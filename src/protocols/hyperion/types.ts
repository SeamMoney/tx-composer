export interface HyperionConfig {
  address: string;
  pools: Record<string, string>;
}

export const DEFAULT_HYPERION_CONFIG: HyperionConfig = {
  address:
    "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c",
  pools: {
    USD1_USDC:
      "0x1609a6f6e914e60bf958d0e1ba24a471ee2bcadeca9e72659336a1f002be50db",
  },
};

/** Max sqrt_price_limit for b->a swaps (Uniswap V3 style) */
export const MAX_SQRT_PRICE_B_TO_A = "79226673515401279992447579055";
/** Min sqrt_price_limit for a->b swaps */
export const MIN_SQRT_PRICE_A_TO_B = "4295128740";
