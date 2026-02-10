import type { AnyRawTransaction } from "@aptos-labs/ts-sdk";
import type { TokenConfig, SimulationResult, ExecutionResult } from "../types.js";
import type { BalanceDiff, DiagnosedError } from "../simulation/types.js";

// ── Argument System ───────────────────────────────────────────────

export type RefMode = "move" | "copy" | "borrow" | "borrow_mut";

export type StepArg =
  | { kind: "signer" }
  | { kind: "literal"; value: string | number | bigint | boolean }
  | { kind: "ref"; step: string; returnIndex: number; mode: RefMode };

/** Ergonomic factories for building step arguments */
export const arg = {
  signer: (): StepArg => ({ kind: "signer" }),
  literal: (value: string | number | bigint | boolean): StepArg => ({
    kind: "literal",
    value,
  }),
  ref: (step: string, returnIndex: number, mode: RefMode = "move"): StepArg => ({
    kind: "ref",
    step,
    returnIndex,
    mode,
  }),
};

// ── Step Definition ───────────────────────────────────────────────

export interface ComposerStep {
  function: `${string}::${string}::${string}`;
  typeArguments?: string[];
  args: StepArg[];
}

// ── Simulation Result ─────────────────────────────────────────────

export interface ComposedResult {
  success: boolean;
  simulation: SimulationResult;
  transaction: AnyRawTransaction;
  balanceDiff: BalanceDiff | null;
  errors: DiagnosedError[];
  summary: string;
  stepLabels: string[];
  execute: () => Promise<ExecutionResult>;
}

// ── JSON Schema (AI-agent input) ──────────────────────────────────

export type StepArgJSON =
  | { kind: "signer" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "ref"; step: string; returnIndex: number; mode?: RefMode };

export interface DynamicStepJSON {
  label: string;
  function: `${string}::${string}::${string}`;
  typeArguments?: string[];
  args: StepArgJSON[];
}

export interface DynamicPlanJSON {
  tokens?: TokenConfig[];
  steps: DynamicStepJSON[];
}
