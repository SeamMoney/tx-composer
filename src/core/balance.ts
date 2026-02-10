import type { Aptos } from "@aptos-labs/ts-sdk";
import type { TokenConfig } from "../types.js";

export async function getFABalance(
  aptos: Aptos,
  owner: string,
  metadataAddr: string,
): Promise<bigint> {
  try {
    const balances = await aptos.getCurrentFungibleAssetBalances({
      options: {
        where: {
          owner_address: { _eq: owner },
          asset_type: { _eq: metadataAddr },
        },
      },
    });
    if (balances.length > 0) return BigInt(balances[0].amount);
  } catch {
    // indexer may be down
  }
  return 0n;
}

export async function getBalances(
  aptos: Aptos,
  owner: string,
  tokens: TokenConfig[],
): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  await Promise.all(
    tokens.map(async (t) => {
      const bal = await getFABalance(aptos, owner, t.metadata);
      result.set(t.symbol, bal);
    }),
  );
  return result;
}

export async function getFABalanceSafe(
  aptos: Aptos,
  owner: string,
  metadataAddr: string,
): Promise<{ balance: bigint; error?: Error }> {
  try {
    const balances = await aptos.getCurrentFungibleAssetBalances({
      options: {
        where: {
          owner_address: { _eq: owner },
          asset_type: { _eq: metadataAddr },
        },
      },
    });
    if (balances.length > 0) return { balance: BigInt(balances[0].amount) };
    return { balance: 0n };
  } catch (e) {
    return { balance: 0n, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export function formatAmount(raw: bigint | number, decimals: number): string {
  return (Number(raw) / 10 ** decimals).toFixed(decimals);
}
