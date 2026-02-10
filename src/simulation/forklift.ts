import { Harness } from "@aptos-labs/forklift";

export class ForkliftReader {
  private harness: ReturnType<typeof Harness.createNetworkFork>;

  constructor(network: string = "mainnet", apiKey: string) {
    this.harness = Harness.createNetworkFork(network, apiKey);
  }

  viewResource(account: string, resourceType: string): any {
    return this.harness.viewResource(account, resourceType);
  }

  viewFunction(functionId: string, args: string[]): any {
    return this.harness.runViewFunction({ functionId, args });
  }

  cleanup(): void {
    this.harness.cleanup();
  }
}
