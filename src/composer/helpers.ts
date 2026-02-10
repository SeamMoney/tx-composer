import type { CallArgument } from "@aptos-labs/script-composer-sdk";
import type { ComposableAction } from "../types.js";

/**
 * Withdraw a fungible asset from the signer's primary store.
 * Returns [FungibleAsset].
 */
export function withdrawFromWallet(
  tokenMetadata: string,
  amount: bigint,
  typeArg: string = "0x1::fungible_asset::Metadata",
): ComposableAction {
  return {
    description: `Withdraw ${amount} from wallet (${tokenMetadata.slice(0, 10)}...)`,
    async build(ctx) {
      return ctx.composer.addBatchedCalls({
        function: "0x1::primary_fungible_store::withdraw",
        functionArguments: [ctx.signer, tokenMetadata, Number(amount)],
        typeArguments: [typeArg],
      });
    },
  };
}

/**
 * Deposit a fungible asset into a recipient's primary store.
 * Takes a FungibleAsset CallArgument from a prior action.
 */
export function depositToWallet(
  recipient: string,
  faArgument: CallArgument,
): ComposableAction {
  return {
    description: `Deposit FA to ${recipient.slice(0, 10)}...`,
    async build(ctx) {
      return ctx.composer.addBatchedCalls({
        function: "0x1::primary_fungible_store::deposit",
        functionArguments: [recipient, faArgument],
        typeArguments: [],
      });
    },
  };
}
