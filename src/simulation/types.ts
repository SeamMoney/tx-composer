import type { TokenConfig, EntryFunctionPayload, ParsedEvent } from "../types.js";

// ── Balance Tracking ───────────────────────────────────────────────

export interface BalanceSnapshot {
  owner: string;
  balances: Map<string, bigint>;
  vault?: VaultSnapshot;
}

export interface VaultSnapshot {
  market: string;
  collateral: bigint;
  debtPrincipal: bigint;
  exists: boolean;
}

export interface BalanceDelta {
  token: TokenConfig;
  before: bigint;
  after: bigint;
  delta: bigint;
  deltaFormatted: string;
}

export interface BalanceDiff {
  owner: string;
  deltas: BalanceDelta[];
  vault?: {
    before: VaultSnapshot | null;
    after: VaultSnapshot | null;
  };
}

// ── Simulation Plan ────────────────────────────────────────────────

export interface PlanStep {
  label: string;
  description: string;
  payload: EntryFunctionPayload;
  expectations?: StepExpectation[];
}

export type ExpectationType =
  | "balance_increase"
  | "balance_decrease"
  | "vault_debt_decrease"
  | "vault_collateral_decrease"
  | "success";

export interface StepExpectation {
  type: ExpectationType;
  token?: string;
  description: string;
}

export interface SimulationPlan {
  name: string;
  description: string;
  owner: string;
  tokens: TokenConfig[];
  steps: PlanStep[];
  vaultMarket?: string;
  vaultProtocol?: string;
}

// ── Step Result ────────────────────────────────────────────────────

export interface StepResult {
  label: string;
  description: string;
  success: boolean;
  vmStatus: string;
  gasUsed: number;
  gasCostApt: number;
  events: ParsedEvent[];
  balancesAfter: Map<string, bigint>;
  vaultAfter?: VaultSnapshot;
  deltas: BalanceDelta[];
  expectationResults: ExpectationResult[];
  durationMs: number;
}

export interface ExpectationResult {
  passed: boolean;
  description: string;
  actual: string;
}

// ── Error Diagnosis ────────────────────────────────────────────────

export type ErrorSeverity = "error" | "warning";

export interface DiagnosedError {
  severity: ErrorSeverity;
  code: string;
  title: string;
  detail: string;
  suggestion: string;
  stepLabel?: string;
}

// ── Flow Report ────────────────────────────────────────────────────

export interface FlowReport {
  plan: SimulationPlan;
  success: boolean;
  totalGasUsed: number;
  totalGasCostApt: number;
  initialSnapshot: BalanceSnapshot;
  stepResults: StepResult[];
  overallDiff: BalanceDiff;
  errors: DiagnosedError[];
  warnings: DiagnosedError[];
  summary: string;
}
