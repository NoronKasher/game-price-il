import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { toILS, canConvert } from '../rates.ts';
import { describeProduct, parseLocalizedPrice } from '../normalize.ts';
import { getSetting } from '../db.ts';
import { discoverSearchHashShared, hashDiscoveryDue, noteHashRejected } from './psnHash.ts';
import { REGIONS } from '../regions.ts';

/**
 * PlayStation Store — regional price board.
 *
 * PSN rebuilt its store as a client-side app in 2026: the search page now ships
 * only empty loading skeletons and hydrates results in the browser, so the old
 * "read the server-rendered search HTML" approach returns nothing. There is no
 * official free price API (PlatPrices forbids price-alert tools; ITAD has no
 * console prices), so — like every PS price tracker — we now use the store's own
 * two public data paths, the same ones the user's browser hits:
 *
 *   1. SEARCH — the store's GraphQL endpoint (`getSearchResults`), which takes an
 *      explicit `countryCode` and returns each region's products (with the stable
 *      cross-region product code) but NOT their price. This is the one call that
 *      needs a persisted-query hash (see currentSearchHash()).
 *   2. PRICE — the product page IS still server-rendered with its price embedded
 *      in `__NEXT_DATA__` (`batarangs.cta`). We fetch `/{locale}/product/{id}` and
 *      read the buyable ("APPLICABLE") price. No hash, no scraping of protected
 *      markup — just the page the store serves without JavaScript.
 *
 * Product ids are region-specific by prefix (UP…=Americas, EP…=Europe), but the
 * trailing product code (e.g. "GOWRAGNAROK00000") is stable across regions, so we
 * search each region and match a game by that code, then price that region's id.
 *
 * sourceGameId = "<productCode>~<url-encoded search name>".
 */

/**
 * The same honest identifier every other adapter sends.
 *
 * This used to be a forged Chrome 124 string — the only one of sixteen sources
 * that pretended to be a browser, in a project whose first stated rule is that it
 * never forges a fingerprint. It was presumably added on the assumption that the
 * store would refuse anything else.
 *
 * It does not. Measured against the live store on 2026-08-23, with the adapter's
 * own headers: the GraphQL search answers HTTP 200 with the same five result
 * groups under either string, and the product page returns byte-identical HTML.
 * The disguise bought nothing and cost the one thing the project says it will
 * not spend. If PlayStation ever does start requiring a browser string, the
 * honest answer is that PlayStation stops being supported — not that we put the
 * costume back on.
 */
const UA = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const GQL = 'https://web.np.playstation.com/api/graphql/v1//op';
const STORE = 'https://store.playstation.com';
const CACHE_TTL = 10 * 60 * 1000;
// Each region costs a search + a product-page fetch, so with ~22 regions we let
// more run at once (PSN's own store fans out far harder than this).
const MAX_CONCURRENT = 8;

/**
 * Persisted-query hash for the store's `getSearchResults` operation. PSN runs a
 * server-side allowlist of hashes (a raw query is refused as "not whitelisted"),
 * and the hash is computed on their client from the query text, so it is not a
 * constant we can look up. It's stable for long stretches and rotates only when
 * PSN changes the query.
 *
 * This value is just the starting point. When it rotates, psnHash.ts recovers a
 * fresh one automatically by loading the public store page in a browser, and
 * Settings offers both a re-check button and a field to paste one by hand.
 * Captured 2026-08-20 from @sie-ppr-web-store/app 0.113.0.
 */
const SEARCH_OP = 'getSearchResults';
const DEFAULT_SEARCH_HASH = '4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa';

/**
 * Recovering from a rotated hash, without a code change.
 *
 * The obvious fix — derive the hash ourselves — was tried and rejected. Apollo
 * hashes the AST-PRINTED document, so reproducing it means pulling the query AND
 * every fragment it spreads out of a minified Next.js bundle and reassembling
 * them in Apollo's exact order. That extractor would break on any bundle
 * refactor, i.e. a self-heal that itself needs healing, replacing a one-line fix
 * with a silent one. (Verified: no plain-string normalisation of the extracted
 * document reproduces the live hash.)
 *
 * So recovery is made cheap rather than automatic. The hash is read at call time
 * from PSN_SEARCH_HASH (env) or the `psn_search_hash` setting, so a rotation is
 * fixed by setting a value — no rebuild, no redeploy. The health canary reports
 * PSN as failing the moment it rotates, which is the part that actually used to
 * be missing: 22 regions could vanish and look like "not sold there".
 *
 * To refresh: open store.playstation.com, search anything, and copy `sha256Hash`
 * from the getSearchResults request in the network tab.
 */
export function currentSearchHash(): string {
  const fromEnv = process.env.PSN_SEARCH_HASH?.trim();
  if (fromEnv) return fromEnv;
  const fromSettings = getSetting('psn_search_hash')?.trim();
  return fromSettings || DEFAULT_SEARCH_HASH;
}

/** Where the hash in use came from, so Settings can say so plainly. */
export function searchHashSource(): 'env' | 'saved' | 'builtin' {
  if (process.env.PSN_SEARCH_HASH?.trim()) return 'env';
  return getSetting('psn_search_hash')?.trim() ? 'saved' : 'builtin';
}

/**
 * The markets PSN serves, each mapped to the store locale its product pages
 * actually price in. PSN's country set differs from the shared roster — it has
 * no Israel store, and several markets need a non-English locale (es-/pt-/uk-…)
 * or the product page renders with no price. Every region here was verified to
 * return a real APPLICABLE price; the rest of the roster is simply skipped.
 * (currency isn't listed — each product page reports its own, e.g. LATAM in USD.)
 */
const PSN_LOCALE: Record<string, string> = {
  // Americas cluster
  US: 'en-us', CA: 'en-ca', MX: 'es-mx', BR: 'pt-br', AR: 'es-ar', CL: 'es-cl', CO: 'es-co', PE: 'es-pe',
  // Europe / EMEA cluster
  GB: 'en-gb', TR: 'en-tr', IN: 'en-in', ZA: 'en-za', DE: 'de-de', FR: 'fr-fr', UA: 'uk-ua',
  // Asia cluster
  HK: 'en-hk', SG: 'en-sg', TW: 'zh-tw', TH: 'en-th', ID: 'en-id', MY: 'en-my', KR: 'ko-kr',
};

interface PsnRegion {
  country: string;
  locale: string;
  nameHe: string;
  flag: string;
  pinned: boolean;
}
/** PSN-servable regions, drawn from the shared roster so names/flags stay in sync. */
const PSN_REGIONS: PsnRegion[] = REGIONS.filter((r) => PSN_LOCALE[r.market]).map((r) => ({
  country: r.market,
  locale: PSN_LOCALE[r.market]!,
  nameHe: r.nameHe,
  flag: r.flag,
  pinned: r.pinned,
}));

/** PSN platform tag ⇄ our platform id (PSN only sells PS4/PS5). */
const PLATFORM_TAG: Record<'ps4' | 'ps5', string> = { ps5: 'PS5', ps4: 'PS4' };

/** Store-display classifications that are NOT a buyable game (skip in search). */
const SKIP_CLASS = /ADD.?ON|LEVEL|CONSUMABLE|CURRENCY|DEMO|THEME|AVATAR|SEASON_PASS|MEMBERSHIP/i;

const cache = new Map<string, { body: string; at: number }>();

/** Fetch text with a short cache; null on any non-200 / network error. */
/**
 * Like fetchText, but hands back the status AND the body on failure.
 *
 * The GraphQL endpoint rejects a rotated hash with HTTP 400 and
 * `{"message":"Query not whitelisted"}` — a shape fetchText discards, so the
 * rejection used to read as "no results" and the hash error could never fire.
 * Error responses are deliberately not cached.
 */
async function fetchStatusText(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string } | null> {
  const key = url + JSON.stringify(headers);
  const c = cache.get(key);
  if (c && Date.now() - c.at < CACHE_TTL) return { status: 200, body: c.body };
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    if (res.status === 200) cache.set(key, { body, at: Date.now() });
    return { status: res.status, body };
  } catch {
    return null;
  }
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string | null> {
  const key = url + JSON.stringify(headers);
  const c = cache.get(key);
  if (c && Date.now() - c.at < CACHE_TTL) return c.body;
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (res.status !== 200) return null;
    const body = await res.text();
    cache.set(key, { body, at: Date.now() });
    return body;
  } catch {
    return null;
  }
}

/** Thrown when the store's GraphQL rejects our persisted-query hash (rotated). */
export class PsnHashError extends Error {
  constructor(detail: string) {
    super(
      'PSN search hash rejected (rotated). Set PSN_SEARCH_HASH, or the psn_search_hash setting, ' +
        'to the sha256Hash of a getSearchResults request from store.playstation.com. ' +
        detail
    );
    this.name = 'PsnHashError';
  }
}

interface SearchProduct {
  id: string;
  name: string;
  platforms: string[];
  media?: { role: string; type: string; url: string }[];
  storeDisplayClassification?: string;
}

/** The stable, cross-region product code — the segment after "_00-". */
function codeOf(productId: string): string | null {
  return productId.match(/_00-([A-Za-z0-9]+)$/)?.[1] ?? null;
}

/** Best cover image from a product's media list. */
function imageOf(p: SearchProduct): string | undefined {
  const pref = ['GAMEHUB_COVER_ART', 'MASTER', 'EDITION_KEY_ART', 'FOUR_BY_THREE_BANNER', 'BACKGROUND'];
  const images = (p.media ?? []).filter((m) => m.type === 'IMAGE');
  for (const role of pref) {
    const hit = images.find((m) => m.role === role);
    if (hit) return hit.url;
  }
  return images[0]?.url;
}

/**
 * Call the store's `getSearchResults` for one region. Throws PsnHashError if the
 * persisted-query hash is no longer accepted (so callers can surface the outage
 * instead of silently returning nothing); returns [] on ordinary empty/failed
 * responses.
 */
async function gqlSearch(term: string, country: string, lang: string, pageSize = 20): Promise<SearchProduct[]> {
  const variables = encodeURIComponent(
    JSON.stringify({ countryCode: country, languageCode: lang, nextCursor: '', pageOffset: 0, pageSize, searchTerm: term })
  );
  const extensions = encodeURIComponent(
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: currentSearchHash() } })
  );
  const url = `${GQL}?operationName=${SEARCH_OP}&variables=${variables}&extensions=${extensions}`;
  const res = await fetchStatusText(url, {
    'User-Agent': UA,
    Accept: 'application/json',
    'content-type': 'application/json',
    'x-apollo-operation-name': SEARCH_OP,
    // Non-English stores (DE/FR/KR/JP…) return zero results for an `en` query,
    // so the search language must match the region's own store locale.
    'x-psn-store-locale-override': `${lang}-${country}`,
  });
  if (!res) return [];
  const rejected = (m: string) => /persisted|whitelist|unknown operation/i.test(m);
  let json: {
    message?: string;
    data?: { universalSearch?: { results?: SearchProduct[] } };
    errors?: { message?: string }[];
  };
  try {
    json = JSON.parse(res.body);
  } catch {
    return [];
  }
  // The rejection arrives as a bare top-level message on a 400, not in `errors`.
  if (json.message && rejected(json.message)) throw new PsnHashError(json.message.slice(0, 120));
  if (res.status !== 200) return [];
  if (json.errors?.length) {
    const msg = json.errors[0]?.message ?? '';
    if (rejected(msg)) throw new PsnHashError(msg.slice(0, 120));
    return [];
  }
  return json.data?.universalSearch?.results ?? [];
}

interface RegionPrice {
  currency: string;
  /** Current buy price in major currency units (e.g. 69.99, 4999). */
  value: number;
  /** Full price before discount, major units. */
  base: number;
}

/**
 * The buyable ("APPLICABLE") price on a product's server-rendered page, in the
 * given region locale. Reads `__NEXT_DATA__ → props.pageProps.batarangs.cta`,
 * skipping the PS-Plus "UPSELL" price (which shows as "Included" / 0). Returns
 * null when the product isn't sold in that region (the page then carries no
 * applicable price).
 */
async function priceOf(locale: string, productId: string): Promise<RegionPrice | null> {
  const html = await fetchText(`${STORE}/${locale}/product/${productId}`, {
    'User-Agent': UA,
    'Accept-Language': 'en',
  });
  if (!html) return null;
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let cta: unknown;
  try {
    const nd = JSON.parse(m[1]!) as { props?: { pageProps?: { batarangs?: Record<string, unknown> } } };
    cta = nd.props?.pageProps?.batarangs?.cta;
  } catch {
    return null;
  }
  // The `cta` batarang is `{ text, statusCode }`, where `text` is the CTA
  // fragment's own HTML — the price JSON sits inside it as a real (once-escaped)
  // string, so we scan `text` directly. Stringifying the wrapper object instead
  // double-escapes the quotes and the match silently fails.
  const blob =
    typeof cta === 'string'
      ? cta
      : cta && typeof (cta as { text?: unknown }).text === 'string'
        ? (cta as { text: string }).text
        : '';
  // Take the buyable ("APPLICABLE") price, not the PS-Plus "UPSELL" one (which
  // shows as "Included"/0 for catalog games). basePrice/discountedPrice/currencyCode
  // all sit inside that Price object, before its applicability field.
  const at = blob.indexOf('"applicability":"APPLICABLE"');
  if (at < 0) return null;
  const start = blob.lastIndexOf('{"__typename":"Price"', at);
  if (start < 0) return null;
  const seg = blob.slice(start, at + 40);
  const cc = seg.match(/"currencyCode":"([A-Z]{3})"/);
  const bp = seg.match(/"basePrice":"([^"]*)"/);
  const dp = seg.match(/"discountedPrice":"([^"]*)"/);
  if (!cc || !bp || !dp) return null;
  // Parse the display strings ("$69.99", "Rs 4,999", "2.799,00 TL") per locale
  // rather than the numeric minor-unit field, whose scale varies by currency
  // (USD/TRY are in cents, INR is whole rupees).
  const value = parseLocalizedPrice(dp[1]!);
  const base = parseLocalizedPrice(bp[1]!);
  if (value == null || !(value > 0)) return null; // free / included / unpriced
  return { currency: cc[1]!, value, base: base ?? value };
}

/** How long a request will wait on hash recovery before giving up on it. */
const RECOVERY_BUDGET_MS = 12_000;

/**
 * gqlSearch, plus one automatic attempt to recover a rotated hash.
 *
 * Recovery drives a real browser over the public store page and reads the hash
 * it sends (see psnHash.ts) — only possible when Playwright is installed, and
 * rate-limited to one attempt per cooldown because it launches a browser. When
 * it isn't available the original error propagates, the canary reports PSN as
 * down, and the fix is to set PSN_SEARCH_HASH.
 */
async function gqlSearchRecovering(
  term: string,
  country: string,
  lang: string,
  pageSize = 20
): Promise<SearchProduct[]> {
  try {
    return await gqlSearch(term, country, lang, pageSize);
  } catch (err) {
    if (!(err instanceof PsnHashError)) throw err;
    // Record the refusal before deciding what to do about it: a host with its
    // own browser (the desktop build) watches this flag, and it must be set
    // even on the calls that the cooldown declines to act on.
    noteHashRejected();
    if (!hashDiscoveryDue()) throw err;
    // Start the recovery, but never make a user wait out a cold browser start.
    // If it lands inside the budget the request is saved outright; if not it
    // keeps running and persists the hash, so the next search or the nightly
    // capture succeeds. Either way this request fails fast and honestly rather
    // than hanging for minutes.
    const fresh = await Promise.race([
      discoverSearchHashShared(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RECOVERY_BUDGET_MS)),
    ]);
    if (!fresh) throw err;
    console.log('psn: recovered a fresh search hash automatically');
    return gqlSearch(term, country, lang, pageSize);
  }
}

export const psn: SourceAdapter = {
  id: 'psn-store',
  name: 'PlayStation Store (regional)',
  nameHe: 'חנות פלייסטיישן — לפי אזור',
  platforms: ['ps5', 'ps4'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    // Discover the game in the US catalog (broadest); per-region ids come later.
    const products = await gqlSearchRecovering(title, 'US', 'en');
    const wantPs5 = !platforms.length || platforms.includes('ps5');
    const wantPs4 = !platforms.length || platforms.includes('ps4');

    const hits: GameHit[] = [];
    const seen = new Set<string>();
    for (const p of products) {
      if (SKIP_CLASS.test(p.storeDisplayClassification ?? '')) continue;
      const code = codeOf(p.id);
      if (!code) continue;
      const d = describeProduct(p.name);
      if (d.accessory) continue;
      const image = imageOf(p);
      for (const platform of ['ps5', 'ps4'] as const) {
        if (platform === 'ps5' && !wantPs5) continue;
        if (platform === 'ps4' && !wantPs4) continue;
        if (!p.platforms?.includes(PLATFORM_TAG[platform])) continue;
        const key = `${code}:${platform}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          sourceId: 'psn-store',
          sourceGameId: `${code}~${encodeURIComponent(d.base || p.name)}`,
          title: d.base || p.name,
          groupKey: d.groupKey,
          edition: d.edition,
          image,
          platform,
        });
      }
    }
    return hits;
  },

  /** One offer per PSN region, matched by product code, cheapest ₪ first. */
  async getOffers(sourceGameId: string, platform: Platform): Promise<Offer[]> {
    const [code, encodedName] = sourceGameId.split('~');
    const name = decodeURIComponent(encodedName ?? '');
    const tag = PLATFORM_TAG[platform as 'ps4' | 'ps5'];
    if (!code || !name || !tag) return [];

    // Process each region (search → match by code → price) with a small pool so
    // one game opens in a few seconds without bursting either PSN host.
    const results: (Offer | null)[] = [];
    let i = 0;
    async function worker() {
      while (i < PSN_REGIONS.length) {
        const region = PSN_REGIONS[i++]!;
        results.push(await offerForRegion(region));
      }
    }
    const targetGroup = describeProduct(name).groupKey;
    async function offerForRegion(region: PsnRegion): Promise<Offer | null> {
      const lang = region.locale.split('-')[0]!;
      // Recovering here too, not just in search(): pricing a region ALSO has to
      // find that region's product id, so a rotated hash takes the price board
      // down with the search. Discovery is rate-limited internally, so the
      // concurrent workers below trigger at most one attempt between them.
      const products = await gqlSearchRecovering(name, region.country, lang);
      // First-party SIE titles carry a region marker in the product code
      // (STRAYSIEA vs …SIEE), so an exact-code match only works for region-neutral
      // codes. Fall back to the same base game by name + platform, preferring the
      // base edition, so those titles still price across every region.
      let product = products.find((p) => codeOf(p.id) === code && p.platforms?.includes(tag));
      if (!product) {
        const cands = products.filter(
          (p) =>
            p.platforms?.includes(tag) &&
            !SKIP_CLASS.test(p.storeDisplayClassification ?? '') &&
            describeProduct(p.name).groupKey === targetGroup
        );
        product = cands.find((p) => describeProduct(p.name).edition === null) ?? cands[0];
      }
      if (!product) return null;
      const price = await priceOf(region.locale, product.id);
      if (!price) return null;
      if (!(await canConvert(price.currency))) return null;
      const native = price.value;
      const regular = price.base;
      const onSale = regular > native;
      return {
        store: `PS Store ${region.flag}`,
        kind: 'digital',
        location: region.country === 'IL' ? 'israel' : 'international',
        price: native,
        currency: price.currency,
        priceILS: await toILS(native, price.currency),
        retailPrice: onSale ? regular : undefined,
        savings: onSale ? Math.round(((regular - native) / regular) * 100) : undefined,
        region: region.country,
        regionName: region.nameHe,
        flag: region.flag,
        pinned: region.pinned,
        url: `${STORE}/${region.locale}/product/${product.id}`,
      };
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, PSN_REGIONS.length) }, worker));

    return results.filter((o): o is Offer => o !== null).sort((a, b) => a.priceILS - b.priceILS);
  },
};
