import type { CallArgument } from "@aptos-labs/script-composer-sdk";
import type {
  EntryFunctionPayload,
  ComposableAction,
  TokenConfig,
} from "../types.js";
import type { AptosClient } from "../core/client.js";

export interface ProtocolAdapter {
  readonly name: string;
  readonly address: string;
}

export interface DexAdapter extends ProtocolAdapter {
  getSwapQuote(
    client: AptosClient,
    tokenIn: TokenConfig,
    tokenOut: TokenConfig,
    amountIn: bigint,
    pools: string[],
  ): Promise<bigint | null>;

  buildSwapPayload(params: {
    pools: string[];
    tokenIn: TokenConfig;
    tokenOut: TokenConfig;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: string;
  }): EntryFunctionPayload;

  buildComposableSwap(params: {
    pool: string;
    tokenIn: TokenConfig;
    tokenOut: TokenConfig;
    amountIn: bigint | CallArgument;
    faIn: CallArgument;
    aToB: boolean;
    sqrtPriceLimit?: string;
  }): ComposableAction;
}

export interface LendingAdapter extends ProtocolAdapter {
  buildRepayAllPayload(market: string): EntryFunctionPayload;
  buildWithdrawAllPayload(market: string): EntryFunctionPayload;

  buildComposableRepay(params: {
    market: string;
    faIn: CallArgument;
  }): ComposableAction;

  buildComposableWithdraw(params: {
    market: string;
    amount: bigint;
  }): ComposableAction;
}
