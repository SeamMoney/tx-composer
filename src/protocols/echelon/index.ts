import type { CallArgument } from "@aptos-labs/script-composer-sdk";
import type { LendingAdapter } from "../protocol.js";
import type {
  EntryFunctionPayload,
  ComposableAction,
} from "../../types.js";
import {
  DEFAULT_ECHELON_CONFIG,
  type EchelonConfig,
} from "./types.js";

export class EchelonAdapter implements LendingAdapter {
  readonly name = "Echelon Lending";
  readonly address: string;
  private readonly cfg: EchelonConfig;

  constructor(config?: Partial<EchelonConfig>) {
    this.cfg = { ...DEFAULT_ECHELON_CONFIG, ...config };
    this.address = this.cfg.address;
  }

  /** Look up a market address by token symbol (e.g. "USD1") */
  getMarket(symbol: string): string | undefined {
    return this.cfg.markets[symbol];
  }

  buildRepayAllPayload(market: string): EntryFunctionPayload {
    return {
      function: `${this.address}::scripts::repay_all_fa`,
      typeArguments: [],
      functionArguments: [market],
    };
  }

  buildWithdrawAllPayload(market: string): EntryFunctionPayload {
    return {
      function: `${this.address}::scripts::withdraw_all_fa`,
      typeArguments: [],
      functionArguments: [market],
    };
  }

  /**
   * Composable repay using lending::repay_fa (public function).
   * Takes a FungibleAsset of the debt token.
   */
  buildComposableRepay(params: {
    market: string;
    faIn: CallArgument;
  }): ComposableAction {
    const addr = this.address;
    return {
      description: `Repay debt on Echelon`,
      async build(ctx) {
        return ctx.composer.addBatchedCalls({
          function: `${addr}::lending::repay_fa`,
          functionArguments: [ctx.signer, params.market, params.faIn],
          typeArguments: [],
        });
      },
    };
  }

  /**
   * Composable withdraw using lending::withdraw_fa (public function).
   * Returns [FungibleAsset] of the collateral token.
   */
  buildComposableWithdraw(params: {
    market: string;
    amount: bigint;
  }): ComposableAction {
    const addr = this.address;
    return {
      description: `Withdraw ${params.amount} collateral from Echelon`,
      async build(ctx) {
        return ctx.composer.addBatchedCalls({
          function: `${addr}::lending::withdraw_fa`,
          functionArguments: [ctx.signer, params.market, Number(params.amount)],
          typeArguments: [],
        });
      },
    };
  }
}

export { DEFAULT_ECHELON_CONFIG, type EchelonConfig } from "./types.js";
