/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_BSC_RPC_URL?: string;
  readonly VITE_DAPP_BASE_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_USDT_ADDRESS?: string;
  readonly VITE_CRUDETRUST_CONTRACT_ADDRESS?: string;
  readonly VITE_IRONBROTHER_CONTRACT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
