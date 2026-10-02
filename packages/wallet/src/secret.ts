/** The secret a wallet is derived from: a hex master seed or a BIP-39 mnemonic. */
export type WalletSecret =
  | { kind: 'seed'; value: string }
  | { kind: 'mnemonic'; value: string };
