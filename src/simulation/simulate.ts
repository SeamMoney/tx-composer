import type { UserTransactionResponse } from "@aptos-labs/ts-sdk";
import type {
  SimulationResult,
  ParsedEvent,
  BalanceChange,
  VaultChange,
} from "../types.js";

export function parseSimulationResult(
  raw: UserTransactionResponse,
  tokenRegistry?: Map<string, string>,
): SimulationResult {
  const r = raw as any;
  const gasUsed = parseInt(r.gas_used ?? "0");
  const gasUnitPrice = parseInt(r.gas_unit_price ?? "100");
  const gasCostApt = (gasUsed * gasUnitPrice) / 1e8;

  return {
    success: raw.success,
    vmStatus: r.vm_status ?? "",
    gasUsed,
    gasUnitPrice,
    gasCostApt,
    events: parseEvents(raw),
    balanceChanges: parseBalanceChanges(raw, tokenRegistry),
    vaultChanges: parseVaultChanges(raw),
    raw,
  };
}

function parseEvents(raw: UserTransactionResponse): ParsedEvent[] {
  const result: ParsedEvent[] = [];
  for (const evt of (raw as any).events ?? []) {
    const fullType: string = evt.type ?? "";
    const segments = fullType.split("::");
    const shortType = segments.slice(-2).join("::");
    const amount = evt.data?.amount ? BigInt(evt.data.amount) : undefined;
    result.push({ type: fullType, shortType, amount, data: evt.data ?? {} });
  }
  return result;
}

function resolveTokenSymbol(
  metadata: string,
  registry?: Map<string, string>,
): string {
  if (!registry) return metadata.slice(0, 10) + "...";
  for (const [addr, sym] of registry) {
    if (
      metadata.toLowerCase().includes(addr.slice(2, 8).toLowerCase())
    ) {
      return sym;
    }
  }
  return metadata.slice(0, 10) + "...";
}

function parseBalanceChanges(
  raw: UserTransactionResponse,
  tokenRegistry?: Map<string, string>,
): BalanceChange[] {
  const result: BalanceChange[] = [];
  for (const change of (raw as any).changes ?? []) {
    if (change.type !== "write_resource") continue;
    const resType: string = change.data?.type ?? "";
    if (!resType.includes("FungibleStore")) continue;

    const balance = change.data?.data?.balance;
    const metadata: string = change.data?.data?.metadata?.inner ?? "";
    if (balance == null) continue;

    result.push({
      address: change.address ?? "",
      token: resolveTokenSymbol(metadata, tokenRegistry),
      tokenMetadata: metadata,
      balance: BigInt(balance),
    });
  }
  return result;
}

function parseVaultChanges(raw: UserTransactionResponse): VaultChange[] {
  const result: VaultChange[] = [];
  for (const change of (raw as any).changes ?? []) {
    if (
      change.type === "delete_resource" &&
      (change.resource ?? "").includes("Vault")
    ) {
      result.push({ address: change.address ?? "", collateral: 0n, debtPrincipal: 0n });
      continue;
    }
    if (change.type !== "write_resource") continue;
    const resType: string = change.data?.type ?? "";
    if (!resType.includes("lending::Vault")) continue;

    const vault = change.data?.data;
    if (!vault) continue;

    result.push({
      address: change.address ?? "",
      collateral: BigInt(vault.collaterals?.data?.[0]?.value ?? "0"),
      debtPrincipal: BigInt(
        vault.liabilities?.data?.[0]?.value?.principal ?? "0",
      ),
    });
  }
  return result;
}
