/**
 * Bring a Steam wishlist in, instead of making somebody type it.
 *
 * A price tracker with an empty list demonstrates nothing, and nobody with
 * eighty wishlisted games is going to add them one at a time. Valve publishes
 * the list: `IWishlistService/GetWishlist` answers for any public profile with
 * no key and no login, and the appIDs it returns are exactly what the Steam
 * adapter already uses as its `sourceGameId`. So an import is a read of the
 * user's OWN data from the platform's own API — nothing is scraped and nothing
 * is signed into.
 *
 * WHAT IT COSTS, AND WHY IT IS SLOW ON PURPOSE.
 *
 * The wishlist itself is one request. Turning appIDs into titles is not: Valve
 * retired ISteamApps/GetAppList (it 404s now), and appdetails only accepts
 * several ids at once for `filters=price_overview`, which carries no name. That
 * leaves one small request per game. We space them rather than firing eighty at
 * once — the point of this project is that it is a guest on other people's
 * servers, and an import is exactly the moment it would be easiest to stop
 * being one. A large wishlist therefore takes minutes, and the UI reports
 * progress instead of pretending otherwise.
 */

const WISHLIST = 'https://api.steampowered.com/IWishlistService/GetWishlist/v1';
const APPDETAILS = 'https://store.steampowered.com/api/appdetails';
const PROFILE_XML = 'https://steamcommunity.com/id';

const HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
};

/**
 * Gap between title lookups. Steam's storefront tolerates roughly one request a
 * second sustained; this sits under that deliberately. It is the difference
 * between a tool that borrows an API and one that abuses it.
 */
export const TITLE_GAP_MS = 1_600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A 17-digit SteamID64 — what every Steam API actually wants. */
const isSteamId64 = (s: string) => /^\d{17}$/.test(s);

/**
 * Accept whatever the user has to hand: a profile URL, a vanity name, or the
 * raw id. Asking someone to "find your SteamID64" is asking them to give up.
 *
 * Both URL shapes appear in the wild:
 *   steamcommunity.com/profiles/76561197960287930   → the id itself
 *   steamcommunity.com/id/gabelogannewell           → a vanity name
 */
export function parseProfileInput(raw: string): { kind: 'id' | 'vanity'; value: string } | null {
  const input = raw.trim();
  if (!input) return null;
  if (isSteamId64(input)) return { kind: 'id', value: input };

  const profiles = input.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profiles) return { kind: 'id', value: profiles[1]! };

  const vanity = input.match(/steamcommunity\.com\/id\/([^/?#\s]+)/i);
  if (vanity) return { kind: 'vanity', value: decodeURIComponent(vanity[1]!) };

  // A bare word: treat it as a vanity name. Anything with a slash or a space is
  // a URL we failed to understand, and guessing at it would produce a confusing
  // "profile not found" for what is really a typo.
  if (/^[\w.-]{2,64}$/.test(input)) return { kind: 'vanity', value: input };
  return null;
}

/**
 * Vanity name → SteamID64, without an API key.
 *
 * ISteamUser/ResolveVanityURL needs a registered key, which would put a signup
 * between the user and a one-click import. The community profile's own
 * `?xml=1` view carries the id and needs nothing.
 */
export async function resolveVanity(name: string): Promise<string | null> {
  const url = `${PROFILE_XML}/${encodeURIComponent(name)}/?xml=1`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const xml = await res.text();
  const id = xml.match(/<steamID64>(\d{17})<\/steamID64>/)?.[1];
  return id ?? null;
}

/** Whatever the user pasted → a SteamID64, or null if it names no profile. */
export async function resolveProfile(raw: string): Promise<string | null> {
  const parsed = parseProfileInput(raw);
  if (!parsed) return null;
  return parsed.kind === 'id' ? parsed.value : await resolveVanity(parsed.value);
}

export interface WishlistEntry {
  appId: string;
  /** Unix seconds. Kept so an import can start with what they wanted longest. */
  addedAt: number;
}

/**
 * The wishlist, newest intent first.
 *
 * An empty array is ambiguous on purpose-free grounds: Valve answers 200 with
 * no items both for "this profile wishlists nothing" and for "this profile is
 * private". We cannot tell them apart, so the caller says so in those words
 * rather than picking one.
 */
export async function fetchWishlist(steamId: string): Promise<WishlistEntry[]> {
  const res = await fetch(`${WISHLIST}?steamid=${encodeURIComponent(steamId)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`steam wishlist ${res.status}`);
  const body = (await res.json()) as { response?: { items?: { appid?: number; date_added?: number }[] } };
  const items = body.response?.items ?? [];
  return items
    .filter((i) => typeof i.appid === 'number' && i.appid > 0)
    .map((i) => ({ appId: String(i.appid), addedAt: i.date_added ?? 0 }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

export interface AppInfo {
  title: string;
  image?: string;
  /** Steam's own word: "game", "dlc", "demo", "music"… */
  type: string;
}

/**
 * One app's name and art.
 *
 * `filters=basic` keeps the response small — the full record carries the entire
 * store description and a screenshot list we have no use for here.
 */
export async function fetchAppInfo(appId: string): Promise<AppInfo | null> {
  try {
    const res = await fetch(`${APPDETAILS}?appids=${encodeURIComponent(appId)}&filters=basic&l=en`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<
      string,
      { success?: boolean; data?: { name?: string; header_image?: string; type?: string } }
    >;
    const data = body[appId]?.data;
    if (!data?.name) return null;
    return { title: data.name, image: data.header_image, type: data.type ?? 'game' };
  } catch {
    return null;
  }
}

export interface ImportProgress {
  total: number;
  done: number;
  /** The title just resolved, so the UI can show work rather than a bare number. */
  title?: string;
  added: number;
  skipped: number;
}

export interface ImportOutcome {
  added: number;
  /** Already on the tracked list before this import. */
  skipped: number;
  /** Resolved to something that is not a game — DLC, a demo, a soundtrack. */
  nonGames: number;
  /** Wishlisted apps Steam would not tell us anything about (delisted, region-locked). */
  unresolved: number;
  titles: string[];
}

/**
 * What an already-tracked check and a row insert look like to this module.
 * Injected rather than imported so the same code runs against the server's
 * SQLite and the extension's IndexedDB.
 */
export interface ImportSink {
  /** True when this appID is already tracked, so a re-import adds nothing. */
  has(appId: string): boolean;
  add(row: { title: string; platform: 'pc'; image?: string; refs: { sourceId: string; sourceGameId: string }[] }): void;
}

/** The adapter id Steam prices arrive under. Must match adapters/steam.ts. */
const STEAM_SOURCE = 'steam-regional';

/**
 * Resolve and add, one at a time, reporting as it goes.
 *
 * Add-ons are skipped rather than tracked. A wishlist is full of DLC, and
 * fifteen "Cosmetic Pack" rows in a price tracker is the noise the DLC filter
 * exists to keep off the board in the first place.
 */
export async function importWishlist(
  entries: WishlistEntry[],
  sink: ImportSink,
  onProgress?: (p: ImportProgress) => void,
  gapMs: number = TITLE_GAP_MS
): Promise<ImportOutcome> {
  const out: ImportOutcome = { added: 0, skipped: 0, nonGames: 0, unresolved: 0, titles: [] };
  // Already-tracked entries cost nothing to skip and must not cost a request:
  // re-running an import should be free, not another full pass over Steam.
  const pending = entries.filter((e) => {
    if (sink.has(e.appId)) {
      out.skipped++;
      return false;
    }
    return true;
  });

  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i]!;
    const info = await fetchAppInfo(entry.appId);
    if (!info) {
      out.unresolved++;
    } else if (info.type !== 'game') {
      out.nonGames++;
    } else {
      sink.add({
        title: info.title,
        platform: 'pc',
        image: info.image,
        refs: [{ sourceId: STEAM_SOURCE, sourceGameId: entry.appId }],
      });
      out.added++;
      out.titles.push(info.title);
    }
    onProgress?.({
      total: pending.length,
      done: i + 1,
      title: info?.title,
      added: out.added,
      skipped: out.skipped,
    });
    if (i < pending.length - 1) await sleep(gapMs);
  }
  return out;
}
