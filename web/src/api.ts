import type {
  AlertMode,
  AlertRule,
  AlertScope,
  AppNotification,
  FirstCheckProgress,
  GameMeta,
  HealthReport,
  HealthResponse,
  HistoryPoint,
  KeysResponse,
  Offer,
  OffersProgress,
  OffersResponse,
  PsnHashStatus,
  SearchProgress,
  SearchResponse,
  SettingsResponse,
  SourceRef,
  SourceStatus,
  SteamImportOutcome,
  SteamImportProgress,
  SteamImportResult,
  TickerDeal,
  TrackDetail,
  WishlistItem,
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

  /** Raise a "already on Game Pass" alert into the bell and the Settings log. */
  notifyGamePass: (title: string, platform: string, subscriptions: string[]) =>
    fetch('/api/notify/gamepass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, platform, subscriptions }),
    }).then(() => undefined),

  /**
   * Price the rows that have never been priced, reporting as it goes.
   *
   * Separate from `refresh` on purpose: that one re-prices the whole list,
   * which is the wrong cost for a list that mostly has prices already.
   */
  async refreshUnchecked(onProgress: (p: FirstCheckProgress) => void): Promise<number> {
    const res = await fetch('/api/refresh/unchecked', { method: 'POST' });
    if (!res.ok || !res.body) return 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let updated = 0;

    const handle = (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'start' || msg.type === 'progress') onProgress(msg as unknown as FirstCheckProgress);
      else if (msg.type === 'done') updated = Number(msg.updated ?? 0);
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
    return updated;
  },

  /**
   * The tracked list as one pasteable string, and back again.
   *
   * The file export stays; this is for where a file is awkward — moving between
   * the extension and the desktop app, a phone, or a chat message.
   */
  exportToken: (withHistory: boolean, prefs: Record<string, string>) =>
    fetch('/api/export/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: withHistory, prefs }),
    }).then((r) => json<{ token: string }>(r)),
  importToken: async (
    token: string
  ): Promise<{ games: number; points: number; prefs?: Record<string, string> } | null> => {
    const res = await fetch('/api/import/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    // A bad paste is expected input, not an exception: it comes back as null and
    // the UI says "that is not one of our tokens".
    return res.ok ? ((await res.json()) as { games: number; points: number }) : null;
  },

  /**
   * Import a public Steam wishlist, reporting as it fills.
   *
   * Streamed for an honest reason rather than a cosmetic one: Valve retired the
   * bulk app-list endpoint, so each title is its own small request and they are
   * spaced deliberately. A wishlist of eighty takes minutes, and a spinner that
   * hid that would look broken.
   */
  async importSteam(
    profile: string,
    onProgress: (p: SteamImportProgress) => void
  ): Promise<SteamImportResult> {
    const res = await fetch('/api/import/steam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    if (!res.ok || !res.body) return { ok: false, reason: 'failed' };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: SteamImportResult = { ok: false, reason: 'failed' };

    const handle = (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'progress' || msg.type === 'start') onProgress(msg as unknown as SteamImportProgress);
      else if (msg.type === 'done') final = { ok: true, ...(msg as unknown as SteamImportOutcome) };
      else if (msg.type === 'error') final = { ok: false, reason: String(msg.reason ?? 'failed') };
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
    return final;
  },

  /**
   * The Settings log: every alert ever raised, including ones cleared from the
   * bell. `clearNotifications` empties the BELL; this list survives it, and
   * `purgeNotifications` is the only thing that destroys the record.
   */
  getNotificationLog: () =>
    fetch('/api/notifications/log').then((r) => json<{ items: AppNotification[] }>(r)),
  // Returns nothing on purpose: the other two shells cannot produce a Response,
  // and a contract only one implementation can satisfy is not a contract.
  purgeNotifications: (): Promise<void> =>
    fetch('/api/notifications/log', { method: 'DELETE' }).then(() => undefined),

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

  ticker: (limit?: number) =>
    fetch(`/api/ticker${limit ? `?limit=${limit}` : ''}`).then((r) => json<{ deals: TickerDeal[] }>(r)),
  /** One page of the merged deals feed, for the endless list. */
  deals: (page: number, limit: number) =>
    fetch(`/api/deals?page=${page}&limit=${limit}`).then((r) => json<{ deals: TickerDeal[] }>(r)),

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
