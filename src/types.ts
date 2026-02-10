import type {
  Account,
  AccountAddress,
  Aptos,
  AptosConfig,
  Network,
  UserTransactionResponse,
  CommittedTransactionResponse,
  SimpleTransaction,
  Ed25519PublicKey,
} from "@aptos-labs/ts-sdk";
import type {
  CallArgument,
  AptosScriptComposer,
} from "@aptos-labs/script-composer-sdk";

// ── Token ─────────────────────────────────────────────────────────────

export interface TokenConfig {
  symbol: string;
  metadata: string;
  decimals: number;
}

// ── Network + Wallet ──────────────────────────────────────────────────

export interface ToolkitConfig {
  network: Network;
  apiKey?: string;
  /** Private key (hex or ed25519-priv- prefixed). Enables execution. */
  privateKey?: string;
  /** Public key hex. For simulation-only mode (no private key). */
  publicKey?: string;
}

// ── Transaction Payloads ──────────────────────────────────────────────

export interface EntryFunctionPayload {
  function: `${string}::${string}::${string}`;
  typeArguments: string[];
  functionArguments: (string | number | bigint | boolean | string[])[];
}

// ── Simulation Results ────────────────────────────────────────────────

export interface SimulationResult {
  success: boolean;
  vmStatus: string;
  gasUsed: number;
  gasUnitPrice: number;
  gasCostApt: number;
  events: ParsedEvent[];
  balanceChanges: BalanceChange[];
  vaultChanges: VaultChange[];
  raw: UserTransactionResponse;
}

export interface ParsedEvent {
  type: string;
  shortType: string;
  amount?: bigint;
  data: Record<string, unknown>;
}

export interface BalanceChange {
  address: string;
  token: string;
  tokenMetadata: string;
  balance: bigint;
}

export interface VaultChange {
  address: string;
  collateral: bigint;
  debtPrincipal: bigint;
}

// ── Execution Results ─────────────────────────────────────────────────

export interface ExecutionResult {
  hash: string;
  success: boolean;
  vmStatus?: string;
  gasUsed?: number;
  response: CommittedTransactionResponse;
}

// ── Composable Actions ────────────────────────────────────────────────

export interface ComposableAction {
  description: string;
  build: (ctx: ComposerContext) => Promise<CallArgument[]>;
}

export interface ComposerContext {
  composer: AptosScriptComposer;
  results: Map<string, CallArgument[]>;
  signer: CallArgument;
}
