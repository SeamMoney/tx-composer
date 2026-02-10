// Core
export { AptosClient } from "./core/client.js";
export { getFABalance, getBalances, formatAmount } from "./core/balance.js";
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

// Simulation
export { parseSimulationResult } from "./simulation/simulate.js";
export { ForkliftReader } from "./simulation/forklift.js";

// Types
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
