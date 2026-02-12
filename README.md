# tx-composer

Generalized DeFi transaction composer for Aptos. Compose any Move function calls into atomic transactions with integrated simulation, balance tracking, and error diagnosis — all before committing real funds.

Works with **any protocol** on Aptos. No adapters required — just specify the Move functions you want to call and how to wire outputs between them.

## Install

```bash
npm install tx-composer
```

Requires `@aptos-labs/ts-sdk` v5+.

## What this adds over `@aptos-labs/script-composer-sdk`

The Script Composer SDK gives you the raw primitive: `BuildScriptComposerTransaction` + `CallArgument` wiring inside a builder callback. It's powerful but low-level — you manage WASM initialization, manually track `CallArgument[]` arrays, simulate separately, and parse results yourself.

tx-composer wraps that into a **declare → simulate → execute** workflow:

| Concern | Raw Script Composer SDK | tx-composer |
|---------|------------------------|-------------|
| **Defining steps** | Imperative builder callback, manual `CallArgument` bookkeeping | Declarative `.addStep()` with labeled refs (`arg.ref("swap", 0)`) |
| **ABI validation** | Errors surface as cryptic WASM failures | Pre-build validation: checks function existence, arg count, signer vs address, unconsumed non-droppable returns |
| **Simulation** | Call separately, get raw `UserTransactionResponse` | `.simulate()` builds + simulates + returns parsed `ComposedResult` |
| **Fee payer** | Manual `withFeePayer` flag + separate fee payer key | `.simulate({ withFeePayer: true })` — simulate without sender needing gas |
| **Balance tracking** | Manual — query before, query after, compute diff | `.trackTokens([...])` — owner-aware primary store matching, auto-snapshots, human-readable deltas |
| **Error handling** | Raw VM status string | `diagnoseVmStatus()` maps to actionable errors with suggestions |
| **Reporting** | Write your own | `result.summary` — formatted report with steps, gas, balance changes, events, warnings, errors |
| **Execution** | Build signer, submit, wait — all manual | `result.execute()` — one call, returns hash + status |
| **AI-agent input** | N/A — TypeScript only | `DynamicComposer.fromJSON(client, plan)` — JSON schema an LLM can generate |

In short: Script Composer SDK handles the **transaction composition**. tx-composer handles everything around it — ABI validation, simulation, balance tracking, error diagnosis, and execution — so you (or an AI agent) can go from a declarative plan to a confirmed on-chain result in a few lines.

## DynamicComposer — The Core API

Compose any Move function calls into a single atomic transaction. Wire return values between steps. Simulate and get a full report. Execute if it passes.

```typescript
import { Network } from "@aptos-labs/ts-sdk";
import { AptosClient, DynamicComposer, arg } from "tx-composer";

const client = new AptosClient({
  network: Network.MAINNET,
  privateKey: process.env.APTOS_PRIVATE_KEY,
  // or: publicKey: "0x..." for simulation-only (no execution)
});

const USDC_META = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
const USD1_META = "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2";

const HYPERION = "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c";
const POOL = "0x1609a6f6e914e60bf958d0e1ba24a471ee2bcadeca9e72659336a1f002be50db";

const result = await new DynamicComposer(client)
  .addStep("withdraw", {
    function: "0x1::primary_fungible_store::withdraw",
    typeArguments: ["0x1::fungible_asset::Metadata"],
    args: [arg.signer(), arg.literal(USDC_META), arg.literal(1_000000n)],
  })
  .addStep("swap", {
    function: `${HYPERION}::pool_v3::swap`,
    args: [
      arg.literal(POOL),               // pool address
      arg.literal(false),              // a_to_b
      arg.literal(true),              // exact_input
      arg.literal(1_000000n),         // amount
      arg.ref("withdraw", 0),         // FungibleAsset from step "withdraw", return[0]
      arg.literal("79226673515401279992447579055"), // sqrt_price_limit
    ],
  })
  .addStep("deposit_remainder", {
    function: "0x1::primary_fungible_store::deposit",
    args: [arg.literal(client.address), arg.ref("swap", 1)],
  })
  .addStep("deposit_output", {
    function: "0x1::primary_fungible_store::deposit",
    args: [arg.literal(client.address), arg.ref("swap", 2)],
  })
  .trackTokens([
    { symbol: "USDC", metadata: USDC_META, decimals: 6 },
    { symbol: "USD1", metadata: USD1_META, decimals: 6 },
  ])
  .simulate();

console.log(result.summary);

if (result.success) {
  const exec = await result.execute();
  console.log(`TX: ${exec.hash}`);
}
```

Output:
```
== Composed Transaction (4 steps) ==
Steps: withdraw → swap → deposit_remainder → deposit_output

Status: OK
Gas: 0.000064 APT (64 units)

Balance Changes:
  USDC     -1.000000
  USD1     +1.000417

Events (19):
  fungible_asset::Withdraw amount=1000000
  stablecoin::Withdraw amount=1000000
  pool_v3::SwapBeforeEvent
  ...

Result: SIMULATION PASSED — safe to execute
```

### How It Works

1. **Define steps** as raw Move function calls using `addStep(label, { function, args })`
2. **Wire outputs** between steps using `arg.ref(stepLabel, returnIndex)` — reference any return value from a prior step
3. **Compose** into a single atomic transaction via [Aptos Script Composer](https://aptos.dev/build/sdks/ts-sdk/building-transactions/script-composer)
4. **Simulate** the composed transaction against mainnet
5. **Execute** only if simulation passes

All steps succeed or all revert — it's a single atomic transaction.

### Argument Types

| Helper | Move Type | Example |
|--------|-----------|---------|
| `arg.signer()` | `&signer` | The transaction signer |
| `arg.literal(value)` | `address`, `u64`, `bool`, `u128`, etc. | `arg.literal("0x1...")`, `arg.literal(100)`, `arg.literal(true)` |
| `arg.ref(step, index)` | Return value from prior step | `arg.ref("swap", 2)` = return value [2] from step "swap" |
| `arg.ref(step, index, "borrow")` | `&T` reference | Borrow without consuming |
| `arg.ref(step, index, "copy")` | Copy of value | Use same value in multiple steps |

**Important**: `arg.signer()` is for functions that take `&signer`. For functions that take `address` (like `primary_fungible_store::deposit`), use `arg.literal(address)` instead.

**Important**: In Move, `FungibleAsset` does not have the `drop` ability. If a function returns a `FungibleAsset`, you must consume it in a subsequent step (e.g., deposit it). Unused non-droppable values will cause the transaction to fail.

### JSON API (for AI Agents)

AI agents generate transaction plans as JSON. The host application passes them to `DynamicComposer.fromJSON()` for simulation and execution.

#### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["steps"],
  "properties": {
    "tokens": {
      "type": "array",
      "description": "Tokens to track balance changes for. Optional but recommended.",
      "items": {
        "type": "object",
        "required": ["symbol", "metadata", "decimals"],
        "properties": {
          "symbol": { "type": "string", "description": "Human-readable token symbol (e.g. \"USDC\")" },
          "metadata": { "type": "string", "description": "On-chain fungible asset metadata address (0x-prefixed, 64 hex chars)" },
          "decimals": { "type": "integer", "description": "Token decimal places (e.g. 6 for USDC, 8 for APT)" }
        }
      }
    },
    "steps": {
      "type": "array",
      "minItems": 1,
      "description": "Ordered list of Move function calls to compose atomically.",
      "items": {
        "type": "object",
        "required": ["label", "function", "args"],
        "properties": {
          "label": { "type": "string", "description": "Unique step identifier. Used by ref args to wire return values between steps." },
          "function": { "type": "string", "pattern": "^0x[a-fA-F0-9]+::[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_]*$", "description": "Fully qualified Move function: {address}::{module}::{function}" },
          "typeArguments": { "type": "array", "items": { "type": "string" }, "description": "Move type arguments (e.g. [\"0x1::fungible_asset::Metadata\"]). Omit if none." },
          "args": {
            "type": "array",
            "description": "Function arguments in parameter order.",
            "items": {
              "oneOf": [
                {
                  "type": "object",
                  "required": ["kind"],
                  "properties": { "kind": { "const": "signer" } },
                  "description": "Transaction signer. Use for &signer parameters only."
                },
                {
                  "type": "object",
                  "required": ["kind", "value"],
                  "properties": {
                    "kind": { "const": "literal" },
                    "value": { "oneOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }] }
                  },
                  "description": "Literal value. Strings ending in 'n' are parsed as bigint (e.g. \"1000000n\"). Use for address, u64, u128, bool, etc."
                },
                {
                  "type": "object",
                  "required": ["kind", "step", "returnIndex"],
                  "properties": {
                    "kind": { "const": "ref" },
                    "step": { "type": "string", "description": "Label of the prior step whose return value to use." },
                    "returnIndex": { "type": "integer", "minimum": 0, "description": "Index into the step's return values (0-based)." },
                    "mode": { "type": "string", "enum": ["move", "copy", "borrow", "borrow_mut"], "default": "move", "description": "How to pass the value. Default \"move\" consumes it." }
                  },
                  "description": "Reference to a prior step's return value. This is how you wire outputs between steps."
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

#### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tokens` | `TokenConfig[]` | No | Optional. If provided, `result.balanceDiff` will show before/after deltas for these tokens. Omit if you only care about success/failure. |
| `tokens[].symbol` | `string` | Yes | Display name (e.g. `"USDC"`) |
| `tokens[].metadata` | `string` | Yes | On-chain metadata address (`0x...`, 64 hex chars) |
| `tokens[].decimals` | `integer` | Yes | Decimal places (6 for USDC, 8 for APT) |
| `steps` | `Step[]` | Yes | Ordered Move function calls (min 1) |
| `steps[].label` | `string` | Yes | Unique ID, referenced by `ref` args |
| `steps[].function` | `string` | Yes | `{address}::{module}::{function}` |
| `steps[].typeArguments` | `string[]` | No | Move type args (omit if none) |
| `steps[].args` | `Arg[]` | Yes | Arguments in parameter order |

**Arg types:**

| `kind` | Fields | Use when |
|--------|--------|----------|
| `"signer"` | (none) | Parameter type is `&signer` |
| `"literal"` | `value: string \| number \| boolean` | Parameter is `address`, `u64`, `u128`, `bool`, etc. Append `n` for bigint strings: `"1000000n"` |
| `"ref"` | `step: string`, `returnIndex: number`, `mode?: string` | Consuming a return value from a prior step. Default mode is `"move"` (consumes the value) |

#### Rules for agents

1. **`&signer` vs `address`**: If the Move function takes `&signer`, use `{ "kind": "signer" }`. If it takes `address`, use `{ "kind": "literal", "value": "<wallet-address>" }`. Getting this wrong is the most common mistake.
2. **Non-droppable returns must be consumed**: `FungibleAsset` does not have the `drop` ability. If a step returns one, a later step must consume it via `ref` (e.g. deposit it). Unconsumed non-droppable values revert the transaction.
3. **Step order matters**: Steps execute in array order. A `ref` can only reference a step that appears earlier in the array.
4. **Bigint encoding**: JSON has no native bigint. Encode large numbers as strings with an `n` suffix: `"1000000n"` becomes `BigInt(1000000)`.

#### Example: Minimal (no token tracking)

The simplest possible plan — just steps, no `tokens`. You get `result.success` and `result.summary` but no `balanceDiff`.

```json
{
  "steps": [
    {
      "label": "transfer",
      "function": "0x1::primary_fungible_store::transfer",
      "typeArguments": ["0x1::fungible_asset::Metadata"],
      "args": [
        { "kind": "signer" },
        { "kind": "literal", "value": "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b" },
        { "kind": "literal", "value": "<recipient-address>" },
        { "kind": "literal", "value": "1000000n" }
      ]
    }
  ]
}
```

#### Example: Simple swap (USDC → USD1)

Withdraw USDC from wallet, swap on Hyperion DEX, deposit both outputs back.

```json
{
  "tokens": [
    { "symbol": "USDC", "metadata": "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b", "decimals": 6 },
    { "symbol": "USD1", "metadata": "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2", "decimals": 6 }
  ],
  "steps": [
    {
      "label": "withdraw",
      "function": "0x1::primary_fungible_store::withdraw",
      "typeArguments": ["0x1::fungible_asset::Metadata"],
      "args": [
        { "kind": "signer" },
        { "kind": "literal", "value": "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b" },
        { "kind": "literal", "value": "1000000n" }
      ]
    },
    {
      "label": "swap",
      "function": "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c::pool_v3::swap",
      "args": [
        { "kind": "literal", "value": "0x1609a6f6e914e60bf958d0e1ba24a471ee2bcadeca9e72659336a1f002be50db" },
        { "kind": "literal", "value": false },
        { "kind": "literal", "value": true },
        { "kind": "literal", "value": "1000000n" },
        { "kind": "ref", "step": "withdraw", "returnIndex": 0 },
        { "kind": "literal", "value": "79226673515401279992447579055" }
      ]
    },
    {
      "label": "deposit_remainder",
      "function": "0x1::primary_fungible_store::deposit",
      "args": [
        { "kind": "literal", "value": "<your-wallet-address>" },
        { "kind": "ref", "step": "swap", "returnIndex": 1 }
      ]
    },
    {
      "label": "deposit_output",
      "function": "0x1::primary_fungible_store::deposit",
      "args": [
        { "kind": "literal", "value": "<your-wallet-address>" },
        { "kind": "ref", "step": "swap", "returnIndex": 2 }
      ]
    }
  ]
}
```

#### Example: Swap + repay loan + withdraw collateral

A 5-step DeFi flow: withdraw USDC, swap to USD1 on Hyperion, deposit leftover USDC, repay Echelon lending debt with USD1, withdraw collateral.

```json
{
  "tokens": [
    { "symbol": "USDC", "metadata": "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b", "decimals": 6 },
    { "symbol": "USD1", "metadata": "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2", "decimals": 6 }
  ],
  "steps": [
    {
      "label": "withdraw_usdc",
      "function": "0x1::primary_fungible_store::withdraw",
      "typeArguments": ["0x1::fungible_asset::Metadata"],
      "args": [
        { "kind": "signer" },
        { "kind": "literal", "value": "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b" },
        { "kind": "literal", "value": "205000000n" }
      ]
    },
    {
      "label": "swap",
      "function": "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c::pool_v3::swap",
      "args": [
        { "kind": "literal", "value": "0x1609a6f6e914e60bf958d0e1ba24a471ee2bcadeca9e72659336a1f002be50db" },
        { "kind": "literal", "value": false },
        { "kind": "literal", "value": true },
        { "kind": "literal", "value": "205000000n" },
        { "kind": "ref", "step": "withdraw_usdc", "returnIndex": 0 },
        { "kind": "literal", "value": "79226673515401279992447579055" }
      ]
    },
    {
      "label": "deposit_remainder",
      "function": "0x1::primary_fungible_store::deposit",
      "args": [
        { "kind": "literal", "value": "<your-wallet-address>" },
        { "kind": "ref", "step": "swap", "returnIndex": 1 }
      ]
    },
    {
      "label": "repay_debt",
      "function": "0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba::lending::repay_fa",
      "args": [
        { "kind": "signer" },
        { "kind": "literal", "value": "0xbb8f38636896c629ff9ef0bf916791a992e12ab4f1c6e26279ee9c6979646963" },
        { "kind": "ref", "step": "swap", "returnIndex": 2 }
      ]
    },
    {
      "label": "withdraw_collateral",
      "function": "0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba::scripts::withdraw_all_fa",
      "args": [
        { "kind": "literal", "value": "0xbb8f38636896c629ff9ef0bf916791a992e12ab4f1c6e26279ee9c6979646963" }
      ]
    }
  ]
}
```

#### Usage in TypeScript

```typescript
import { AptosClient, DynamicComposer } from "tx-composer";
import { Network } from "@aptos-labs/ts-sdk";

const client = new AptosClient({ network: Network.MAINNET, privateKey: process.env.APTOS_PRIVATE_KEY });
const plan = JSON.parse(agentOutput); // the JSON above
const result = await DynamicComposer.fromJSON(client, plan).simulate();

if (result.success) {
  console.log(result.summary);
  const exec = await result.execute();
}
```

### ComposedResult

```typescript
interface ComposedResult {
  success: boolean;              // simulation passed?
  simulation: SimulationResult;  // full parsed result (events, balance changes, gas)
  transaction: AnyRawTransaction; // ready-to-sign transaction
  balanceDiff: BalanceDiff | null; // before/after balance deltas (if tokens tracked)
  errors: DiagnosedError[];      // actionable error diagnosis if failed
  warnings: ValidationWarning[]; // ABI validation warnings (signer mismatch, unconsumed resources, etc.)
  summary: string;               // pre-formatted human-readable report
  stepLabels: string[];          // ordered step labels
  execute(): Promise<ExecutionResult>; // sign + submit + wait
}
```

## Example: Swap + Repay Debt + Withdraw Collateral

A real-world DeFi flow using Hyperion DEX and Echelon Lending, all in one atomic transaction:

```typescript
const HYPERION = "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c";
const ECHELON = "0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba";
const POOL = "0x1609a6f6e914e60bf958d0e1ba24a471ee2bcadeca9e72659336a1f002be50db";
const MARKET = "0xbb8f38636896c629ff9ef0bf916791a992e12ab4f1c6e26279ee9c6979646963";

const result = await new DynamicComposer(client)
  // Step 1: Withdraw USDC from wallet
  .addStep("withdraw_usdc", {
    function: "0x1::primary_fungible_store::withdraw",
    typeArguments: ["0x1::fungible_asset::Metadata"],
    args: [arg.signer(), arg.literal(USDC_META), arg.literal(205_000000n)],
  })
  // Step 2: Swap USDC → USD1 on Hyperion
  .addStep("swap", {
    function: `${HYPERION}::pool_v3::swap`,
    args: [
      arg.literal(POOL),
      arg.literal(false),        // USDC is token_b, so b→a
      arg.literal(true),         // exact_input
      arg.literal(205_000000n),
      arg.ref("withdraw_usdc", 0),
      arg.literal("79226673515401279992447579055"),
    ],
  })
  // Step 3: Deposit swap remainder back
  .addStep("deposit_remainder", {
    function: "0x1::primary_fungible_store::deposit",
    args: [arg.literal(client.address), arg.ref("swap", 1)],
  })
  // Step 4: Repay debt with swap output
  .addStep("repay", {
    function: `${ECHELON}::lending::repay_fa`,
    args: [arg.signer(), arg.literal(MARKET), arg.ref("swap", 2)],
  })
  // Step 5: Withdraw all collateral
  .addStep("withdraw_collateral", {
    function: `${ECHELON}::scripts::withdraw_all_fa`,
    args: [arg.literal(MARKET)],
  })
  .trackTokens([USDC, USD1])
  .simulate();

if (result.success) {
  console.log("All 5 steps simulated successfully in one atomic tx!");
  const exec = await result.execute();
}
```

## ABI Pre-Validation

Every `.build()` and `.simulate()` call automatically fetches on-chain ABIs and validates your steps before touching WASM. Catches common mistakes with clear messages:

```typescript
const { warnings } = await composer.validate();
// [{ code: "SIGNER_MISMATCH", message: 'Step "deposit" arg 0: used arg.signer() but parameter type is "address" — use arg.literal(address) instead' }]
// [{ code: "ARG_COUNT_ERROR", message: 'Step "swap": expected 6 non-signer argument(s), got 4' }]
// [{ code: "UNCONSUMED_RESOURCE", message: 'Step "withdraw" return[0] (FungibleAsset) is non-droppable but not consumed by any subsequent step' }]
// [{ code: "FUNCTION_NOT_FOUND_ERROR", message: 'Function "0x1::fake::function" not found on-chain' }]
```

Hard errors (codes ending in `_ERROR`) abort the build. Soft warnings (like `UNCONSUMED_RESOURCE`, `SIGNER_MISMATCH`) are included in `result.warnings` and the summary report.

## Fee Payer Simulation

Simulate transactions even when the sender wallet has no APT for gas:

```typescript
const result = await composer.simulate({ withFeePayer: true });
// Simulation succeeds without checking sender's gas balance
```

Useful for AI agents previewing transactions for users who haven't funded their wallet yet.

## Forked Simulation (via Forklift)

Fork mainnet state and run Move functions sequentially — each call sees the previous call's state changes. Inspect how on-chain state changed: pool reserves after a swap, lending positions after repayment, etc.

Requires `@aptos-labs/forklift` (optional peer dependency) and [Aptos CLI](https://aptos.dev/build/cli) v7.14.1+.

```bash
npm install @aptos-labs/forklift
```

### Inspect pool state after a swap

```typescript
import { ForkedSession } from "tx-composer";

const HYPERION = "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c";
const POOL = "0x1609a6f6e914e60bf958d0e1ba24a471ee2bcadeca9e72659336a1f002be50db";

const fork = ForkedSession.create({
  apiKey: process.env.APTOS_API_KEY,
  privateKey: process.env.APTOS_PRIVATE_KEY,
});

// Read pool state before
fork.snapshot("before", [
  { account: POOL, resourceType: `${HYPERION}::pool_v3::LiquidityPoolV3` },
]);

// Swap against the fork — state changes persist
fork.run(`${HYPERION}::pool_v3::swap`, {
  args: [
    `address:${POOL}`, "bool:false", "bool:true",
    "u64:1000000", "u64:0", "u128:79226673515401279992447579055",
  ],
});

// Read pool state after
fork.snapshot("after", [
  { account: POOL, resourceType: `${HYPERION}::pool_v3::LiquidityPoolV3` },
]);

// See what changed
const changes = fork.diff("before", "after");
console.log(changes);
// [{ account: "0x1609...", resourceType: "...::LiquidityPoolV3",
//    before: { liquidity: "2899680723522387", sqrt_price: "18441225413107329731", ... },
//    after:  { liquidity: "2899680723522387", sqrt_price: "18441225413107329600", ... } }]

fork.cleanup();
```

### Read any on-chain resource

```typescript
// Direct resources (regular accounts)
const account = fork.readResource("0x1", "0x1::account::Account");

// Object-based resources (DEX pools, lending markets, etc.)
// readResource auto-falls back to resource groups for objects
const pool = fork.readResource(POOL, `${HYPERION}::pool_v3::LiquidityPoolV3`);

// Read all resources in an object at once
const allResources = fork.readResourceGroup(POOL);
// { "0x1::object::ObjectCore": {...}, "...::LiquidityPoolV3": {...}, ... }

// View functions
const result = fork.view("0x1::coin::balance", ["address:0x1"], ["0x1::aptos_coin::AptosCoin"]);
```

### Sequential state changes

Each `run()` call mutates fork state. Subsequent calls see previous changes:

```typescript
// Step 1: transfer tokens
fork.run("0x1::aptos_account::transfer", {
  args: ["address:0xRECIPIENT", "u64:1000000"],
});

// Step 2: this sees step 1's state changes
const balance = fork.view("0x1::coin::balance",
  ["address:0xRECIPIENT"],
  ["0x1::aptos_coin::AptosCoin"],
);
```

### ForkedSession vs DynamicComposer

| | ForkedSession | DynamicComposer |
|--|---------------|-----------------|
| **Execution** | Sequential individual calls | Single atomic transaction |
| **State** | Each call sees prior state | All steps share one tx |
| **Use case** | "What happens to the pool if I swap?" | "Compose withdraw+swap+deposit atomically" |
| **Powered by** | Aptos CLI + Forklift | Script Composer WASM |
| **Requires** | API key + Aptos CLI | Nothing extra |

### ForkedSession API

| Method | Description |
|--------|------------|
| `ForkedSession.create(config)` | Fork a network. Config: `{ apiKey, network?, networkVersion?, privateKey? }` |
| `.run(functionId, { args?, typeArgs? })` | Execute a Move function. Args use `type:value` format (e.g. `"u64:1000"`) |
| `.readResource(account, type)` | Read a resource (auto-falls back to resource group for objects) |
| `.readResourceGroup(account)` | Read all resources in an object |
| `.view(functionId, args?, typeArgs?)` | Call a view function |
| `.snapshot(label, queries)` | Capture state of specified resources under a label |
| `.diff(before, after)` | Compare two snapshots, returns `ResourceDiff[]` |
| `.senderAddress` | The sender's address in this fork |
| `.cleanup()` | Delete temp directory. Session is unusable after this. |

## Performance & Script Composer Limitations

### Build latency breakdown

A 4-step composed transaction (withdraw → swap → deposit → deposit) on mainnet:

| Phase | Cold (1st call) | Warm (cached) | What's happening |
|-------|----------------|---------------|------------------|
| ABI validation | ~290ms | <1ms | Fetching function/module ABIs from chain |
| `addBatchedCalls()` | ~270ms | ~185ms | SDK internally fetches module bytecodes |
| WASM bytecode generation | ~11ms | <1ms | Actual script compilation |
| **Total `build()`** | **~570ms** | **~185ms** | |

The WASM compilation itself is sub-millisecond after the first run. The dominant cost is **network I/O** — the SDK's `addBatchedCalls()` re-fetches module bytecodes from chain on every build because it creates a new `AptosScriptComposer` instance internally. tx-composer's ABI validation cache eliminates its own network calls after the first run, but the SDK's internal fetches remain.

### Script Composer design constraints

**Arguments are baked into bytecode.** The Script Composer SDK embeds all literal values (amounts, addresses, pool IDs) as constants in the generated Move script bytecode. You cannot pre-compile a script and reuse it with different arguments — different args means different bytecode. Move scripts do support parameterized inputs, but the SDK chose to embed constants for simplicity and safety:

- The WASM compiler doesn't need to map script parameters to function call arguments
- What you simulate is exactly what you execute — no risk of arg substitution between simulation and signing
- Return value wiring between steps (`arg.ref()`) is encoded as straight-line local variable moves, which is simpler when all values are known at compile time

For production dapps with fixed flows (e.g., always "swap → repay → withdraw"), deploying a Move module with entry functions is more efficient than recompiling scripts per-transaction. Script Composer is best suited for dynamic/user-defined flows where the step sequence isn't known ahead of time.

**Other constraints:**
- Only **entry** and **public** functions can be composed — no view functions or private functions
- Non-droppable return types (like `FungibleAsset`) must be consumed by a subsequent step or the transaction reverts
- 64KB max transaction size limits practical step count to ~30-100 depending on complexity
- No gas savings from composition — the value is atomicity, not efficiency
- Multi-signer is supported in the WASM layer (`multi_signer(count)`) but `BuildScriptComposerTransaction` defaults to single signer

## Single Transaction Simulate + Execute

For simple single-function transactions, use `buildAndSimulate()` directly:

```typescript
import { AptosClient, buildAndSimulate, executeTransaction } from "tx-composer";

const payload = {
  function: "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c::router_v3::swap_batch" as const,
  typeArguments: [],
  functionArguments: [pools, tokenIn, tokenOut, amountIn, minOut, recipient],
};

const { transaction, simulation } = await buildAndSimulate(client, payload);

if (simulation.success) {
  const result = await executeTransaction(client, transaction, "Swap");
  console.log(`TX: ${result.hash}`);
}
```

## Simulation-Only Mode

Pass just a public key for safe simulation without execution capability:

```typescript
const client = new AptosClient({
  network: Network.MAINNET,
  publicKey: process.env.APTOS_PUBLIC_KEY,
});

// client.canExecute === false
// .simulate() works, .execute() throws
```

Recommended for AI agents doing analysis.

## Error Diagnosis

```typescript
import { diagnoseVmStatus } from "tx-composer";

const errors = diagnoseVmStatus("Move abort at 0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba::lending");
// [{ code: "LENDING_ERROR", title: "Lending protocol error",
//    suggestion: "Check: repay amount <= debt, withdrawal won't breach health factor" }]
```

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

## Protocol Adapters (Optional Convenience)

Pre-built adapters for common protocols. These are optional — you can always use `DynamicComposer` directly with raw function calls.

### Hyperion DEX

```typescript
import { HyperionAdapter } from "tx-composer";

const hyperion = new HyperionAdapter();
const quote = await hyperion.getSwapQuote(client, USDC, USD1, 100_000000n, [pool]);
const payload = hyperion.buildSwapPayload({ pools, tokenIn, tokenOut, amountIn, minAmountOut, recipient });
```

### Echelon Lending

```typescript
import { EchelonAdapter } from "tx-composer";

const echelon = new EchelonAdapter();
const repayPayload = echelon.buildRepayAllPayload(market);
const withdrawPayload = echelon.buildWithdrawAllPayload(market);
```

## Sequential Dry-Run (Separate Transactions)

For simulating separate transactions in sequence (not atomic), use `SimulationPlanBuilder`:

```typescript
import { SimulationPlanBuilder, dryRun } from "tx-composer";

const plan = new SimulationPlanBuilder("My Flow")
  .forWallet(client.address)
  .trackTokens([USDC, USD1])
  .addStep({
    label: "swap",
    description: "Swap USDC → USD1",
    payload: swapPayload,
    expectations: [
      { type: "balance_decrease", token: USDC.metadata, description: "USDC spent" },
      { type: "balance_increase", token: USD1.metadata, description: "USD1 received" },
    ],
  })
  .addStep({
    label: "repay",
    description: "Repay debt",
    payload: repayPayload,
  })
  .build();

const report = await dryRun(client, plan);
console.log(report.summary);
```

**Note**: Each step simulates independently against current mainnet state. Step 2 doesn't see step 1's changes. For accurate multi-step simulation, use `DynamicComposer` which composes everything atomically.

## API Reference

### DynamicComposer

| Method | Description |
|--------|------------|
| `new DynamicComposer(client)` | Create a composer for the given client |
| `.addStep(label, { function, typeArguments?, args })` | Add a Move function call |
| `.trackTokens(tokens[])` | Track balance changes for these tokens |
| `.validate()` | Fetch ABIs and validate all steps (returns `{ validations, warnings }`) |
| `.build(options?)` | Validate + build the composed transaction. `{ withFeePayer: true }` for fee payer mode |
| `.simulate(options?)` | Build + simulate + parse into `ComposedResult`. `{ withFeePayer: true }` to skip gas check |
| `DynamicComposer.fromJSON(client, json)` | Construct from a JSON plan |

### arg Helpers

| Helper | Description |
|--------|------------|
| `arg.signer()` | Reference to transaction signer (`&signer` params) |
| `arg.literal(value)` | Literal value (string, number, bigint, boolean) |
| `arg.ref(step, returnIndex, mode?)` | Reference to a prior step's return value |

### Core

| Export | Description |
|--------|------------|
| `AptosClient` | Wallet management with `privateKey` (full) or `publicKey` (sim-only) modes |
| `getFABalance(aptos, owner, metadata)` | Query fungible asset balance |
| `getFABalanceSafe(aptos, owner, metadata)` | Same but returns `{ balance, error? }` |
| `getBalances(aptos, owner, tokens[])` | Parallel multi-token balance query |
| `formatAmount(raw, decimals)` | Format raw bigint to human-readable string |
| `buildAndSimulate(client, payload)` | Build + simulate a single entry function |
| `executeTransaction(client, tx, description?)` | Sign, submit, and wait |
| `diagnoseVmStatus(vmStatus)` | Diagnose VM errors into actionable messages |

## Architecture

```
tx-composer/
├── dynamic/
│   ├── types.ts       # StepArg, ComposerStep, ComposedResult, DynamicPlanJSON
│   ├── composer.ts    # DynamicComposer class
│   ├── validate.ts    # ABI pre-validation (fetches ABIs, checks args, detects non-droppable returns)
│   └── report.ts      # Composed simulation report formatter
├── core/
│   ├── client.ts      # AptosClient (wallet management, dual-mode)
│   ├── balance.ts     # FA balance queries
│   └── transaction.ts # build, simulate, execute
├── composer/
│   ├── composer.ts    # Low-level Script Composer wrapper
│   └── helpers.ts     # withdraw/deposit composable actions
├── protocols/
│   ├── protocol.ts    # DexAdapter / LendingAdapter interfaces
│   ├── hyperion/      # Hyperion DEX adapter (optional)
│   └── echelon/       # Echelon lending adapter (optional)
├── simulation/
│   ├── types.ts       # SimulationPlan, FlowReport, StepResult, etc.
│   ├── simulate.ts    # Parse simulation responses
│   ├── plan.ts        # SimulationPlanBuilder + dryRun()
│   ├── report.ts      # Sequential dry-run report formatter
│   ├── flow-tracker.ts # Balance snapshots, diffs, expectation validation
│   ├── errors.ts      # VM error → actionable diagnosis
│   └── forklift.ts    # Forklift state fork reader (optional)
├── types.ts           # Core type definitions
└── index.ts           # Public API exports
```

## Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `@aptos-labs/ts-sdk` | Yes | Core Aptos SDK |
| `@aptos-labs/script-composer-sdk` | Yes | Atomic transaction composition |
| `@aptos-labs/script-composer-pack` | Yes | WASM pack for script composer |
| `@aptos-labs/forklift` | Optional | State forking for sequential simulation |

## License

MIT
