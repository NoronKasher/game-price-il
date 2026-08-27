import fs from 'node:fs';
import path from 'node:path';
import { getSetting, setSetting } from './db.ts';

/**
 * API-key resolution for the "bring your own key" model.
 *
 * GG.deals and ITAD are free but require a key registered to the *user* (their
 * terms are "personal use"), so the tool must never ship one baked in — each
 * person supplies their own. A key can come from three places, in priority:
 *   1. the settings table  — what the in-app key-setup screen writes (primary);
 *   2. an environment variable — for advanced / deployment setups;
 *   3. a plain-text file at the repo root — the original mechanism, still honored.
 * The actual key value is never returned to the client; only whether one is set
 * and where it came from.
 */

export type ApiKeyName = 'ggdeals' | 'itad' | 'steam';

const ENV_VAR: Record<ApiKeyName, string> = {
  ggdeals: 'GG_DEALS_API_KEY',
  itad: 'ITAD_API_KEY',
  // Steam's own Web API key, free from steamcommunity.com/dev/apikey. Needed
  // only for the library import: Steam login-gates a profile's game list now,
  // so there is no keyless way to read what somebody owns.
  steam: 'STEAM_API_KEY',
};
const KEY_FILE: Record<ApiKeyName, string> = {
  ggdeals: '.gg_deals_key',
  itad: '.itad_key',
  steam: '.steam_key',
};
const SETTING_KEY: Record<ApiKeyName, string> = {
  ggdeals: 'api_key_ggdeals',
  itad: 'api_key_itad',
  steam: 'api_key_steam',
};

export type ApiKeySource = 'settings' | 'env' | 'file' | 'none';

function fromFile(name: ApiKeyName): string {
  try {
    const file = path.join(import.meta.dirname, '..', '..', KEY_FILE[name]);
    const raw = fs.readFileSync(file, 'utf8');
    const line = raw.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
    return line?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Where the active key comes from (or 'none') — for the setup screen's status. */
export function apiKeySource(name: ApiKeyName): ApiKeySource {
  if ((getSetting(SETTING_KEY[name]) ?? '').trim()) return 'settings';
  if ((process.env[ENV_VAR[name]] ?? '').trim()) return 'env';
  if (fromFile(name)) return 'file';
  return 'none';
}

/** The resolved key, or '' if none is configured anywhere. */
export function getApiKey(name: ApiKeyName): string {
  const fromSetting = (getSetting(SETTING_KEY[name]) ?? '').trim();
  if (fromSetting) return fromSetting;
  const fromEnv = (process.env[ENV_VAR[name]] ?? '').trim();
  if (fromEnv) return fromEnv;
  return fromFile(name);
}

export function hasApiKey(name: ApiKeyName): boolean {
  return getApiKey(name).length > 0;
}

/** Save (or, with an empty value, clear) the user-supplied key in the settings table. */
export function setApiKey(name: ApiKeyName, value: string | null): void {
  setSetting(SETTING_KEY[name], (value ?? '').trim().slice(0, 200));
}
