import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { nis, platformNames, t } from './he';
import { DlcPanel } from './DlcPanel';
import { PriceStats } from './PriceStats';
import { cleanStoreName, isDirectPurchase, regionLabel, storeFamily } from './source';
import { offerRisk, boardHasRisk, loadRegionNoticeHidden, saveRegionNoticeHidden, type RowRisk } from './regionRisk';
import { loadBoardView, type BoardView } from './regions';
import { boardHasEilatPrices, eilatPrice, eilatSaving } from './eilat';
import { safeUrl } from './url';
import { SearchProgressBar, type ProgressState } from './SearchProgressBar';
import { loadProgressBar, loadProgressBlink } from './progressPrefs';
import { loadQuietNotices } from './prefs';
import {
  acknowledge,
  isAcknowledged,
  loadGamePassAlerts,
  markAlerted,
  shouldAlert,
} from './gamepassAlerts';
import type { GameMeta, HistoryLow, Inclusion, Offer, Platform, SourceRef } from './types';

/**
 * The in-page detail "tab" a search card opens into.
 *
 * Two panes (RTL): the game sits on the right — art, title, platform and its
 * Steam blurb + genre tags — and the departure board fills the left with every
 * way to buy it, cheapest-first, prices flipping in row by row. A filter bar
 * lets the user narrow by store type, region, sale and sort. Same live offers
 * the full game page uses (api.offers); this only reskins and filters them.
 */

type Cat = 'official' | 'disc' | 'keys';
type SortKey = 'cheap' | 'region' | 'official';

/**
 * Which kind of seller an offer is.
 *
 * "Official" is about WHO sells it, not whether the row names a region: EA App
 * and GOG sell direct but price in one place only, and lumping them under
 * "key resellers" put a first-party storefront in the grey-market bucket.
 */
function catOf(o: Offer): Cat {
  if (o.kind === 'physical') return 'disc';
  return o.region || isDirectPurchase(storeFamily(o.store).key) ? 'official' : 'keys';
}
function onSaleOf(o: Offer): boolean {
  return (o.retailPrice != null && o.retailPrice > o.price) || (o.savings != null && o.savings > 0);
}
/**
 * The row's real discount: how far the store cut its OWN price.
 *
 * This used to compare against Israel's price, silently falling back to the
 * dearest row on the board when the game isn't sold in Israel — so every row of
 * such a game showed a huge "-90%" that read as a sale but only meant "cheaper
 * than the priciest region". A discount now means a discount.
 */
function discountOf(o: Offer): number {
  if (o.retailPrice != null && o.retailPrice > o.price) {
    return Math.round(((o.retailPrice - o.price) / o.retailPrice) * 100);
  }
  return o.savings != null && o.savings > 0 ? Math.round(o.savings) : 0;
}
/**
 * Airport-style code for the flap: the region market code, else what the row is.
 * A region-less row from the platform itself is a direct purchase, not a key —
 * calling Steam's or Uplay's own listing "מפתח" mislabelled the safest rows on
 * the board as the riskiest kind.
 */
function codeFor(o: Offer): string {
  if (o.region) return o.region;
  if (o.kind === 'physical') return t.depDisc;
  return isDirectPurchase(storeFamily(o.store).key) ? t.depDirect : t.depKey;
}

/**
 * What that code in the region column actually means.
 *
 * The column asks "which region", and three of its possible answers are not
 * regions at all — "ישיר", "מפתח" and "דיסק" say why this row HAS no region.
 * That was left to be inferred, and it is not inferrable: a reasonable person
 * reads "ישיר" in a region column and asks what kind of region that is.
 */
function codeHint(o: Offer): string {
  if (o.region) return t.depRegionHint(regionLabel(o.region) || o.region);
  if (o.kind === 'physical') return t.depDiscHint;
  return isDirectPurchase(storeFamily(o.store).key) ? t.depDirectHint : t.depKeyHint;
}

/** How many rows the "top" view shows before the "show the rest" button. */
const TOP_N = 12;

interface Row {
  o: Offer;
  risk: RowRisk;
  cut: number;
  best: boolean;
  /** Other regions of the same storefront, hidden behind this row in collapse view. */
  folded: Offer[];
}

export function DepartureBoard({
  title,
  platform,
  image,
  refs,
  preferred,
  absorb,
  platforms,
  onSwitchPlatform,
  onOpenFull,
  onClose,
}: {
  title: string;
  platform: Platform;
  image?: string;
  refs: SourceRef[];
  preferred: string;
  /** Card-into-board flight phase: 'active' hides the game pane until the flying
   *  clone lands, 'done' fades it in there; null/undefined = no flight (open plainly). */
  absorb?: 'active' | 'done' | null;
  /** Sibling platforms of this game, so the user can switch without closing. */
  platforms?: Platform[];
  onSwitchPlatform?: (p: Platform) => void;
  onOpenFull: () => void;
  onClose: () => void;
}) {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [showProgress] = useState(loadProgressBar);
  const [progressBlink] = useState(loadProgressBlink);
  const [error, setError] = useState(false);
  const [meta, setMeta] = useState<GameMeta | null | undefined>(undefined);
  // Filters — all permissive by default; a game/platform switch resets them.
  const [types, setTypes] = useState<Record<Cat, boolean>>({ official: true, disc: true, keys: true });
  const [region, setRegion] = useState<string>('all');
  const [onSale, setOnSale] = useState(false);
  const [sort, setSort] = useState<SortKey>('cheap');
  /** Storefronts the user has switched OFF. Empty = show everything (the default). */
  const [hiddenStores, setHiddenStores] = useState<Set<string>>(new Set());
  /** Opt-in, never on by default: hide rows that need a foreign account or a regional key. */
  const [onlyBuyable, setOnlyBuyable] = useState(false);
  /** Layout mode — seeded from the user's setting, switchable per board. */
  const [view, setView] = useState<BoardView>(() => loadBoardView());
  /** Storefronts whose folded regions are currently expanded (collapse view). */
  const [openStores, setOpenStores] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [noticeHidden, setNoticeHidden] = useState(() => loadRegionNoticeHidden());
  /** Show Israeli-shop prices as they'd be in Eilat (VAT-free). Estimate, off by default. */
  const [eilat, setEilat] = useState(false);
  const [noticeDismissedNow, setNoticeDismissedNow] = useState(false);
  const [priceProgress, setPriceProgress] = useState<ProgressState | null>(null);
  /** What price trackers have on record for this game, when a source keeps one. */
  const [lows, setLows] = useState<HistoryLow[]>([]);
  /** Subscriptions that already carry this game in Israel. */
  const [includedIn, setIncludedIn] = useState<Inclusion[]>([]);
  /** Re-rendered when the user says "I know" — the state itself is in storage. */
  const [ackBump, setAckBump] = useState(0);

  const refsKey = refs.map((r) => `${r.sourceId}:${r.sourceGameId}`).join('|');

  useEffect(() => {
    let live = true;
    setOffers(null);
    setError(false);
    setMeta(undefined);
    setTypes({ official: true, disc: true, keys: true });
    setRegion('all');
    setOnSale(false);
    setSort('cheap');
    setHiddenStores(new Set());
    setOnlyBuyable(false);
    setView(loadBoardView());
    setOpenStores(new Set());
    setShowAll(false);
    setNoticeDismissedNow(false);
    setEilat(false);
    setLows([]);
    setIncludedIn([]);
    setAckBump(0);
    if (refs.length === 0) {
      setOffers([]);
      setMeta(null);
      return;
    }
    setPriceProgress(null);
    // Prices arrive shop by shop, exactly like the search. Opening a game is a
    // second fan-out — who has it, then what they charge — and there is no
    // reason for the user to wait out the slowest shop twice with a blank board.
    const landed: Offer[] = [];
    let answered = 0;
    api
      .offersStream(refs, platform, (p) => {
        if (!live) return;
        landed.push(...p.offers);
        if (p.lows?.length) setLows(p.lows);
        if (p.includedIn?.length) setIncludedIn(p.includedIn);
        if (p.status.ok) answered++;
        setPriceProgress({ total: p.total, done: p.done, answered });
        // Cheapest first while it fills, so the top row is meaningful from the
        // first shop that answers rather than jumping around at the end.
        setOffers([...landed].sort((a, b) => a.priceILS - b.priceILS));
      })
      .then((r) => {
        if (!live) return;
        setOffers(r.offers);
        if (r.lows?.length) setLows(r.lows);
        if (r.includedIn?.length) setIncludedIn(r.includedIn);
      })
      .catch(() => live && setError(true));
    api.meta(refs).then((r) => live && setMeta(r.meta)).catch(() => live && setMeta(null));
    return () => {
      live = false;
    };
  }, [refsKey, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Raise the "already on a subscription" alert, if it was asked for.
   *
   * Only when the switch in Settings is on: telling somebody who does not
   * subscribe that a game is free with a subscription is noise dressed as a
   * saving, and the tool cannot know whether they subscribe. The badge on the
   * board is a different thing and always shows — that is a fact sitting beside
   * the prices, this is an interruption, and an interruption has to be asked
   * for.
   */
  const alertKey = `${title}|${platform}`;
  useEffect(() => {
    if (includedIn.length === 0) return;
    if (!shouldAlert(alertKey)) return;
    markAlerted(alertKey);
    void api.notifyGamePass(title, platform, includedIn.map((i) => i.name)).catch(() => {
      /* a failed alert must never take the board down with it */
    });
  }, [includedIn, alertKey, title, platform]);

  const all = offers ?? [];
  // Only surface a control when it can actually do something for this game.
  const cats = useMemo(() => new Set(all.map(catOf)), [all]);
  const regionsPresent = useMemo(
    () => [...new Set(all.filter((o) => o.region).map((o) => o.region as string))],
    [all]
  );
  const anyOnSale = useMemo(() => all.some(onSaleOf), [all]);
  const anyRisk = useMemo(() => boardHasRisk(all, preferred), [all, preferred]);
  const anyEilat = useMemo(() => boardHasEilatPrices(all), [all]);
  /**
   * Storefronts on this board, biggest first. A regional storefront contributes
   * ~30 rows to a PC board, so hiding one is the strongest lever the user has on
   * a long board — hence the row count on each chip.
   */
  const storeFamilies = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    for (const o of all) {
      const f = storeFamily(o.store);
      const prev = counts.get(f.key);
      if (prev) prev.count++;
      else counts.set(f.key, { ...f, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [all]);

  /** Everything the filters let through, before any layout decision. */
  const filtered = useMemo(() => {
    let list = all.filter((o) => types[catOf(o)]);
    // Region narrows the regional offers only; discs/keyshops carry no region and
    // are governed by their own type toggle.
    if (region !== 'all') list = list.filter((o) => !o.region || o.region === region);
    if (onSale) list = list.filter(onSaleOf);
    if (hiddenStores.size > 0) list = list.filter((o) => !hiddenStores.has(storeFamily(o.store).key));
    if (onlyBuyable) list = list.filter((o) => offerRisk(o, preferred).level === 'ok');
    return list;
  }, [all, types, region, onSale, hiddenStores, onlyBuyable, preferred]);

  /**
   * Whether the "only what I can buy from here" toggle can still change anything.
   *
   * Judged on what is CURRENTLY VISIBLE, not on the whole board. Once the other
   * filters have already removed every row that carries a caveat — showing only
   * discs, say, which are never region-locked — the toggle is a control that
   * does nothing, and offering it invites the user to press it and conclude the
   * tool is broken. Same reasoning as the recover button that could not recover.
   */
  const filterableRisk = useMemo(
    () => !onlyBuyable && boardHasRisk(filtered, preferred),
    [filtered, preferred, onlyBuyable]
  );

  const rows = useMemo<Row[]>(() => {
    let list = filtered;
    const byPrice = (a: Offer, b: Offer) => a.priceILS - b.priceILS;
    if (sort === 'region') {
      list = list.slice().sort((a, b) => (a.region ?? 'zzz').localeCompare(b.region ?? 'zzz') || byPrice(a, b));
    } else if (sort === 'official') {
      const rank: Record<Cat, number> = { official: 0, disc: 1, keys: 2 };
      list = list.slice().sort((a, b) => rank[catOf(a)] - rank[catOf(b)] || byPrice(a, b));
    } else {
      list = list.slice().sort(byPrice);
    }

    // `best` marks the cheapest row of everything that passed the filters, so it
    // stays meaningful whichever layout is chosen below.
    const cheapest = list.length ? Math.min(...list.map((o) => o.priceILS)) : 0;
    const make = (o: Offer, folded: Offer[] = []): Row => ({
      o,
      risk: offerRisk(o, preferred),
      cut: discountOf(o),
      best: o.priceILS === cheapest,
      folded,
    });

    // Sorting stays as chosen; only WHICH rows are shown changes per view.
    if (view === 'collapse') {
      // One row per storefront — its cheapest surviving region — with the rest
      // folded behind it. Discs keep their own row each (different shops).
      const groups = new Map<string, Offer[]>();
      for (const o of list) {
        const key = o.kind === 'physical' ? `disc:${o.store}` : storeFamily(o.store).key;
        const g = groups.get(key);
        if (g) g.push(o);
        else groups.set(key, [o]);
      }
      // Head rows race on price; an expanded store's other regions sit directly
      // under its own head rather than scattering back into the global order.
      const heads = [...groups].map(([key, group]) => {
        const sorted = group.slice().sort(byPrice);
        return { key, head: sorted[0]!, rest: sorted.slice(1) };
      });
      heads.sort((a, b) => byPrice(a.head, b.head));
      const out: Row[] = [];
      for (const h of heads) {
        out.push(make(h.head, h.rest));
        if (openStores.has(h.key)) for (const o of h.rest) out.push(make(o));
      }
      return out;
    }

    if (view === 'pinned') {
      /**
       * The DEFAULT REGION first, then everything else cheapest to dearest.
       *
       * It used to pin Israel and then the chosen region, which the label
       * described as "ישראל והמדינה שלי למעלה" — two different countries at the
       * top for a reason the reader had to guess at. If somebody has picked a
       * default region, that is the answer to "which prices are mine"; Israel
       * is only special when Israel is what they picked.
       */
      const rank = (o: Offer) =>
        preferred && (o.region === preferred || (preferred === 'IL' && o.location === 'israel')) ? 0 : 1;
      return list
        .slice()
        .sort((a, b) => rank(a) - rank(b) || byPrice(a, b))
        .map((o) => make(o));
    }

    if (view === 'top' && !showAll) return list.slice(0, TOP_N).map((o) => make(o));

    return list.map((o) => make(o));
  }, [filtered, sort, preferred, view, openStores, showAll]);

  /** Rows the "top" view is holding back, for the "show the rest" button. */
  const hiddenCount = view === 'top' && !showAll ? Math.max(0, filtered.length - TOP_N) : 0;

  const toggleType = (c: Cat) => setTypes((p) => ({ ...p, [c]: !p[c] }));
  const toggleStore = (key: string) =>
    setHiddenStores((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const toggleFold = (key: string) =>
    setOpenStores((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const dismissNotice = (forever: boolean) => {
    if (forever) saveRegionNoticeHidden(true);
    setNoticeHidden(forever);
    setNoticeDismissedNow(true);
  };

  // The settings switch silences the explanatory notices altogether — see
  // prefs.ts. Read at render rather than cached, so flipping it in Settings
  // takes effect the next time a board opens rather than on the next reload.
  const showNotice = anyRisk && !noticeHidden && !noticeDismissedNow && !loadQuietNotices();
  const absorbClass = absorb === 'active' ? 'absorbing' : absorb === 'done' ? 'absorbed' : '';

  return (
    <section
      className={`dt-panel ${absorbClass}`}
      role="region"
      aria-label={`${title} — ${platformNames[platform]}`}
    >
      <button className="dt-close" onClick={onClose} aria-label={t.depClose}>✕</button>
      <div className="dt-inner">
        <aside className="dt-game">
          {image ? <img className="dt-art" src={safeUrl(image)} alt={title} /> : <div className="dt-noart">{title}</div>}
          <h3 className="dt-title">{title}</h3>
          <div className="dt-platform">{platformNames[platform]}</div>
          {/* Switch platform without leaving the board (the grid card that used
              to carry these chips is now tucked inside here). */}
          {platforms && platforms.length > 1 && onSwitchPlatform && (
            <div className="dt-platforms">
              {platforms.map((p) => (
                <button
                  key={p}
                  className={`chip ${p} ${p === platform ? 'on' : ''}`}
                  onClick={() => onSwitchPlatform(p)}
                >
                  {platformNames[p]}
                </button>
              ))}
            </div>
          )}
          {includedIn.length > 0 && (
            /* ackBump is read here only to re-render after "I know" — the state
               itself lives in storage, not in React. */
            /* The loudest thing this board can say. Placed above the genres and
               the price summary because it can make the whole table moot: the
               cheapest price for a game you already have access to is none. */
            <div className="dt-included" title={t.includedTitle} data-ack={ackBump}>
              <span className="dt-included-mark" aria-hidden="true">✓</span>
              <div>
                <div className="dt-included-head">{t.includedHead}</div>
                <ul className="dt-included-list">
                  {includedIn.map((inc) => (
                    <li key={inc.id}>{inc.name}</li>
                  ))}
                </ul>
                <div className="dt-included-note">{t.includedNote}</div>
                {/* Only meaningful when the alerts are on: without them there is
                    nothing to acknowledge, and a button that silences something
                    that never speaks is just confusing. */}
                {loadGamePassAlerts() &&
                  (isAcknowledged(alertKey) ? (
                    <div className="dt-included-acked">{t.includedAcked}</div>
                  ) : (
                    <button
                      className="dt-included-ack"
                      onClick={() => {
                        acknowledge(alertKey);
                        setAckBump((n) => n + 1);
                      }}
                    >
                      {t.includedAck}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {meta === undefined ? (
            <p className="dt-meta-loading">{t.depMetaLoading}</p>
          ) : meta ? (
            <>
              {meta.genres.length > 0 && (
                <div className="dt-tags">
                  {meta.genres.slice(0, 6).map((g) => (
                    <span className="dt-tag" key={g}>{g}</span>
                  ))}
                </div>
              )}
              {meta.description && <p className="dt-desc">{meta.description}</p>}
            </>
          ) : null}
          <button className="dt-full" onClick={onOpenFull}>{t.depFull} ↗</button>
          {/* Add-ons live with the game, not in the price table: they are a
              different thing to buy, and mixing them into the board's rows was
              exactly the noise the DLC filter exists to remove. */}
          <DlcPanel title={title} platform={platform} />
          {/* What the rows on the left add up to. Placed with the game rather
              than above the table because it is a property of the game, and
              because a summary that scrolls away with the board is a summary
              nobody reads. */}
          {offers !== null && (
            <PriceStats
              offers={filtered}
              title={title}
              platform={platform}
              image={image}
              refs={refs}
              eilat={eilat}
              filtered={filtered.length !== all.length}
              lows={lows}
            />
          )}
        </aside>

        <div className="dt-main">
          <div className="dt-filters">
            {(['official', 'disc', 'keys'] as Cat[])
              .filter((c) => cats.has(c))
              .map((c) => (
                <button
                  key={c}
                  className={`dt-ftoggle ${types[c] ? 'on' : ''}`}
                  aria-pressed={types[c]}
                  onClick={() => toggleType(c)}
                >
                  {t.depType[c]}
                </button>
              ))}
            {regionsPresent.length > 1 && (
              <select
                className="dt-fselect"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                aria-label={t.depRegionLabel}
              >
                <option value="all">{t.depRegionAll}</option>
                {regionsPresent.includes(preferred) && (
                  <option value={preferred}>{t.depMyRegion(regionLabel(preferred) ?? preferred)}</option>
                )}
                {regionsPresent.map((r) => (
                  <option key={r} value={r}>{regionLabel(r) ?? r}</option>
                ))}
              </select>
            )}
            {anyOnSale && (
              <button
                className={`dt-ftoggle ${onSale ? 'on' : ''}`}
                aria-pressed={onSale}
                onClick={() => setOnSale((v) => !v)}
              >
                {t.depOnSale}
              </button>
            )}
            {(filterableRisk || onlyBuyable) && (
              <button
                className={`dt-ftoggle ${onlyBuyable ? 'on' : ''}`}
                aria-pressed={onlyBuyable}
                onClick={() => setOnlyBuyable((v) => !v)}
                title={t.depOnlyBuyableHint(regionLabel(preferred) ?? preferred)}
              >
                {t.depOnlyBuyable}
                {/* The name alone does not say WHICH "here" it means. The mark
                    carries the full explanation, including that "here" is the
                    country chosen in Settings — the one thing that changes what
                    this button does. */}
                <span
                  className="dt-help"
                  role="img"
                  aria-label={t.depOnlyBuyableHint(regionLabel(preferred) ?? preferred)}
                  title={t.depOnlyBuyableHint(regionLabel(preferred) ?? preferred)}
                >
                  ?
                </span>
              </button>
            )}
            {anyEilat && (
              <button
                className={`dt-ftoggle ${eilat ? 'on' : ''}`}
                aria-pressed={eilat}
                onClick={() => setEilat((v) => !v)}
                title={t.depEilatHint}
              >
                {t.depEilat}
              </button>
            )}
            <select
              className="dt-fselect dt-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label={t.depSortLabel}
            >
              <option value="cheap">{t.depSortCheap}</option>
              <option value="region">{t.depSortRegion}</option>
              <option value="official">{t.depSortOfficial}</option>
            </select>
          </div>

          {/* Per-storefront switches. Only worth showing when there's more than
              one storefront to choose between. */}
          {storeFamilies.length > 1 && (
            <div className="dt-stores" role="group" aria-label={t.depStoresLabel}>
              <span className="dt-stores-label">{t.depStoresLabel}</span>
              {storeFamilies.map((f) => {
                const on = !hiddenStores.has(f.key);
                return (
                  <button
                    key={f.key}
                    className={`dt-store ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleStore(f.key)}
                  >
                    {f.label}
                    <span className="dt-store-n">{f.count}</span>
                  </button>
                );
              })}
              {hiddenStores.size > 0 && (
                <button className="dt-store-reset" onClick={() => setHiddenStores(new Set())}>
                  {t.depStoresAll}
                </button>
              )}
            </div>
          )}

          {/* What buying from another region actually involves. Informational —
              nothing here prevents the user from choosing any row they want. */}
          {showNotice && (
            <div className="dt-risk-note" role="note">
              <strong className="dt-risk-title">⚠️ {t.depRiskTitle}</strong>
              <p>{t.depRiskBody}</p>
              <p>{t.depRiskWhatHappens}</p>
              <p className="dt-risk-disclaimer">{t.depRiskDisclaimer}</p>
              <div className="dt-risk-actions">
                <button className="dt-risk-ok" onClick={() => dismissNotice(false)}>{t.depRiskGotIt}</button>
                <label className="dt-risk-never">
                  <input type="checkbox" onChange={(e) => dismissNotice(e.target.checked)} />
                  {t.depRiskDismiss}
                </label>
              </div>
            </div>
          )}

          {eilat && (
            <div className="dt-eilat-note" role="note">
              <strong>{t.depEilatTitle}</strong>
              <p>{t.depEilatBody}</p>
              <p>{t.depEilatBody2}</p>
            </div>
          )}

          <SearchProgressBar
            progress={showProgress ? priceProgress : null}
            blink={progressBlink}
            onHidden={() => setPriceProgress(null)}
          />

          <div className="dep-board">
            {error ? (
              <div className="dep-msg">{t.depError}</div>
            ) : offers === null ? (
              <div className="dep-msg dep-pulse">{t.depLoading}</div>
            ) : all.length === 0 ? (
              <div className="dep-msg">{t.depEmpty}</div>
            ) : rows.length === 0 ? (
              <div className="dep-msg">{t.depNoMatch}</div>
            ) : (
              <>
                <div className="dep-head">
                  <span>{t.depColStore}</span>
                  <span>{t.depColRegion}</span>
                  <span>{t.depColPrice}</span>
                  <span className="dep-sale">{t.depColSale}</span>
                  <span className="dep-go-head">{t.depColGo}</span>
                </div>
                <div className="dep-rows">
                  {rows.map(({ o, risk, cut, best, folded }, i) => {
                    const famKey = o.kind === 'physical' ? `disc:${o.store}` : storeFamily(o.store).key;
                    const expanded = openStores.has(famKey);
                    return (
                      <div
                        className={`dep-row ${best ? 'best' : ''} ${risk.level !== 'ok' ? 'risky' : ''}`}
                        key={`${o.store}-${o.region ?? o.kind}-${i}`}
                        style={{ animationDelay: `${220 + Math.min(i, 12) * 55}ms` }}
                        title={
                          [
                            o.regionName ? `${cleanStoreName(o.store)} · ${o.regionName}` : cleanStoreName(o.store),
                            eilat && eilatSaving(o) != null ? t.depEilatSaving(eilatSaving(o)!) : null,
                            risk.detail,
                          ]
                            .filter(Boolean)
                            .join('\n\n')
                        }
                      >
                        <span className="dep-where">
                          {cleanStoreName(o.store)}
                          {risk.badge && <span className={`dep-risk ${risk.level}`}>{risk.badge}</span>}
                          {folded.length > 0 && (
                            <button
                              className="dep-fold"
                              aria-expanded={expanded}
                              onClick={() => toggleFold(famKey)}
                            >
                              {expanded ? t.depFewerRegions : t.depMoreRegions(folded.length)}
                            </button>
                          )}
                        </span>
                        <span className="dep-flap" title={codeHint(o)}>
                          {codeFor(o)}
                        </span>
                        <span className="dep-flap amber">
                          {eilat && eilatPrice(o) != null ? nis(eilatPrice(o)!) : nis(o.priceILS)}
                          {eilat &&
                            (eilatPrice(o) != null ? (
                              <span className="dep-eilat">{t.depEilatBadge}</span>
                            ) : (
                              <span className="dep-eilat none">{t.depEilatNone}</span>
                            ))}
                        </span>
                        <span className={`dep-flap dep-sale ${cut > 0 ? 'down' : 'flat'}`}>
                          {cut > 0 ? `-${cut}%` : '—'}
                        </span>
                        {/* The point of the whole board: the row has to take you
                            to the listing. The anchor covers the row (see
                            .dep-go::after) so the target is the row, not a 12px
                            arrow — the fold button sits above it and still
                            works. A row whose source gave no link says so
                            rather than pretending to be clickable. */}
                        {o.url ? (
                          <a
                            className="dep-go"
                            href={safeUrl(o.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t.depGoAria(cleanStoreName(o.store), nis(o.priceILS))}
                          >
                            <span aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <span className="dep-go none" title={t.depNoLink} aria-label={t.depNoLink}>
                            —
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {hiddenCount > 0 && (
                  <button className="dep-showall" onClick={() => setShowAll(true)}>
                    {t.depShowRest(hiddenCount)}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
