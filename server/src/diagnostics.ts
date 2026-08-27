import { recentEvents, eventCounts } from './eventLog.ts';
import type { LoggedEvent } from './eventLog.ts';

/**
 * A report the user can hand to somebody who is trying to help.
 *
 * WHY THIS EXISTS. Diagnosing "the search shows duplicates" or "a source is
 * missing" from a description costs an enormous amount of back-and-forth:
 * which sources answered, what they returned, which grouping decision merged
 * or split two titles, what the browser is. All of that is knowable inside the
 * tool in one click, and unknowable outside it without a long conversation.
 *
 * WHAT IT DELIBERATELY LEAVES OUT, because this is a file people send to
 * strangers:
 *
 *   - API keys. Not the values, not truncated, not hashed. Only whether one is
 *     present at all, as a yes/no.
 *   - The PlayStation search hash, which is a credential-shaped thing that
 *     identifies an install.
 *   - Notes. They are the user's own writing about their own life — "gift for
 *     Dana" has no business in a bug report.
 *   - Prices and history. A tracked list is a shopping list; the report says
 *     HOW MANY games and points there are, never which.
 *
 * The one thing it does include by name is game TITLES, and only inside the
 * duplicate sample, because the entire point of that section is "these two
 * titles should have merged and did not". The user is told this before they
 * export.
 */

export interface DiagnosticsInput {
  /** 'server' | 'extension' | 'desktop' — which shell produced this. */
  shell: string;
  version: string;
  /** Whether each BYOK source has a key. Never the key. */
  keysPresent: Record<string, boolean>;
  /** Source health, as last measured. */
  health: unknown;
  /** Counts only — never the list itself. */
  tracked: { games: number; historyPoints: number; withNotes: number };
  settings: Record<string, string>;
  /** Anything the caller wants to add: browser UA, platform, screen size. */
  environment: Record<string, string>;
  /** Optional: what a search actually grouped, for duplicate reports. */
  searchSample?: SearchSample;
}

export interface SearchSample {
  query: string;
  /** Every hit as the fan-out saw it, before and after grouping. */
  hits: { sourceId: string; title: string; groupKey: string; platform: string; dlc?: boolean }[];
  /** The groups it produced, so a wrong merge or a missed one is visible. */
  groups: { key: string; titles: string[]; platforms: string[] }[];
}

export interface DiagnosticsReport {
  generatedAt: string;
  shell: string;
  version: string;
  environment: Record<string, string>;
  keysPresent: Record<string, boolean>;
  tracked: DiagnosticsInput['tracked'];
  settings: Record<string, string>;
  health: unknown;
  events: LoggedEvent[];
  eventCounts: Record<string, number>;
  /** Per-host politeness state — often the answer to "why is a store missing". */
  rateLimits: RateLimitState[];
  searchSample?: SearchSample;
}

/** Settings that must never leave the machine, whatever else does. */
const NEVER_EXPORT = /key|hash|secret|token/i;

/**
 * Internal bookkeeping that is not a "setting" a person ever chose.
 *
 * The health report has its own section already, and dumping its JSON here as
 * well made a 14KB report out of a 3KB one. The rate-limit rows ARE worth
 * reporting — "why is Ivory missing" is often "we are backed off from it" —
 * but as a readable summary rather than raw JSON, so they get their own
 * section below.
 */
const INTERNAL = /^(health_report|health_last_run|polite:)/;

export interface RateLimitState {
  host: string;
  requestsToday: number;
  pausedUntil: string | null;
}

/** The polite-fetch rows, read into something a person can scan. */
function readRateLimits(settings: Record<string, string>): RateLimitState[] {
  const out: RateLimitState[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith('polite:')) continue;
    try {
      const parsed = JSON.parse(value) as { count?: number; pausedUntil?: number };
      const until = Number(parsed.pausedUntil) || 0;
      out.push({
        host: key.slice('polite:'.length),
        requestsToday: Number(parsed.count) || 0,
        // Only a pause still in the future is worth reporting; a stale one is
        // noise that reads like a live problem.
        pausedUntil: until > Date.now() ? new Date(until).toISOString() : null,
      });
    } catch {
      /* a row we cannot read tells us nothing worth printing */
    }
  }
  return out.sort((a, b) => a.host.localeCompare(b.host));
}

export function buildReport(input: DiagnosticsInput): DiagnosticsReport {
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.settings ?? {})) {
    // A name-based filter rather than a list, so a setting added later is
    // excluded by default if it is named like a credential. Getting this
    // backwards would leak the one thing this file must not carry.
    if (NEVER_EXPORT.test(key)) continue;
    if (INTERNAL.test(key)) continue;
    settings[key] = value;
  }

  return {
    generatedAt: new Date().toISOString(),
    shell: input.shell,
    version: input.version,
    environment: input.environment ?? {},
    keysPresent: input.keysPresent ?? {},
    tracked: input.tracked,
    settings,
    health: input.health ?? null,
    events: recentEvents(),
    eventCounts: eventCounts(),
    rateLimits: readRateLimits(input.settings ?? {}),
    searchSample: input.searchSample,
  };
}

/**
 * The report as something a person can read and paste.
 *
 * Plain text rather than JSON: the point is that it lands in a chat message or
 * an issue, and a wall of braces is something people apologise for pasting.
 */
export function renderReport(report: DiagnosticsReport): string {
  const lines: string[] = [];
  const section = (title: string) => {
    lines.push('', `── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
  };

  lines.push('VGPT.IL — diagnostic report');
  lines.push(`generated: ${report.generatedAt}`);
  lines.push(`shell:     ${report.shell}  version ${report.version}`);
  lines.push('');
  lines.push('Contains no API keys, no prices, no notes and no game list.');
  lines.push('Game titles appear ONLY in the search sample at the end, if one was taken.');

  section('environment');
  for (const [k, v] of Object.entries(report.environment)) lines.push(`  ${k}: ${v}`);

  section('sources with a key');
  const keys = Object.entries(report.keysPresent);
  if (keys.length === 0) lines.push('  (none configured)');
  for (const [name, present] of keys) lines.push(`  ${name}: ${present ? 'yes' : 'no'}`);

  section('tracked list');
  lines.push(`  games:          ${report.tracked.games}`);
  lines.push(`  price points:   ${report.tracked.historyPoints}`);
  lines.push(`  games with a note: ${report.tracked.withNotes}`);

  section('settings');
  const settingEntries = Object.entries(report.settings);
  if (settingEntries.length === 0) lines.push('  (all default)');
  for (const [k, v] of settingEntries) lines.push(`  ${k}: ${v}`);

  section('source health');
  const health = report.health as { checkedAt?: string; adapters?: { name?: string; state?: string; count?: number }[] } | null;
  if (!health?.adapters) lines.push('  (never run)');
  else {
    lines.push(`  last checked: ${health.checkedAt ?? '?'}`);
    for (const a of health.adapters) {
      lines.push(`  ${String(a.name).padEnd(28)} ${String(a.state).padEnd(10)} ${a.count ?? '-'}`);
    }
  }

  section('politeness state');
  if (report.rateLimits.length === 0) lines.push('  (no store has been asked yet today)');
  for (const r of report.rateLimits) {
    const paused = r.pausedUntil ? `BACKED OFF until ${r.pausedUntil}` : 'ok';
    lines.push(`  ${r.host.padEnd(26)} ${String(r.requestsToday).padStart(4)} today   ${paused}`);
  }

  section(`recent events (${report.eventCounts.error ?? 0} errors)`);
  if (report.events.length === 0) lines.push('  (nothing recorded this session)');
  for (const e of report.events) {
    lines.push(`  [${e.level}] ${e.at.slice(11, 19)} ${e.scope}: ${e.message}`);
  }

  if (report.searchSample) {
    const s = report.searchSample;
    section(`search sample — "${s.query}"`);
    lines.push(`  ${s.hits.length} hits from the sources, grouped into ${s.groups.length}`);
    lines.push('');
    lines.push('  GROUPS (a duplicate looks like two groups that should be one):');
    for (const g of s.groups) {
      lines.push(`    ${g.key}  [${g.platforms.join(',')}]`);
      for (const title of g.titles) lines.push(`        ${title}`);
    }
    lines.push('');
    lines.push('  RAW HITS (source → title → the key it was grouped under):');
    for (const h of s.hits) {
      lines.push(`    ${h.sourceId.padEnd(18)} ${h.platform.padEnd(7)} ${h.dlc ? 'DLC ' : '    '} ${h.title}`);
      lines.push(`    ${' '.repeat(18)} └─ ${h.groupKey}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
