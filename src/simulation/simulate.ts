import type { UserTransactionResponse } from "@aptos-labs/ts-sdk";
import type {
  SimulationResult,
  ParsedEvent,
  BalanceChange,
  VaultChange,
} from "../types.js";

// ── Type Guards ────────────────────────────────────────────────────

interface FungibleStoreChange {
  type: "write_resource";
  address: string;
  data: {
    type: string;
    data: {
      balance: string;
      frozen: boolean;
      metadata: { inner: string };
    };
  };
}

interface VaultWriteChange {
  type: "write_resource";
  address: string;
  data: {
    type: string;
    data: {
      collaterals?: { data: Array<{ key: string; value: string }> };
      liabilities?: {
        data: Array<{ key: string; value: { principal: string } }>;
      };
    };
  };
}

interface VaultDeleteChange {
  type: "delete_resource";
  address: string;
  resource: string;
}

function isFungibleStoreChange(change: unknown): change is FungibleStoreChange {
  const c = change as Record<string, unknown>;
  if (c?.type !== "write_resource") return false;
  const data = c.data as Record<string, unknown> | undefined;
  if (!data || typeof data.type !== "string") return false;
  if (!data.type.includes("FungibleStore")) return false;
  const inner = data.data as Record<string, unknown> | undefined;
  return (
    inner?.balance != null &&
    typeof (inner?.metadata as Record<string, unknown>)?.inner === "string"
  );
}

function isVaultWriteChange(change: unknown): change is VaultWriteChange {
  const c = change as Record<string, unknown>;
  if (c?.type !== "write_resource") return false;
  const data = c.data as Record<string, unknown> | undefined;
  if (!data || typeof data.type !== "string") return false;
  return data.type.includes("lending::Vault");
}

function isVaultDeleteChange(change: unknown): change is VaultDeleteChange {
  const c = change as Record<string, unknown>;
  return (
    c?.type === "delete_resource" &&
    typeof c?.resource === "string" &&
    (c.resource as string).includes("Vault")
  );
}

// ── Access Helpers ─────────────────────────────────────────────────

function getResponseField(raw: UserTransactionResponse, field: string): string {
  return (raw as Record<string, unknown>)[field] as string ?? "";
}

function getResponseChanges(raw: UserTransactionResponse): unknown[] {
  return ((raw as Record<string, unknown>).changes as unknown[]) ?? [];
}

function getResponseEvents(raw: UserTransactionResponse): Array<Record<string, unknown>> {
  return ((raw as Record<string, unknown>).events as Array<Record<string, unknown>>) ?? [];
}

// ── Main Parser ───────────────────────────────────────────────────

export function parseSimulationResult(
  raw: UserTransactionResponse,
  tokenRegistry?: Map<string, string>,
): SimulationResult {
  const gasUsed = parseInt(getResponseField(raw, "gas_used") || "0");
  const gasUnitPrice = parseInt(getResponseField(raw, "gas_unit_price") || "100");
  const gasCostApt = (gasUsed * gasUnitPrice) / 1e8;

  return {
    success: raw.success,
    vmStatus: getResponseField(raw, "vm_status"),
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
  for (const evt of getResponseEvents(raw)) {
    const fullType = (evt.type as string) ?? "";
    const segments = fullType.split("::");
    const shortType = segments.slice(-2).join("::");
    const data = (evt.data as Record<string, unknown>) ?? {};
    const amountRaw = data.amount;
    const amount =
      amountRaw != null && String(amountRaw) !== "0"
        ? BigInt(String(amountRaw))
        : undefined;
    result.push({ type: fullType, shortType, amount, data });
  }
  return result;
}

function resolveTokenSymbol(
  metadata: string,
  registry?: Map<string, string>,
): string {
  if (!registry) return metadata.slice(0, 10) + "...";
  for (const [addr, sym] of registry) {
    if (metadata.toLowerCase() === addr.toLowerCase()) return sym;
  }
  return metadata.slice(0, 10) + "...";
}

function parseBalanceChanges(
  raw: UserTransactionResponse,
  tokenRegistry?: Map<string, string>,
): BalanceChange[] {
  const result: BalanceChange[] = [];
  for (const change of getResponseChanges(raw)) {
    if (!isFungibleStoreChange(change)) continue;
    result.push({
      address: change.address,
      token: resolveTokenSymbol(change.data.data.metadata.inner, tokenRegistry),
      tokenMetadata: change.data.data.metadata.inner,
      balance: BigInt(change.data.data.balance),
    });
  }
  return result;
}

function parseVaultChanges(raw: UserTransactionResponse): VaultChange[] {
  const result: VaultChange[] = [];
  for (const change of getResponseChanges(raw)) {
    if (isVaultDeleteChange(change)) {
      result.push({ address: change.address, collateral: 0n, debtPrincipal: 0n });
      continue;
    }
    if (!isVaultWriteChange(change)) continue;

    const vaultData = change.data.data;
    let collateral = 0n;
    let debtPrincipal = 0n;

    if (vaultData.collaterals?.data) {
      for (const entry of vaultData.collaterals.data) {
        collateral += BigInt(entry.value ?? "0");
      }
    }

    if (vaultData.liabilities?.data) {
      for (const entry of vaultData.liabilities.data) {
        debtPrincipal += BigInt(entry.value?.principal ?? "0");
      }
    }

    result.push({ address: change.address, collateral, debtPrincipal });
  }
  return result;
}
