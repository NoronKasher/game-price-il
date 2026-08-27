import { getApiKey } from './keys.ts';
import { resolveProfile } from './steamWishlist.ts';

/**
 * What somebody owns on Steam, and how long they played it.
 *
 * WHY THIS NEEDS A KEY, when the wishlist did not. Steam login-gates a
 * profile's game list now — `steamcommunity.com/id/<name>/games?xml=1` answers
 * with a redirect to /login, whatever the profile's privacy setting. Measured,
 * not assumed. `IPlayerService/GetOwnedGames` is the only remaining route and
 * it returns 401 without a key.
 *
 * That key is free, is the user's own, and is registered in a minute at
 * steamcommunity.com/dev/apikey — the same bring-your-own-key shape ITAD and
 * GG.deals already use here. Nothing about this feature works without one and
 * nothing about the rest of the tool changes if it is absent.
 *
 * WHAT COMES BACK, and what does not. appid and playtime, both of which are
 * useful. NOT reviews: there is no API for a person's own reviews, and the
 * profile page that lists them is login-gated like the library was. So a
 * recommender here can know what you own and how long you played it, and
 * cannot know whether you liked it — which is a real limit, stated rather
 * than papered over.
 */

const OWNED = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

const HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
};

export interface OwnedGame {
  appId: string;
  title: string;
  /** Minutes, all time. 0 for something owned and never started. */
  minutes: number;
  /** Minutes in the last fortnight, when Steam reports it. */
  recentMinutes: number;
}

export class SteamKeyMissing extends Error {
  constructor() {
    super('steam_key_missing');
  }
}

export class SteamProfilePrivate extends Error {
  constructor() {
    super('steam_profile_private');
  }
}

/**
 * A profile's owned games.
 *
 * Throws two distinguishable errors on purpose. "You have not set a key" and
 * "your library is private" need completely different things from the user,
 * and a single "could not load" would leave them guessing which.
 */
export async function ownedGames(profile: string): Promise<OwnedGame[]> {
  const key = getApiKey('steam');
  if (!key) throw new SteamKeyMissing();

  const steamId = await resolveProfile(profile);
  if (!steamId) throw new Error('steam_profile_not_found');

  const url =
    `${OWNED}?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(steamId)}` +
    '&include_appinfo=1&include_played_free_games=1';
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`steam owned games ${res.status}`);

  const body = (await res.json()) as {
    response?: { game_count?: number; games?: { appid?: number; name?: string; playtime_forever?: number; playtime_2weeks?: number }[] };
  };
  const games = body.response?.games;
  // Steam answers 200 with an EMPTY response object for a private library —
  // not an error, not an empty list, just nothing. Telling those apart matters
  // because the fix is different: one is a privacy setting, the other is a
  // person who genuinely owns nothing.
  if (!games) throw new SteamProfilePrivate();

  return games
    .filter((g) => Number.isFinite(g.appid) && g.name)
    .map((g) => ({
      appId: String(g.appid),
      title: String(g.name),
      minutes: Number(g.playtime_forever) || 0,
      recentMinutes: Number(g.playtime_2weeks) || 0,
    }));
}
