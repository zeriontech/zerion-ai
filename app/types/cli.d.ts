// Type declarations for CLI modules imported in server code

declare module '../../cli/utils/wallet/keystore.js' {
  export function getEvmAddress(walletName: string): string
  export function signEvmTransaction(
    walletName: string,
    unsignedTxHex: string,
    passphrase: string,
    caip2ChainId?: string
  ): { signature: string; recoveryId: number }
}
