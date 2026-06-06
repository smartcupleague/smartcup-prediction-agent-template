import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import { OracleClient } from '../adapters/oracle-client.js';
import type { AgentConfig, U128String } from '../types/index.js';

const PLANCK_PER_VARA = 1_000_000_000_000n;
const MICRO_USD_PER_USD = 1_000_000n;

export type VaraUsdPriceSource = {
  source: 'oracle' | 'bolao_state';
  priceUsdMicro: bigint;
  updatedAt: string | null;
};

export async function usdToPlanck(
  config: AgentConfig,
  usdAmount: string | number,
): Promise<{ planck: U128String; price: VaraUsdPriceSource }> {
  const price = await readVaraUsdPrice(config);
  const usdMicro = parseUsdToMicro(usdAmount);
  if (usdMicro <= 0n) throw new Error(`USD amount must be positive: ${usdAmount}`);
  const numerator = usdMicro * PLANCK_PER_VARA;
  const planck = ceilDiv(numerator, price.priceUsdMicro);
  return { planck: planck.toString() as U128String, price };
}

export function planckToUsdString(planck: string | bigint, price: VaraUsdPriceSource): string {
  const rawPlanck = typeof planck === 'bigint' ? planck : BigInt(planck);
  const negative = rawPlanck < 0n;
  const absolutePlanck = negative ? -rawPlanck : rawPlanck;
  const usdMicro = (absolutePlanck * price.priceUsdMicro) / PLANCK_PER_VARA;
  const dollars = usdMicro / MICRO_USD_PER_USD;
  const cents = ((usdMicro % MICRO_USD_PER_USD) + 5_000n) / 10_000n;
  const value = cents >= 100n ? `${dollars + 1n}.00` : `${dollars}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${value}` : value;
}

export function planckToVaraString(planck: string | bigint, fractionDigits = 2): string {
  const rawPlanck = typeof planck === 'bigint' ? planck : BigInt(planck);
  const negative = rawPlanck < 0n;
  const absolutePlanck = negative ? -rawPlanck : rawPlanck;
  const scale = 10n ** BigInt(Math.max(0, fractionDigits));
  const rounded = (absolutePlanck * scale + PLANCK_PER_VARA / 2n) / PLANCK_PER_VARA;
  const whole = rounded / scale;
  const fraction = rounded % scale;
  const value =
    fractionDigits > 0
      ? `${whole}.${fraction.toString().padStart(fractionDigits, '0')}`
      : whole.toString();
  return negative ? `-${value}` : value;
}

export function formatUsdAmount(usd: string): string {
  return usd.startsWith('-') ? `-$${usd.slice(1)}` : `$${usd}`;
}

export function formatVaraUsdPrice(price: VaraUsdPriceSource): string {
  const whole = price.priceUsdMicro / MICRO_USD_PER_USD;
  const fraction = price.priceUsdMicro % MICRO_USD_PER_USD;
  return `$${whole}.${fraction.toString().padStart(6, '0')}/VARA`;
}

export async function readVaraUsdPrice(config: AgentConfig): Promise<VaraUsdPriceSource> {
  try {
    const price = await new OracleClient(config).queryVaraUsdPrice();
    const priceUsdMicro = BigInt(price.price_usd_micro);
    if (priceUsdMicro > 0n) {
      return {
        source: 'oracle',
        priceUsdMicro,
        updatedAt: price.price_updated_at,
      };
    }
  } catch {
    // Fallback below uses BolaoCore state, which is the same protocol price cache family.
  }

  const state = await new BolaoChainClient(config).queryState();
  const priceUsdMicro = BigInt(state.vara_price_usd_micro || '0');
  if (priceUsdMicro <= 0n) {
    throw new Error('Could not resolve VARA/USD price from Oracle or BolaoCore state.');
  }
  return {
    source: 'bolao_state',
    priceUsdMicro,
    updatedAt: state.price_cached_at,
  };
}

export function parseUsdToMicro(value: string | number): bigint {
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new Error(`Invalid USD amount: ${value}`);
  const [whole = '0', fraction = ''] = raw.split('.');
  return BigInt(whole) * MICRO_USD_PER_USD + BigInt(fraction.padEnd(6, '0'));
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive.');
  return (numerator + denominator - 1n) / denominator;
}
