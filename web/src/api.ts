import type {
  AlertMode,
  AlertRule,
  AlertScope,
  AppNotification,
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
} from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  search: (q: string) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => json<SearchResponse>(r)),

  offers: (refs: SourceRef[], platform: string) =>
    fetch('/api/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs, platform }),
    }).then((r) => json<{ offers: Offer[]; partial?: boolean; sources?: SourceStatus[] }>(r)),

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
