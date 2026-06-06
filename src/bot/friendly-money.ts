import {
  formatUsdAmount,
  formatVaraUsdPrice,
  planckToUsdString,
  planckToVaraString,
  type VaraUsdPriceSource,
} from '../economics/vara-usd-converter.js';
import type { DecisionReport } from '../types/index.js';

export function formatFriendlyPlanckAmount(
  planck: string | bigint,
  price: VaraUsdPriceSource | null | undefined,
): string {
  const vara = `${planckToVaraString(planck)} VARA`;
  if (!price) return `${vara} (USD conversion unavailable)`;
  return `${vara} (~${formatUsdAmount(planckToUsdString(planck, price))} USD at ${formatVaraUsdPrice(price)})`;
}

export function decisionReportVaraUsdPrice(report: DecisionReport): VaraUsdPriceSource | null {
  const price = report.economics.varaUsdPrice;
  if (!price?.priceUsdMicro) return null;
  try {
    const priceUsdMicro = BigInt(price.priceUsdMicro);
    return priceUsdMicro > 0n
      ? {
          source: price.source,
          priceUsdMicro,
          updatedAt: price.updatedAt,
        }
      : null;
  } catch {
    return null;
  }
}
