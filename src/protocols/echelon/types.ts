export interface EchelonConfig {
  address: string;
  markets: Record<string, string>;
}

export const DEFAULT_ECHELON_CONFIG: EchelonConfig = {
  address:
    "0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba",
  markets: {
    USD1: "0xbb8f38636896c629ff9ef0bf916791a992e12ab4f1c6e26279ee9c6979646963",
  },
};
