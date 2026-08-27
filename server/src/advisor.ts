import type { OwnedGame } from './steamLibrary.ts';
import { steamMeta } from './adapters/steam.ts';

/**
 * "Given what you actually play, is this one for you?" — ALPHA.
 *
 * MARKED ALPHA IN THE UI AND MEANT IT. A recommender that guesses badly is
 * worse than none: it spends the trust the price board earns by being exact.
 * This one is deliberately a weak, explainable heuristic rather than something
 * that looks clever, and every suggestion says WHY in one line so the user can
 * see the reasoning and disagree with it.
 *
 * WHAT IT KNOWS, and the shape of the hole in the middle:
 *
 *   Owned — from the Steam library, with a key. Reliable.
 *   Playtime — from the same call. Reliable, and the single best signal
 *     available: 200 hours is an opinion, whatever the person would say.
 *   Genres and tags — from the store page, per game.
 *
 *   NOT reviews. There is no API for a person's own reviews and the profile
 *   page listing them is login-gated. So this cannot tell "played 80 hours and
 *   hated it" from "played 80 hours and loved it". Playtime stands in for
 *   liking, which is a real assumption and is written down here rather than
 *   hidden in a score.
 *
 * WHY NOT SOMETHING CLEVERER. A taste graph needs either many users' libraries
 * (which would mean collecting them, which this tool will not do) or a model
 * shipped with the app. Neither belongs in a price tracker that keeps
 * everything on one machine. Genre affinity weighted by hours is honest about
 * being simple.
 */

/** Below this, "owning" it says nothing about taste. */
const PLAYED_ENOUGH_MINUTES = 120;
/** Hours, capped — a 3,000-hour game must not drown out everything else. */
const MAX_WEIGHT_HOURS = 100;

export interface GenreAffinity {
  genre: string;
  /** Weighted hours across the library, capped per game. */
  hours: number;
  /** How many played games carry this genre. */
  games: number;
}

export interface Suggestion {
  appId: string;
  title: string;
  /** 0–100. Comparable within one run and meaningless between runs. */
  score: number;
  /** Why, in words the user can disagree with. */
  because: string[];
  genres: string[];
}

/**
 * What the library says somebody likes.
 *
 * Weighted by hours, not by count: owning forty untouched bundle games says
 * nothing, and one 90-hour RPG says a great deal. Hours are capped per game so
 * a single obsession does not become the entire profile.
 */
export function genreAffinity(
  owned: OwnedGame[],
  genresOf: (appId: string) => string[] | undefined
): GenreAffinity[] {
  const byGenre = new Map<string, GenreAffinity>();
  for (const game of owned) {
    if (game.minutes < PLAYED_ENOUGH_MINUTES) continue;
    const hours = Math.min(game.minutes / 60, MAX_WEIGHT_HOURS);
    for (const genre of genresOf(game.appId) ?? []) {
      const entry = byGenre.get(genre) ?? { genre, hours: 0, games: 0 };
      entry.hours += hours;
      entry.games += 1;
      byGenre.set(genre, entry);
    }
  }
  return [...byGenre.values()].sort((a, b) => b.hours - a.hours);
}

/**
 * Score one candidate against that profile.
 *
 * Returns null for anything already owned — recommending a game somebody has
 * is the single most obvious way for this to look stupid, and the library is
 * right there.
 */
export function scoreCandidate(
  candidate: { appId: string; title: string; genres: string[] },
  affinity: GenreAffinity[],
  ownedIds: Set<string>
): Suggestion | null {
  if (ownedIds.has(candidate.appId)) return null;
  if (candidate.genres.length === 0) return null;

  const total = affinity.reduce((n, a) => n + a.hours, 0);
  if (total <= 0) return null;

  const because: string[] = [];
  let share = 0;
  for (const genre of candidate.genres) {
    const match = affinity.find((a) => a.genre === genre);
    if (!match) continue;
    share += match.hours / total;
    // Only the strongest few reasons — a list of nine genres explains nothing.
    if (because.length < 3) {
      because.push(`${genre}: ${Math.round(match.hours)} שעות ב־${match.games} משחקים שלכם`);
    }
  }
  if (because.length === 0) return null;

  // A candidate matching several strong genres scores higher than one matching
  // a single strong genre, but with diminishing returns — otherwise anything
  // tagged with ten genres wins by breadth rather than fit.
  const score = Math.round(Math.min(100, Math.sqrt(share) * 100));
  return { appId: candidate.appId, title: candidate.title, score, because, genres: candidate.genres };
}

/** Genre lookups for a set of appIds, spaced and cached by steamMeta. */
export async function genresFor(appIds: string[], gapMs = 300): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < appIds.length; i++) {
    const id = appIds[i]!;
    try {
      const meta = await steamMeta(id);
      if (meta?.genres?.length) out.set(id, meta.genres);
    } catch {
      /* a game we cannot describe simply does not vote */
    }
    if (i < appIds.length - 1 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}

/**
 * How many of the library's games to look up.
 *
 * Each one is a request to Steam. Taking the most-played ones first means the
 * profile is built from the games that actually say something, and a library of
 * two thousand costs the same as a library of forty.
 */
export const PROFILE_SAMPLE = 40;

export function mostPlayed(owned: OwnedGame[], limit = PROFILE_SAMPLE): OwnedGame[] {
  return [...owned]
    .filter((g) => g.minutes >= PLAYED_ENOUGH_MINUTES)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
}
