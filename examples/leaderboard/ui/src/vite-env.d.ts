/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK_ID?: string;
  readonly VITE_DEFAULT_CONTRACT?: string;
  readonly VITE_INDEXER_URL?: string;
  readonly VITE_BLOCKFROST_PROJECT_ID?: string;
}
