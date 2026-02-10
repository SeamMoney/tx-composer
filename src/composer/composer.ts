import {
  BuildScriptComposerTransaction,
  CallArgument,
} from "@aptos-labs/script-composer-sdk";
import type { AnyRawTransaction } from "@aptos-labs/ts-sdk";
import type { ComposableAction, ComposerContext } from "../types.js";
import type { AptosClient } from "../core/client.js";

export interface ComposedTransactionResult {
  transaction: AnyRawTransaction;
  actionDescriptions: string[];
}

/**
 * Compose multiple DeFi actions into a single atomic transaction
 * using the Aptos Script Composer SDK.
 *
 * Actions execute in order. Each action receives a ComposerContext
 * with the composer instance, a signer reference, and named results
 * from all prior actions (keyed by label).
 */
export async function composeActions(
  client: AptosClient,
  actions: Array<{ label: string; action: ComposableAction }>,
): Promise<ComposedTransactionResult> {
  const actionDescriptions: string[] = [];

  const transaction = await BuildScriptComposerTransaction({
    sender: client.accountAddress,
    aptosConfig: client.config,
    builder: async (composer) => {
      const results = new Map<string, CallArgument[]>();
      const signer = CallArgument.newSigner(0);
      const ctx: ComposerContext = { composer, results, signer };

      for (const { label, action } of actions) {
        actionDescriptions.push(action.description);
        const callResults = await action.build(ctx);
        results.set(label, callResults);
      }

      return composer;
    },
  });

  return { transaction, actionDescriptions };
}
