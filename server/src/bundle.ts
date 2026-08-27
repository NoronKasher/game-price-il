import { toILS } from './rates.ts';

/**
 * "I already own three of these five — is the bundle still worth it?"
 *
 * The question a price board cannot answer. A bundle's sticker price says
 * nothing about whether it is a good deal for YOU, because the only number that
 * matters is what the games you do NOT already own would cost separately. Every
 * store shows the first figure and none of them show the second, because none
 * of them know what you own.
 *
 * STEAM ONLY, AND THAT IS NOT LAZINESS — it is what the shops actually publish:
 *
 *   Steam gives everything. `appdetails` lists the packages a game belongs to,
 *   `packagedetails` lists a package's apps and its price in shekels for
 *   Israel, and the same appdetails endpoint prices many apps in ONE request
 *   when asked for price_overview alone. Two requests answer the whole
 *   question.
 *
 *   GOG does not. Its catalogue marks a product `productType: pack` and its
 *   product API confirms `game_type: pack`, but neither lists what is inside
 *   one — `related_products` comes back empty even for The Witcher 3 Complete
 *   Edition. The contents exist only in the store page's markup, and reading
 *   that is scraping a storefront this project does not scrape.
 *
 *   Xbox and PlayStation cannot answer the "what do you own" half at all
 *   without a logged-in session, which this tool does not have and will not
 *   ask for.
 *
 * So: full arithmetic on Steam, and for everything else the user ticks what
 * they own by hand and gets the same arithmetic from their own answers.
 */

const APPDETAILS = 'https://store.steampowered.com/api/appdetails';
const PACKAGEDETAILS = 'https://store.steampowered.com/api/packagedetails';

const HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
};

/** Israel. Steam prices packages per country and we want the one the user pays. */
const COUNTRY = 'IL';

/** A package with fewer than two games is an edition, not a bundle. */
const MIN_APPS = 2;

export interface BundleApp {
  appId: string;
  title: string;
  /**
   * What this game costs on its own, in ₪.
   *
   * Null means Steam does not sell it separately — Half-Life 2: Lost Coast and
   * most soundtracks have no standalone price at all. That is NOT zero, and
   * the difference is the whole reason this field is nullable: counting an
   * unpriceable component as free would understate what the bundle saves you.
   */
  priceILS: number | null;
}

export interface Bundle {
  packageId: string;
  name: string;
  apps: BundleApp[];
  /** What the bundle itself costs, in ₪. */
  priceILS: number;
  discountPercent: number;
  /**
   * Steam's OWN sum of the components' individual prices, when it gives one.
   * Kept as a cross-check against our own addition rather than as the answer —
   * two independent numbers that agree are worth more than one that cannot be
   * checked. Measured on The Orange Box: Steam said 7390, our own sum of the
   * priced components came to exactly 7390.
   */
  steamIndividualILS: number | null;
}

interface RawPackage {
  name?: string;
  apps?: { id?: number; name?: string }[];
  price?: { currency?: string; final?: number; individual?: number; discount_percent?: number };
}

/** Steam quotes packages in the smallest unit: 7395 is ₪73.95. */
const fromCents = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v / 100 : null;
};

/**
 * Every package a game is sold in, as ids.
 *
 * Steam returns editions here as well as true bundles — ELDEN RING lists its
 * standard, Shadow of the Erdtree and Deluxe packages — so the caller filters
 * on how many DISTINCT games each one actually contains.
 */
export async function packageIdsFor(appId: string): Promise<string[]> {
  const res = await fetch(`${APPDETAILS}?appids=${encodeURIComponent(appId)}&cc=${COUNTRY}&l=en`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as Record<string, { data?: { packages?: number[] } }>;
  const packages = body[appId]?.data?.packages ?? [];
  return packages.filter((p) => Number.isFinite(p)).map(String);
}

/** Per-app prices in one request — appdetails takes many ids for price_overview alone. */
export async function pricesFor(appIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (appIds.length === 0) return out;
  const res = await fetch(
    `${APPDETAILS}?appids=${appIds.map(encodeURIComponent).join(',')}&cc=${COUNTRY}&filters=price_overview`,
    { headers: HEADERS, signal: AbortSignal.timeout(20000) }
  );
  if (!res.ok) return out;
  const body = (await res.json()) as Record<
    string,
    { data?: { price_overview?: { final?: number; currency?: string } } } | null
  >;
  for (const appId of appIds) {
    const price = body?.[appId]?.data?.price_overview;
    const final = fromCents(price?.final);
    if (final === null) {
      // No standalone price. Not free — not sold separately.
      out.set(appId, null);
      continue;
    }
    const currency = price?.currency?.trim() || 'ILS';
    try {
      out.set(appId, currency === 'ILS' ? final : await toILS(final, currency));
    } catch {
      out.set(appId, null);
    }
  }
  return out;
}

/**
 * One bundle, with each game priced.
 *
 * Returns null for anything that is not a multi-game package — an edition, a
 * soundtrack, a package Steam no longer sells — because the arithmetic this
 * exists to do is meaningless for those.
 */
export async function bundleFor(packageId: string): Promise<Bundle | null> {
  const res = await fetch(`${PACKAGEDETAILS}?packageids=${encodeURIComponent(packageId)}&cc=${COUNTRY}&l=en`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, { success?: boolean; data?: RawPackage } | null>;
  const entry = body?.[packageId];
  if (!entry?.success || !entry.data) return null;

  const raw = entry.data;
  const apps = (raw.apps ?? [])
    .filter((a) => Number.isFinite(a.id) && a.name)
    .map((a) => ({ appId: String(a.id), title: String(a.name) }));
  if (apps.length < MIN_APPS) return null;

  const price = fromCents(raw.price?.final);
  if (price === null) return null; // not currently sold here

  const prices = await pricesFor(apps.map((a) => a.appId));
  return {
    packageId,
    name: raw.name?.trim() || `Package ${packageId}`,
    apps: apps.map((a) => ({ ...a, priceILS: prices.get(a.appId) ?? null })),
    priceILS: price,
    discountPercent: Math.round(Number(raw.price?.discount_percent) || 0),
    steamIndividualILS: fromCents(raw.price?.individual),
  };
}

/** Every multi-game bundle this game is sold in. */
export async function bundlesForApp(appId: string): Promise<Bundle[]> {
  const ids = await packageIdsFor(appId);
  // Bounded: a game in twenty packages would otherwise cost twenty requests to
  // answer a question about three of them.
  const settled = await Promise.all(
    ids.slice(0, 8).map((id) => bundleFor(id).catch(() => null))
  );
  return settled.filter((b): b is Bundle => b !== null);
}

export interface BundleVerdict {
  /** What the bundle costs. */
  bundleILS: number;
  /** What the games you do NOT own would cost bought separately. */
  separateILS: number;
  /** Positive: the bundle is cheaper by this much. Negative: buying separately is. */
  savingILS: number;
  ownedCount: number;
  /**
   * True when NOTHING the user still needs can be bought on its own.
   *
   * Found by using it: own the two priced games in The Orange Box and the five
   * that remain have no standalone price, so the separate total is ₪0 and the
   * card cheerfully reported "buying separately is ₪73.95 cheaper" — about
   * games that cannot be bought separately at any price. The saving is not
   * merely imprecise there, it describes a route that does not exist, so the
   * UI has to stop comparing and say the bundle is the only way.
   */
  onlyViaBundle: boolean;
  /**
   * Games with no standalone price, among the ones the user does not own.
   *
   * These make `separateILS` a FLOOR rather than an exact figure: they cannot
   * be bought on their own at any price, so "buy the rest separately" is not
   * actually available. The UI has to say so — a saving computed as if they
   * were free would be a number that flatters the wrong option.
   */
  unpriceable: string[];
}

/**
 * The arithmetic, given what the user says they own.
 *
 * Deliberately a pure function of the bundle and a set of app ids: the owning
 * is the user's claim, not something this tool can or should find out for
 * itself, and keeping it a parameter is what lets the same code serve Steam's
 * answer and a hand-ticked list.
 */
export function verdictFor(bundle: Bundle, ownedAppIds: Iterable<string>): BundleVerdict {
  const owned = new Set(ownedAppIds);
  let separate = 0;
  const unpriceable: string[] = [];
  let ownedCount = 0;

  for (const app of bundle.apps) {
    if (owned.has(app.appId)) {
      ownedCount++;
      continue;
    }
    if (app.priceILS === null) unpriceable.push(app.title);
    else separate += app.priceILS;
  }

  const stillNeeded = bundle.apps.length - ownedCount;
  return {
    bundleILS: bundle.priceILS,
    separateILS: Math.round(separate * 100) / 100,
    savingILS: Math.round((separate - bundle.priceILS) * 100) / 100,
    ownedCount,
    unpriceable,
    // Everything left is unbuyable on its own — including the case where the
    // user owns everything, which is handled separately by the UI.
    onlyViaBundle: stillNeeded > 0 && unpriceable.length === stillNeeded,
  };
}
