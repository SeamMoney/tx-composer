// Core
export { AptosClient } from "./core/client.js";
export {
  getFABalance,
  getFABalanceSafe,
  getBalances,
  formatAmount,
} from "./core/balance.js";
export {
  buildTransaction,
  simulateTransaction,
  executeTransaction,
  buildAndSimulate,
} from "./core/transaction.js";

// Composer
export { composeActions } from "./composer/composer.js";
export type { ComposedTransactionResult } from "./composer/composer.js";
export { withdrawFromWallet, depositToWallet } from "./composer/helpers.js";

// Protocols
export type {
  ProtocolAdapter,
  DexAdapter,
  LendingAdapter,
} from "./protocols/protocol.js";
export { HyperionAdapter } from "./protocols/hyperion/index.js";
export {
  DEFAULT_HYPERION_CONFIG,
  MAX_SQRT_PRICE_B_TO_A,
  MIN_SQRT_PRICE_A_TO_B,
} from "./protocols/hyperion/index.js";
export type { HyperionConfig } from "./protocols/hyperion/index.js";
export { EchelonAdapter } from "./protocols/echelon/index.js";
export { DEFAULT_ECHELON_CONFIG } from "./protocols/echelon/index.js";
export type { EchelonConfig } from "./protocols/echelon/index.js";

// Simulation — parsing
export { parseSimulationResult } from "./simulation/simulate.js";
export { ForkedSession } from "./simulation/forklift.js";
export type {
  ForkedSessionConfig,
  ForkStepResult,
  ResourceDiff,
} from "./simulation/forklift.js";

// Simulation — flow engine
export { SimulationPlanBuilder, dryRun } from "./simulation/plan.js";
export { formatFlowReport } from "./simulation/report.js";
export { diagnoseVmStatus } from "./simulation/errors.js";
export {
  captureSnapshot,
  extractBalancesFromSimulation,
  extractVaultFromSimulation,
  computeDeltas,
  computeDiff,
  validateExpectations,
} from "./simulation/flow-tracker.js";

// Types — core
export type {
  ToolkitConfig,
  TokenConfig,
  EntryFunctionPayload,
  SimulationResult,
  ParsedEvent,
  BalanceChange,
  VaultChange,
  ExecutionResult,
  ComposableAction,
  ComposerContext,
} from "./types.js";

// Dynamic Composer
export { DynamicComposer } from "./dynamic/composer.js";
export { arg } from "./dynamic/types.js";
export { formatComposedSummary } from "./dynamic/report.js";
export { validateSteps } from "./dynamic/validate.js";
export type { StepValidation, ValidationWarning } from "./dynamic/validate.js";

// Types — simulation engine
export type {
  BalanceSnapshot,
  VaultSnapshot,
  BalanceDelta,
  BalanceDiff,
  PlanStep,
  StepExpectation,
  ExpectationType,
  SimulationPlan,
  StepResult,
  ExpectationResult,
  ErrorSeverity,
  DiagnosedError,
  FlowReport,
} from "./simulation/types.js";

// Types — dynamic composer
export type {
  StepArg,
  RefMode,
  ComposerStep,
  ComposedResult,
  StepArgJSON,
  DynamicStepJSON,
  DynamicPlanJSON,
} from "./dynamic/types.js";
