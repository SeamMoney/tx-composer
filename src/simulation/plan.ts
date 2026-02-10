import type { AptosClient } from "../core/client.js";
import type { TokenConfig, EntryFunctionPayload } from "../types.js";
import type {
  SimulationPlan,
  PlanStep,
  StepExpectation,
  StepResult,
  FlowReport,
  VaultSnapshot,
} from "./types.js";
import { buildAndSimulate } from "../core/transaction.js";
import {
  captureSnapshot,
  extractBalancesFromSimulation,
  extractVaultFromSimulation,
  computeDeltas,
  computeDiff,
  validateExpectations,
} from "./flow-tracker.js";
import { diagnoseVmStatus } from "./errors.js";
import { parseSimulationResult } from "./simulate.js";
import { formatFlowReport } from "./report.js";

// ── Plan Builder ──────────────────────────────────────────────────

export class SimulationPlanBuilder {
  private _name: string;
  private _description = "";
  private _owner = "";
  private _tokens: TokenConfig[] = [];
  private _steps: PlanStep[] = [];
  private _vaultMarket?: string;
  private _vaultProtocol?: string;

  constructor(name: string) {
    this._name = name;
  }

  describe(description: string): this {
    this._description = description;
    return this;
  }

  forWallet(owner: string): this {
    this._owner = owner;
    return this;
  }

  trackTokens(tokens: TokenConfig[]): this {
    this._tokens = tokens;
    return this;
  }

  trackVault(market: string, protocolAddress: string): this {
    this._vaultMarket = market;
    this._vaultProtocol = protocolAddress;
    return this;
  }

  addStep(step: {
    label: string;
    description: string;
    payload: EntryFunctionPayload;
    expectations?: StepExpectation[];
  }): this {
    this._steps.push(step);
    return this;
  }

  build(): SimulationPlan {
    if (!this._owner) throw new Error("SimulationPlan requires a wallet (forWallet)");
    if (this._tokens.length === 0) throw new Error("SimulationPlan requires tracked tokens (trackTokens)");
    if (this._steps.length === 0) throw new Error("SimulationPlan requires at least one step (addStep)");

    return {
      name: this._name,
      description: this._description,
      owner: this._owner,
      tokens: this._tokens,
      steps: this._steps,
      vaultMarket: this._vaultMarket,
      vaultProtocol: this._vaultProtocol,
    };
  }
}

// ── Dry Run Executor ──────────────────────────────────────────────

export async function dryRun(
  client: AptosClient,
  plan: SimulationPlan,
): Promise<FlowReport> {
  const tokenRegistry = new Map<string, string>();
  for (const t of plan.tokens) {
    tokenRegistry.set(t.metadata, t.symbol);
  }

  // 1. Capture initial on-chain balances
  const initialSnapshot = await captureSnapshot(
    client.aptos,
    plan.owner,
    plan.tokens,
  );

  const stepResults: StepResult[] = [];
  let currentBalances = new Map(initialSnapshot.balances);
  let currentVault: VaultSnapshot | null = null;
  let allSuccess = true;

  // 2. Simulate each step
  for (const step of plan.steps) {
    const start = performance.now();

    const { simulation } = await buildAndSimulate(
      client,
      step.payload,
      tokenRegistry,
    );

    const durationMs = performance.now() - start;

    // Extract balances from this simulation's WriteSetChanges
    const afterBalances = extractBalancesFromSimulation(
      simulation.raw,
      plan.tokens,
      plan.owner,
    );

    // Merge: for tokens not in the simulation result, carry forward from current state
    const mergedBalances = new Map(currentBalances);
    for (const [meta, bal] of afterBalances) {
      mergedBalances.set(meta, bal);
    }

    // Extract vault state if tracking
    let vaultAfter: VaultSnapshot | undefined;
    if (plan.vaultProtocol) {
      const vaultResult = extractVaultFromSimulation(
        simulation.raw,
        plan.vaultProtocol,
      );
      if (vaultResult) {
        vaultAfter = vaultResult;
      }
    }

    // Compute deltas for this step
    const deltas = computeDeltas(currentBalances, mergedBalances, plan.tokens);

    // Validate expectations
    const expectationResults = step.expectations
      ? validateExpectations(
          step.expectations,
          deltas,
          currentVault,
          vaultAfter ?? null,
        )
      : [];

    // Diagnose errors if simulation failed
    const vmStatus = simulation.vmStatus;
    const stepSuccess = simulation.success;
    if (!stepSuccess) allSuccess = false;

    stepResults.push({
      label: step.label,
      description: step.description,
      success: stepSuccess,
      vmStatus,
      gasUsed: simulation.gasUsed,
      gasCostApt: simulation.gasCostApt,
      events: simulation.events,
      balancesAfter: mergedBalances,
      vaultAfter,
      deltas,
      expectationResults,
      durationMs,
    });

    // Advance state for next step
    currentBalances = mergedBalances;
    if (vaultAfter) currentVault = vaultAfter;
  }

  // 3. Compute overall diff (initial → final)
  const overallDiff = computeDiff(
    initialSnapshot,
    currentBalances,
    plan.tokens,
    null,
    currentVault,
  );

  // 4. Collect all errors and warnings
  const errors = stepResults
    .filter((s) => !s.success)
    .flatMap((s) => diagnoseVmStatus(s.vmStatus, s.label));

  const warnings = stepResults
    .flatMap((s) =>
      s.expectationResults
        .filter((e) => !e.passed)
        .map((e) => ({
          severity: "warning" as const,
          code: "EXPECTATION_FAILED",
          title: `Expectation failed: ${e.description}`,
          detail: `Actual: ${e.actual}`,
          suggestion: "Review the step inputs and expected outcomes.",
          stepLabel: s.label,
        })),
    );

  // 5. Build report
  const report: FlowReport = {
    plan,
    success: allSuccess,
    totalGasUsed: stepResults.reduce((sum, s) => sum + s.gasUsed, 0),
    totalGasCostApt: stepResults.reduce((sum, s) => sum + s.gasCostApt, 0),
    initialSnapshot,
    stepResults,
    overallDiff,
    errors,
    warnings,
    summary: "", // filled below
  };

  report.summary = formatFlowReport(report);

  return report;
}
