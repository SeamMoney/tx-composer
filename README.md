# tx-composer

Simulate-first DeFi transaction composer for Aptos. Build, dry-run, and execute complex multi-step DeFi flows with balance tracking, error diagnosis, and human-readable reports — before committing real funds.

Built for AI agents and programmatic DeFi execution where you need to **know exactly what will happen** before signing anything.

## What It Does

- **Dry-run multi-step flows**: Simulate a sequence of transactions (swap → repay → withdraw) and see exactly how balances change at each step
- **Atomic composition**: Combine multiple DeFi operations into a single all-or-nothing transaction using [Aptos Script Composer](https://aptos.dev/build/sdks/ts-sdk/building-transactions/script-composer)
- **Error diagnosis**: Pattern-match Move VM errors into actionable messages ("Repay amount exceeds debt — use repay_all instead")
- **Balance tracking**: Capture before/after snapshots, compute per-token deltas, validate expectations
- **Protocol adapters**: Pluggable adapters for DEXs and lending protocols with both entry-function and composable interfaces

## Install

```bash
npm install tx-composer
```

Requires `@aptos-labs/ts-sdk` v5+.

## Quick Start

```typescript
import { Network } from "@aptos-labs/ts-sdk";
import {
  AptosClient,
  getFABalance,
  formatAmount,
  buildAndSimulate,
  executeTransaction,
  HyperionAdapter,
} from "tx-composer";

// Initialize — pass privateKey to enable execution, or publicKey for simulation-only
const client = new AptosClient({
  network: Network.MAINNET,
  privateKey: process.env.APTOS_PRIVATE_KEY,
});

const hyperion = new HyperionAdapter();

// Define tokens
const USDC = { symbol: "USDC", metadata: "0xbae207...", decimals: 6 };
const USD1 = { symbol: "USD1", metadata: "0x05fabd...", decimals: 6 };

// Check balance
const balance = await getFABalance(client.aptos, client.address, USDC.metadata);
console.log(`USDC: ${formatAmount(balance, 6)}`);

// Simulate a swap
const payload = hyperion.buildSwapPayload({
  pools: [hyperion.getPool("USD1_USDC")!],
  tokenIn: USDC,
  tokenOut: USD1,
  amountIn: balance,
  minAmountOut: (balance * 995n) / 1000n, // 0.5% slippage
  recipient: client.address,
});

const { transaction, simulation } = await buildAndSimulate(client, payload);
console.log(`Success: ${simulation.success}, Gas: ${simulation.gasCostApt} APT`);

// Execute only if simulation passed
if (simulation.success) {
  const result = await executeTransaction(client, transaction, "Swap USDC → USD1");
  console.log(`TX: ${result.hash}`);
}
```

## Dry-Run Multi-Step Flows

This is the core feature. Define a multi-step DeFi plan, simulate each step, track how money moves, and get a full report before touching real funds.

### Example: Withdraw from a Lending Position

You have 252 USD1 deposited as collateral and 204 USD1 of debt on Echelon. You deposited 205 USDC to repay. The plan: swap USDC → USD1, repay all debt, withdraw all collateral.

```typescript
import { Network } from "@aptos-labs/ts-sdk";
import {
  AptosClient,
  SimulationPlanBuilder,
  dryRun,
  HyperionAdapter,
  EchelonAdapter,
  type TokenConfig,
} from "tx-composer";

const client = new AptosClient({
  network: Network.MAINNET,
  publicKey: "0xc75bb89f...", // simulation-only, no private key needed
});

const hyperion = new HyperionAdapter();
const echelon = new EchelonAdapter();

const USDC: TokenConfig = {
  symbol: "USDC",
  metadata: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
  decimals: 6,
};
const USD1: TokenConfig = {
  symbol: "USD1",
  metadata: "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2",
  decimals: 6,
};

const market = echelon.getMarket("USD1")!;
const pool = hyperion.getPool("USD1_USDC")!;

// Build the plan
const plan = new SimulationPlanBuilder("Echelon Withdrawal")
  .describe("Swap USDC → USD1, repay all debt, withdraw all collateral")
  .forWallet(client.address)
  .trackTokens([USDC, USD1])
  .trackVault(market, echelon.address)
  .addStep({
    label: "swap",
    description: "Swap 205 USDC → USD1 via Hyperion",
    payload: hyperion.buildSwapPayload({
      pools: [pool],
      tokenIn: USDC,
      tokenOut: USD1,
      amountIn: 205_000000n, // 205 USDC (6 decimals)
      minAmountOut: 204_000000n, // ~0.5% slippage
      recipient: client.address,
    }),
    expectations: [
      { type: "balance_decrease", token: USDC.metadata, description: "USDC spent" },
      { type: "balance_increase", token: USD1.metadata, description: "USD1 received" },
    ],
  })
  .addStep({
    label: "repay",
    description: "Repay all USD1 debt on Echelon",
    payload: echelon.buildRepayAllPayload(market),
    expectations: [
      { type: "vault_debt_decrease", description: "Debt cleared" },
    ],
  })
  .addStep({
    label: "withdraw",
    description: "Withdraw all USD1 collateral from Echelon",
    payload: echelon.buildWithdrawAllPayload(market),
    expectations: [
      { type: "vault_collateral_decrease", description: "Collateral withdrawn" },
      { type: "balance_increase", token: USD1.metadata, description: "USD1 collateral received" },
    ],
  })
  .build();

// Run the dry-run
const report = await dryRun(client, plan);

// Print human-readable report
console.log(report.summary);

// Programmatic access
if (report.success) {
  console.log("\nSafe to execute with real funds!");
  console.log(`Total gas: ${report.totalGasCostApt.toFixed(6)} APT`);

  for (const delta of report.overallDiff.deltas) {
    if (delta.delta !== 0n) {
      console.log(`  ${delta.token.symbol}: ${delta.deltaFormatted}`);
    }
  }
} else {
  console.log("\nDry run FAILED:");
  for (const err of report.errors) {
    console.log(`  [${err.code}] ${err.title}`);
    console.log(`    ${err.suggestion}`);
  }
}
```

Output:
```
══ Echelon Withdrawal — Dry Run ══
Swap USDC → USD1, repay all debt, withdraw all collateral

Starting Balances:
  USDC   205.000000
  USD1     0.000000

Step 1: Swap 205 USDC → USD1 via Hyperion [OK]
  USDC   -205.000000
  USD1   +205.027736
  ✓ USDC spent (-205.000000 USDC)
  ✓ USD1 received (+205.027736 USD1)
  Gas: 0.001234 APT

Step 2: Repay all USD1 debt on Echelon [OK]
  USD1   -204.191062
  ✓ Debt cleared (debt 204191062 → 0)
  Gas: 0.000891 APT

Step 3: Withdraw all USD1 collateral from Echelon [OK]
  USD1   +252.343981
  ✓ Collateral withdrawn (collateral 252343981 → 0)
  ✓ USD1 collateral received (+252.343981 USD1)
  Gas: 0.000756 APT

Final Balances:
  USDC     0.000000
  USD1   253.180655

Net: USDC -205.000000, USD1 +253.180655
Total Gas: 0.002881 APT
Result: ALL STEPS PASSED

Note: Each step was simulated against current mainnet state independently.
Steps 2+ may differ slightly from actual execution since prior steps haven't committed.
```

### Example: Detect Failures Before They Happen

```typescript
// Simulate repaying more than you owe
const badPlan = new SimulationPlanBuilder("Bad Repay Test")
  .describe("Intentionally repay more than debt to test error detection")
  .forWallet(client.address)
  .trackTokens([USD1])
  .addStep({
    label: "repay",
    description: "Repay all debt (but we have no debt)",
    payload: echelon.buildRepayAllPayload(market),
    expectations: [
      { type: "success", description: "Transaction succeeds" },
    ],
  })
  .build();

const report = await dryRun(client, badPlan);

// report.success === false
// report.errors[0]:
// {
//   code: "ARITHMETIC_OVERFLOW",
//   title: "Arithmetic overflow in contract",
//   suggestion: "Check that repay amount <= outstanding debt. Verify swap amounts against pool liquidity."
// }
```

### FlowReport Structure

The `dryRun()` function returns a `FlowReport` with full programmatic access:

```typescript
interface FlowReport {
  plan: SimulationPlan;           // the input plan
  success: boolean;               // true if ALL steps passed
  totalGasUsed: number;           // aggregate gas across all steps
  totalGasCostApt: number;        // total gas in APT
  initialSnapshot: BalanceSnapshot; // starting on-chain balances
  stepResults: StepResult[];      // per-step: success, balances, deltas, events, errors
  overallDiff: BalanceDiff;       // net change from start to finish
  errors: DiagnosedError[];       // actionable error diagnosis for failed steps
  warnings: DiagnosedError[];     // failed expectations that didn't cause step failure
  summary: string;                // pre-formatted human-readable report
}
```

Each `StepResult` contains:

```typescript
interface StepResult {
  label: string;
  success: boolean;
  vmStatus: string;
  gasUsed: number;
  gasCostApt: number;
  events: ParsedEvent[];           // all events emitted by this step
  balancesAfter: Map<string, bigint>; // tracked token balances after this step
  deltas: BalanceDelta[];          // per-token change from previous state
  expectationResults: ExpectationResult[]; // pass/fail for each expectation
  durationMs: number;              // wall-clock simulation time
}
```

## Atomic Multi-Step Transactions

For operations that **must** succeed or fail together, compose them into a single atomic transaction using Script Composer. This is different from dry-run (which simulates separate transactions) — here everything executes in one tx.

### Example: Swap + Repay in One Transaction

```typescript
import {
  AptosClient,
  composeActions,
  simulateTransaction,
  executeTransaction,
  withdrawFromWallet,
  depositToWallet,
  HyperionAdapter,
  EchelonAdapter,
} from "tx-composer";

const client = new AptosClient({
  network: Network.MAINNET,
  privateKey: process.env.APTOS_PRIVATE_KEY,
});

const hyperion = new HyperionAdapter();
const echelon = new EchelonAdapter();

const USDC_META = "0xbae207...";
const pool = hyperion.getPool("USD1_USDC")!;
const market = echelon.getMarket("USD1")!;

// Compose: withdraw USDC → swap → repay debt — all atomic
const { transaction, actionDescriptions } = await composeActions(client, [
  {
    label: "withdraw_usdc",
    action: withdrawFromWallet(USDC_META, 205_000000n),
  },
  {
    label: "swap",
    action: hyperion.buildComposableSwap({
      pool,
      tokenIn: USDC,
      tokenOut: USD1,
      amountIn: 205_000000n,
      faIn: null!, // wired from ctx.results["withdraw_usdc"][0] inside build()
      aToB: false,
    }),
  },
  {
    label: "repay",
    action: echelon.buildComposableRepay({
      market,
      faIn: null!, // wired from ctx.results["swap"][2] (output FA) inside build()
    }),
  },
]);

// Simulate the composed atomic transaction
const sim = await simulateTransaction(client, transaction);
console.log(`Composed TX: ${sim.success ? "OK" : "FAILED"}, Gas: ${sim.gasCostApt} APT`);

// Execute if simulation passes
if (sim.success && client.canExecute) {
  const result = await executeTransaction(client, transaction, "Atomic swap + repay");
  console.log(`TX: ${result.hash}`);
}
```

### Wiring CallArguments Between Actions

In composable actions, each action's `build()` receives a `ComposerContext`:

```typescript
interface ComposerContext {
  composer: AptosScriptComposer;      // the script composer instance
  results: Map<string, CallArgument[]>; // outputs from all prior actions
  signer: CallArgument;               // reference to the transaction signer
}
```

Actions reference prior results by label:

```typescript
// Custom composable action that uses output from "swap" step
const myAction: ComposableAction = {
  description: "Deposit swap output to wallet",
  async build(ctx) {
    const swapResults = ctx.results.get("swap")!;
    const outputFA = swapResults[2]; // FungibleAsset output from Hyperion swap

    return ctx.composer.addBatchedCalls({
      function: "0x1::primary_fungible_store::deposit",
      functionArguments: [ctx.signer, outputFA],
      typeArguments: [],
    });
  },
};
```

## Simulation-Only Mode

Pass just a public key (no private key) for safe simulation without execution capability:

```typescript
const client = new AptosClient({
  network: Network.MAINNET,
  publicKey: "0xc75bb89f...",
});

// client.canExecute === false
// buildAndSimulate() works
// dryRun() works
// executeTransaction() throws "Cannot execute: no private key provided"
```

This is the recommended mode for AI agents doing analysis — simulate freely without risk of accidental execution.

## Error Diagnosis

The `diagnoseVmStatus()` function pattern-matches Move VM error strings into actionable diagnostics:

```typescript
import { diagnoseVmStatus } from "tx-composer";

const errors = diagnoseVmStatus("Move abort: 0x10004 at 0xc6bc...::lending");
// [{
//   severity: "error",
//   code: "LENDING_ERROR",
//   title: "Lending protocol error",
//   detail: "The lending protocol rejected the operation.",
//   suggestion: "Check: repay amount <= debt, withdrawal won't breach health factor, position exists."
// }]
```

Recognized error patterns:

| Code | Matches | Suggestion |
|------|---------|------------|
| `INSUFFICIENT_BALANCE` | `65540`, `INSUFFICIENT_BALANCE` | Verify wallet holds enough tokens |
| `ARITHMETIC_OVERFLOW` | `ARITHMETIC_ERROR` | Repay amount may exceed debt |
| `OUT_OF_GAS` | `OUT_OF_GAS` | Increase max gas or reduce steps |
| `SEQUENCE_NUMBER_ERROR` | `SEQUENCE_NUMBER` | Wait for pending txs to finalize |
| `REPAY_EXCEEDS_DEBT` | `repay_amount_exceeds` | Use repay_all instead |
| `INSUFFICIENT_SHARES` | `insufficient_shares` | Reduce withdrawal or use withdraw_all |
| `PRICE_LIMIT_ERROR` | `sqrt_price` | Increase slippage or reduce amount |
| `LENDING_ERROR` | `lending` | Check repay/withdrawal constraints |
| `DEX_POOL_ERROR` | `pool_v3`, `pool_v2` | Check slippage and pool liquidity |
| `MOVE_ABORT` | `ABORTED` | Check abort code against protocol source |

## Protocol Adapters

### Hyperion DEX

```typescript
import { HyperionAdapter, MAX_SQRT_PRICE_B_TO_A, MIN_SQRT_PRICE_A_TO_B } from "tx-composer";

const hyperion = new HyperionAdapter(); // default mainnet config
// or with custom config:
const hyperion = new HyperionAdapter({
  address: "0x8b4a2c...",
  pools: {
    "USD1_USDC": "0x1609a6...",
    "APT_USDC": "0xabc...",
  },
});

// Get a swap quote (view function, no gas)
const quote = await hyperion.getSwapQuote(client, USDC, USD1, 100_000000n, [pool]);

// Build entry function payload (for standalone transactions)
const payload = hyperion.buildSwapPayload({
  pools: [pool],
  tokenIn: USDC,
  tokenOut: USD1,
  amountIn: 100_000000n,
  minAmountOut: 99_500000n,
  recipient: client.address,
});

// Build composable action (for atomic multi-step)
const action = hyperion.buildComposableSwap({
  pool,
  tokenIn: USDC,
  tokenOut: USD1,
  amountIn: 100_000000n,
  faIn: callArgFromPriorStep,
  aToB: false, // USDC → USD1 (b→a for this pool)
  sqrtPriceLimit: MAX_SQRT_PRICE_B_TO_A, // default for b→a
});
```

**Pool ordering**: Hyperion V3 pools have a fixed token order (token_a, token_b). For USD1_USDC: token_a=USD1, token_b=USDC. So USDC→USD1 is `aToB: false`.

### Echelon Lending

```typescript
import { EchelonAdapter } from "tx-composer";

const echelon = new EchelonAdapter(); // default mainnet config

// Get market address
const market = echelon.getMarket("USD1")!;

// Entry function payloads (standalone transactions)
const repayPayload = echelon.buildRepayAllPayload(market);
const withdrawPayload = echelon.buildWithdrawAllPayload(market);

// Composable actions (for atomic multi-step)
const repayAction = echelon.buildComposableRepay({ market, faIn: debtTokenFA });
const withdrawAction = echelon.buildComposableWithdraw({ market, amount: 252_000000n });
```

### Adding a New Protocol Adapter

Implement `DexAdapter` or `LendingAdapter`:

```typescript
import type {
  DexAdapter,
  EntryFunctionPayload,
  ComposableAction,
  TokenConfig,
} from "tx-composer";
import type { AptosClient } from "tx-composer";

export class PancakeSwapAdapter implements DexAdapter {
  readonly name = "PancakeSwap";
  readonly address = "0x...";

  async getSwapQuote(
    client: AptosClient,
    tokenIn: TokenConfig,
    tokenOut: TokenConfig,
    amountIn: bigint,
    pools: string[],
  ): Promise<bigint | null> {
    // Call the protocol's view function to get an output quote
    const result = await client.aptos.view({
      payload: {
        function: `${this.address}::router::get_amount_out`,
        typeArguments: [],
        functionArguments: [pools[0], amountIn.toString(), tokenIn.metadata],
      },
    });
    return BigInt(result[0] as string);
  }

  buildSwapPayload(params: {
    pools: string[];
    tokenIn: TokenConfig;
    tokenOut: TokenConfig;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: string;
  }): EntryFunctionPayload {
    return {
      function: `${this.address}::router::swap_exact_input`,
      typeArguments: [],
      functionArguments: [
        params.pools[0],
        params.tokenIn.metadata,
        params.tokenOut.metadata,
        params.amountIn.toString(),
        params.minAmountOut.toString(),
      ],
    };
  }

  buildComposableSwap(params: { /* ... */ }): ComposableAction {
    return {
      description: `Swap via PancakeSwap`,
      async build(ctx) {
        return ctx.composer.addBatchedCalls({
          function: `${this.address}::pool::swap`,
          functionArguments: [params.pool, params.faIn, /* ... */],
          typeArguments: [],
        });
      },
    };
  }
}
```

Then use it with the simulation engine:

```typescript
const pancake = new PancakeSwapAdapter();

const plan = new SimulationPlanBuilder("PancakeSwap Trade")
  .forWallet(client.address)
  .trackTokens([APT, USDC])
  .addStep({
    label: "swap",
    description: "Swap APT → USDC",
    payload: pancake.buildSwapPayload({ /* ... */ }),
    expectations: [
      { type: "balance_increase", token: USDC.metadata, description: "USDC received" },
    ],
  })
  .build();

const report = await dryRun(client, plan);
```

## API Reference

### Core

| Export | Description |
|--------|------------|
| `AptosClient` | Wrapper with wallet management. Accepts `privateKey` (full) or `publicKey` (sim-only) |
| `getFABalance(aptos, owner, metadata)` | Query a single fungible asset balance |
| `getFABalanceSafe(aptos, owner, metadata)` | Same but returns `{ balance, error? }` instead of swallowing errors |
| `getBalances(aptos, owner, tokens[])` | Parallel multi-token balance query |
| `formatAmount(raw, decimals)` | Format raw bigint to human-readable string |

### Transactions

| Export | Description |
|--------|------------|
| `buildTransaction(client, payload)` | Build a transaction from an entry function payload |
| `simulateTransaction(client, tx, tokenRegistry?)` | Simulate and parse results |
| `executeTransaction(client, tx, description?)` | Sign, submit, and wait for confirmation |
| `buildAndSimulate(client, payload, tokenRegistry?)` | Build + simulate in one call |

### Composition

| Export | Description |
|--------|------------|
| `composeActions(client, actions[])` | Compose multiple actions into a single atomic transaction |
| `withdrawFromWallet(metadata, amount)` | Composable: withdraw FA from signer's store |
| `depositToWallet(recipient, faArgument)` | Composable: deposit FA to recipient |

### Simulation Engine

| Export | Description |
|--------|------------|
| `SimulationPlanBuilder` | Fluent builder for multi-step simulation plans |
| `dryRun(client, plan)` | Execute a simulation plan and return a FlowReport |
| `formatFlowReport(report)` | Format a FlowReport as human-readable text |
| `diagnoseVmStatus(vmStatus, stepLabel?)` | Diagnose VM errors into actionable messages |
| `captureSnapshot(aptos, owner, tokens[])` | Capture current on-chain balances |
| `extractBalancesFromSimulation(raw, tokens, owner)` | Extract balances from simulation WriteSetChanges |
| `extractVaultFromSimulation(raw, protocolAddr)` | Extract vault state from simulation |
| `computeDeltas(before, after, tokens)` | Compute per-token balance deltas |
| `computeDiff(before, after, tokens, vaultBefore?, vaultAfter?)` | Full balance diff |
| `validateExpectations(expectations, deltas, vaultBefore?, vaultAfter?)` | Check step expectations |

### Simulation Types

```typescript
import type {
  SimulationPlan,        // plan definition
  PlanStep,              // a step in the plan
  StepExpectation,       // expected outcome for a step
  ExpectationType,       // "balance_increase" | "balance_decrease" | "vault_debt_decrease" | ...
  FlowReport,            // full dry-run result
  StepResult,            // per-step simulation result
  BalanceSnapshot,       // point-in-time balance state
  BalanceDelta,          // single token's change
  BalanceDiff,           // full balance comparison
  VaultSnapshot,         // lending vault state
  DiagnosedError,        // actionable error diagnosis
  ExpectationResult,     // pass/fail for an expectation
} from "tx-composer";
```

## Architecture

```
tx-composer/
├── core/
│   ├── client.ts          # AptosClient (wallet management, dual-mode)
│   ├── balance.ts         # FA balance queries
│   └── transaction.ts     # build, simulate, execute
├── composer/
│   ├── composer.ts        # Script Composer atomic transactions
│   └── helpers.ts         # withdraw/deposit composable actions
├── protocols/
│   ├── protocol.ts        # DexAdapter / LendingAdapter interfaces
│   ├── hyperion/          # Hyperion DEX adapter
│   └── echelon/           # Echelon lending adapter
├── simulation/
│   ├── types.ts           # SimulationPlan, FlowReport, StepResult, etc.
│   ├── simulate.ts        # Parse simulation responses (events, balances, vaults)
│   ├── plan.ts            # SimulationPlanBuilder + dryRun() executor
│   ├── report.ts          # Human-readable report formatter
│   ├── flow-tracker.ts    # Balance snapshots, diffs, expectation validation
│   ├── errors.ts          # VM error → actionable diagnosis
│   └── forklift.ts        # Forklift state fork reader (optional)
├── types.ts               # Core type definitions
└── index.ts               # Public API exports
```

## Known Limitations

1. **Sequential simulation caveat**: Each step in `dryRun()` simulates against the current mainnet state independently. Step 2 doesn't see Step 1's state changes. The balance carry-forward is approximated from simulation WriteSetChanges. For fully accurate sequential simulation, use Forklift with state forking (see roadmap).

2. **Protocol coverage**: Currently supports Hyperion DEX (swaps) and Echelon Lending (repay/withdraw). Deposit, borrow, and liquidation operations are not yet implemented.

3. **Single-pool swaps only**: Hyperion adapter supports single-pool swaps. Multi-hop routing across multiple pools is not yet supported.

4. **Single vault tracking**: The dry-run engine tracks one vault (market) per plan. Multi-market positions require separate plans.

## Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `@aptos-labs/ts-sdk` | Yes | Core Aptos SDK |
| `@aptos-labs/script-composer-sdk` | Yes | Atomic transaction composition |
| `@aptos-labs/script-composer-pack` | Yes | WASM pack for script composer |
| `@aptos-labs/forklift` | Optional | State forking for accurate sequential simulation |

## License

MIT
