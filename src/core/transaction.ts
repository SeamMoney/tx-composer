import type { AnyRawTransaction } from "@aptos-labs/ts-sdk";
import type {
  EntryFunctionPayload,
  ExecutionResult,
  SimulationResult,
} from "../types.js";
import { parseSimulationResult } from "../simulation/simulate.js";
import type { AptosClient } from "./client.js";

export async function buildTransaction(
  client: AptosClient,
  payload: EntryFunctionPayload,
): Promise<AnyRawTransaction> {
  return client.aptos.transaction.build.simple({
    sender: client.accountAddress,
    data: payload,
  });
}

export async function simulateTransaction(
  client: AptosClient,
  transaction: AnyRawTransaction,
  tokenRegistry?: Map<string, string>,
): Promise<SimulationResult> {
  const [rawResult] = await client.aptos.transaction.simulate.simple({
    signerPublicKey: client.publicKey,
    transaction,
  });
  return parseSimulationResult(rawResult, tokenRegistry);
}

export async function executeTransaction(
  client: AptosClient,
  transaction: AnyRawTransaction,
  description?: string,
): Promise<ExecutionResult> {
  if (!client.canExecute || !client.account) {
    throw new Error(
      "Cannot execute: no private key provided (simulation-only mode)",
    );
  }

  if (description) console.log(`  Submitting: ${description}...`);

  const pending = await client.aptos.signAndSubmitTransaction({
    signer: client.account,
    transaction,
  });

  if (description) {
    console.log(`  TX hash: ${pending.hash}`);
    console.log(`  Waiting for confirmation...`);
  }

  const result = await client.aptos.waitForTransaction({
    transactionHash: pending.hash,
  });

  const r = result as any;
  return {
    hash: pending.hash,
    success: r.success,
    vmStatus: r.vm_status,
    gasUsed: parseInt(r.gas_used ?? "0"),
    response: result,
  };
}

export async function buildAndSimulate(
  client: AptosClient,
  payload: EntryFunctionPayload,
  tokenRegistry?: Map<string, string>,
): Promise<{ transaction: AnyRawTransaction; simulation: SimulationResult }> {
  const transaction = await buildTransaction(client, payload);
  const simulation = await simulateTransaction(client, transaction, tokenRegistry);
  return { transaction, simulation };
}
