/**
 * Live currency conversion to ILS via the free, keyless open.er-api.com.
 * Chosen over ECB-based sources because it covers the "cheap region"
 * currencies gamers actually use — ARS (Argentina), UAH (Ukraine), RUB,
 * TRY — which ECB feeds omit. Rates cache for 6 hours; a stale/fallback
 * rate keeps the app working offline.
 */

const CACHE_MS = 6 * 60 * 60 * 1000;
const ENDPOINT = 'https://open.er-api.com/v6/latest/ILS';

/** Coarse offline fallback (foreign units per 1 ILS), only if the API is unreachable. */
const FALLBACK: Record<string, number> = {
  ILS: 1,
  USD: 0.33,
  EUR: 0.28,
  GBP: 0.24,
  TRY: 15.5,
  ARS: 485,
  UAH: 14.7,
  INR: 31.7,
  BRL: 1.68,
  RUB: 25.7,
  JPY: 53,
};

interface RateCache {
  /** ILS per 1 unit of the foreign currency. */
  ilsPerUnit: Record<string, number>;
  fetchedAt: number;
}

let cache: RateCache | null = null;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`er-api ${res.status}`);
  const data = (await res.json()) as { result: string; rates: Record<string, number> };
  if (data.result !== 'success') throw new Error('er-api non-success');
  // API gives foreign units per 1 ILS; invert to ILS per 1 foreign unit.
  const ilsPerUnit: Record<string, number> = { ILS: 1 };
  for (const [cur, perIls] of Object.entries(data.rates)) {
    if (perIls > 0) ilsPerUnit[cur] = 1 / perIls;
  }
  cache = { ilsPerUnit, fetchedAt: Date.now() };
}

async function ensureFresh(): Promise<void> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return;
  // Collapse concurrent refreshes (region board converts many currencies at once).
  if (!inflight) {
    inflight = refresh()
      .catch(() => {
        if (!cache) {
          cache = {
            ilsPerUnit: Object.fromEntries(
              Object.entries(FALLBACK).map(([c, perIls]) => [c, 1 / perIls])
            ),
            fetchedAt: 0,
          };
        }
      })
      .finally(() => {
        inflight = null;
      });
  }
  await inflight;
}

/** Convert an amount in `currency` to ILS, rounded to agorot. Throws if the currency is unknown. */
export async function toILS(amount: number, currency: string): Promise<number> {
  if (currency === 'ILS') return Math.round(amount * 100) / 100;
  await ensureFresh();
  const rate = cache!.ilsPerUnit[currency];
  if (!rate) throw new Error(`no ILS rate for ${currency}`);
  return Math.round(amount * rate * 100) / 100;
}

/** How many units of `currency` equal 1 ILS — for showing ILS-normalized prices in
 *  a chosen display currency (USD/EUR). Falls back to 1 (i.e. ILS) if unknown. */
export async function ilsTo(currency: string): Promise<number> {
  if (currency === 'ILS') return 1;
  await ensureFresh();
  const rate = cache?.ilsPerUnit[currency];
  return rate && rate > 0 ? 1 / rate : 1;
}

/** True if we can convert this currency right now (used to skip unpriceable regions gracefully). */
export async function canConvert(currency: string): Promise<boolean> {
  if (currency === 'ILS') return true;
  await ensureFresh();
  return Boolean(cache && cache.ilsPerUnit[currency]);
}
