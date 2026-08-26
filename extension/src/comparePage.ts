import { searchGames, offersFor, type SourceRef } from '../../server/src/fanout.ts';
import { groupKey } from '../../server/src/normalize.ts';
import type { Platform } from '../../server/src/search.ts';
import type { Offer, SourceAdapter } from '../../server/src/adapters/types.ts';
import { toILS } from '../../server/src/rates.ts';

/**
 * "You are looking at this game — here is what it costs everywhere else."
 *
 * The comparison behind the store-page panel. It is the tool's ORDINARY search
 * and price fan-out, the one the user could have run by typing the name in
 * themselves; standing on the store page just saves them the typing and the
 * moment of remembering to.
 *
 * It runs only when asked. See storePage.ts for why: a fan-out is sixteen
 * stores answering under a spacing budget, and doing that automatically for
 * every product page anybody idly opens would scale this tool's footprint with
 * browsing rather than with intent.
 */

/** Which board a storefront's page belongs to. */
const PLATFORM_OF: Record<string, Platform> = {
  steam: 'pc',
  gog: 'pc',
  epic: 'pc',
  xbox: 'xbox',
  playstation: 'ps5',
  nintendo: 'switch',
};

export interface ComparisonRow {
  store: string;
  region?: string;
  regionName?: string;
  flag?: string;
  priceILS: number;
  price: number;
  currency: string;
  url?: string;
  kind: string;
}

export interface Comparison {
  /** The title we actually searched for — shown, so a wrong match is visible. */
  matchedTitle: string;
  platform: Platform;
  rows: ComparisonRow[];
  /** The page's own price in ILS, when it could be read and converted. */
  pagePriceILS?: number;
  /** How much the cheapest row undercuts this page. Absent when it does not. */
  savingILS?: number;
}

export interface CompareRequest {
  title: string;
  store: string;
  price?: number;
  currency?: string;
}

/** How many rows the panel shows. It is a nudge, not the full board. */
const MAX_ROWS = 5;

/**
 * The group the page is actually about.
 *
 * Exact grouping-key match first — the page told us the name, so anything else
 * is a guess. Failing that, the group with the most sources behind it, which is
 * the base game rather than one of its editions. A page we cannot match
 * confidently returns nothing, because a comparison against the wrong game is
 * worse than no comparison.
 */
function pickGroup(
  hits: { groupKey: string; title: string; sourceId: string; sourceGameId: string; platform: Platform }[],
  title: string,
  platform: Platform
): { title: string; refs: SourceRef[] } | null {
  const onPlatform = hits.filter((h) => h.platform === platform);
  if (onPlatform.length === 0) return null;

  const wanted = groupKey(title);
  const byKey = new Map<string, typeof onPlatform>();
  for (const hit of onPlatform) {
    const list = byKey.get(hit.groupKey) ?? [];
    list.push(hit);
    byKey.set(hit.groupKey, list);
  }

  const exact = byKey.get(wanted);
  const chosen =
    exact ?? [...byKey.values()].sort((a, b) => b.length - a.length)[0] ?? null;
  if (!chosen || chosen.length === 0) return null;

  return {
    title: chosen[0]!.title,
    refs: chosen.map((h) => ({ sourceId: h.sourceId, sourceGameId: h.sourceGameId })),
  };
}

/** Drop rows from the storefront the user is already standing on. */
function isSameStore(offer: Offer, store: string): boolean {
  const name = offer.store.toLowerCase();
  const marks: Record<string, string[]> = {
    steam: ['steam'],
    gog: ['gog'],
    epic: ['epic'],
    xbox: ['xbox'],
    playstation: ['playstation', 'psn'],
    nintendo: ['nintendo'],
  };
  // A REGIONAL row of the same store is the most valuable answer there is
  // ("this exact page, in Turkey"), so only the user's own region is dropped.
  return (marks[store] ?? []).some((m) => name.includes(m)) && !offer.region;
}

export async function comparePage(sources: SourceAdapter[], req: CompareRequest): Promise<Comparison | null> {
  const platform = PLATFORM_OF[req.store];
  if (!platform || !req.title) return null;

  const found = await searchGames(sources, req.title);
  const group = pickGroup(found.games, req.title, platform);
  if (!group) return null;

  const { offers } = await offersFor(sources, group.refs, platform);
  const rows = offers
    .filter((o) => o.priceILS > 0 && !isSameStore(o, req.store))
    .slice(0, MAX_ROWS)
    .map((o) => ({
      store: o.store,
      region: o.region,
      regionName: o.regionName,
      flag: o.flag,
      priceILS: o.priceILS,
      price: o.price,
      currency: o.currency,
      url: o.url,
      kind: o.kind,
    }));

  // The page's own price, converted only so the two can be compared. A rate we
  // do not have means no saving is claimed — never a saving computed from a
  // guess at the exchange rate.
  let pagePriceILS: number | undefined;
  if (req.price && req.currency) {
    try {
      pagePriceILS = await toILS(req.price, req.currency);
    } catch {
      pagePriceILS = undefined;
    }
  }

  const cheapest = rows[0]?.priceILS;
  const savingILS =
    pagePriceILS !== undefined && cheapest !== undefined && cheapest < pagePriceILS
      ? pagePriceILS - cheapest
      : undefined;

  return { matchedTitle: group.title, platform, rows, pagePriceILS, savingILS };
}
