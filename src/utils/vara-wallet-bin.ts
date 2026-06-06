import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function varaWalletBin(): string | null {
  if (process.env.VARA_WALLET_BIN) return process.env.VARA_WALLET_BIN;

  const localBin = join(process.cwd(), 'node_modules', '.bin', 'vara-wallet');
  return existsSync(localBin) ? localBin : null;
}
