import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { nis, t } from './he';
import { cleanStoreName, regionLabel } from './source';
import { eilatPrice } from './eilat';
import type { HistoryPoint, Offer, Platform, SourceRef } from './types';

/**
 * What the board's prices add up to, under the game it belongs to.
 *
 * The table answers "where can I buy this"; it does not answer "is this a lot of
 * money for this game", which is the question people actually arrive with. That
 * used to be answered by the full game page's history section — and when the
 * departure board became what opening a game shows, the answer quietly stopped
 * appearing. Twelve rows of numbers with nothing summarising them is data, not
 * an answer.
 *
 * Everything here is derived from offers the board already has, so it costs no
 * request and works for EVERY game, tracked or not. The one thing it fetches is
 * the recorded price history, which is a local database read — no store is
 * touched by opening a game.
 *
 * IT DELIBERATELY DOES NOT JUDGE. The app has one verdict engine
 * (server/src/verdict.ts) with real rules about exchange-rate wobble and how
 * much history counts as evidence. A second, simpler "cheapest ever!" written
 * here would eventually contradict it on the same screen, and the one that is
 * wrong would be this one. So this states what was recorded and what is on offer
 * now, and lets the two numbers sit next to each other.
 */

interface Stats {
  low: Offer;
  high: Offer;
  median: number;
  stores: number;
  count: number;
  /** The cheapest offer sold from Israel, when the game is sold here at all. */
  israeli: Offer | null;
}

/** The price a row is actually SHOWING, so the summary can never disagree with the table. */
function shownPrice(o: Offer, eilat: boolean): number {
  return eilat ? (eilatPrice(o) ?? o.priceILS) : o.priceILS;
}

function isIsraeli(o: Offer): boolean {
  return o.region === 'IL' || o.location === 'israel';
}

function summarise(offers: Offer[], eilat: boolean): Stats | null {
  const priced = offers.filter((o) => o.priceILS > 0);
  if (priced.length === 0) return null;

  const sorted = [...priced].sort((a, b) => shownPrice(a, eilat) - shownPrice(b, eilat));
  const mid = Math.floor(sorted.length / 2);
  // The middle value, not the mean: one $2 Argentinian listing drags an average
  // somewhere no real row sits, and "typical" is the thing being asked for.
  const median =
    sorted.length % 2 === 1
      ? shownPrice(sorted[mid]!, eilat)
      : (shownPrice(sorted[mid - 1]!, eilat) + shownPrice(sorted[mid]!, eilat)) / 2;

  const israeliRows = sorted.filter(isIsraeli);

  return {
    low: sorted[0]!,
    high: sorted[sorted.length - 1]!,
    median,
    stores: new Set(priced.map((o) => cleanStoreName(o.store))).size,
    count: priced.length,
    israeli: israeliRows[0] ?? null,
  };
}

/** Where a row is, in as few words as the row itself uses. */
function whereOf(o: Offer): string {
  const region = regionLabel(o.region);
  const store = cleanStoreName(o.store);
  return region ? `${store} · ${region}` : store;
}

/**
 * A price line small enough to sit in a 300px column.
 *
 * Not the full PriceGraph: that one carries dated axis labels and per-point
 * markers, and squeezed to a third of its width it becomes an illegible version
 * of a chart the full game page already shows properly. This says only "which
 * way, and how far", which is all there is room to say honestly.
 */
function Sparkline({ points }: { points: HistoryPoint[] }) {
  const W = 240;
  const H = 44;
  const pad = 3;

  const prices = points.map((p) => p.price_ils);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;

  const xy = points.map((p, i) => [pad + i * step, pad + (1 - (p.price_ils - min) / span) * (H - pad * 2)]);
  const line = xy.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ');
  const lowIndex = prices.indexOf(min);

  return (
    <svg className="pstat-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <polygon className="pstat-spark-area" points={`${pad},${H - pad} ${line} ${W - pad},${H - pad}`} />
      <polyline className="pstat-spark-line" points={line} />
      <circle className="pstat-spark-low" cx={xy[lowIndex]![0]} cy={xy[lowIndex]![1]} r="3" />
    </svg>
  );
}

export function PriceStats({
  offers,
  title,
  platform,
  image,
  refs,
  eilat,
  filtered,
}: {
  /** The offers currently passing the board's filters — what the user can see. */
  offers: Offer[];
  title: string;
  platform: Platform;
  image?: string;
  /** Needed to start tracking from here — the panel is where people ask to. */
  refs: SourceRef[];
  eilat: boolean;
  /** True when filters are hiding something, so the numbers can say what they cover. */
  filtered: boolean;
}) {
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [tracked, setTracked] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // The tracked history, if this game has any. A local database read: opening a
  // game must never cost a store a request it did not already need.
  useEffect(() => {
    let live = true;
    setHistory(null);
    setTracked(null);
    api
      .trackStatus(title, platform)
      .then((r) => {
        if (!live) return;
        setHistory(r.history ?? []);
        setTracked(r.tracked);
      })
      .catch(() => {
        if (!live) return;
        setHistory([]);
        setTracked(false);
      });
    return () => {
      live = false;
    };
  }, [title, platform]);

  const stats = useMemo(() => summarise(offers, eilat), [offers, eilat]);

  /** One reading per check, oldest first — the shape a line wants. */
  const points = useMemo(() => {
    if (!history) return [];
    return [...history]
      .filter((p) => p.price_ils > 0)
      .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
      .slice(-40);
  }, [history]);

  if (!stats) return null;

  const lowPrice = shownPrice(stats.low, eilat);
  const highPrice = shownPrice(stats.high, eilat);
  const gap = highPrice - lowPrice;
  const gapPct = lowPrice > 0 ? Math.round((gap / lowPrice) * 100) : 0;

  const israeliPrice = stats.israeli ? shownPrice(stats.israeli, eilat) : null;
  // How much more the Israeli shelf costs than the cheapest row on the board —
  // the number this whole tool exists to put in front of an Israeli buyer.
  const israeliOver =
    israeliPrice != null && lowPrice > 0 && israeliPrice > lowPrice
      ? Math.round(((israeliPrice - lowPrice) / lowPrice) * 100)
      : null;

  const recordedLow = points.length > 0 ? Math.min(...points.map((p) => p.price_ils)) : null;
  const recordedAt = recordedLow != null ? points.find((p) => p.price_ils === recordedLow)?.checked_at : undefined;

  return (
    <section className="pstat" aria-label={t.statsTitle}>
      <h4 className="pstat-title">{t.statsTitle}</h4>

      <dl className="pstat-rows">
        <div className="pstat-row best">
          <dt>{t.statsLow}</dt>
          <dd>
            <span className="pstat-num">{nis(lowPrice)}</span>
            <span className="pstat-where">{whereOf(stats.low)}</span>
          </dd>
        </div>
        <div className="pstat-row">
          <dt>{t.statsMedian}</dt>
          <dd>
            <span className="pstat-num">{nis(stats.median)}</span>
          </dd>
        </div>
        <div className="pstat-row">
          <dt>{t.statsHigh}</dt>
          <dd>
            <span className="pstat-num">{nis(highPrice)}</span>
            <span className="pstat-where">{whereOf(stats.high)}</span>
          </dd>
        </div>
        {gap > 0 && (
          <div className="pstat-row spread">
            <dt>{t.statsSpread}</dt>
            <dd>
              <span className="pstat-num">{nis(gap)}</span>
              <span className="pstat-where">{t.statsSpreadPct(gapPct)}</span>
            </dd>
          </div>
        )}
      </dl>

      <p className="pstat-count">
        {t.statsCount(stats.count, stats.stores)}
        {filtered && <span className="pstat-filtered"> · {t.statsFiltered}</span>}
      </p>

      {israeliPrice != null && (
        <p className="pstat-israel">
          {/* Sold here as well: the comparison the board is really for. */}
          <span className="pstat-israel-label">{t.statsIsrael}</span>
          <span className="pstat-num">{nis(israeliPrice)}</span>
          {israeliOver != null ? (
            <span className="pstat-israel-over">{t.statsIsraelOver(israeliOver)}</span>
          ) : (
            <span className="pstat-israel-best">{t.statsIsraelBest}</span>
          )}
        </p>
      )}

      {points.length >= 2 && recordedLow != null && (
        <div className="pstat-history">
          <Sparkline points={points} />
          <p className="pstat-recorded">
            {t.statsRecordedLow(nis(recordedLow), recordedAt ? whenOf(recordedAt) : '')}
          </p>
          <p className="pstat-checks">{t.statsChecks(points.length)}</p>
        </div>
      )}
      {points.length === 1 && <p className="pstat-checks">{t.statsOneCheck}</p>}
      {history !== null && points.length === 0 && <p className="pstat-checks">{t.statsNoHistory}</p>}

      {/* The panel told people to start tracking and then gave them no way to.
          An instruction with no control is worse than no instruction. */}
      {tracked === false && refs.length > 0 && (
        <button
          className="pstat-track"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              const r = await api.track({ title, platform, image, refs });
              setHistory(r.history ?? []);
              setTracked(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? t.tracking : t.statsTrackThis}
        </button>
      )}
      {tracked && <p className="pstat-tracked">{t.statsTracked}</p>}
    </section>
  );
}

/** "12 באוגוסט" — the history is months long, so the day and month is enough. */
function whenOf(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
}
