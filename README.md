# tx-composer

Simulate-first DeFi transaction composer for Aptos. Chain multiple protocol operations into atomic transactions using [Aptos Script Composer](https://aptos.dev/build/sdks/ts-sdk/building-transactions/script-composer), with built-in simulation before execution.

## Install

```bash
npm install tx-composer
```

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
  EchelonAdapter,
} from "tx-composer";

// Initialize client (with private key for execution, or just publicKey for simulation-only)
const client = new AptosClient({
  network: Network.MAINNET,
  privateKey: process.env.APTOS_PRIVATE_KEY,
});

// Use protocol adapters
const hyperion = new HyperionAdapter();
const echelon = new EchelonAdapter();

// Check balances
const balance = await getFABalance(client.aptos, client.address, USDC_METADATA);
console.log(`USDC: ${formatAmount(balance, 6)}`);

// Build a swap payload
const payload = hyperion.buildSwapPayload({
  pools: [hyperion.getPool("USD1_USDC")],
  tokenIn: USDC,
  tokenOut: USD1,
  amountIn: balance,
  minAmountOut: (balance * 995n) / 1000n, // 0.5% slippage
  recipient: client.address,
});

// Simulate first, then execute
const { transaction, simulation } = await buildAndSimulate(client, payload);
console.log(`Simulation: ${simulation.success}, gas: ${simulation.gasCostApt} APT`);

if (simulation.success) {
  const result = await executeTransaction(client, transaction, "Swap USDC → USD1");
  console.log(`TX: ${result.hash}`);
}
```

## Atomic Multi-Step Transactions

Compose multiple operations into a single atomic transaction using Script Composer — all succeed or all revert:

```typescript
import { composeActions, withdrawFromWallet, depositToWallet } from "tx-composer";

const { transaction } = await composeActions(client, [
  {
    label: "withdrawUsdc",
    action: withdrawFromWallet(USDC_METADATA, amount),
  },
  {
    label: "swap",
    action: hyperion.buildComposableSwap({
      pool: poolAddress,
      tokenIn: USDC,
      tokenOut: USD1,
      amountIn: amount,
      faIn: null, // wired via ctx.results in build()
      aToB: false,
    }),
  },
  {
    label: "repay",
    action: echelon.buildComposableRepay({
      market: marketAddress,
      faIn: null, // wired via ctx.results in build()
    }),
  },
]);

// Simulate the composed transaction
const sim = await simulateTransaction(client, transaction);
```

Each action's `build()` receives a `ComposerContext` with results from prior actions, so you can wire `CallArgument` outputs between steps.

## Simulation-Only Mode

Pass just a public key (no private key) to simulate without being able to execute:

```typescript
const client = new AptosClient({
  network: Network.MAINNET,
  publicKey: "0x...", // derived from a past on-chain transaction
});

// client.canExecute === false
// simulateTransaction() works, executeTransaction() throws
```

## Protocol Adapters

### Hyperion DEX (`HyperionAdapter`)

```typescript
const hyperion = new HyperionAdapter(); // uses default mainnet addresses
// or
const hyperion = new HyperionAdapter({
  address: "0x...",
  pools: { "USD1_USDC": "0x..." },
});

await hyperion.getSwapQuote(client, tokenIn, tokenOut, amountIn, [pool]);
hyperion.buildSwapPayload({ pools, tokenIn, tokenOut, amountIn, minAmountOut, recipient });
hyperion.buildComposableSwap({ pool, tokenIn, tokenOut, amountIn, faIn, aToB });
```

### Echelon Lending (`EchelonAdapter`)

```typescript
const echelon = new EchelonAdapter(); // uses default mainnet addresses

echelon.buildRepayAllPayload(market);        // entry function: repay_all_fa
echelon.buildWithdrawAllPayload(market);     // entry function: withdraw_all_fa
echelon.buildComposableRepay({ market, faIn });    // public function for composition
echelon.buildComposableWithdraw({ market, amount }); // public function for composition
```

### Adding a New Protocol

Implement `DexAdapter` or `LendingAdapter`:

```typescript
import type { DexAdapter, EntryFunctionPayload, ComposableAction, TokenConfig } from "tx-composer";
import type { AptosClient } from "tx-composer";

export class MyDexAdapter implements DexAdapter {
  readonly name = "MyDex";
  readonly address = "0x...";

  async getSwapQuote(client: AptosClient, tokenIn: TokenConfig, tokenOut: TokenConfig, amountIn: bigint, pools: string[]) {
    // call view function
  }

  buildSwapPayload(params: { ... }): EntryFunctionPayload {
    // return entry function payload
  }

  buildComposableSwap(params: { ... }): ComposableAction {
    // return ComposableAction for script-composer
  }
}
```

## API

### Core
- `AptosClient` — Wrapper around Aptos SDK with wallet management
- `getFABalance(aptos, owner, metadata)` — Query fungible asset balance
- `getBalances(aptos, owner, tokens[])` — Parallel multi-token balance query
- `formatAmount(raw, decimals)` — Format raw amount to readable string

### Transactions
- `buildTransaction(client, payload)` — Build a transaction
- `simulateTransaction(client, transaction, tokenRegistry?)` — Simulate and parse results
- `executeTransaction(client, transaction, description?)` — Sign, submit, wait
- `buildAndSimulate(client, payload, tokenRegistry?)` — Build + simulate in one call

### Composition
- `composeActions(client, actions[])` — Compose atomic multi-step transaction
- `withdrawFromWallet(metadata, amount)` — Helper: withdraw FA from signer's store
- `depositToWallet(recipient, faArgument)` — Helper: deposit FA to recipient's store

### Simulation
- `parseSimulationResult(raw, tokenRegistry?)` — Parse simulation into structured result
- `ForkliftReader` — Read on-chain state via Aptos Forklift (optional peer dep)

## Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `@aptos-labs/ts-sdk` | Yes | Core Aptos SDK |
| `@aptos-labs/script-composer-sdk` | Yes | Atomic transaction composition |
| `@aptos-labs/forklift` | Optional | On-chain state reading for simulation |

## License

MIT
