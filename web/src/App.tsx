import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { api } from './api';
import { pricesChecked, onPricesChecked } from './bus';
import { nis, platformNames, searchExamples, t } from './he';
import {
  REGIONS,
  regionByMarket,
  loadPreferredRegion,
  savePreferredRegion,
  loadHideAllDesc,
  saveHideAllDesc,
} from './regions';
import { PriceGraph, TrackGraph } from './PriceGraph';
import { Logo } from './Logo';
import { safeUrl } from './url';
import {
  setCurrencyConfig,
  currencySymbol,
  currencyCode,
  isMeaningfulChange,
  CURRENCIES,
  type CurrencyCode,
} from './currency';
import { sourceLabel } from './source';
import type {
  AlertMode,
  AlertRule,
  AlertScope,
  GameHit,
  HistoryPoint,
  KeyStatus,
  KeysResponse,
  Offer,
  AppNotification,
  Platform,
  PriceVerdict,
  SearchResponse,
  SourceRef,
  SourceStatus,
  TickerDeal,
  TrackDetail,
  WishlistItem,
} from './types';

type View =
  | { name: 'search' }
  | { name: 'offers'; group: GameGroup; platform: Platform }
  | { name: 'wishlist' }
  | { name: 'settings' };

export function App() {
  const [view, setView] = useState<View>({ name: 'search' });
  const [ticker, setTicker] = useState<TickerDeal[]>([]);
  // Search state lives here so returning from a game's board keeps the results.
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  // A title clicked in the ticker → jump to search and run it automatically.
  const [autoQuery, setAutoQuery] = useState<string | null>(null);
  // The user's preferred region — global, persisted, pins to the top everywhere.
  const [preferred, setPreferred] = useState<string>(() => loadPreferredRegion());
  const changePreferred = (m: string) => {
    setPreferred(m);
    savePreferredRegion(m);
  };

  // Display currency — global. Prices are stored in ILS and converted for display;
  // `currency` in state forces the whole tree to reformat when it changes.
  const [currency, setCurrency] = useState<CurrencyCode>('ILS');
  const [rates, setRates] = useState<Record<CurrencyCode, number>>({ ILS: 1, USD: 1, EUR: 1 });
  const changeCurrency = async (c: CurrencyCode) => {
    setCurrencyConfig(c, rates);
    setCurrency(c);
    await api.setSettings({ displayCurrency: c });
  };

  // The one sale-alert rule every tracked game is watched with. Lives here because
  // it's edited from two places — the bell and the tracking list — which must
  // never drift apart.
  const [alerts, setAlerts] = useState<AlertRule | null>(null);
  const changeAlerts = async (patch: Partial<AlertRule>) => {
    setAlerts((prev) => (prev ? { ...prev, ...patch } : prev)); // reflect the click at once
    try {
      setAlerts((await api.setSettings({ alerts: patch })).alerts);
    } catch {
      /* keep the optimistic value; the next load reconciles */
    }
  };

  const notifications = useNotifications();
  // Clicking a notification should land on the game it's about, already open.
  const [focusTrack, setFocusTrack] = useState<number | null>(null);
  const openTrackedGame = (id: number | null) => {
    setView({ name: 'wishlist' });
    setFocusTrack(id);
  };

  useEffect(() => {
    api.ticker().then((r) => setTicker(r.deals)).catch(() => {});
    api
      .getSettings()
      .then((s) => {
        setRates(s.ratesFromILS);
        setCurrency(s.displayCurrency);
        setCurrencyConfig(s.displayCurrency, s.ratesFromILS);
        setAlerts(s.alerts);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <header className="header">
        <div className="brand">
          <div className="brand-row">
            <Logo />
            <h1>{t.appName}</h1>
          </div>
          <p>{t.tagline}</p>
        </div>
        <nav className="tabs">
          <button
            className={view.name === 'search' || view.name === 'offers' ? 'active' : ''}
            onClick={() => setView({ name: 'search' })}
          >
            {t.searchTab}
          </button>
          <button
            className={view.name === 'wishlist' ? 'active' : ''}
            onClick={() => setView({ name: 'wishlist' })}
          >
            {t.wishlistTab}
          </button>
          <button
            className={view.name === 'settings' ? 'active' : ''}
            onClick={() => setView({ name: 'settings' })}
          >
            {t.settingsTab}
          </button>
          <CurrencySwitch value={currency} onChange={changeCurrency} />
          <NotificationBell
            state={notifications}
            rule={alerts}
            onChangeRule={changeAlerts}
            onOpenGame={openTrackedGame}
          />
        </nav>
      </header>

      {ticker.length > 0 && (
        <div className="ticker">
          <span className="label">{t.tickerTitle}</span>
          <div className="reel">
            {ticker.map((d, i) => (
              <button
                key={i}
                className="deal"
                title={t.tickerDealHint}
                onClick={() => {
                  setView({ name: 'search' });
                  setAutoQuery(d.title);
                }}
              >
                <b>{d.title}</b> <span className="num">{nis(d.salePrice)}</span>{' '}
                <span className="pct num">{d.savings}%-</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <main className="main">
        {view.name === 'search' && (
          <SearchView
            query={query}
            setQuery={setQuery}
            result={result}
            setResult={setResult}
            autoQuery={autoQuery}
            onAutoConsumed={() => setAutoQuery(null)}
            onOpen={(group, platform) => setView({ name: 'offers', group, platform })}
          />
        )}
        {view.name === 'offers' && (
          <GamePage
            group={view.group}
            initialPlatform={view.platform}
            preferred={preferred}
            onChangePreferred={changePreferred}
            onBack={() => setView({ name: 'search' })}
          />
        )}
        {view.name === 'wishlist' && (
          <WishlistView
            rule={alerts}
            onChangeRule={changeAlerts}
            focusId={focusTrack}
            onFocusConsumed={() => setFocusTrack(null)}
          />
        )}
        {view.name === 'settings' && <SettingsView />}
      </main>

      <AlertToasts
        items={notifications.toasts}
        onDismiss={notifications.dismissToast}
        onOpen={openTrackedGame}
      />
    </>
  );
}

/**
 * One price in the tracking list: what kind of price it is, how much, and where
 * it comes from — in that reading order, each part visually distinct.
 *
 * The old markup put the kind, a bare flag emoji and the raw store name in one
 * undifferentiated row, which on Windows (no flag glyphs) read "Steam us $59.99
 * US" — the region twice and the store name apparently mangled. Now the store
 * and region are one labelled chip built by sourceLabel().
 */
function PriceLine({
  tone,
  kind,
  priceILS,
  store,
  region,
  official,
  title,
  delta,
}: {
  /** Which bucket this price is — also picks the dot colour, matching the graph. */
  tone: 'official' | 'disc' | 'keys';
  kind: string;
  priceILS: number;
  store: string;
  region?: string | null;
  official?: boolean;
  title?: string;
  /** Movement since the previous check, in ILS — shown beside the price it describes. */
  delta?: { amountILS: number; prevILS: number } | null;
}) {
  return (
    <div className={`price-line ${official ? 'official' : ''}`} title={title}>
      {/* A drawn dot rather than an emoji: emoji render inconsistently across
          platforms (Windows shows flag emoji as bare letters), and these dots
          reuse the graph's series colours so the two views agree. */}
      <span className={`price-dot ${tone}`} aria-hidden="true" />
      <span className="price-type">{kind}</span>
      {/* Amount and its movement travel together — with the delta as a separate
          flex child it drifted to the far edge, away from the price it describes. */}
      <span className="price-amount">
        <span className="price num">{nis(priceILS)}</span>
        {delta && <DeltaMark amountILS={delta.amountILS} prevILS={delta.prevILS} />}
      </span>
      <span className="price-source" title={sourceLabel(store, region)}>
        {sourceLabel(store, region)}
      </span>
    </div>
  );
}

/** Which way a price moved, next to the price itself rather than in its own column. */
function DeltaMark({ amountILS, prevILS }: { amountILS: number; prevILS: number }) {
  if (!isMeaningfulChange(prevILS + amountILS, prevILS)) {
    return (
      <span className="delta flat" title={t.deltaNoiseHint}>
        ≈
      </span>
    );
  }
  const down = amountILS < 0;
  return (
    <span className={`delta ${down ? 'down' : 'up'} num`}>
      {down ? '▼' : '▲'} {nis(Math.abs(amountILS))}
    </span>
  );
}

/**
 * The answer to "should I buy this now?", above the prices it judges.
 *
 * Worked out from the game's own recorded history rather than the discount a
 * shop advertises — a store can call anything 50% off, but it can't argue with
 * what this tool watched the price actually do. Stays quiet (grey, one line)
 * when the answer is "no"; only a genuine low earns colour.
 */
function VerdictLine({ v }: { v: PriceVerdict }) {
  const low = nis(v.lowILS);
  const notable = v.kind === 'record' || v.kind === 'cheapest-since';
  const main =
    v.kind === 'record'
      ? t.verdictRecord
      : v.kind === 'cheapest-since'
        ? t.verdictCheapestSince(t.verdictSince(v.daysSinceCheaper ?? 0))
        : t.verdictAboveLow(v.pctAboveLow, low);

  const scope = t.verdictScope[v.scope] ?? '';
  return (
    <div className={`verdict ${v.kind}`} title={t.verdictHint}>
      <span className="verdict-main">{main}</span>
      {/* Naming the scope is what stops "cheapest ever ₪183" from reading as a
          lie when a cheaper keyshop price sits on the next line. */}
      {/* At a record the low IS today's price, so repeating it just invited a
          confusing near-miss ("record €24.07 · all-time low €24.06" — the 1%
          FX tolerance). Only a non-record needs the low spelled out. */}
      <span className="verdict-sub">
        {scope}
        {v.kind !== 'record' ? ` · ${t.verdictAboveLow(v.pctAboveLow, low)}` : ''}
      </span>
      {/* Recency of the cut — the honest half of "when does this sale end?",
          which no source publishes. Only shown while it's still news. */}
      {v.changeDirection === 'down' && (v.changedDaysAgo ?? 99) <= 14 && (
        <span className="verdict-fresh" title={t.verdictDroppedHint}>
          {t.verdictDropped(v.changedDaysAgo ?? 0)}
        </span>
      )}
      {/* Say what the claim rests on. "Cheapest ever" off two checks is true and
          nearly worthless; showing the evidence stops it from overselling. */}
      {notable && v.checks < 5 && (
        <span className="verdict-evidence">{t.verdictEvidence(v.checks, v.spanDays)}</span>
      )}
    </div>
  );
}

/* ───────────────────────── currency switch (header) ───────────────────────── */

/**
 * Display currency, reachable from every page. It used to live only inside the
 * settings tab, which meant leaving whatever you were comparing to change it —
 * the one setting you most want to flip while looking at prices.
 */
function CurrencySwitch({
  value,
  onChange,
}: {
  value: CurrencyCode;
  onChange: (c: CurrencyCode) => void;
}) {
  return (
    <div className="currency-switch" role="group" aria-label={t.currencyTitle}>
      {CURRENCIES.map((c) => (
        <button
          key={c}
          className={c === value ? 'active' : ''}
          onClick={() => onChange(c)}
          title={t.currencyNames[c]}
          aria-pressed={c === value}
        >
          {currencySymbol(c)}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── notifications bell ───────────────────────── */

/** How long a popup stays on screen before retiring into the bell. */
const TOAST_MS = 12_000;
/** Never stack more than this many popups, however many alerts land at once. */
const MAX_TOASTS = 3;

/** Icon for why an alert fired — a plain drop, a discount, or the price you asked for. */
function reasonIcon(kind: string | null): string {
  return kind === 'price' ? '🎯' : kind === 'pct' ? '🏷️' : '📉';
}

/**
 * The notification layer: one poll, shared by the bell (the archive) and the
 * popups (the interruption). Alerts that arrive while the app is open pop once
 * and then live in the bell for later; the backlog waiting at startup only
 * lights the badge, so opening the app never buries you in popups.
 */
function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    let r;
    try {
      r = await api.getNotifications();
    } catch {
      return;
    }
    setItems(r.items);
    setUnread(r.unread);

    const fresh = r.items.filter((n) => !seen.current.has(n.id) && n.read === 0);
    r.items.forEach((n) => seen.current.add(n.id));
    if (firstLoad.current) {
      firstLoad.current = false;
      return; // what was already waiting is the bell's job, not a popup's
    }
    if (fresh.length === 0) return;
    setToasts((prev) => [...fresh, ...prev].slice(0, MAX_TOASTS));
    // Same news outside the tab, for whoever allowed it. `tag` keeps a repeated
    // poll from stacking duplicates of one alert in the OS tray.
    if ('Notification' in window && Notification.permission === 'granted') {
      for (const n of fresh) {
        new Notification(`${t.appName} · ${n.title}`, { body: n.message, tag: `vgpt-${n.id}` });
      }
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    // A price check can fire an alert this second — don't make the user wait for
    // the next poll to see it.
    const off = onPricesChecked(load);
    return () => {
      clearInterval(timer);
      off();
    };
  }, [load]);

  const markRead = useCallback(async () => {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: 1 })));
    await api.markNotificationsRead();
  }, []);

  const clear = useCallback(async () => {
    setItems([]);
    setUnread(0);
    await api.clearNotifications();
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { items, unread, toasts, markRead, clear, dismissToast };
}

type NotificationState = ReturnType<typeof useNotifications>;

/* ───────────────────────── alert popups ───────────────────────── */

/**
 * The popup a price drop makes. Fixed to the viewport corner and width-clamped,
 * so it floats over the page instead of widening it — nothing we add may push
 * the app's borders outward.
 */
function AlertToasts({
  items,
  onDismiss,
  onOpen,
}: {
  items: AppNotification[];
  onDismiss: (id: number) => void;
  onOpen: (wishlistId: number | null) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((n) => (
        <Toast key={n.id} n={n} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  );
}

function Toast({
  n,
  onDismiss,
  onOpen,
}: {
  n: AppNotification;
  onDismiss: (id: number) => void;
  onOpen: (wishlistId: number | null) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(n.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [n.id, onDismiss]);

  return (
    <div className="toast">
      <button
        className="toast-body"
        title={t.notifJumpHint}
        onClick={() => {
          onOpen(n.wishlist_id);
          onDismiss(n.id);
        }}
      >
        <span className="toast-icon">{reasonIcon(n.kind)}</span>
        <span className="toast-text">
          <span className="toast-head">
            <b>{n.title}</b>
            {n.platform && <span className="toast-platform">{platformNames[n.platform]}</span>}
          </span>
          <span className="toast-msg">{n.message}</span>
        </span>
      </button>
      <button className="toast-x" onClick={() => onDismiss(n.id)} aria-label={t.toastDismiss}>
        ✕
      </button>
    </div>
  );
}

/* ───────────────────────── the bell (archive + rule) ───────────────────────── */

function NotificationBell({
  state,
  rule,
  onChangeRule,
  onOpenGame,
}: {
  state: NotificationState;
  rule: AlertRule | null;
  onChangeRule: (patch: Partial<AlertRule>) => void;
  onOpenGame: (wishlistId: number | null) => void;
}) {
  const { items, unread, markRead, clear } = state;
  const [open, setOpen] = useState(false);
  const [showRule, setShowRule] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) await markRead();
  };

  const canAskBrowser = 'Notification' in window && Notification.permission === 'default';

  return (
    <div className="bell-wrap">
      <button
        className={`bell ${unread > 0 ? 'has-unread' : ''}`}
        onClick={toggle}
        title={unread > 0 ? t.notifUnreadBadge(unread) : t.notifTitle}
      >
        🔔{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <b>{t.notifTitle}</b>
            {items.length > 0 && (
              <button className="bell-clear" onClick={clear}>
                {t.notifClear}
              </button>
            )}
          </div>

          {/* The rule lives with the alerts it produces — the same editor as the
              one on the tracking list, writing to the same global setting. */}
          <button
            className={`bell-rule-toggle ${showRule ? 'open' : ''}`}
            onClick={() => setShowRule((v) => !v)}
          >
            {t.notifSettingsToggle} <span className="caret">{showRule ? '▾' : '▸'}</span>
          </button>
          {showRule && <NotificationRule value={rule} onChange={onChangeRule} compact />}

          {canAskBrowser && (
            <button className="bell-enable" onClick={() => Notification.requestPermission()}>
              {t.notifEnableBrowser}
            </button>
          )}
          {items.length === 0 ? (
            <p className="bell-empty">{t.notifEmpty}</p>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id} className={n.read ? '' : 'unread'}>
                  <button
                    className="bell-item"
                    title={t.notifJumpHint}
                    onClick={() => {
                      onOpenGame(n.wishlist_id);
                      setOpen(false);
                    }}
                  >
                    <span className="bell-item-head">
                      <span>{reasonIcon(n.kind)}</span>
                      <b>{n.title}</b>
                      {n.platform && <span className="toast-platform">{platformNames[n.platform]}</span>}
                    </span>
                    <span className="bell-msg">{n.message}</span>
                  </button>
                  <span className="bell-time">
                    {new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString('he-IL')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** A rule written out in words, for "the global rule is currently: …". */
function ruleSummary(r: AlertRule): string {
  const parts: string[] = [];
  if (r.anyDrop) parts.push(t.ruleAnyDrop);
  if (r.pct != null) parts.push(t.rulePct(r.pct));
  if (r.price != null) parts.push(t.rulePrice(`${currencySymbol(r.ccy as CurrencyCode)}${r.price}`));
  return t.ruleSummary(parts);
}

/**
 * The "when should we tell you" editor. One component, two homes — the bell and
 * the tracking list — both writing the single global rule, so the setting can be
 * reached from wherever the user happens to be thinking about it.
 */
function NotificationRule({
  value,
  onChange,
  compact,
}: {
  value: AlertRule | null;
  onChange: (patch: Partial<AlertRule>) => void;
  compact?: boolean;
}) {
  const [pctVal, setPctVal] = useState('');
  const [priceVal, setPriceVal] = useState('');
  useEffect(() => {
    setPctVal(value?.pct == null ? '' : String(value.pct));
    setPriceVal(value?.price == null ? '' : String(value.price));
  }, [value?.pct, value?.price]);

  if (!value) return null;

  const commitPct = () => {
    const n = Number(pctVal);
    onChange({ pct: pctVal.trim() === '' || !(n >= 1) ? null : Math.round(n) });
  };
  // With no threshold set yet, offer the currency the user is actually looking at.
  // Defaulting to ILS while the app displayed dollars invited "notify under 50"
  // to mean ₪50 when the user meant $50.
  const effectiveCcy = value.price == null ? currencyCode() : value.ccy;
  const commitPrice = (ccy: string = effectiveCcy) => {
    const n = Number(priceVal);
    onChange({ price: priceVal.trim() === '' || !(n > 0) ? null : n, ccy });
  };

  return (
    <div className={`notif-rule ${compact ? 'compact' : ''}`}>
      {!compact && <p className="notif-rule-intro">{t.notifRuleIntro}</p>}

      <label className="notif-check" title={t.notifAnyDropHint}>
        <input
          type="checkbox"
          checked={value.anyDrop}
          onChange={(e) => onChange({ anyDrop: e.target.checked })}
        />
        <span>📉 {t.notifAnyDropLabel}</span>
      </label>

      <label className="notif-line">
        <span className="notif-line-label">🏷️ {t.notifPctLabel}</span>
        <input
          className="alert-input"
          type="number"
          min={1}
          max={99}
          placeholder={t.notifOff}
          value={pctVal}
          onChange={(e) => setPctVal(e.target.value)}
          onBlur={commitPct}
          onKeyDown={(e) => e.key === 'Enter' && commitPct()}
        />
        <span>%</span>
      </label>

      <label className="notif-line">
        <span className="notif-line-label">🎯 {t.notifPriceLabel}</span>
        <input
          className="alert-input"
          type="number"
          min={0}
          placeholder={t.notifOff}
          value={priceVal}
          onChange={(e) => setPriceVal(e.target.value)}
          onBlur={() => commitPrice()}
          onKeyDown={(e) => e.key === 'Enter' && commitPrice()}
        />
        <select
          className="pref-select small"
          value={effectiveCcy}
          onChange={(e) => commitPrice(e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {currencySymbol(c)}
            </option>
          ))}
        </select>
      </label>

      <label className="notif-line">
        <span className="notif-line-label">{t.notifScopeLabel}</span>
        <select
          className="pref-select small grow"
          value={value.scope}
          onChange={(e) => onChange({ scope: e.target.value as AlertScope })}
        >
          {(Object.keys(t.scopeNames) as AlertScope[]).map((s) => (
            <option key={s} value={s}>
              {t.scopeNames[s]}
            </option>
          ))}
        </select>
      </label>
      <p className="notif-rule-note">{t.scopeHint}</p>
    </div>
  );
}

/* ───────────────────────── search ───────────────────────── */

interface GameGroup {
  key: string;
  title: string;
  image?: string;
  /** hits per platform, so one chip can carry several sources. */
  byPlatform: Map<Platform, GameHit[]>;
}

/** Return whichever title reads better for display — prefer proper case over ALL CAPS. */
function prettierTitle(a: string, b: string): string {
  const lower = (s: string) => (s.match(/\p{Ll}/gu) ?? []).length;
  if (lower(a) !== lower(b)) return lower(a) > lower(b) ? a : b;
  return a.length <= b.length ? a : b;
}

/**
 * Honest visibility when a source didn't answer — so an empty/short list reads as
 * "this store is down or resting", not silently as "the game isn't sold". Renders
 * nothing when every source responded.
 */
function SourceNotice({ sources }: { sources?: SourceStatus[] }) {
  const failed = (sources ?? []).filter((s) => !s.ok);
  if (failed.length === 0) return null;
  return (
    <div className="source-notice" role="status">
      <p className="source-notice-head">⚠️ {t.sourcesUnavailable}</p>
      <ul>
        {failed.map((s) => (
          <li key={s.id}>
            <b>{s.name}</b> — {s.reason === 'rate_limited' ? t.sourceReasonRateLimited : t.sourceReasonError}
          </li>
        ))}
      </ul>
      <p className="source-notice-hint">{t.sourcesRetryHint}</p>
    </div>
  );
}

function SearchView({
  query,
  setQuery,
  result,
  setResult,
  autoQuery,
  onAutoConsumed,
  onOpen,
}: {
  query: string;
  setQuery: (q: string) => void;
  result: SearchResponse | null;
  setResult: (r: SearchResponse | null) => void;
  autoQuery: string | null;
  onAutoConsumed: () => void;
  onOpen: (group: GameGroup, platform: Platform) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [example] = useState(
    () => searchExamples[Math.floor(Math.random() * searchExamples.length)]
  );

  const run = async (q: string = query) => {
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    try {
      setResult(await api.search(term));
    } finally {
      setBusy(false);
    }
  };

  // A ticker click hands us a title: put it in the box and search it right away.
  useEffect(() => {
    if (autoQuery == null) return;
    setQuery(autoQuery);
    run(autoQuery);
    onAutoConsumed();
  }, [autoQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo<GameGroup[]>(() => {
    if (!result) return [];
    const map = new Map<string, GameGroup>();
    for (const hit of result.games) {
      const g =
        map.get(hit.groupKey) ??
        ({ key: hit.groupKey, title: hit.title, image: hit.image, byPlatform: new Map() } as GameGroup);
      g.image ??= hit.image;
      // Prefer a nicely-cased title over an ALL-CAPS store title for display.
      if (prettierTitle(hit.title, g.title) === hit.title) g.title = hit.title;
      const list = g.byPlatform.get(hit.platform) ?? [];
      list.push(hit);
      g.byPlatform.set(hit.platform, list);
      map.set(hit.groupKey, g);
    }
    return [...map.values()];
  }, [result]);

  const soonPlatforms = useMemo<Platform[]>(() => {
    if (!result?.platformStatus) return [];
    return (Object.entries(result.platformStatus) as [Platform, boolean][])
      .filter(([, active]) => !active)
      .map(([p]) => p);
  }, [result]);

  return (
    <section>
      <div className="searchbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder={t.searchPlaceholder(example)}
          autoFocus
        />
        <button onClick={() => run()} disabled={busy}>
          {busy ? t.searching : t.searchButton}
        </button>
      </div>
      <p className="hint">{t.searchHint}</p>

      {result && <SourceNotice sources={result.sources} />}

      {result && groups.length === 0 && (
        <div className="empty">
          {result.query.platforms.length > 0 &&
          soonPlatforms.length === result.query.platforms.length
            ? `${t.noSourcesForPlatform} (${result.query.platforms
                .map((p) => platformNames[p])
                .join(', ')})`
            : t.noResults}
        </div>
      )}

      <div className="results">
        {groups.map((g) => (
          <article className="card" key={g.key}>
            {g.image ? <img src={safeUrl(g.image)} alt={g.title} loading="lazy" /> : <div className="noart">{g.title}</div>}
            <div className="body">
              <h3>{g.title}</h3>
              <div className="chips">
                {[...g.byPlatform.keys()].map((platform) => (
                  <button
                    key={platform}
                    className={`chip ${platform}`}
                    onClick={() => onOpen(g, platform)}
                  >
                    {platformNames[platform]}
                  </button>
                ))}
                {soonPlatforms.map((p) => (
                  <span key={p} className="chip soon">
                    {platformNames[p]} · {t.comingSoonPlatform}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── game page ───────────────────────── */

type Mode = 'physical' | 'digital';
type DigitalView = 'regions' | 'stores';

/** Order editions for the selector: base first, then Standard, then the rest. */
function orderEditions(editions: (string | null)[]): (string | null)[] {
  const rank = (e: string | null) => (e === null ? 0 : /standard/i.test(e) ? 1 : 2);
  return [...editions].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

function GamePage({
  group,
  initialPlatform,
  preferred,
  onChangePreferred,
  onBack,
}: {
  group: GameGroup;
  initialPlatform: Platform;
  preferred: string;
  onChangePreferred: (m: string) => void;
  onBack: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const platforms = useMemo(() => [...group.byPlatform.keys()], [group]);

  // Editions available for the currently-selected platform.
  const editionMap = useMemo(() => {
    const m = new Map<string | null, GameHit[]>();
    for (const h of group.byPlatform.get(platform) ?? []) {
      const list = m.get(h.edition) ?? [];
      list.push(h);
      m.set(h.edition, list);
    }
    return m;
  }, [group, platform]);
  const editions = useMemo(() => orderEditions([...editionMap.keys()]), [editionMap]);

  const [edition, setEdition] = useState<string | null>(editions[0] ?? null);
  // Switching platform resets the edition to that platform's first one.
  useEffect(() => {
    setEdition(orderEditions([...editionMap.keys()])[0] ?? null);
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRefs = useMemo<SourceRef[]>(
    () =>
      (editionMap.get(edition) ?? []).map((h) => ({
        sourceId: h.sourceId,
        sourceGameId: h.sourceGameId,
      })),
    [editionMap, edition]
  );

  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [sources, setSources] = useState<SourceStatus[] | undefined>(undefined);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<Mode>('physical');
  const [digitalView, setDigitalView] = useState<DigitalView>('regions');

  const fullTitle = edition ? `${group.title} — ${edition}` : group.title;

  useEffect(() => {
    // Guard against a slow response from a previously-selected edition arriving
    // after the user switched — without this it clobbers the current edition's
    // offers (the "no offers on non-standard editions" bug).
    let live = true;
    setOffers(null);
    setError(false);
    setSources(undefined);
    if (selectedRefs.length === 0) {
      setOffers([]);
      return;
    }
    api
      .offers(selectedRefs, platform)
      .then((r) => {
        if (!live) return;
        setOffers(r.offers);
        setSources(r.sources);
        // Default to physical if any disc offers exist, else digital (the user
        // mostly buys discs). Digital defaults to whichever sub-view has data.
        const hasPhysical = r.offers.some((o) => o.kind === 'physical');
        const hasRegions = r.offers.some((o) => o.kind === 'digital' && o.regionName);
        setMode(hasPhysical ? 'physical' : 'digital');
        setDigitalView(hasRegions ? 'regions' : 'stores');
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [selectedRefs, platform]);

  // Partition offers into the three buckets the page switches between.
  const physical = useMemo(() => (offers ?? []).filter((o) => o.kind === 'physical'), [offers]);
  const digitalRegions = useMemo(
    () => (offers ?? []).filter((o) => o.kind === 'digital' && o.regionName),
    [offers]
  );
  const digitalStores = useMemo(
    () => (offers ?? []).filter((o) => o.kind === 'digital' && !o.regionName),
    [offers]
  );

  // Baseline for the "vs" column = the user's preferred region price (if sold there).
  const preferredOffer = useMemo(
    () => digitalRegions.find((o) => o.region === preferred) ?? null,
    [digitalRegions, preferred]
  );
  // All regions stay visible (sorted cheapest, from the server); the preferred
  // region is pinned to the very top regardless of price.
  const orderedRegions = useMemo(() => {
    if (!preferredOffer) return digitalRegions;
    return [preferredOffer, ...digitalRegions.filter((o) => o.region !== preferred)];
  }, [digitalRegions, preferredOffer, preferred]);
  const preferredMeta = regionByMarket.get(preferred);

  // If the chosen digital sub-view is empty but the other has offers, show the
  // one with data instead of a dead-end "nothing here" message.
  const effectiveView: DigitalView =
    digitalView === 'regions' && digitalRegions.length === 0 && digitalStores.length > 0
      ? 'stores'
      : digitalView === 'stores' && digitalStores.length === 0 && digitalRegions.length > 0
        ? 'regions'
        : digitalView;
  // The region ⇄ external-suppliers toggle only makes sense when both exist.
  // Consoles usually have no external key resellers, so it's hidden there.
  const showDigitalToggle = digitalRegions.length > 0 && digitalStores.length > 0;

  return (
    <section>
      <button className="backlink" onClick={onBack}>
        ‹ חזרה לתוצאות
      </button>
      <div className="boardhead">
        {group.image && <img src={safeUrl(group.image)} alt="" />}
        <div>
          <h2>
            {group.title} — {platformNames[platform]}
          </h2>
        </div>
      </div>

      {/* Platform switcher — jump between platforms of the same game */}
      {platforms.length > 1 && (
        <div className="platform-switch">
          <span className="editions-label">{t.platformSwitchLabel}:</span>
          {platforms.map((p) => (
            <button
              key={p}
              className={`chip ${p} ${platform === p ? 'on' : ''}`}
              onClick={() => setPlatform(p)}
            >
              {platformNames[p]}
            </button>
          ))}
        </div>
      )}

      {/* Edition selector */}
      {editions.length > 1 && (
        <div className="editions">
          <span className="editions-label">{t.editionLabel}:</span>
          {editions.map((e) => (
            <button key={e ?? ''} className={edition === e ? 'on' : ''} onClick={() => setEdition(e)}>
              {e ?? t.editionStandard}
            </button>
          ))}
        </div>
      )}

      {/* Digital vs physical — only when the game actually comes in both forms
          (digital-only PC games, disc-only titles etc. don't need the choice). */}
      {offers && physical.length > 0 && digitalRegions.length + digitalStores.length > 0 && (
        <div className="mode-switch">
          <button className={mode === 'physical' ? 'on' : ''} onClick={() => setMode('physical')}>
            <span className="price-dot disc" aria-hidden="true" /> {t.modePhysical}
          </button>
          <button className={mode === 'digital' ? 'on' : ''} onClick={() => setMode('digital')}>
            <span className="price-dot official" aria-hidden="true" /> {t.modeDigital}
          </button>
        </div>
      )}

      {!offers && !error && <div className="empty">{t.searching}</div>}
      {error && <div className="error">{t.offersLoadError}</div>}

      {offers &&
        (mode === 'physical' ? (
          physical.length > 0 ? (
            <StoreBoard offers={physical} />
          ) : (
            <div className="empty">{t.physicalEmpty}</div>
          )
        ) : digitalRegions.length === 0 && digitalStores.length === 0 ? (
          <div className="empty">{t.noOffersYet}</div>
        ) : (
          <>
            {/* The region ⇄ external-suppliers toggle — only when both exist. */}
            {showDigitalToggle && (
              <button
                className="digital-toggle"
                title={t.digitalToggleHint}
                onClick={() => setDigitalView(digitalView === 'regions' ? 'stores' : 'regions')}
              >
                <span className="dt-icon">⇄</span>
                {digitalView === 'regions' ? t.digitalRegionsLabel : t.digitalStoresLabel}
              </button>
            )}

            {effectiveView === 'regions' ? (
              digitalRegions.length > 0 ? (
                <>
                  <div className="pref-row">
                    <label className="editions-label" htmlFor="pref-region">
                      {t.preferredRegionLabel}:
                    </label>
                    <select
                      id="pref-region"
                      className="pref-select"
                      value={preferred}
                      onChange={(e) => onChangePreferred(e.target.value)}
                    >
                      {REGIONS.map((r) => (
                        <option key={r.market} value={r.market}>
                          {r.flag} {r.nameHe}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="board-note">
                    {preferredOffer && preferredMeta
                      ? t.preferredPinNote(preferredMeta.nameHe)
                      : t.regionBoardNote}
                  </p>
                  <RegionBoard
                    offers={orderedRegions}
                    baselinePrice={preferredOffer?.priceILS ?? null}
                    baselineName={preferredMeta?.nameHe ?? ''}
                    preferred={preferred}
                  />
                </>
              ) : (
                <div className="empty">{t.digitalRegionsEmpty}</div>
              )
            ) : digitalStores.length > 0 ? (
              <>
                <p className="board-note">
                  {t.digitalStoresNote}
                  {preferredMeta && ` ${t.forRegionNote(`${preferredMeta.flag} ${preferredMeta.nameHe}`)}`}
                </p>
                <StoreBoard offers={digitalStores} showLaunchers />
              </>
            ) : (
              <div className="empty">{t.digitalStoresEmpty}</div>
            )}
          </>
        ))}

      {offers && <SourceNotice sources={sources} />}

      <PriceHistorySection
        title={fullTitle}
        platform={platform}
        image={group.image}
        refs={selectedRefs}
      />
    </section>
  );
}

/* ───────────────────────── price history (opt-in, local) ───────────────────────── */

function PriceHistorySection({
  title,
  platform,
  image,
  refs,
}: {
  title: string;
  platform: Platform;
  image?: string;
  refs: SourceRef[];
}) {
  const [status, setStatus] = useState<{ tracked: boolean; id?: number; history: HistoryPoint[] } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    api
      .trackStatus(title, platform)
      .then(setStatus)
      .catch(() => setStatus({ tracked: false, history: [] }));
  }, [title, platform]);

  const startTracking = async () => {
    if (refs.length === 0) return;
    setBusy(true);
    try {
      const r = await api.track({ title, platform, image, refs });
      setStatus({ tracked: true, id: r.id, history: r.history });
    } finally {
      setBusy(false);
    }
  };

  const addPoint = async () => {
    if (!status?.id) return;
    setBusy(true);
    try {
      const r = await api.trackRefresh(status.id);
      setStatus((s) => (s ? { ...s, history: r.history } : s));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="history">
      <h3 className="history-title">📈 {t.historyTitle}</h3>
      {!status ? (
        <div className="graph-empty">…</div>
      ) : !status.tracked ? (
        <div className="track-prompt">
          <b>{t.trackPromptTitle}</b>
          <p>{t.trackPromptBody}</p>
          <button className="refresh" onClick={startTracking} disabled={busy || refs.length === 0}>
            {busy ? t.tracking : t.trackStart}
          </button>
        </div>
      ) : (
        <>
          <PriceGraph history={status.history} />
          <div className="history-actions">
            <span className="tracking-badge">{t.trackingActive}</span>
            <button className="addbtn" onClick={addPoint} disabled={busy}>
              {busy ? t.addingPoint : t.addPoint}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Official PC storefronts (a key here is a direct purchase, not a reseller). */
const OFFICIAL_LAUNCHERS: Record<string, string> = {
  steam: 'Steam',
  'epic games store': 'Epic',
  gog: 'GOG',
  origin: 'EA',
  'ea app': 'EA',
  'ubisoft store': 'Ubisoft',
  uplay: 'Ubisoft',
  'battle.net': 'Battle.net',
  blizzard: 'Battle.net',
  'microsoft store': 'Microsoft',
};
function launcherOf(store: string): string | null {
  return OFFICIAL_LAUNCHERS[store.trim().toLowerCase()] ?? null;
}

/** Multi-store board (PC digital + Israeli physical). */
function StoreBoard({ offers, showLaunchers = false }: { offers: Offer[]; showLaunchers?: boolean }) {
  // Only surface the launcher when the game spans more than one storefront.
  const launchers = new Set(offers.map((o) => launcherOf(o.store)).filter(Boolean));
  const withLaunchers = showLaunchers && launchers.size > 1;
  return (
    <table className="board">
      <thead>
        <tr>
          <th>{t.storeColumn}</th>
          <th></th>
          <th>{t.priceColHeader(currencySymbol())}</th>
          <th>{t.origPriceColumn}</th>
          <th>{t.savingsColumn}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {offers.map((o, i) => (
          <tr key={i} className={i === 0 ? 'best' : ''}>
            <td>
              <span className="storecell">
                {o.storeLogo && <img src={safeUrl(o.storeLogo)} alt="" />}
                {o.store}
              </span>
            </td>
            <td>
              <span className={`badge ${o.kind}`}>
                {o.kind === 'physical' ? t.physicalBadge : t.digitalBadge}
              </span>{' '}
              {withLaunchers && launcherOf(o.store) && (
                <span className="badge official">{t.officialBadge}</span>
              )}
              {!withLaunchers && (
                <span className={`badge ${o.location === 'israel' ? 'local' : ''}`}>
                  {o.location === 'israel' ? t.localBadge : t.abroadBadge}
                </span>
              )}
            </td>
            <td>
              <span className="price num">{nis(o.priceILS)}</span>{' '}
              {o.currency !== 'ILS' && (
                <span className="meta num">
                  ({o.currency} {o.price.toFixed(2)})
                </span>
              )}
            </td>
            <td>
              {o.retailPrice != null && o.retailPrice > o.price && (
                <span className="orig num">
                  {o.currency === 'ILS' ? nis(o.retailPrice) : `${o.currency} ${o.retailPrice.toFixed(2)}`}
                </span>
              )}
            </td>
            <td>{!!o.savings && <span className="savings num">{o.savings}%-</span>}</td>
            <td>
              {o.url && (
                <a className="golink" href={safeUrl(o.url)} target="_blank" rel="noreferrer">
                  {t.toStore}
                </a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Cross-region console price board. Preferred region is pinned to the top. */
function RegionBoard({
  offers,
  baselinePrice,
  baselineName,
  preferred,
}: {
  offers: Offer[];
  baselinePrice: number | null;
  baselineName: string;
  preferred: string;
}) {
  return (
    <table className="board">
      <thead>
        <tr>
          <th>{t.regionColumnName}</th>
          <th>{t.nativePriceColumn}</th>
          <th>{t.priceColHeader(currencySymbol())}</th>
          <th>{baselineName ? t.vsPreferredLabel(baselineName) : t.vsIsraelLabel}</th>
          <th>{t.savingsColumn}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {offers.map((o, i) => {
          const isPreferred = o.region === preferred;
          const vsBaseline =
            baselinePrice && !isPreferred && o.priceILS < baselinePrice
              ? Math.round(((baselinePrice - o.priceILS) / baselinePrice) * 100)
              : null;
          return (
            <tr key={i} className={isPreferred ? 'preferred' : i === 0 ? 'best' : ''}>
              <td>
                <span className="regioncell">
                  <span className="flag">{o.flag}</span>
                  {o.regionName}
                  {isPreferred && <span className="pin">📍</span>}
                </span>
              </td>
              <td>
                <span className="meta num">
                  {o.currency} {o.price.toLocaleString('en-US')}
                </span>
              </td>
              <td>
                <span className="price num">{nis(o.priceILS)}</span>
              </td>
              <td>
                {isPreferred ? (
                  <span className="meta">{t.preferredRegionLabel}</span>
                ) : vsBaseline ? (
                  <span className="delta down num">−{vsBaseline}%</span>
                ) : (
                  <span className="meta">—</span>
                )}
              </td>
              <td>{!!o.savings && <span className="savings num">{o.savings}%-</span>}</td>
              <td>
                {o.url && (
                  <a className="golink" href={safeUrl(o.url)} target="_blank" rel="noreferrer">
                    {t.toStore}
                  </a>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ───────────────────────── wishlist board ───────────────────────── */

const CAPTURE_PRESETS = [1, 3, 7, 14, 30];

/** Interval picker used both globally and per-game. `defaultDays` set → adds a
 *  "use the global default" option that maps to null. */
function CaptureSelect({
  value,
  onChange,
  defaultDays,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  defaultDays?: number;
}) {
  const presets = [...new Set([...CAPTURE_PRESETS, ...(value ? [value] : [])])].sort((a, b) => a - b);
  return (
    <select
      className="pref-select small"
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      {defaultDays !== undefined && <option value="">{t.captureUseGlobal(defaultDays)}</option>}
      {presets.map((d) => (
        <option key={d} value={d}>
          {t.captureEvery(d)}
        </option>
      ))}
    </select>
  );
}

/* ───────────────────────── settings (BYOK keys) ───────────────────────── */

/**
 * Shown whenever the app can't reach its own server. Silently rendering an
 * empty state instead made a live tracking list look erased — this says what
 * actually happened and offers the one useful action.
 */
function ServerDown({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="server-down" role="alert">
      <p className="server-down-title">⚠️ {t.serverDownTitle}</p>
      <p className="server-down-body">{t.serverDownBody}</p>
      <button className="toolbtn" onClick={onRetry}>
        {t.serverDownRetry}
      </button>
    </div>
  );
}

function SettingsView() {
  const [keys, setKeys] = useState<KeysResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadKeys = () =>
    api
      .getKeys()
      .then((k) => {
        setKeys(k);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  useEffect(() => {
    loadKeys();
  }, []);
  const save = async (patch: { ggdeals?: string; itad?: string }) => setKeys(await api.setKeys(patch));

  // A dead server used to leave this page blank below the heading, which read as
  // "you can't enter API keys here" rather than "the server isn't answering".
  if (loadFailed) return <ServerDown onRetry={loadKeys} />;

  return (
    <section className="settings-view">
      <h2>{t.keysTitle}</h2>
      <p className="settings-intro">{t.keysIntro}</p>
      {keys ? (
        <>
          <KeyRow
            label="GG.deals"
            status={keys.ggdeals}
            registerUrl="https://gg.deals/settings/api/"
            blurb={t.keysGgBlurb}
            onSave={(v) => save({ ggdeals: v })}
          />
          <KeyRow
            label="IsThereAnyDeal"
            status={keys.itad}
            registerUrl="https://isthereanydeal.com/apps/"
            blurb={t.keysItadBlurb}
            onSave={(v) => save({ itad: v })}
          />
        </>
      ) : (
        <p className="settings-intro">{t.loadingDetails}</p>
      )}

      <h2 className="settings-section">{t.currencyTitle}</h2>
      <p className="settings-intro">{t.currencySettingsNote}</p>
    </section>
  );
}

function KeyRow({
  label,
  status,
  registerUrl,
  blurb,
  onSave,
}: {
  label: string;
  status: KeyStatus;
  registerUrl: string;
  blurb: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const commit = async (v: string) => {
    setBusy(true);
    try {
      await onSave(v);
      setValue('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="key-row">
      <div className="key-head">
        <span className="key-label">{label}</span>
        {status.configured ? (
          <span className="key-status ok">
            {t.keyConfigured} · {t.keySource(status.source)}
          </span>
        ) : (
          <span className="key-status off">{t.keyNotConfigured}</span>
        )}
      </div>
      <p className="key-blurb">{blurb}</p>
      <div className="key-actions">
        <input
          type="password"
          className="key-input"
          value={value}
          placeholder={t.keyPlaceholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && commit(value.trim())}
        />
        <button className="toolbtn" disabled={busy || !value.trim()} onClick={() => commit(value.trim())}>
          {t.keySave}
        </button>
        {status.configured && status.source === 'settings' && (
          <button className="toolbtn danger" disabled={busy} onClick={() => commit('')}>
            {t.keyRemove}
          </button>
        )}
        <a className="key-register" href={registerUrl} target="_blank" rel="noreferrer">
          {t.keyGetOne} ↗
        </a>
      </div>
    </div>
  );
}

function WishlistView({
  rule,
  onChangeRule,
  focusId,
  onFocusConsumed,
}: {
  rule: AlertRule | null;
  onChangeRule: (patch: Partial<AlertRule>) => void;
  focusId: number | null;
  onFocusConsumed: () => void;
}) {
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hideAll, setHideAll] = useState(loadHideAllDesc());
  const [captureGlobal, setCaptureGlobal] = useState(7);
  const [showRule, setShowRule] = useState(false);

  // "Couldn't reach the server" and "you track nothing yet" are completely
  // different messages. Collapsing a failed fetch into an empty list once made
  // a full tracking list look permanently DELETED — never imply data loss we
  // haven't verified.
  const [loadFailed, setLoadFailed] = useState(false);
  const load = () =>
    api
      .wishlist()
      .then((r) => {
        setItems(r.items);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  useEffect(() => {
    load();
    api.getSettings().then((s) => setCaptureGlobal(s.captureDaysGlobal)).catch(() => {});
  }, []);

  const changeCaptureGlobal = async (days: number) => {
    setCaptureGlobal(days);
    await api.setSettings({ captureDaysGlobal: days });
  };

  const setCaptureDaysFor = async (id: number, days: number | null) => {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === id ? { ...it, capture_days: days } : it)) : prev
    );
    await api.setTrackSetting(id, { captureDays: days });
  };

  const setAlertFor = async (id: number, patch: TrackAlertPatch) => {
    setItems((prev) =>
      prev
        ? prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  ...(patch.alertPct !== undefined ? { alert_pct: patch.alertPct } : {}),
                  ...(patch.alertPrice !== undefined
                    ? { alert_price: patch.alertPrice, alert_price_ccy: patch.alertPriceCcy ?? it.alert_price_ccy }
                    : {}),
                  ...(patch.alertMode !== undefined ? { alert_mode: patch.alertMode } : {}),
                  ...(patch.alertScope !== undefined ? { alert_scope: patch.alertScope } : {}),
                  // Naming a threshold IS choosing a custom rule — the server makes
                  // the same move, so the row must not keep claiming "global".
                  ...(patch.alertPct != null || patch.alertPrice != null
                    ? { alert_mode: 'custom' }
                    : {}),
                }
              : it
          )
        : prev
    );
    await api.setTrackSetting(id, patch);
  };

  const refresh = async () => {
    setBusy(true);
    try {
      await api.refresh();
      await load();
      pricesChecked(); // fresh prices can mean fresh alerts — show them now
    } finally {
      setBusy(false);
    }
  };

  // Arrived here by clicking a notification: open that game straight away.
  useEffect(() => {
    if (focusId == null || !items) return;
    setExpandedId(items.some((it) => it.id === focusId) ? focusId : null);
    onFocusConsumed();
  }, [focusId, items, onFocusConsumed]);

  const remove = async (id: number) => {
    if (expandedId === id) setExpandedId(null);
    await api.removeWish(id);
    await load();
  };

  const setPref = async (id: number, region: string) => {
    // Reflect the dropdown choice instantly…
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === id ? { ...it, preferred_region: region || null } : it)) : prev
    );
    await api.setTrackSetting(id, { preferredRegion: region || null });
    // …then reload so the "best price" column follows the newly-picked region
    // (it's recomputed server-side from that region's offers).
    await load();
  };

  const toggleHideAll = () => {
    const next = !hideAll;
    setHideAll(next);
    saveHideAllDesc(next);
  };

  const [importMsg, setImportMsg] = useState('');
  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const imported = Array.isArray(data) ? data : data.items;
      const r = await api.importData(imported);
      setImportMsg(t.importDone(r.games, r.points));
      await load();
    } catch {
      setImportMsg(t.importError);
    }
  };

  if (loadFailed) return <ServerDown onRetry={load} />;
  if (!items) return null;

  return (
    <section>
      <div className="toolbar">
        {items.length > 0 && (
          <button className="refresh" onClick={refresh} disabled={busy}>
            {busy ? t.refreshing : t.refreshPrices}
          </button>
        )}
        {items.length > 0 && (
          <a className="toolbtn" href="/api/export">
            ⤓ {t.exportButton}
          </a>
        )}
        <label className="toolbtn">
          ⤒ {t.importButton}
          <input type="file" accept="application/json" onChange={onImport} hidden />
        </label>
        {items.length > 0 && (
          <label className="capture-global" title={t.captureHint} style={{ marginInlineStart: 'auto' }}>
            {t.captureGlobalLabel}
            <CaptureSelect value={captureGlobal} onChange={(v) => v != null && changeCaptureGlobal(v)} />
          </label>
        )}
        {items.length > 0 && (
          <button
            className={`toolbtn ${showRule ? 'active' : ''}`}
            onClick={() => setShowRule((v) => !v)}
            aria-expanded={showRule}
          >
            {t.notifSettingsButton} <span className="caret">{showRule ? '▾' : '▸'}</span>
          </button>
        )}
        {items.length > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={hideAll} onChange={toggleHideAll} />
            {t.hideAllDescriptions}
          </label>
        )}
        {importMsg && <span className="meta">{importMsg}</span>}
      </div>

      {/* The alert rule, editable right where the tracked games are — the same
          setting the bell edits, so the two can never say different things. */}
      {showRule && items.length > 0 && (
        <div className="notif-panel">
          <h3 className="notif-panel-title">🔔 {t.notifRuleTitle}</h3>
          <NotificationRule value={rule} onChange={onChangeRule} />
        </div>
      )}
      {items.length === 0 ? (
        <div className="empty">{t.wishlistEmpty}</div>
      ) : (
        <>
        <p className="region-scope-hint">{t.regionScopeHint}</p>
        <table className="board wishlist">
          <thead>
            <tr>
              <th>משחק</th>
              <th>פלטפורמה</th>
              <th>{t.preferredCol}</th>
              <th>{t.pricesCol}</th>
              {/* The old "שינוי" column held one character per row; the movement
                  now sits beside the price it actually describes. */}
              <th>{t.lastChecked}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const delta =
                it.current && it.previous ? it.current.price_ils - it.previous.price_ils : null;
              const open = expandedId === it.id;
              return (
                <Fragment key={it.id}>
                  <tr className={open ? 'wishrow open' : 'wishrow'}>
                    <td>
                      <button
                        className="wishrow-title link"
                        onClick={() => setExpandedId(open ? null : it.id)}
                      >
                        <span className="caret">{open ? '▾' : '▸'}</span>
                        {it.image && <img src={safeUrl(it.image)} alt="" />}
                        <b>{it.title}</b>
                        {/* Only rows that DIFFER from the global rule say anything —
                            "everything is watched" is the norm, not news. */}
                        {it.alert_mode === 'off' ? (
                          <span className="alert-flag off" title={t.alertRowOff}>
                            🔕
                          </span>
                        ) : it.alert_mode === 'custom' ? (
                          <span className="alert-flag" title={t.alertRowCustom}>
                            🔔
                          </span>
                        ) : null}
                      </button>
                      {/* The verdict belongs with the game's name, not floating
                          above a stack of prices it only partly describes. */}
                      {it.verdict && <VerdictLine v={it.verdict} />}
                    </td>
                    <td>
                      <span className={`chip ${it.platform}`} style={{ cursor: 'default' }}>
                        {platformNames[it.platform]}
                      </span>
                    </td>
                    <td>
                      <select
                        className="pref-select small"
                        value={it.preferred_region ?? ''}
                        onChange={(e) => setPref(it.id, e.target.value)}
                        title={t.preferredRegionGameLabel}
                      >
                        <option value="">—</option>
                        {REGIONS.map((r) => (
                          <option key={r.market} value={r.market}>
                            {r.flag} {r.nameHe}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="prices-cell">
                      {it.current ? (
                        <PriceLine
                          tone="official"
                          kind={t.kindDigitalShort}
                          official
                          delta={
                            delta != null && it.previous
                              ? { amountILS: delta, prevILS: it.previous.price_ils }
                              : null
                          }
                          priceILS={it.current.price_ils}
                          store={it.current.store}
                          region={it.current.region}
                          title={
                            it.current.region && regionByMarket.get(it.current.region)
                              ? it.preferred_region && it.current.region !== it.preferred_region
                                ? t.bestPriceFallback(regionByMarket.get(it.current.region)!.nameHe)
                                : t.forRegionNote(regionByMarket.get(it.current.region)!.nameHe)
                              : t.kindDigital
                          }
                        />
                      ) : (
                        <span className="meta">{t.neverChecked}</span>
                      )}
                      {it.physical && (
                        <PriceLine
                          tone="disc"
                          kind={t.kindDiscShort}
                          priceILS={it.physical.price_ils}
                          store={it.physical.store}
                          title={t.kindDisc}
                        />
                      )}
                      {it.cdkeys && (
                        <PriceLine
                          tone="keys"
                          kind={t.kindKeyshopShort}
                          priceILS={it.cdkeys.price_ils}
                          store={it.cdkeys.store}
                          title={t.kindKeyshop}
                        />
                      )}
                    </td>
                    <td className="meta">
                      {it.current ? (
                        <span title={new Date(it.current.checked_at + 'Z').toLocaleString('he-IL')}>
                          {t.timeAgo(it.current.checked_at)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <button className="removebtn" onClick={() => remove(it.id)}>
                        {t.remove} ✕
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="wishrow-detail">
                      <td colSpan={6}>
                        <ExpandedTrack
                          id={it.id}
                          preferredRegion={it.preferred_region}
                          hideAll={hideAll}
                          captureDays={it.capture_days}
                          captureGlobal={captureGlobal}
                          onSetCaptureDays={(v) => setCaptureDaysFor(it.id, v)}
                          alertMode={it.alert_mode}
                          alertPct={it.alert_pct}
                          alertPrice={it.alert_price}
                          alertPriceCcy={it.alert_price_ccy}
                          alertScope={it.alert_scope}
                          globalRule={rule}
                          onSetAlert={(p) => setAlertFor(it.id, p)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </>
      )}
    </section>
  );
}

/** Everything a tracked row can change about its own alerts. */
interface TrackAlertPatch {
  alertPct?: number | null;
  alertPrice?: number | null;
  alertPriceCcy?: string;
  alertMode?: AlertMode;
  alertScope?: AlertScope | null;
}

/**
 * Per-game alert settings. Every tracked game already follows the global rule, so
 * this panel is about the exceptions: watch a different price for THIS game, hold
 * it to its own threshold, or hear nothing about it at all.
 */
function AlertControls({
  mode,
  pct,
  price,
  ccy,
  scope,
  globalRule,
  onSet,
}: {
  mode: string | null;
  pct: number | null;
  price: number | null;
  ccy: string | null;
  scope: string | null;
  globalRule: AlertRule | null;
  onSet: (patch: TrackAlertPatch) => void;
}) {
  const [pctVal, setPctVal] = useState(pct == null ? '' : String(pct));
  const [priceVal, setPriceVal] = useState(price == null ? '' : String(price));
  const [curCcy, setCurCcy] = useState<string>(ccy || currencyCode());
  useEffect(() => {
    setPctVal(pct == null ? '' : String(pct));
  }, [pct]);
  useEffect(() => {
    setPriceVal(price == null ? '' : String(price));
    setCurCcy(ccy || currencyCode());
  }, [price, ccy]);

  const effectiveMode: AlertMode = mode === 'custom' || mode === 'off' ? mode : 'global';

  const commitPct = () => {
    const n = Number(pctVal);
    onSet({ alertPct: pctVal.trim() === '' || !(n >= 1) ? null : Math.round(n) });
  };
  const commitPrice = (useCcy: string = curCcy) => {
    const n = Number(priceVal);
    onSet({ alertPrice: priceVal.trim() === '' || !(n > 0) ? null : n, alertPriceCcy: useCcy });
  };

  return (
    <div className="alert-controls">
      <span className="alert-title">🔔 {t.alertTitle}</span>

      <label className="alert-line">
        {t.alertModeLabel}
        <select
          className="pref-select small"
          value={effectiveMode}
          onChange={(e) => onSet({ alertMode: e.target.value as AlertMode })}
        >
          <option value="global">{t.alertModeGlobal}</option>
          <option value="custom">{t.alertModeCustom}</option>
          <option value="off">{t.alertModeOff}</option>
        </select>
      </label>

      {effectiveMode === 'global' && globalRule && (
        <span className="alert-inherit">{t.alertGlobalSummary(ruleSummary(globalRule))}</span>
      )}

      {effectiveMode === 'custom' && (
        <>
          <label className="alert-line">
            {t.alertPctLabel}
            <input
              className="alert-input"
              type="number"
              min={1}
              max={99}
              placeholder={t.notifOff}
              value={pctVal}
              onChange={(e) => setPctVal(e.target.value)}
              onBlur={commitPct}
              onKeyDown={(e) => e.key === 'Enter' && commitPct()}
            />
            %
          </label>
          <label className="alert-line">
            {t.alertPriceLabel}
            <input
              className="alert-input"
              type="number"
              min={0}
              placeholder={t.notifOff}
              value={priceVal}
              onChange={(e) => setPriceVal(e.target.value)}
              onBlur={() => commitPrice()}
              onKeyDown={(e) => e.key === 'Enter' && commitPrice()}
            />
            <select
              className="pref-select small"
              value={curCcy}
              onChange={(e) => {
                setCurCcy(e.target.value);
                commitPrice(e.target.value);
              }}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {currencySymbol(c)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {/* WHICH price to watch is about how this game is tracked, so it applies in
          both modes — a game bought as a disc is judged on disc prices either way. */}
      {effectiveMode !== 'off' && (
        <label className="alert-line">
          {t.notifScopeLabel}
          <select
            className="pref-select small"
            value={scope ?? ''}
            onChange={(e) => onSet({ alertScope: (e.target.value || null) as AlertScope | null })}
          >
            <option value="">
              {t.alertScopeUseGlobal(t.scopeNames[globalRule?.scope ?? 'auto']!)}
            </option>
            {(Object.keys(t.scopeNames) as AlertScope[]).map((s) => (
              <option key={s} value={s}>
                {t.scopeNames[s]}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="alert-note">{effectiveMode === 'off' ? t.alertOffNote : t.alertNote}</p>
    </div>
  );
}

/** Inline detail shown when a tracked row is expanded (item 1: same page). */
function ExpandedTrack({
  id,
  preferredRegion,
  hideAll,
  captureDays,
  captureGlobal,
  onSetCaptureDays,
  alertMode,
  alertPct,
  alertPrice,
  alertPriceCcy,
  alertScope,
  globalRule,
  onSetAlert,
}: {
  id: number;
  preferredRegion: string | null;
  hideAll: boolean;
  captureDays: number | null;
  captureGlobal: number;
  onSetCaptureDays: (v: number | null) => void;
  alertMode: string | null;
  alertPct: number | null;
  alertPrice: number | null;
  alertPriceCcy: string | null;
  alertScope: string | null;
  globalRule: AlertRule | null;
  onSetAlert: (patch: TrackAlertPatch) => void;
}) {
  const [detail, setDetail] = useState<TrackDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.trackDetail(id).then((d) => {
      setDetail(d);
      // Opening the panel may have just recorded a fresh point (capture.ts) —
      // and with it possibly a sale alert; let the bell hear about it now.
      if (d.captured) pricesChecked();
    });
  useEffect(() => {
    setDetail(null);
    load();
  }, [id]);

  const addPoint = async () => {
    setBusy(true);
    try {
      await api.trackRefresh(id);
      await load();
      pricesChecked(); // this check may have just fired this game's alert
    } finally {
      setBusy(false);
    }
  };
  const toggleHideDesc = async () => {
    if (!detail) return;
    const next = !detail.hideDesc;
    await api.setTrackSetting(id, { hideDesc: next });
    setDetail({ ...detail, hideDesc: next });
  };

  // The row owns the preferred region; use the freshest value passed in.
  const pref = preferredRegion;
  const prefMeta = pref ? regionByMarket.get(pref) : undefined;
  // Offer buckets depend on the (slow) detail fetch; the controls below don't, so
  // they render immediately while the graph + offers stream in underneath.
  const physical = detail ? detail.offers.filter((o) => o.kind === 'physical') : [];
  const digitalRegions = detail ? detail.offers.filter((o) => o.kind === 'digital' && o.regionName) : [];
  const digitalStores = detail ? detail.offers.filter((o) => o.kind === 'digital' && !o.regionName) : [];
  const showDesc = !hideAll && detail?.meta && !detail.hideDesc && detail.meta.description;

  return (
    <div className="expanded">
      {detail?.meta?.genres?.length ? (
        <span className="meta genre-line">
          {t.genreLabel}: {detail.meta.genres.join(', ')}
        </span>
      ) : null}

      {showDesc ? (
        <p className="game-desc">
          {detail!.meta!.description}
          <button className="desc-toggle" onClick={toggleHideDesc}>
            {t.hideDescription}
          </button>
        </p>
      ) : detail?.meta && detail.meta.description && !hideAll ? (
        <button className="desc-toggle standalone" onClick={toggleHideDesc}>
          {t.showDescription}
        </button>
      ) : null}

      <div className="expanded-graph">
        {detail ? (
          <TrackGraph
            history={detail.history}
            preferredRegion={pref}
            preferredName={prefMeta ? `${prefMeta.flag} ${prefMeta.nameHe}` : ''}
          />
        ) : (
          <div className="graph-loading">{t.loadingDetails}</div>
        )}
        <div className="graph-actions">
          <button className="addbtn" onClick={addPoint} disabled={busy || !detail}>
            {busy ? t.addingPoint : t.addPoint}
          </button>
          {detail?.captured && <span className="captured-note">{t.graphCapturedNow}</span>}
          <label className="capture-game" title={t.captureHint}>
            {t.captureGameLabel}:
            <CaptureSelect
              value={captureDays}
              defaultDays={captureGlobal}
              onChange={onSetCaptureDays}
            />
          </label>
        </div>
        <AlertControls
          mode={alertMode}
          pct={alertPct}
          price={alertPrice}
          ccy={alertPriceCcy}
          scope={alertScope}
          globalRule={globalRule}
          onSet={onSetAlert}
        />
      </div>

      <h4 className="history-title">🛒 {t.currentOffersTitle}</h4>
      {!detail ? (
        <div className="offers-loading">{t.loadingDetails}</div>
      ) : (
        <>
          {digitalRegions.length > 0 && (
            <RegionBoard
              offers={
                prefMeta && digitalRegions.some((o) => o.region === pref)
                  ? [
                      digitalRegions.find((o) => o.region === pref)!,
                      ...digitalRegions.filter((o) => o.region !== pref),
                    ]
                  : digitalRegions
              }
              baselinePrice={digitalRegions.find((o) => o.region === pref)?.priceILS ?? null}
              baselineName={prefMeta?.nameHe ?? ''}
              preferred={pref ?? ''}
            />
          )}
          {physical.length > 0 && <StoreBoard offers={physical} />}
          {digitalStores.length > 0 && <StoreBoard offers={digitalStores} showLaunchers />}
          {detail.offers.length === 0 && <div className="empty">{t.noOffersYet}</div>}
        </>
      )}
    </div>
  );
}
