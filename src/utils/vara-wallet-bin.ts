import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

export function varaWalletBin(): string | null {
  if (process.env.VARA_WALLET_BIN) return process.env.VARA_WALLET_BIN;

  const localBin = join(process.cwd(), 'node_modules', '.bin', 'vara-wallet');
  return existsSync(localBin) ? localBin : null;
}

export function ensureVaraWalletPersistentHome(): void {
  if (process.env.SMARTPREDICTOR_DISABLE_VARA_WALLET_HOME_LINK === 'true') return;

  const home = process.env.HOME;
  if (!home) return;

  const persistentRoot = '/var/data';
  if (!existsSync(persistentRoot)) return;

  const persistentWalletHome = join(persistentRoot, '.vara-wallet');
  const homeWalletPath = join(home, '.vara-wallet');

  try {
    mkdirSync(persistentWalletHome, { recursive: true, mode: 0o700 });
    try {
      if (existsSync(homeWalletPath) && realpathSync(homeWalletPath) === persistentWalletHome) return;
    } catch {
      // Fall through and replace an unreadable or broken wallet-home path.
    }

    if (existsSync(homeWalletPath)) {
      const stat = lstatSync(homeWalletPath);
      rmSync(homeWalletPath, { recursive: stat.isDirectory() && !stat.isSymbolicLink(), force: true });
    }
    symlinkSync(persistentWalletHome, homeWalletPath);
  } catch {
    // Wallet readiness checks will surface the concrete failure later.
  }
}
