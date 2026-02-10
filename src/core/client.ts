import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
  Ed25519PublicKey,
  type AccountAddress,
} from "@aptos-labs/ts-sdk";
import type { ToolkitConfig } from "../types.js";

export class AptosClient {
  readonly aptos: Aptos;
  readonly config: AptosConfig;
  readonly network: Network;
  readonly account: Account | null;
  readonly accountAddress: AccountAddress;
  readonly publicKey: Ed25519PublicKey;

  constructor(cfg: ToolkitConfig) {
    this.network = cfg.network;
    this.config = new AptosConfig({
      network: cfg.network,
      ...(cfg.apiKey ? { clientConfig: { API_KEY: cfg.apiKey } } : {}),
    });
    this.aptos = new Aptos(this.config);

    if (cfg.privateKey) {
      const pk = new Ed25519PrivateKey(cfg.privateKey);
      this.account = Account.fromPrivateKey({ privateKey: pk });
      this.accountAddress = this.account.accountAddress;
      this.publicKey = this.account.publicKey as Ed25519PublicKey;
    } else if (cfg.publicKey) {
      this.account = null;
      this.publicKey = new Ed25519PublicKey(cfg.publicKey);
      this.accountAddress = this.publicKey.authKey().derivedAddress();
    } else {
      throw new Error("Either privateKey or publicKey must be provided");
    }
  }

  get address(): string {
    return this.accountAddress.toString();
  }

  get canExecute(): boolean {
    return this.account !== null;
  }
}
