/// <reference types="vite/client" />

// All optional — defaults live next to each use. Set them in the shell, e.g.
//   VITE_NETWORK_ID=preview yarn dev
interface ImportMetaEnv {
  readonly VITE_NETWORK_ID?: string; // default 'preprod'
  readonly VITE_LOGGING_LEVEL?: string; // default 'info'
  readonly VITE_ATTESTATION_API_URL?: string; // default 'http://localhost:4000'
  readonly VITE_INDEXER_URI?: string; // default: the wallet's indexer
  readonly VITE_INDEXER_WS_URI?: string; // set both or neither
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
