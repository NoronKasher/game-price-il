import { useMemo, useRef, useState } from 'react';
import { nis, t } from './he';
import { regionByMarket } from './regions';
import type { HistoryPoint } from './types';

/**
 * A dependency-free SVG line chart of a game's price over time (₪). The lowest
 * point is highlighted (the best moment to have bought). Renders responsively
 * inside its container.
 */
export function PriceGraph({ history }: { history: HistoryPoint[] }) {
  const pts = useMemo(
    () => [...history].sort((a, b) => a.checked_at.localeCompare(b.checked_at)),
    [history]
  );

  if (pts.length < 2) {
    return (
      <div className="graph-empty">
        {pts.length === 1 ? t.graphOnePoint(nis(pts[0]!.price_ils)) : t.graphNoData}
      </div>
    );
  }

  // Geometry (viewBox units; scales responsively via CSS width).
  const W = 640;
  const H = 220;
  const padL = 8;
  const padR = 8;
  const padT = 18;
  const padB = 28;

  const prices = pts.map((p) => p.price_ils);
  const times = pts.map((p) => new Date(p.checked_at + 'Z').getTime());
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const minT = times[0]!;
  const maxT = times[times.length - 1]!;
  const spanP = maxP - minP || 1;
  const spanT = maxT - minT || 1;

  const x = (ti: number) => padL + ((ti - minT) / spanT) * (W - padL - padR);
  const y = (p: number) => padT + (1 - (p - minP) / spanP) * (H - padT - padB);

  const line = pts.map((p, i) => `${x(times[i]!).toFixed(1)},${y(p.price_ils).toFixed(1)}`).join(' ');
  const area = `${padL},${H - padB} ${line} ${W - padR},${H - padB}`;

  const lowIdx = prices.indexOf(minP);
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const fmtDate = (iso: string) => new Date(iso + 'Z').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });

  return (
    <div className="graph-wrap">
      <svg className="graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <polygon points={area} className="g-area" />
        <polyline points={line} className="g-line" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(times[i]!)}
            cy={y(p.price_ils)}
            r={i === lowIdx ? 5 : 3}
            className={i === lowIdx ? 'g-dot-low' : 'g-dot'}
          />
        ))}
        {/* lowest-price label */}
        <text x={x(times[lowIdx]!)} y={y(minP) - 9} className="g-label-low" textAnchor="middle">
          {nis(minP)}
        </text>
      </svg>
      <div className="graph-axis">
        <span>
          {fmtDate(first.checked_at)} · {nis(first.price_ils)}
        </span>
        <span className="g-low-legend">▼ {t.graphLowest}: {nis(minP)}</span>
        <span>
          {fmtDate(last.checked_at)} · <b>{nis(last.price_ils)}</b>
        </span>
      </div>
    </div>
  );
}

/* ────────────────── multi-series graph (expanded tracking panel) ──────────────────
 *
 * Every price the tool records is drawn, not just the cheapest: one line per
 * official-store region (the preferred region emphasised in amber), one for the
 * cheapest disc, one for the cheapest key seller. The old graph collapsed all of
 * that into "cheapest + preferred", so a store jumping ₪229→₪629 was invisible
 * whenever it wasn't the cheapest — the "prices changed but the graph stayed
 * flat" bug. Legend chips toggle lines; hovering shows every visible price at
 * the nearest check. Dependency-free SVG, PNG export preserved.
 */

const AMBER = '#ffc14d';
const DISC_COLOR = '#7ee0a3';
const KEYS_COLOR = '#c792ea';
/** Colors for non-preferred region lines, cycled in order of appearance. */
const REGION_COLORS = ['#4db8ff', '#62d9d9', '#9aa7ff', '#ff9d76', '#5fb4e8', '#e58fb1', '#8fd18c', '#d8b25c'];
/** A second palette for individual-store lines, so they never mimic a region line. */
const STORE_COLORS = ['#f2789f', '#8bd450', '#ffb26b', '#6bc5ff', '#d9a7ff', '#ffd93d', '#7de3c8', '#c9905a', '#a3b8ff', '#ff8f6b'];

/** localStorage key for the per-store-lines toggle (an opt-in power view). */
const SHOW_STORES_LS = 'vgpt_graph_show_stores';

interface SeriesPt {
  t: number;
  p: number;
}

interface Series {
  key: string;
  label: string;
  color: string;
  /** Solid amber line = the preferred region; everything else is context. */
  emphasis: boolean;
  /** Individual-store lines are drawn thinner so the bucket lines keep the lead. */
  thin?: boolean;
  dash?: string;
  points: SeriesPt[];
  byTime: Map<number, number>;
}

/** Cheapest price per check across a set of history rows, oldest first. */
function cheapestPerCheck(rows: HistoryPoint[]): SeriesPt[] {
  const byCheck = new Map<string, number>();
  for (const r of rows) {
    const cur = byCheck.get(r.checked_at);
    if (cur == null || r.price_ils < cur) byCheck.set(r.checked_at, r.price_ils);
  }
  return [...byCheck.entries()]
    .map(([iso, p]) => ({ t: new Date(iso.replace(' ', 'T') + 'Z').getTime(), p }))
    .sort((a, b) => a.t - b.t);
}

const withIndex = (points: SeriesPt[]): Map<number, number> =>
  new Map(points.map((d) => [d.t, d.p]));

/** Round-numbered y-axis tick values covering [min, max]. */
function priceTicks(min: number, max: number, want = 4): number[] {
  if (max <= min) return [min];
  const step0 = (max - min) / want;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (max - min) / s <= want) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

export function TrackGraph({
  history,
  preferredRegion,
  preferredName,
}: {
  history: HistoryPoint[];
  preferredRegion: string | null;
  preferredName: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hoverT, setHoverT] = useState<number | null>(null);
  // Opt-in extra layer: a line per individual store ON TOP of the bucket lines
  // (cheapest disc / cheapest key seller stay drawn either way). Persisted so a
  // user who thinks in stores keeps their view.
  const [showStores, setShowStores] = useState(() => {
    try {
      return localStorage.getItem(SHOW_STORES_LS) === '1';
    } catch {
      return false;
    }
  });
  const toggleStores = () =>
    setShowStores((v) => {
      try {
        localStorage.setItem(SHOW_STORES_LS, v ? '0' : '1');
      } catch {
        /* private mode — the toggle still works for the session */
      }
      return !v;
    });

  const series = useMemo<Series[]>(() => {
    const out: Series[] = [];
    // Official stores: one line per region, preferred first (it reads as "my line").
    const regions = [...new Set(history.filter((h) => h.region).map((h) => h.region as string))];
    regions.sort((a, b) => (a === preferredRegion ? -1 : b === preferredRegion ? 1 : a.localeCompare(b)));
    let colorIdx = 0;
    for (const r of regions) {
      const points = cheapestPerCheck(history.filter((h) => h.region === r));
      const meta = regionByMarket.get(r);
      const emphasis = r === preferredRegion;
      out.push({
        key: `region:${r}`,
        label: `${meta?.flag ?? '☁️'} ${meta?.nameHe ?? r}`,
        color: emphasis ? AMBER : REGION_COLORS[colorIdx++ % REGION_COLORS.length]!,
        emphasis,
        points,
        byTime: withIndex(points),
      });
    }
    const disc = cheapestPerCheck(history.filter((h) => h.kind === 'physical'));
    if (disc.length > 0) {
      out.push({
        key: 'disc',
        label: `💿 ${t.kindDiscShort}`,
        color: DISC_COLOR,
        emphasis: false,
        dash: '7 4',
        points: disc,
        byTime: withIndex(disc),
      });
    }
    const keys = cheapestPerCheck(history.filter((h) => h.kind === 'digital' && !h.region));
    if (keys.length > 0) {
      out.push({
        key: 'keys',
        label: `🔑 ${t.kindKeyshopShort}`,
        color: KEYS_COLOR,
        emphasis: false,
        dash: '2 4',
        points: keys,
        byTime: withIndex(keys),
      });
    }

    // Opt-in: every individual store as its own thin line, ON TOP of the bucket
    // lines above (never instead of them). This is where a single store's move
    // shows even when it isn't the bucket's cheapest — e.g. one disc shop
    // spiking while another stays the cheapest kept the disc line flat.
    // Region lines already are one-store-per-line, so only the disc and
    // key-seller buckets (where several stores hide behind one line) expand.
    if (showStores) {
      const storeSeries: Series[] = [];
      let storeIdx = 0;
      for (const [bucket, icon] of [
        [(h: HistoryPoint) => h.kind === 'physical', '💿'],
        [(h: HistoryPoint) => h.kind === 'digital' && !h.region, '🔑'],
      ] as const) {
        const rows = history.filter(bucket);
        for (const store of [...new Set(rows.map((r) => r.store))]) {
          const points = cheapestPerCheck(rows.filter((r) => r.store === store));
          storeSeries.push({
            key: `store:${icon}:${store}`,
            label: `${icon} ${store}`,
            color: STORE_COLORS[storeIdx++ % STORE_COLORS.length]!,
            emphasis: false,
            thin: true,
            points,
            byTime: withIndex(points),
          });
        }
      }
      // Cheapest-today first, so the legend reads like the store board.
      storeSeries.sort(
        (a, b) => (a.points[a.points.length - 1]?.p ?? 0) - (b.points[b.points.length - 1]?.p ?? 0)
      );
      out.push(...storeSeries);
    }
    return out;
  }, [history, preferredRegion, showStores]);

  const visible = series.filter((s) => !hidden.has(s.key));
  const allPts = visible.flatMap((s) => s.points);
  const checkTimes = [...new Set(allPts.map((d) => d.t))].sort((a, b) => a - b);

  if (checkTimes.length < 2) {
    const only = allPts[0];
    return (
      <div className="graph-empty">
        {history.length === 0 ? t.graphNoData : t.graphOnePoint(nis(only?.p ?? 0))}
      </div>
    );
  }

  // Wider right pad hosts the price axis — in RTL the eye starts there.
  const W = 680, H = 260, padL = 10, padR = 56, padT = 16, padB = 30;
  const minP = Math.min(...allPts.map((d) => d.p));
  const maxP = Math.max(...allPts.map((d) => d.p));
  const minT = checkTimes[0]!;
  const maxT = checkTimes[checkTimes.length - 1]!;
  const sp = maxP - minP || 1;
  const st = maxT - minT || 1;
  const X = (ti: number) => padL + ((ti - minT) / st) * (W - padL - padR);
  const Y = (p: number) => padT + (1 - (p - minP) / sp) * (H - padT - padB);
  const poly = (pts: SeriesPt[]) => pts.map((d) => `${X(d.t).toFixed(1)},${Y(d.p).toFixed(1)}`).join(' ');

  // Axis ticks. When every check happened within two days, dates alone would
  // repeat — show the hour instead so the axis still says something true.
  const shortSpan = maxT - minT < 48 * 3600 * 1000;
  const fmtTick = (ms: number) =>
    shortSpan
      ? new Date(ms).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : new Date(ms).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  const xTickCount = Math.min(4, checkTimes.length);
  const xTicks = [...new Set(
    Array.from({ length: xTickCount }, (_, i) => minT + (st * i) / Math.max(1, xTickCount - 1))
  )];
  const yTicks = priceTicks(minP, maxP);

  // Lowest visible price ever — the "should have bought then" marker. Its label
  // is centered on the point, so clamp it into the plot area (a low at the very
  // first/last check would otherwise slide off the edge and truncate).
  const low = allPts.reduce((a, b) => (b.p < a.p ? b : a));
  const lowLabelX = Math.min(Math.max(X(low.t), padL + 34), W - padR - 34);
  /** Tick labels drop a redundant ".00" so the axis stays quiet. */
  const tickLabel = (v: number) => nis(Math.round(v)).replace('.00', '');

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // Map the cursor to viewBox x, then invert X() back to a time, and snap to
    // the nearest recorded check (prices only exist at checks).
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const time = minT + ((vx - padL) / (W - padL - padR)) * st;
    let nearest = checkTimes[0]!;
    for (const c of checkTimes) if (Math.abs(c - time) < Math.abs(nearest - time)) nearest = c;
    setHoverT(nearest);
  };

  const hoverRows = hoverT == null ? [] : visible
    .map((s) => ({ s, p: s.byTime.get(hoverT) }))
    .filter((r): r is { s: Series; p: number } => r.p != null)
    .sort((a, b) => a.p - b.p);

  const downloadPng = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#141a22';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'price-graph.png';
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  };

  return (
    <div className="graph-wrap">
      <svg
        ref={svgRef}
        className="graph"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverT(null)}
      >
        {/* y gridlines + price labels (on the right — RTL reads from there) */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} className="g-grid" />
            <text x={W - padR + 6} y={Y(v) + 3.5} className="g-axis-label">
              {tickLabel(v)}
            </text>
          </g>
        ))}
        {/* x date labels */}
        {xTicks.map((ms) => (
          <text key={ms} x={X(ms)} y={H - 8} textAnchor="middle" className="g-axis-label">
            {fmtTick(ms)}
          </text>
        ))}

        {/* context lines first, the preferred (amber) line drawn on top */}
        {[...visible].sort((a, b) => Number(a.emphasis) - Number(b.emphasis)).map((s) => (
          <g key={s.key} opacity={s.emphasis ? 1 : s.thin ? 0.7 : 0.8}>
            <polyline
              points={poly(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.emphasis ? 3 : s.thin ? 1.2 : 1.8}
              strokeDasharray={s.dash}
            />
            {s.points.map((d, i) => (
              <circle
                key={i}
                cx={X(d.t)}
                cy={Y(d.p)}
                r={hoverT === d.t ? 4.5 : s.emphasis ? 3.2 : s.thin ? 1.8 : 2.4}
                fill={s.color}
              />
            ))}
          </g>
        ))}

        {/* lowest price ever seen (among visible lines) */}
        <text x={lowLabelX} y={Y(low.p) - 8} textAnchor="middle" className="g-label-low">
          ▼ {nis(low.p)}
        </text>

        {/* hover guide */}
        {hoverT != null && (
          <line x1={X(hoverT)} x2={X(hoverT)} y1={padT} y2={H - padB} className="g-hover-line" />
        )}
      </svg>

      {hoverT != null && hoverRows.length > 0 && (
        <div
          className="graph-tooltip"
          // Clamped away from both edges so the box always stays inside the
          // panel (the UI-borders rule: floating layers never widen the layout).
          style={{ left: `clamp(15%, ${((X(hoverT) / W) * 100).toFixed(1)}%, 85%)` }}
          dir="rtl"
        >
          <div className="gt-date">{fmtTick(hoverT)}</div>
          {hoverRows.map(({ s, p }) => (
            <div key={s.key} className="gt-row">
              <i style={{ background: s.color }} />
              <span className="gt-label">{s.label}</span>
              <b className="num">{nis(p)}</b>
            </div>
          ))}
        </div>
      )}

      <div className="graph-legend">
        {series.map((s) => (
          <button
            key={s.key}
            className={`legend-chip ${s.thin ? 'thin' : ''} ${hidden.has(s.key) ? 'off' : ''}`}
            onClick={() => toggle(s.key)}
            title={t.graphLegendHint}
          >
            <i style={{ background: s.color }} />
            {s.label}
            {s.emphasis && preferredName ? ` · ${t.seriesPreferred}` : ''}
          </button>
        ))}
        {/* Master switch for the per-store layer — additive, never replaces the buckets. */}
        <button
          className={`legend-chip stores-master ${showStores ? 'on' : ''}`}
          onClick={toggleStores}
          title={t.graphShowStoresHint}
        >
          🏪 {t.graphShowStores}
        </button>
        <button className="toolbtn" onClick={downloadPng}>🖼️ {t.exportGraphImage}</button>
      </div>
      <p className="graph-hint">{t.graphHint}</p>
    </div>
  );
}
