import type {
  AlertMode,
  HealthReport,
  HealthResponse,
  PsnHashStatus,
  AlertRule,
  AlertScope,
  AppNotification,
  GameMeta,
  HistoryPoint,
  KeysResponse,
  Offer,
  SearchResponse,
  SettingsResponse,
  SourceRef,
  SourceStatus,
  TickerDeal,
  TrackDetail,
  WishlistItem,
  SearchProgress,
  OffersProgress,
  OffersResponse,
} from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** The line separator of the NDJSON search stream. */
const NEWLINE = '\n';

export const api = {
  /** `includeDlc` opts into add-on results; without it the search is games only. */
  search: (q: string, includeDlc = false) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}${includeDlc ? '&dlc=1' : ''}`).then((r) =>
      json<SearchResponse>(r)
    ),

  /**
   * The same search, reported store by store as each one lands.
   *
   * The fan-out cannot beat its slowest source — the Israeli shops, held to a
   * 2.5s gap this project will not shorten. What it can stop doing is making the
   * user stare at nothing while CheapShark's 370ms answer waits for Ivory's 2.3s
   * one. Falls back to the plain search if the stream is unavailable, so a
   * client that cannot read a body stream still works.
   */
  async searchStream(
    q: string,
    includeDlc: boolean,
    onProgress: (p: SearchProgress) => void
  ): Promise<SearchResponse> {
    let res: Response;
    try {
      res = await fetch(`/api/search/stream?q=${encodeURIComponent(q)}${includeDlc ? '&dlc=1' : ''}`);
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    } catch {
      return api.search(q, includeDlc);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: SearchResponse | null = null;

    const handle = (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return; // a torn line is not worth failing a search over
      }
      if (msg.type === 'source') onProgress(msg as unknown as SearchProgress);
      else if (msg.type === 'done') final = msg as unknown as SearchResponse;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        // Everything before the last newline is complete; the tail may not be.
        const lines = buffer.split(NEWLINE);
        buffer = lines.pop() ?? '';
        for (const l of lines) handle(l);
      }
      if (done) break;
    }
    handle(buffer);

    // A stream that ended without its final line told us nothing usable.
    return final ?? (await api.search(q, includeDlc));
  },

  /**
   * Prices for one game, reported per store as each answers.
   *
   * Opening a game is a second fan-out — the search asked who HAS the game, this
   * asks what each of them charges — so it deserves the same treatment rather
   * than a fresh silent wait.
   */
  async offersStream(
    refs: SourceRef[],
    platform: string,
    onProgress: (p: OffersProgress) => void
  ): Promise<OffersResponse> {
    let res: Response;
    try {
      res = await fetch('/api/offers/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs, platform }),
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    } catch {
      return api.offers(refs, platform);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: OffersResponse | null = null;

    const handle = (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'source') onProgress(msg as unknown as OffersProgress);
      else if (msg.type === 'done') final = msg as unknown as OffersResponse;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(NEWLINE);
        buffer = lines.pop() ?? '';
        for (const l of lines) handle(l);
      }
      if (done) break;
    }
    handle(buffer);
    return final ?? (await api.offers(refs, platform));
  },

  /** PlayStation hash status / manual override / re-discovery. */
  getPsnHash: () => fetch('/api/psn-hash').then((r) => json<PsnHashStatus>(r)),
  setPsnHash: (hash: string) =>
    fetch('/api/psn-hash', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash }),
    }).then((r) => json<{ ok: boolean; hash: string; source: PsnHashStatus['source'] }>(r)),
  recoverPsnHash: () =>
    fetch('/api/psn-hash/recover', { method: 'POST' }).then((r) =>
      json<{ found: string | null; hash: string; source: PsnHashStatus['source'] }>(r)
    ),

  /** Adapter health: which sources actually returned data on the last probe. */
  getHealth: () => fetch('/api/health').then((r) => json<HealthResponse>(r)),
  runHealth: () =>
    fetch('/api/health/run', { method: 'POST' }).then((r) => json<{ report: HealthReport }>(r)),

  /** Fast title suggestions for the search box (never runs the full fan-out). */
  suggest: (q: string, signal?: AbortSignal) =>
    fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal }).then((r) =>
      json<{ suggestions: string[] }>(r)
    ),

  offers: (refs: SourceRef[], platform: string) =>
    fetch('/api/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs, platform }),
    }).then((r) => json<{ offers: Offer[]; partial?: boolean; sources?: SourceStatus[] }>(r)),

  /** Steam description + genres for a searched game (meta is null when it has no Steam ref). */
  meta: (refs: SourceRef[]) =>
    fetch('/api/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs }),
    }).then((r) => json<{ meta: GameMeta | null }>(r)),

  wishlist: () => fetch('/api/wishlist').then((r) => json<{ items: WishlistItem[] }>(r)),

  removeWish: (id: number) => fetch(`/api/wishlist/${id}`, { method: 'DELETE' }),

  /** Full detail for a tracked game: current offers, all history series, meta. */
  trackDetail: (id: number) => fetch(`/api/track/${id}/detail`).then((r) => json<TrackDetail>(r)),

  /** Update per-game settings (preferred region / hide desc / capture interval / sale alerts). */
  setTrackSetting: (
    id: number,
    patch: {
      preferredRegion?: string | null;
      hideDesc?: boolean;
      captureDays?: number | null;
      alertPct?: number | null;
      alertPrice?: number | null;
      alertPriceCcy?: string;
      alertMode?: AlertMode;
      alertScope?: AlertScope | null;
    }
  ) =>
    fetch(`/api/track/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<{ ok: boolean }>(r)),

  /** Sale-alert notifications (in-app bell). */
  getNotifications: () =>
    fetch('/api/notifications').then((r) => json<{ items: AppNotification[]; unread: number }>(r)),
  markNotificationsRead: () => fetch('/api/notifications/read', { method: 'POST' }),
  clearNotifications: () => fetch('/api/notifications', { method: 'DELETE' }),

  /** Global app settings (auto-capture interval, display currency & rates, alert rule). */
  getSettings: () => fetch('/api/settings').then((r) => json<SettingsResponse>(r)),
  setSettings: (patch: {
    captureDaysGlobal?: number;
    displayCurrency?: string;
    alerts?: Partial<AlertRule>;
  }) =>
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<SettingsResponse>(r)),

  /** BYOK API-key status (never returns the secret) + save/clear. */
  getKeys: () => fetch('/api/keys').then((r) => json<KeysResponse>(r)),
  setKeys: (patch: { ggdeals?: string; itad?: string }) =>
    fetch('/api/keys', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<KeysResponse>(r)),

  refresh: () =>
    fetch('/api/refresh', { method: 'POST' }).then((r) => json<{ updated: number }>(r)),

  ticker: () => fetch('/api/ticker').then((r) => json<{ deals: TickerDeal[] }>(r)),

  /** Is this game tracked, plus its full price history for the graph. */
  trackStatus: (title: string, platform: string) =>
    fetch(`/api/track/status?title=${encodeURIComponent(title)}&platform=${encodeURIComponent(platform)}`)
      .then((r) => json<{ tracked: boolean; id?: number; history: HistoryPoint[] }>(r)),

  /** Opt in to tracking one game (records the first price point). */
  track: (item: { title: string; platform: string; image?: string; refs: SourceRef[] }) =>
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    }).then((r) => json<{ id: number; history: HistoryPoint[] }>(r)),

  /** Add a fresh price point for one tracked game. */
  trackRefresh: (id: number) =>
    fetch(`/api/track/${id}/refresh`, { method: 'POST' }).then((r) =>
      json<{ history: HistoryPoint[] }>(r)
    ),

  importData: (items: unknown) =>
    fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).then((r) => json<{ games: number; points: number }>(r)),
};
