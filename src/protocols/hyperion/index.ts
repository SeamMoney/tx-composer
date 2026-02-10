import type { CallArgument } from "@aptos-labs/script-composer-sdk";
import type { DexAdapter } from "../protocol.js";
import type {
  EntryFunctionPayload,
  ComposableAction,
  TokenConfig,
} from "../../types.js";
import type { AptosClient } from "../../core/client.js";
import {
  DEFAULT_HYPERION_CONFIG,
  MAX_SQRT_PRICE_B_TO_A,
  MIN_SQRT_PRICE_A_TO_B,
  type HyperionConfig,
} from "./types.js";

export class HyperionAdapter implements DexAdapter {
  readonly name = "Hyperion DEX";
  readonly address: string;
  private readonly cfg: HyperionConfig;

  constructor(config?: Partial<HyperionConfig>) {
    this.cfg = { ...DEFAULT_HYPERION_CONFIG, ...config };
    this.address = this.cfg.address;
  }

  /** Look up a pool address by key (e.g. "USD1_USDC") */
  getPool(key: string): string | undefined {
    return this.cfg.pools[key];
  }

  async getSwapQuote(
    client: AptosClient,
    tokenIn: TokenConfig,
    tokenOut: TokenConfig,
    amountIn: bigint,
    pools: string[],
  ): Promise<bigint | null> {
    try {
      const result = await client.aptos.view({
        payload: {
          function: `${this.address}::router_v3::get_batch_amount_out`,
          typeArguments: [],
          functionArguments: [
            pools,
            amountIn.toString(),
            tokenIn.metadata,
            tokenOut.metadata,
          ],
        },
      });
      return BigInt(result[0] as string);
    } catch {
      return null;
    }
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
      function: `${this.address}::router_v3::swap_batch`,
      typeArguments: [],
      functionArguments: [
        params.pools,
        params.tokenIn.metadata,
        params.tokenOut.metadata,
        params.amountIn.toString(),
        params.minAmountOut.toString(),
        params.recipient,
      ],
    };
  }

  /**
   * Build a composable swap action using pool_v3::swap (public function).
   *
   * Returns CallArgument[]:
   *   [0] = u64 amount_calculated
   *   [1] = FungibleAsset (remainder of input token)
   *   [2] = FungibleAsset (output token)
   */
  buildComposableSwap(params: {
    pool: string;
    tokenIn: TokenConfig;
    tokenOut: TokenConfig;
    amountIn: bigint | CallArgument;
    faIn: CallArgument;
    aToB: boolean;
    sqrtPriceLimit?: string;
  }): ComposableAction {
    const addr = this.address;
    const priceLimit =
      params.sqrtPriceLimit ??
      (params.aToB ? MIN_SQRT_PRICE_A_TO_B : MAX_SQRT_PRICE_B_TO_A);

    return {
      description: `Swap ${params.tokenIn.symbol} -> ${params.tokenOut.symbol} via Hyperion`,
      async build(ctx) {
        return ctx.composer.addBatchedCalls({
          function: `${addr}::pool_v3::swap`,
          functionArguments: [
            params.pool,
            params.aToB,
            true, // exact_input
            typeof params.amountIn === "bigint"
              ? Number(params.amountIn)
              : params.amountIn,
            params.faIn,
            priceLimit,
          ],
          typeArguments: [],
        });
      },
    };
  }
}

export { DEFAULT_HYPERION_CONFIG, type HyperionConfig } from "./types.js";
export {
  MAX_SQRT_PRICE_B_TO_A,
  MIN_SQRT_PRICE_A_TO_B,
} from "./types.js";
