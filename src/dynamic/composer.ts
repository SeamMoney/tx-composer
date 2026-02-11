import {
  BuildScriptComposerTransaction,
  CallArgument,
} from "@aptos-labs/script-composer-sdk";
import type { AnyRawTransaction } from "@aptos-labs/ts-sdk";
import type { AptosClient } from "../core/client.js";
import type { TokenConfig } from "../types.js";
import { parseSimulationResult } from "../simulation/simulate.js";
import {
  captureSnapshot,
  extractBalancesFromSimulation,
  computeDiff,
} from "../simulation/flow-tracker.js";
import { diagnoseVmStatus } from "../simulation/errors.js";
import { executeTransaction } from "../core/transaction.js";
import { formatComposedSummary } from "./report.js";
import {
  validateSteps,
  type ValidationWarning,
  type StepValidation,
} from "./validate.js";
import type {
  ComposerStep,
  StepArg,
  RefMode,
  ComposedResult,
  StepArgJSON,
  DynamicPlanJSON,
} from "./types.js";

// ── Argument Resolution ───────────────────────────────────────────

function resolveArg(
  a: StepArg,
  signer: CallArgument,
  results: Map<string, CallArgument[]>,
): CallArgument | string | number | bigint | boolean {
  switch (a.kind) {
    case "signer":
      return signer;

    case "literal":
      return a.value;

    case "ref": {
      const stepResults = results.get(a.step);
      if (!stepResults) {
        throw new Error(
          `Reference to unknown step "${a.step}". Available: [${[...results.keys()].join(", ")}]`,
        );
      }
      if (a.returnIndex >= stepResults.length) {
        throw new Error(
          `Step "${a.step}" has ${stepResults.length} return value(s), but index ${a.returnIndex} was requested`,
        );
      }
      return applyRefMode(stepResults[a.returnIndex], a.mode);
    }
  }
}

function applyRefMode(callArg: CallArgument, mode: RefMode): CallArgument {
  switch (mode) {
    case "move":
      return callArg;
    case "copy":
      return callArg.copy();
    case "borrow":
      return callArg.borrow();
    case "borrow_mut":
      return callArg.borrowMut();
  }
}

// ── JSON Deserialization ──────────────────────────────────────────

function deserializeArg(json: StepArgJSON): StepArg {
  switch (json.kind) {
    case "signer":
      return { kind: "signer" };

    case "literal": {
      let value: string | number | bigint | boolean = json.value;
      if (typeof value === "string" && /^\d+n$/.test(value)) {
        value = BigInt(value.slice(0, -1));
      }
      return { kind: "literal", value };
    }

    case "ref":
      return {
        kind: "ref",
        step: json.step,
        returnIndex: json.returnIndex,
        mode: json.mode ?? "move",
      };
  }
}

// ── DynamicComposer ───────────────────────────────────────────────

export class DynamicComposer {
  private client: AptosClient;
  private steps: Array<{ label: string; step: ComposerStep }> = [];
  private tokens: TokenConfig[] = [];
  private lastWarnings: ValidationWarning[] = [];

  constructor(client: AptosClient) {
    this.client = client;
  }

  addStep(label: string, step: ComposerStep): this {
    if (this.steps.some((s) => s.label === label)) {
      throw new Error(`Duplicate step label: "${label}"`);
    }
    this.steps.push({ label, step });
    return this;
  }

  trackTokens(tokens: TokenConfig[]): this {
    this.tokens = tokens;
    return this;
  }

  async validate(): Promise<{
    validations: StepValidation[];
    warnings: ValidationWarning[];
  }> {
    return validateSteps(this.client.aptos, this.steps);
  }

  async build(options?: { withFeePayer?: boolean }): Promise<AnyRawTransaction> {
    if (this.steps.length === 0) {
      throw new Error("DynamicComposer requires at least one step");
    }

    // Run ABI validation before building
    const { warnings } = await validateSteps(this.client.aptos, this.steps);
    this.lastWarnings = warnings;

    // Hard errors (codes ending in _ERROR) abort the build
    const hardErrors = warnings.filter((w) => w.code.endsWith("_ERROR"));
    if (hardErrors.length > 0) {
      const msgs = hardErrors.map((e) => e.message).join("\n  ");
      throw new Error(`Validation failed:\n  ${msgs}`);
    }

    const steps = this.steps;

    const transaction = await BuildScriptComposerTransaction({
      sender: this.client.accountAddress,
      aptosConfig: this.client.config,
      withFeePayer: options?.withFeePayer,
      builder: async (composer) => {
        const resultsMap = new Map<string, CallArgument[]>();
        const signer = CallArgument.newSigner(0);

        for (const { label, step } of steps) {
          const resolvedArgs = step.args.map((a) =>
            resolveArg(a, signer, resultsMap),
          );

          const callResults = await composer.addBatchedCalls({
            function: step.function,
            typeArguments: step.typeArguments ?? [],
            functionArguments: resolvedArgs,
          });

          resultsMap.set(label, callResults);
        }

        return composer;
      },
    });

    return transaction;
  }

  async simulate(options?: {
    withFeePayer?: boolean;
  }): Promise<ComposedResult> {
    const transaction = await this.build(options);

    const tokenRegistry = new Map<string, string>();
    for (const t of this.tokens) {
      tokenRegistry.set(t.metadata, t.symbol);
    }

    const [rawResult] = await this.client.aptos.transaction.simulate.simple({
      signerPublicKey: options?.withFeePayer
        ? undefined
        : this.client.publicKey,
      transaction,
      ...(options?.withFeePayer
        ? { feePayerPublicKey: this.client.publicKey }
        : {}),
    });

    const simulation = parseSimulationResult(rawResult, tokenRegistry);

    let balanceDiff = null;
    if (this.tokens.length > 0) {
      const snapshot = await captureSnapshot(
        this.client.aptos,
        this.client.address,
        this.tokens,
      );

      const afterBalances = extractBalancesFromSimulation(
        simulation.raw,
        this.tokens,
        this.client.address,
      );

      const mergedBalances = new Map(snapshot.balances);
      for (const [meta, bal] of afterBalances) {
        mergedBalances.set(meta, bal);
      }

      balanceDiff = computeDiff(snapshot, mergedBalances, this.tokens);
    }

    const errors = simulation.success
      ? []
      : diagnoseVmStatus(simulation.vmStatus);

    const warnings = this.lastWarnings;
    const stepLabels = this.steps.map((s) => s.label);

    const summary = formatComposedSummary(
      stepLabels,
      simulation,
      balanceDiff,
      errors,
      warnings,
    );

    const client = this.client;

    return {
      success: simulation.success,
      simulation,
      transaction,
      balanceDiff,
      errors,
      warnings,
      summary,
      stepLabels,
      execute: () =>
        executeTransaction(
          client,
          transaction,
          `Composed: ${stepLabels.join(" \u2192 ")}`,
        ),
    };
  }

  static fromJSON(client: AptosClient, json: DynamicPlanJSON): DynamicComposer {
    const composer = new DynamicComposer(client);

    if (json.tokens) {
      composer.trackTokens(json.tokens);
    }

    for (const step of json.steps) {
      composer.addStep(step.label, {
        function: step.function,
        typeArguments: step.typeArguments,
        args: step.args.map(deserializeArg),
      });
    }

    return composer;
  }
}
