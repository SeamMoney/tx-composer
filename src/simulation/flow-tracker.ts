import type { Aptos, UserTransactionResponse } from "@aptos-labs/ts-sdk";
import type { TokenConfig } from "../types.js";
import type {
  BalanceSnapshot,
  VaultSnapshot,
  BalanceDelta,
  BalanceDiff,
  StepExpectation,
  ExpectationResult,
} from "./types.js";
import { getFABalance } from "../core/balance.js";
import { formatAmount } from "../core/balance.js";

// ── Snapshot Capture ───────────────────────────────────────────────

export async function captureSnapshot(
  aptos: Aptos,
  owner: string,
  tokens: TokenConfig[],
): Promise<BalanceSnapshot> {
  const balances = new Map<string, bigint>();
  await Promise.all(
    tokens.map(async (t) => {
      const bal = await getFABalance(aptos, owner, t.metadata);
      balances.set(t.metadata, bal);
    }),
  );
  return { owner, balances };
}

// ── Simulation Balance Extraction ──────────────────────────────────

export function extractBalancesFromSimulation(
  raw: UserTransactionResponse,
  tokens: TokenConfig[],
  owner: string,
): Map<string, bigint> {
  const trackedMetadata = new Set(tokens.map((t) => t.metadata.toLowerCase()));
  const result = new Map<string, bigint>();
  const changes = ((raw as Record<string, unknown>).changes as unknown[]) ?? [];

  for (const change of changes) {
    const c = change as Record<string, unknown>;
    if (c.type !== "write_resource") continue;

    const data = c.data as Record<string, unknown> | undefined;
    if (!data || typeof data.type !== "string") continue;
    if (!data.type.includes("FungibleStore")) continue;

    const inner = data.data as Record<string, unknown> | undefined;
    if (!inner?.balance) continue;

    const metadata = (inner.metadata as Record<string, unknown>)?.inner as string;
    if (!metadata) continue;

    if (!trackedMetadata.has(metadata.toLowerCase())) continue;

    // Find the canonical metadata address (preserve original casing from token config)
    const canonicalMeta = tokens.find(
      (t) => t.metadata.toLowerCase() === metadata.toLowerCase(),
    )?.metadata;
    if (!canonicalMeta) continue;

    const balance = BigInt(String(inner.balance));

    // Aggregate: if multiple stores for same token, take the one associated with owner.
    // For primary fungible stores, there's typically one per token per owner.
    // We use the highest balance found (most likely the owner's store, not a pool store).
    const existing = result.get(canonicalMeta);
    if (existing === undefined || balance > existing) {
      result.set(canonicalMeta, balance);
    }
  }

  return result;
}

export function extractVaultFromSimulation(
  raw: UserTransactionResponse,
  protocolAddress: string,
): VaultSnapshot | null {
  const changes = ((raw as Record<string, unknown>).changes as unknown[]) ?? [];

  for (const change of changes) {
    const c = change as Record<string, unknown>;

    // Check for vault deletion
    if (
      c.type === "delete_resource" &&
      typeof c.resource === "string" &&
      c.resource.includes("Vault")
    ) {
      return { market: "", collateral: 0n, debtPrincipal: 0n, exists: false };
    }

    if (c.type !== "write_resource") continue;
    const data = c.data as Record<string, unknown> | undefined;
    if (!data || typeof data.type !== "string") continue;
    if (!data.type.includes("lending::Vault")) continue;

    const vaultData = data.data as Record<string, unknown> | undefined;
    if (!vaultData) continue;

    let collateral = 0n;
    let debtPrincipal = 0n;

    const collaterals = vaultData.collaterals as
      | { data: Array<{ key: string; value: string }> }
      | undefined;
    if (collaterals?.data) {
      for (const entry of collaterals.data) {
        collateral += BigInt(entry.value ?? "0");
      }
    }

    const liabilities = vaultData.liabilities as
      | { data: Array<{ key: string; value: { principal: string } }> }
      | undefined;
    if (liabilities?.data) {
      for (const entry of liabilities.data) {
        debtPrincipal += BigInt(entry.value?.principal ?? "0");
      }
    }

    return { market: "", collateral, debtPrincipal, exists: true };
  }

  return null;
}

// ── Diff Computation ───────────────────────────────────────────────

export function computeDeltas(
  before: Map<string, bigint>,
  after: Map<string, bigint>,
  tokens: TokenConfig[],
): BalanceDelta[] {
  const deltas: BalanceDelta[] = [];
  for (const token of tokens) {
    const b = before.get(token.metadata) ?? 0n;
    const a = after.get(token.metadata) ?? b; // if not in simulation, assume unchanged
    const delta = a - b;
    const sign = delta >= 0n ? "+" : "";
    deltas.push({
      token,
      before: b,
      after: a,
      delta,
      deltaFormatted: `${sign}${formatAmount(delta, token.decimals)}`,
    });
  }
  return deltas;
}

export function computeDiff(
  before: BalanceSnapshot,
  afterBalances: Map<string, bigint>,
  tokens: TokenConfig[],
  vaultBefore?: VaultSnapshot | null,
  vaultAfter?: VaultSnapshot | null,
): BalanceDiff {
  return {
    owner: before.owner,
    deltas: computeDeltas(before.balances, afterBalances, tokens),
    vault:
      vaultBefore !== undefined || vaultAfter !== undefined
        ? { before: vaultBefore ?? null, after: vaultAfter ?? null }
        : undefined,
  };
}

// ── Expectation Validation ─────────────────────────────────────────

export function validateExpectations(
  expectations: StepExpectation[],
  deltas: BalanceDelta[],
  vaultBefore?: VaultSnapshot | null,
  vaultAfter?: VaultSnapshot | null,
): ExpectationResult[] {
  return expectations.map((exp) => {
    switch (exp.type) {
      case "balance_increase": {
        const d = deltas.find(
          (d) => d.token.metadata.toLowerCase() === exp.token?.toLowerCase(),
        );
        if (!d) return { passed: false, description: exp.description, actual: "token not tracked" };
        return {
          passed: d.delta > 0n,
          description: exp.description,
          actual: `${d.deltaFormatted} ${d.token.symbol}`,
        };
      }
      case "balance_decrease": {
        const d = deltas.find(
          (d) => d.token.metadata.toLowerCase() === exp.token?.toLowerCase(),
        );
        if (!d) return { passed: false, description: exp.description, actual: "token not tracked" };
        return {
          passed: d.delta < 0n,
          description: exp.description,
          actual: `${d.deltaFormatted} ${d.token.symbol}`,
        };
      }
      case "vault_debt_decrease": {
        if (!vaultBefore || !vaultAfter) {
          return { passed: false, description: exp.description, actual: "vault not tracked" };
        }
        const decreased = vaultAfter.debtPrincipal < vaultBefore.debtPrincipal;
        return {
          passed: decreased,
          description: exp.description,
          actual: `debt ${vaultBefore.debtPrincipal} → ${vaultAfter.debtPrincipal}`,
        };
      }
      case "vault_collateral_decrease": {
        if (!vaultBefore || !vaultAfter) {
          return { passed: false, description: exp.description, actual: "vault not tracked" };
        }
        const decreased = vaultAfter.collateral < vaultBefore.collateral;
        return {
          passed: decreased,
          description: exp.description,
          actual: `collateral ${vaultBefore.collateral} → ${vaultAfter.collateral}`,
        };
      }
      case "success":
        return { passed: true, description: exp.description, actual: "checked at step level" };
      default:
        return { passed: false, description: exp.description, actual: `unknown type: ${exp.type}` };
    }
  });
}
