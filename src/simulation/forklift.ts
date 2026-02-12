import { Harness } from "@aptos-labs/forklift";

// ── Types ────────────────────────────────────────────────────────

export interface ForkedSessionConfig {
  /** Network to fork (default: "mainnet") */
  network?: string;
  /** Aptos API key for network access */
  apiKey: string;
  /** Pin fork to a specific block version */
  networkVersion?: number | string | bigint;
  /** Sender private key for executing functions against the fork */
  privateKey?: string;
}

export interface ForkStepResult {
  success: boolean;
  vmStatus: string;
  gasUsed: number;
  events: unknown[];
  hash: string;
}

export interface ResourceDiff {
  account: string;
  resourceType: string;
  before: unknown;
  after: unknown;
}

// ── ForkedSession ────────────────────────────────────────────────

/**
 * Fork mainnet/testnet state and run Move functions sequentially.
 * Each call sees the previous call's state changes.
 *
 * Use this to inspect how on-chain state changes — pool reserves
 * after a swap, lending positions after repayment, etc.
 *
 * Note: ForkedSession runs individual Move functions via the Aptos CLI.
 * For atomic multi-step transactions, use DynamicComposer instead.
 */
export class ForkedSession {
  private harness: ReturnType<typeof Harness.createNetworkFork>;
  private senderProfile: string;
  private snapshots = new Map<string, Map<string, unknown>>();

  private constructor(
    harness: ReturnType<typeof Harness.createNetworkFork>,
    senderProfile: string,
  ) {
    this.harness = harness;
    this.senderProfile = senderProfile;
  }

  /**
   * Fork a network and create a session.
   *
   * If `privateKey` is provided, it's registered as the sender profile
   * so transactions execute as that account against forked state.
   * If omitted, the default profile (auto-funded with 100 APT) is used.
   */
  static create(config: ForkedSessionConfig): ForkedSession {
    const network = config.network ?? "mainnet";
    const harness = Harness.createNetworkFork(
      network,
      config.apiKey,
      config.networkVersion,
    );

    let senderProfile = "default";

    if (config.privateKey) {
      harness.init_cli_profile("sender", config.privateKey);
      senderProfile = "sender";
    }

    return new ForkedSession(harness, senderProfile);
  }

  /**
   * Execute a Move function against the fork. State persists — the next
   * call will see this call's changes.
   */
  run(
    functionId: string,
    options?: {
      args?: string[];
      typeArgs?: string[];
      includeEvents?: boolean;
    },
  ): ForkStepResult {
    const res = this.harness.runMoveFunction({
      sender: this.senderProfile,
      functionId,
      args: options?.args,
      typeArgs: options?.typeArgs,
      includeEvents: options?.includeEvents ?? true,
    });

    const result = res?.Result ?? {};

    return {
      success: result.success ?? false,
      vmStatus: result.vm_status ?? "unknown",
      gasUsed: result.gas_used ?? 0,
      events: result.events ?? [],
      hash: result.transaction_hash ?? "",
    };
  }

  /**
   * Read a resource from the fork's current state.
   * Tries direct resource first, then falls back to resource group
   * (needed for object-based resources like DEX pools).
   * Returns the resource data, or null if not found.
   */
  readResource(account: string, resourceType: string): unknown {
    // Try direct resource first
    const res = this.harness.viewResource(account, resourceType);
    if (res?.Result != null) return res.Result;

    // Fall back to resource group (objects store resources in groups)
    try {
      const group = this.harness.viewResourceGroup(
        account,
        "0x1::object::ObjectGroup",
      );
      if (group?.Result?.[resourceType] != null) {
        return group.Result[resourceType];
      }
    } catch {
      // Resource group not available
    }

    return null;
  }

  /**
   * Read all resources in an account's object group.
   * Returns a map of resource type → data, or null if not an object.
   */
  readResourceGroup(
    account: string,
    group = "0x1::object::ObjectGroup",
  ): Record<string, unknown> | null {
    try {
      const res = this.harness.viewResourceGroup(account, group);
      return (res?.Result as Record<string, unknown>) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Call a view function on the fork's current state.
   */
  view(
    functionId: string,
    args?: string[],
    typeArgs?: string[],
  ): unknown {
    const res = this.harness.runViewFunction({
      functionId,
      args,
      typeArgs,
    });
    return res?.Result ?? null;
  }

  /**
   * Snapshot the current state of specified resources under a label.
   * Use with `diff()` to see what changed between two points.
   */
  snapshot(
    label: string,
    queries: Array<{ account: string; resourceType: string }>,
  ): void {
    const snap = new Map<string, unknown>();

    for (const q of queries) {
      const key = `${q.account}::${q.resourceType}`;
      const data = this.readResource(q.account, q.resourceType);
      snap.set(key, data);
    }

    this.snapshots.set(label, snap);
  }

  /**
   * Compare two labeled snapshots. Returns diffs for resources that changed.
   */
  diff(before: string, after: string): ResourceDiff[] {
    const beforeSnap = this.snapshots.get(before);
    const afterSnap = this.snapshots.get(after);

    if (!beforeSnap) throw new Error(`Snapshot "${before}" not found`);
    if (!afterSnap) throw new Error(`Snapshot "${after}" not found`);

    const diffs: ResourceDiff[] = [];
    const allKeys = new Set([...beforeSnap.keys(), ...afterSnap.keys()]);

    for (const key of allKeys) {
      const beforeVal = beforeSnap.get(key) ?? null;
      const afterVal = afterSnap.get(key) ?? null;

      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        // Parse key back to account + resourceType
        // Key format: "0xaddr::module::Type" — split on first "::" pair after the address
        const firstSep = key.indexOf("::");
        const account = key.slice(0, firstSep);
        const resourceType = key.slice(firstSep + 2);

        diffs.push({ account, resourceType, before: beforeVal, after: afterVal });
      }
    }

    return diffs;
  }

  /**
   * Get the sender's address in this fork session.
   */
  get senderAddress(): string {
    return this.harness.getAccountAddress(this.senderProfile);
  }

  /**
   * Clean up the fork's temporary directory. The session cannot be used after this.
   */
  cleanup(): void {
    this.harness.cleanup();
  }
}
