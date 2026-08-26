import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  loadOpenAnim,
  saveOpenAnim,
  loadBoardView,
  saveBoardView,
  BOARD_VIEWS,
  type BoardView,
} from './regions';
import { PriceGraph, TrackGraph } from './PriceGraph';
import { DepartureBoard } from './DepartureBoard';
import { SearchBox, rememberSearch, loadIncludeDlc, saveIncludeDlc } from './SearchBox';
import type { HealthReport, PsnHashStatus, SteamImportProgress } from './types';
import { Logo } from './Logo';
import { safeUrl } from './url';
import { HoldToConfirm } from './HoldToConfirm';
import { SearchProgressBar, type ProgressState } from './SearchProgressBar';
import { loadProgressBar, loadProgressBlink, saveProgressBar, saveProgressBlink } from './progressPrefs';
import { clearMutesForWorkingSources, muteForADay, muteUntilBack, visibleFailures } from './sourceNotice';
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

  // Whether a search card animates "into" its price board when opened. Global,
  // persisted, and toggleable from the settings page.
  const [openAnim, setOpenAnim] = useState<boolean>(() => loadOpenAnim());
  const [boardView, setBoardView] = useState<BoardView>(() => loadBoardView());
  const changeOpenAnim = (v: boolean) => {
    setOpenAnim(v);
    saveOpenAnim(v);
  };
  const changeBoardView = (v: BoardView) => {
    setBoardView(v);
    saveBoardView(v);
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
            preferred={preferred}
            openAnim={openAnim}
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
        {view.name === 'settings' && (
          <SettingsView
            preferred={preferred}
            onChangePreferred={changePreferred}
            openAnim={openAnim}
            onChangeOpenAnim={changeOpenAnim}
            boardView={boardView}
            onChangeBoardView={changeBoardView}
          />
        )}
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
  /** Omitted when the row has a single price — there is nothing to distinguish. */
  kind?: string;
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
      {kind && <span className="price-type">{kind}</span>}
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
  /** Add-on content. Only ever true when the user opted into seeing add-ons,
   *  and badged on the card so it is never mistaken for the game itself. */
  dlc?: boolean;
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
/**
 * Accent- and punctuation-insensitive text, so "Assassin's" and "Assassins"
 * are the same word and a apostrophe never decides whether a game is a match.
 */
function normText(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

/** The words a query is asking about. One-letter noise is dropped. */
function normWords(q: string): string[] {
  return normText(q).split(' ').filter((w) => w.length > 1);
}

/**
 * Every alert that has ever fired, in Settings.
 *
 * The bell is a place things pass through: it is cleared, and once cleared the
 * fact that a price ever dropped is gone. That is the wrong shape for the one
 * record the tool keeps of its own behaviour — someone who cleared the bell by
 * reflex, or who was not looking, has no way to find out what they missed.
 *
 * So the log shows everything, read or not, and clearing it is deliberately
 * harder than clearing the bell: three seconds of holding, because unlike the
 * bell this really is the last copy.
 */
function NotificationLog() {
  const [items, setItems] = useState<AppNotification[] | null>(null);

  // The LOG, not the bell: clearing the bell must leave this untouched, which
  // was the whole complaint — tidying the bell threw away the only record.
  const load = () =>
    api
      .getNotificationLog()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));

  useEffect(() => {
    void load();
  }, []);

  const clear = async () => {
    await api.purgeNotifications();
    await load();
  };

  return (
    <div className="setting-row setting-row-block">
      <div className="setting-text">
        <span className="setting-label">{t.logTitle}</span>
        <p className="setting-note">{t.logHint}</p>

        {items === null ? (
          <p className="log-empty">{t.depLoading}</p>
        ) : items.length === 0 ? (
          <p className="log-empty">{t.logEmpty}</p>
        ) : (
          <>
            <ul className="log-list">
              {items.map((n) => (
                <li key={n.id} className={n.read ? '' : 'unread'}>
                  <span className="log-when">{t.timeAgo(n.created_at)}</span>
                  <span className="log-title">{n.title}</span>
                  <span className="log-msg">{n.message}</span>
                </li>
              ))}
            </ul>
            <p className="log-count">{t.logCount(items.length)}</p>
          </>
        )}

        <div className="log-actions">
          <HoldToConfirm
            label={t.logClear}
            holding={t.logClearHolding}
            done={t.logCleared}
            onConfirm={() => void clear()}
          />
          <p className="log-clear-note">{t.logClearNote}</p>
        </div>
      </div>
    </div>
  );
}

function SourceNotice({ sources }: { sources?: SourceStatus[] }) {
  // Bumped when a mute is written, to re-read the stored set.
  const [, forceRender] = useState(0);

  // A store that returned something has come back, so its mute is spent. Doing
  // this on every result is what makes "until it's back" mean what it says.
  useEffect(() => {
    if (sources && clearMutesForWorkingSources(sources)) forceRender((n) => n + 1);
  }, [sources]);

  const failed = visibleFailures(sources);
  if (failed.length === 0) return null;

  const forADay = () => {
    for (const s of failed) muteForADay(s.id);
    forceRender((n) => n + 1);
  };
  const untilBack = () => {
    for (const s of failed) muteUntilBack(s.id);
    forceRender((n) => n + 1);
  };

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
      <div className="source-notice-actions">
        <button className="source-notice-ok" onClick={forADay}>{t.sourcesDismissDay}</button>
        <button className="source-notice-mute" onClick={untilBack}>
          {failed.length === 1 ? t.sourcesMuteOne(failed[0]!.name) : t.sourcesMuteMany(failed.length)}
        </button>
      </div>
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
  preferred,
  openAnim,
}: {
  query: string;
  setQuery: (q: string) => void;
  result: SearchResponse | null;
  setResult: (r: SearchResponse | null) => void;
  autoQuery: string | null;
  onAutoConsumed: () => void;
  onOpen: (group: GameGroup, platform: Platform) => void;
  preferred: string;
  openAnim: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [showProgress] = useState(loadProgressBar);
  const [progressBlink] = useState(loadProgressBlink);
  const [includeDlc, setIncludeDlc] = useState<boolean>(() => loadIncludeDlc());
  const [example] = useState(
    () => searchExamples[Math.floor(Math.random() * searchExamples.length)]
  );
  // Which card is expanded into its inline price board (one at a time). The
  // opened card is REMOVED from the grid — it has "gone into" the board — and,
  // when animation is on, a fixed clone flies from the card's old spot into the
  // board's game pane so the move reads as one object. `absorb` tracks that
  // flight so the board's game pane stays hidden until the clone lands.
  const [expanded, setExpanded] = useState<{ key: string; platform: Platform } | null>(null);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [absorb, setAbsorb] = useState<'active' | 'done' | null>(null);
  /** The results grid, so opening a board can scroll its top into view. */
  const resultsRef = useRef<HTMLDivElement>(null);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const openBoard = (g: GameGroup, platform: Platform, cardEl: HTMLElement | null) => {
    // Clicking the platform already open closes the board and restores the card.
    if (expanded && expanded.key === g.key && expanded.platform === platform) {
      setExpanded(null);
      setFlight(null);
      setAbsorb(null);
      return;
    }
    const animate = openAnim && !prefersReducedMotion() && !!cardEl;
    // Capture the card's on-screen box BEFORE React removes it from the grid.
    let fromRect = animate && cardEl ? cardEl.getBoundingClientRect() : null;

    // The board always opens at the TOP of the results, so bring that into view
    // in the same beat. Without it, clicking a card far down the grid opens a
    // board above the fold and the page appears to have done nothing.
    const scrolledFrom = window.scrollY;
    const resultsTop = resultsRef.current?.getBoundingClientRect().top ?? 0;
    window.scrollTo({ top: Math.max(0, scrolledFrom + resultsTop - 12), behavior: 'auto' });
    // Jumping moves the card's box out from under the clone, which is positioned
    // in viewport coordinates — shift the captured box by however far we went.
    const delta = window.scrollY - scrolledFrom;
    if (fromRect && delta !== 0) {
      fromRect = new DOMRect(fromRect.left, fromRect.top - delta, fromRect.width, fromRect.height);
    }

    setExpanded({ key: g.key, platform });
    if (fromRect) {
      setAbsorb('active');
      setFlight({ fromRect, image: g.image, title: g.title });
    } else {
      setAbsorb(null);
      setFlight(null);
    }
  };

  const switchPlatform = (key: string, platform: Platform) => {
    // Switching platform inside an open board never re-flies; just reload it.
    setFlight(null);
    setAbsorb('done');
    setExpanded({ key, platform });
  };

  const closeBoard = () => {
    setExpanded(null);
    setFlight(null);
    setAbsorb(null);
  };

  /**
   * Sequence number of the newest search. Searches fan out across every source,
   * so they finish in whatever order the slowest store allows — without this,
   * whichever request RESOLVED last won, and a slow "far cry" could land on top
   * of the "far cry 6" the user actually asked for. Only the newest request is
   * allowed to write state; older ones land and are discarded.
   */
  const searchSeq = useRef(0);
  /**
   * Results we've already considered for auto-opening. Without this the effect
   * would re-open the board every render, so closing it would be impossible.
   */
  const autoOpened = useRef<SearchResponse | null>(null);

  const run = async (q: string = query, dlcOverride?: boolean) => {
    const term = q.trim();
    if (!term) return;
    const seq = ++searchSeq.current;
    setBusy(true);
    setFailed(false);
    setProgress(null);
    // Results shown while the rest are still arriving. Accumulated here rather
    // than in the child so a slow store landing never re-runs the whole grid.
    const streamed: GameHit[] = [];
    let answered = 0;
    try {
      const r = await api.searchStream(term, dlcOverride ?? includeDlc, (p) => {
        if (seq !== searchSeq.current) return;
        streamed.push(...p.games);
        // Reached, not necessarily fruitful: a shop that says it does not stock
        // this game has answered. Only an unreachable one is missing.
        if (p.status.ok) answered++;
        setProgress({ total: p.total, done: p.done, answered });
        // Show what has landed so far. The final answer replaces this wholesale,
        // so a partial view is never what the user is left with.
        setResult({ query: { title: term, platforms: [] }, games: [...streamed], sources: [] });
      });
      if (seq === searchSeq.current) setResult(r);
    } catch {
      // A failed search used to reject silently, leaving the previous results on
      // screen as though they answered the new query.
      if (seq === searchSeq.current) {
        setResult(null);
        setFailed(true);
      }
    } finally {
      if (seq === searchSeq.current) setBusy(false);
    }
  };

  // A ticker click hands us a title: put it in the box and search it right away.
  useEffect(() => {
    if (autoQuery == null) return;
    setQuery(autoQuery);
    rememberSearch(autoQuery); // a ticker click is a search too
    run(autoQuery);
    onAutoConsumed();
  }, [autoQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo<GameGroup[]>(() => {
    if (!result) return [];
    const map = new Map<string, GameGroup>();
    for (const hit of result.games) {
      const g =
        map.get(hit.groupKey) ??
        ({ key: hit.groupKey, title: hit.title, image: hit.image, byPlatform: new Map(), dlc: hit.dlc } as GameGroup);
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

  /**
   * What you searched for, and what merely shares a word with it.
   *
   * Store search is fuzzy on purpose — it has to be, or a typo finds nothing —
   * but the results come back flat, so "Ring of Pain" sits in the same grid as
   * "Elden Ring" looking equally like the thing you asked for. The fuzziness is
   * worth keeping; presenting it as if it were all one answer is not.
   *
   * The rule is deliberately simple enough to state: a game whose title contains
   * EVERY word you typed is one of the games you asked for — "Elden Ring
   * Nightreign" for "elden ring" — and anything else is a lookalike. When a typo
   * means nothing matches, everything lands under "related", which is both true
   * and the most useful thing to show.
   */
  const { matched, related } = useMemo(() => {
    const words = normWords(result?.query.title ?? '');
    if (words.length === 0) return { matched: groups, related: [] as GameGroup[] };
    const hit: GameGroup[] = [];
    const near: GameGroup[] = [];
    for (const g of groups) {
      const titleWords = normText(g.title).split(' ');
      // Whole words, not substrings. A plain `includes` put "Tower of Shades",
      // "Cool Shades" and "Shades of Sakura" among the results for "Hades" —
      // because "hades" IS inside "shades". `startsWith` on each title word
      // keeps the useful looseness (assassin → assassins) without that.
      const ok = words.every((w) => titleWords.some((tw) => tw.startsWith(w)));
      (ok ? hit : near).push(g);
    }
    return { matched: hit, related: near };
  }, [groups, result]);

  /** The group whose board is open, if it is still in the current results. */
  const openGroup = expanded ? groups.find((g) => g.key === expanded.key) : undefined;

  /**
   * Go straight to the game when the search names one exactly.
   *
   * Someone who typed "Borderlands 3" in full has already told us which game
   * they want; making them pick it out of a grid of Borderlands cards is a step
   * that answers nothing. The other results still render around the opened
   * board, so this is a shortcut rather than a decision taken away.
   *
   * Only ever on a single unambiguous match — two groups sharing a key means we
   * don't actually know, and guessing there would be worse than the grid.
   */
  useEffect(() => {
    if (!result || autoOpened.current === result) return;
    autoOpened.current = result;
    const key = result.queryKey;
    if (!key) return;
    const exact = groups.filter((g) => g.key === key);
    if (exact.length !== 1) return;
    const g = exact[0]!;
    // A platform named in the query wins; otherwise take the game's first.
    const platform =
      result.query.platforms.find((p) => g.byPlatform.has(p)) ?? [...g.byPlatform.keys()][0];
    if (!platform) return;
    // Opened without the card-into-board flight: there is no card on screen to
    // fly from, and the board carries its own platform switcher for changing.
    setFlight(null);
    setAbsorb(null);
    setExpanded({ key: g.key, platform });
  }, [result, groups]);

  const soonPlatforms = useMemo<Platform[]>(() => {
    if (!result?.platformStatus) return [];
    return (Object.entries(result.platformStatus) as [Platform, boolean][])
      .filter(([, active]) => !active)
      .map(([p]) => p);
  }, [result]);

  return (
    <section>
      <SearchBox
        query={query}
        setQuery={setQuery}
        busy={busy}
        placeholder={t.searchPlaceholder(example)}
        onSubmit={(term) => run(term)}
        includeDlc={includeDlc}
        onChangeIncludeDlc={(v) => {
          setIncludeDlc(v);
          saveIncludeDlc(v);
          // Re-run immediately: flipping the switch is itself the request.
          if (query.trim()) run(query, v);
        }}
      />
      <p className="hint">{t.searchHint}</p>

      {failed && <div className="empty">{t.searchFailed}</div>}

      <SearchProgressBar
        progress={showProgress ? progress : null}
        blink={progressBlink}
        onHidden={() => setProgress(null)}
      />
      {result && <SourceNotice sources={result.sources} />}

      {/* A Hebrew query was translated before the stores were asked. Said out
          loud, with the words we could not translate named — a rewrite the user
          cannot see is one they cannot correct. */}
      {result?.searchedAs && (
        <p className="searched-as">
          {t.searchedAs(result.searchedAs.query)}
          {result.searchedAs.dropped.length > 0 && (
            <span className="searched-as-dropped"> · {t.searchedAsDropped(result.searchedAs.dropped)}</span>
          )}
        </p>
      )}

      {result && groups.length === 0 && (
        <div className="empty">
          {result.query.platforms.length > 0 &&
          soonPlatforms.length === result.query.platforms.length
            ? `${t.noSourcesForPlatform} (${result.query.platforms
                .map((p) => platformNames[p])
                .join(', ')})`
            : // "Try it in English" is good advice for a Hebrew query and an
              // insult to someone who already typed English — it tells them the
              // thing they just did. Only offer it when there is Hebrew to
              // translate.
              /[\u0590-\u05FF]/.test(result.query.title)
              ? t.noResultsTryEnglish
              : t.noResults}
        </div>
      )}

      {/* The open board sits ABOVE the grid, never inside it.
          Opened in place, it left whichever cards happened to be earlier in the
          row sitting above the game the user had just chosen — so a search for
          Cyberpunk 2077 showed its board with "Ultimate Edition" hanging over
          it. Which cards those were depended only on grid position, which is
          not a reason for anything to be above the thing you asked for. */}
      {openGroup && expanded && (
        <div className="board-slot">
          <DepartureBoard
            key={openGroup.key}
            title={openGroup.title}
            platform={expanded.platform}
            image={openGroup.image}
            preferred={preferred}
            absorb={absorb}
            platforms={[...openGroup.byPlatform.keys()]}
            onSwitchPlatform={(p) => switchPlatform(openGroup.key, p)}
            refs={(openGroup.byPlatform.get(expanded.platform) ?? []).map((h) => ({
              sourceId: h.sourceId,
              sourceGameId: h.sourceGameId,
            }))}
            onOpenFull={() => onOpen(openGroup, expanded.platform)}
            onClose={closeBoard}
          />
        </div>
      )}

      <div className="results" ref={resultsRef}>
        {matched.map((g) => {
          // The opened card has gone INTO the board above, so it isn't drawn in
          // the grid; the remaining results keep their order below it.
          if (expanded != null && expanded.key === g.key) return null;
          return (
            <article className="card" key={g.key}>
              {g.image ? <img src={safeUrl(g.image)} alt={g.title} loading="lazy" /> : <div className="noart">{g.title}</div>}
              <div className="body">
                <h3>
                  {g.title}
                  {g.dlc && <span className="dlc-badge">{t.dlcBadge}</span>}
                </h3>
                <div className="chips">
                  {[...g.byPlatform.keys()].map((platform) => (
                    <button
                      key={platform}
                      className={`chip ${platform}`}
                      onClick={(e) => openBoard(g, platform, e.currentTarget.closest('.card'))}
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
          );
        })}
      </div>

      {related.length > 0 && (
        <section className="related">
          <h3 className="related-head">
            {matched.length > 0 ? t.relatedTitle : t.relatedOnlyTitle}
            <span className="related-count">{related.length}</span>
          </h3>
          <p className="related-hint">{t.relatedHint}</p>
          <div className="results">
            {related.map((g) => {
              if (expanded != null && expanded.key === g.key) return null;
              return (
                <article className="card" key={g.key}>
                  {g.image ? (
                    <img src={safeUrl(g.image)} alt={g.title} loading="lazy" />
                  ) : (
                    <div className="noart">{g.title}</div>
                  )}
                  <div className="body">
                    <h3>
                      {g.title}
                      {g.dlc && <span className="dlc-badge">{t.dlcBadge}</span>}
                    </h3>
                    <div className="chips">
                      {[...g.byPlatform.keys()].map((platform) => (
                        <button
                          key={platform}
                          className={`chip ${platform}`}
                          onClick={(e) => openBoard(g, platform, e.currentTarget.closest('.card'))}
                        >
                          {platformNames[platform]}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* The card-into-board flight: a fixed clone morphing from the card's old
          box into the board's game pane. Fast on purpose; it clears itself. */}
      {flight && (
        <AbsorbClone
          flight={flight}
          onDone={() => {
            setFlight(null);
            setAbsorb('done');
          }}
        />
      )}
    </section>
  );
}

/** The card box + art captured at click time, so a clone can fly from it. */
interface FlightState {
  fromRect: DOMRect;
  image?: string;
  title: string;
}

/**
 * A one-shot flying clone of a search card that morphs from where the card sat
 * in the grid into the price board's game pane, so opening a game reads as the
 * card itself sliding inside the board. Deliberately quick (~200ms) — noticeable
 * but never in the user's way. It measures the board's game art as its landing
 * target, animates there, then removes itself (`onDone`) so the board's own game
 * pane fades in exactly where the clone came to rest.
 */
function AbsorbClone({ flight, onDone }: { flight: FlightState; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // useLayoutEffect (not useEffect): the clone was just committed at the card's
  // old box, so we can lock that start state with a forced reflow and then set
  // the end transform — no requestAnimationFrame needed (some throttle it).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => onDone();
    // The board mounts in the same commit; its game art is our landing target.
    const target =
      document.querySelector<HTMLElement>('.dt-panel .dt-art') ??
      document.querySelector<HTMLElement>('.dt-panel .dt-noart');
    if (!target) {
      done();
      return;
    }
    const to = target.getBoundingClientRect();
    const { fromRect: from } = flight;
    if (to.width === 0 || from.width === 0) {
      done();
      return;
    }
    // Force the start box to be laid out, THEN switch on the transition and move
    // to the pane's box — the browser now has two states to animate between.
    void el.getBoundingClientRect();
    el.classList.add('fly');
    el.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${
      to.width / from.width
    }, ${to.height / from.height})`;
    el.addEventListener('transitionend', done, { once: true });
    // Safety net: if the transition never fires (identical boxes, a tab that
    // isn't painting), clean up anyway so the board never gets stuck behind it.
    const timer = window.setTimeout(done, 360);
    return () => {
      el.removeEventListener('transitionend', done);
      window.clearTimeout(timer);
    };
  }, [flight, onDone]);

  const { fromRect, image, title } = flight;
  return (
    <div
      ref={ref}
      className="absorb-clone"
      style={{
        top: fromRect.top,
        left: fromRect.left,
        width: fromRect.width,
        height: fromRect.height,
      }}
      aria-hidden="true"
    >
      {image ? <img src={safeUrl(image)} alt="" /> : <div className="absorb-noart">{title}</div>}
    </div>
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
                          {r.nameHe}
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
                  {preferredMeta && ` ${t.forRegionNote(preferredMeta.nameHe)}`}
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
                  {/* No flag emoji: regional-indicator flags degrade to bare
                      country letters on Windows ("US ארה״ב"), so the Hebrew
                      region name carries it alone. */}
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

/**
 * Adapter health panel. The canary runs itself daily; this shows the last
 * result and lets the user force a round. "empty" is called out separately from
 * "error" on purpose — a source that returns nothing is the failure mode that
 * otherwise looks exactly like a game simply not being sold.
 */
function HealthPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api
      .getHealth()
      .then((r) => setReport(r.report))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const run = async () => {
    setRunning(true);
    try {
      setReport((await api.runHealth()).report);
    } catch {
      /* leave the previous report on screen */
    } finally {
      setRunning(false);
    }
  };

  const anyEmpty = report?.adapters.some((a) => a.state === 'empty' || a.state === 'error');

  return (
    <>
      <h2 className="settings-section">{t.healthTitle}</h2>
      <p className="settings-intro">{t.healthIntro}</p>
      <div className="health-actions">
        <button className="health-run" onClick={run} disabled={running}>
          {running ? t.healthRunning : t.healthRun}
        </button>
        {report && (
          <span className="health-when">{t.healthCheckedAt(new Date(report.checkedAt).toLocaleString('he-IL'))}</span>
        )}
      </div>
      {!loaded ? (
        <p className="settings-intro">{t.loadingDetails}</p>
      ) : !report ? (
        <p className="settings-intro">{t.healthNever}</p>
      ) : (
        <>
          <ul className="health-list">
            {report.adapters.map((a) => (
              <li className={`health-row ${a.state}`} key={a.id} title={a.detail ?? t.healthProbe(a.probe)}>
                <span className="health-dot" aria-hidden="true" />
                <span className="health-name">{a.name}</span>
                <span className="health-state">{t.healthStates[a.state] ?? a.state}</span>
                <span className="health-count">{a.state === 'disabled' ? '—' : `${a.count}`}</span>
              </li>
            ))}
          </ul>
          {anyEmpty && <p className="health-hint">{t.healthEmptyHint}</p>}
        </>
      )}
    </>
  );
}

/**
 * PlayStation connection status.
 *
 * Sony rotates the search hash occasionally; the tool re-reads it by driving a
 * browser already on the machine. This panel says whether that will work HERE —
 * because "no driveable browser" is worth knowing before something breaks, not
 * after — and gives a paste field that works on any machine either way.
 *
 * The hash is a public value from Sony's own JavaScript, not a secret, so it is
 * shown in full: seeing it change is how a user confirms a fix worked.
 */
function PsnPanel() {
  const [status, setStatus] = useState<PsnHashStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    api.getPsnHash().then(setStatus).catch(() => undefined);
  }, []);

  const recover = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.recoverPsnHash();
      setStatus((prev) => (prev ? { ...prev, hash: r.hash, source: r.source } : prev));
      setNote(r.found ? t.psnRecovered : t.psnRecoverFailed);
    } catch {
      setNote(t.psnRecoverFailed);
    } finally {
      setBusy(false);
    }
  };

  const save = async (value: string) => {
    setNote(null);
    try {
      const r = await api.setPsnHash(value);
      setStatus((prev) => (prev ? { ...prev, hash: r.hash, source: r.source } : prev));
      setManual('');
      setNote(t.psnSaved);
    } catch {
      setNote(t.psnBadHash);
    }
  };

  return (
    <>
      <h2 className="settings-section">{t.psnTitle}</h2>
      <p className="settings-intro">{t.psnIntro}</p>
      {status && (
        <>
          <p className={`psn-browser ${status.browser ? 'ok' : 'warn'}`}>
            {status.recovery === 'self'
              ? t.psnBrowserSelf
              : status.recovery === 'manual'
                ? t.psnBrowserManual
                : status.browser
                  ? t.psnBrowserOk(status.browser)
                  : t.psnBrowserNone}
          </p>
          <div className="psn-row">
            <span className="psn-label">{t.psnSourceLabel}</span>
            <code className="psn-hash">{status.hash}</code>
            <span className="psn-src">{t.psnSources[status.source] ?? status.source}</span>
          </div>
          <div className="psn-actions">
            {/* Only where pressing it can actually do something. In the
                extension there is no way to drive a browser at all, and the
                button sat there reporting failure every time — an action
                offered that could never succeed. */}
            {status.recovery !== 'manual' && (
              <button className="health-run" onClick={recover} disabled={busy}>
                {busy ? t.psnRecovering : t.psnRecover}
              </button>
            )}
            {status.source === 'saved' && (
              <button className="psn-clear" onClick={() => save('')}>{t.psnClear}</button>
            )}
            {note && <span className="psn-note">{note}</span>}
          </div>
          <label className="psn-manual">
            <span className="setting-label">{t.psnManualLabel}</span>
            <p className="setting-note">{t.psnManualHelp}</p>
            <span className="psn-manual-row">
              <input
                type="text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="64 hex"
                spellCheck={false}
              />
              <button className="health-run" disabled={!manual.trim()} onClick={() => save(manual)}>
                {t.psnSave}
              </button>
            </span>
          </label>
        </>
      )}
    </>
  );
}

function SettingsView({
  preferred,
  onChangePreferred,
  openAnim,
  onChangeOpenAnim,
  boardView,
  onChangeBoardView,
}: {
  preferred: string;
  onChangePreferred: (m: string) => void;
  openAnim: boolean;
  onChangeOpenAnim: (v: boolean) => void;
  boardView: BoardView;
  onChangeBoardView: (v: BoardView) => void;
}) {
  const [bar, setBar] = useState(loadProgressBar);
  const [blinkPref, setBlinkPref] = useState(loadProgressBlink);
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

  return (
    <section className="settings-view">
      {/* General preferences — stored locally in the browser, so they work even
          when the server is unreachable. */}
      <h2>{t.generalTitle}</h2>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">{t.defaultCountryLabel}</span>
          <p className="setting-note">{t.defaultCountryNote}</p>
        </div>
        <select
          className="pref-select"
          value={preferred}
          onChange={(e) => onChangePreferred(e.target.value)}
          aria-label={t.defaultCountryLabel}
        >
          {REGIONS.map((r) => (
            <option key={r.market} value={r.market}>
              {r.nameHe}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">{t.openAnimLabel}</span>
          <p className="setting-note">{t.openAnimNote}</p>
        </div>
        <button
          className={`toggle ${openAnim ? 'on' : ''}`}
          role="switch"
          aria-checked={openAnim}
          aria-label={t.openAnimLabel}
          onClick={() => onChangeOpenAnim(!openAnim)}
        >
          <span className="toggle-knob" aria-hidden="true" />
          <span className="toggle-text">{openAnim ? t.animOn : t.animOff}</span>
        </button>
      </div>

      <NotificationLog />

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">{t.progressShow}</span>
          <p className="setting-note">{t.progressHint}</p>
        </div>
        <button
          className={`toggle ${bar ? 'on' : ''}`}
          role="switch"
          aria-checked={bar}
          aria-label={t.progressShow}
          onClick={() => {
            saveProgressBar(!bar);
            setBar(!bar);
          }}
        >
          <span className="toggle-knob" aria-hidden="true" />
          <span className="toggle-text">{bar ? t.animOn : t.animOff}</span>
        </button>
      </div>

      {bar && (
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">{t.progressBlinkLabel}</span>
            <p className="setting-note">{t.progressBlinkHint}</p>
          </div>
          <button
            className={`toggle ${blinkPref ? 'on' : ''}`}
            role="switch"
            aria-checked={blinkPref}
            aria-label={t.progressBlinkLabel}
            onClick={() => {
              saveProgressBlink(!blinkPref);
              setBlinkPref(!blinkPref);
            }}
          >
            <span className="toggle-knob" aria-hidden="true" />
            <span className="toggle-text">{blinkPref ? t.animOn : t.animOff}</span>
          </button>
        </div>
      )}

      <div className="setting-row setting-row-block">
        <div className="setting-text">
          <span className="setting-label">{t.boardViewTitle}</span>
          <p className="setting-note">{t.boardViewHint}</p>
          <div className="board-view-list">
            {BOARD_VIEWS.map((v) => (
              <label className="board-view-opt" key={v}>
                <input
                  type="radio"
                  name="board-view"
                  checked={boardView === v}
                  onChange={() => onChangeBoardView(v)}
                />
                <span>{t.boardViewNames[v]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <h2 className="settings-section">{t.keysTitle}</h2>
      <p className="settings-intro">{t.keysIntro}</p>
      {/* Only the API-key panel needs the server; a dead server shows the notice
          here instead of blanking the whole page (or the general prefs above). */}
      {loadFailed ? (
        <ServerDown onRetry={loadKeys} />
      ) : keys ? (
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
          {/* Why EA looks different from every other storefront here. */}
          <p className="key-note">{t.keysEaNote}</p>
        </>
      ) : (
        <p className="settings-intro">{t.loadingDetails}</p>
      )}

      <HealthPanel />

      <PsnPanel />

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
  // Steam wishlist import: open, because a tracker with an empty list
  // demonstrates nothing and nobody types eighty titles by hand.
  const [steamOpen, setSteamOpen] = useState(false);
  const [steamProfile, setSteamProfile] = useState('');
  const [steamBusy, setSteamBusy] = useState(false);
  const [steamStep, setSteamStep] = useState<SteamImportProgress | null>(null);
  const [steamMsg, setSteamMsg] = useState('');

  const runSteamImport = async () => {
    if (!steamProfile.trim() || steamBusy) return;
    setSteamBusy(true);
    setSteamMsg('');
    setSteamStep(null);
    try {
      const r = await api.importSteam(steamProfile.trim(), setSteamStep);
      setSteamMsg(r.ok ? t.steamImportDone(r) : t.steamImportError[r.reason] ?? t.steamImportError.failed!);
      if (r.ok && r.added > 0) await load();
    } catch {
      setSteamMsg(t.steamImportError.failed!);
    } finally {
      setSteamBusy(false);
      setSteamStep(null);
    }
  };

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
        {/* The JSON file above is for re-importing here; this one is for
            actually reading the numbers somewhere else. */}
        {items.length > 0 && (
          <a className="toolbtn" href="/api/export.csv" title={t.exportCsvHint}>
            {t.exportCsv}
          </a>
        )}
        <label className="toolbtn">
          ⤒ {t.importButton}
          <input type="file" accept="application/json" onChange={onImport} hidden />
        </label>
        <button
          className={`toolbtn ${steamOpen ? 'active' : ''}`}
          onClick={() => setSteamOpen((v) => !v)}
          aria-expanded={steamOpen}
        >
          {t.steamImportButton} <span className="caret">{steamOpen ? '▾' : '▸'}</span>
        </button>
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

      {/* Steam wishlist import. Placed with the tracked list rather than in
          Settings because it is how the list gets its contents, not a
          preference about it. */}
      {steamOpen && (
        <div className="steam-panel">
          <h3 className="steam-panel-title">{t.steamImportTitle}</h3>
          <p className="steam-panel-intro">{t.steamImportIntro}</p>
          <div className="steam-row">
            <input
              className="steam-input"
              type="text"
              value={steamProfile}
              placeholder={t.steamImportPlaceholder}
              disabled={steamBusy}
              onChange={(e) => setSteamProfile(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSteamImport()}
            />
            <button className="steam-go" onClick={runSteamImport} disabled={steamBusy || !steamProfile.trim()}>
              {steamBusy ? t.steamImportWorking : t.steamImportGo}
            </button>
          </div>
          {/* Progress, not a spinner: the wait is real and minutes long, and a
              bar that cannot say how far along it is looks like a hang. */}
          {steamStep && (
            <div className="steam-progress">
              <div className="steam-bar">
                <span style={{ width: `${Math.round(((steamStep.done ?? 0) / Math.max(1, steamStep.total)) * 100)}%` }} />
              </div>
              <div className="steam-step">
                {t.steamImportStep(steamStep.done ?? 0, steamStep.total)}
                {steamStep.title && <span className="steam-step-title"> · {steamStep.title}</span>}
              </div>
            </div>
          )}
          {steamMsg && <p className="steam-msg">{steamMsg}</p>}
          <p className="steam-note">{t.steamImportNote}</p>
        </div>
      )}

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

              /**
               * The three price buckets, with repeats removed.
               *
               * `current`, `physical` and `cdkeys` are three QUESTIONS about a
               * game, and one offer can be the answer to more than one of them.
               * A row whose only source is an Amazon listing filled the first
               * two, so the same ₪133.27 appeared twice — once labelled "חנות
               * רשמית" and once "דיסק", two claims about a listing we cannot
               * classify at all.
               *
               * Same store and same price means the same offer, so it is listed
               * once. And when everything collapses to one line the bucket
               * labels go too: they exist to tell three prices apart, and there
               * is nothing to tell apart.
               */
              const priceLines: {
                key: string;
                tone: 'official' | 'disc' | 'keys';
                kind: string;
                title: string;
                priceILS: number;
                store: string;
                region?: string | null;
                official?: boolean;
                delta?: { amountILS: number; prevILS: number } | null;
              }[] = [];
              const seenLines = new Set<string>();
              const addLine = (line: (typeof priceLines)[number]) => {
                const id = `${line.store}|${line.priceILS.toFixed(2)}`;
                if (seenLines.has(id)) return;
                seenLines.add(id);
                priceLines.push(line);
              };
              if (it.current) {
                addLine({
                  key: 'current',
                  tone: 'official',
                  kind: t.kindDigitalShort,
                  official: true,
                  delta:
                    delta != null && it.previous
                      ? { amountILS: delta, prevILS: it.previous.price_ils }
                      : null,
                  priceILS: it.current.price_ils,
                  store: it.current.store,
                  region: it.current.region,
                  title:
                    it.current.region && regionByMarket.get(it.current.region)
                      ? it.preferred_region && it.current.region !== it.preferred_region
                        ? t.bestPriceFallback(regionByMarket.get(it.current.region)!.nameHe)
                        : t.forRegionNote(regionByMarket.get(it.current.region)!.nameHe)
                      : t.kindDigital,
                });
              }
              if (it.physical) {
                addLine({
                  key: 'physical',
                  tone: 'disc',
                  kind: t.kindDiscShort,
                  priceILS: it.physical.price_ils,
                  store: it.physical.store,
                  title: t.kindDisc,
                });
              }
              if (it.cdkeys) {
                addLine({
                  key: 'cdkeys',
                  tone: 'keys',
                  kind: t.kindKeyshopShort,
                  priceILS: it.cdkeys.price_ils,
                  store: it.cdkeys.store,
                  title: t.kindKeyshop,
                });
              }
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
                            {r.nameHe}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="prices-cell">
                      {priceLines.length === 0 ? (
                        <span className="meta">{t.neverChecked}</span>
                      ) : (
                        priceLines.map((line) => (
                          <PriceLine
                            key={line.key}
                            tone={line.tone}
                            // With a single line there is nothing to tell apart,
                            // so the bucket label is dropped — see priceLines.
                            kind={priceLines.length > 1 ? line.kind : undefined}
                            official={line.official}
                            delta={line.delta}
                            priceILS={line.priceILS}
                            store={line.store}
                            region={line.region}
                            title={priceLines.length > 1 ? line.title : line.store}
                          />
                        ))
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
              {t.alertScopeUseGlobal(t.scopeNames[globalRule?.scope ?? 'any']!)}
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
            preferredName={prefMeta ? prefMeta.nameHe : ''}
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
