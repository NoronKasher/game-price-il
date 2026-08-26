import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { nis, t } from './he';
import type { TickerDeal } from './types';

/**
 * Today's deals, as a page rather than a strip.
 *
 * The ticker is a glance: it moves, it holds fifteen, and reading one properly
 * means chasing it or hovering to freeze it. That is the right shape for
 * something at the top of every screen and the wrong shape for browsing. This
 * is the same feed standing still, with room for more of it and the numbers
 * lined up so they can be compared down a column.
 *
 * It costs nothing extra: the deals come from CheapShark's own JSON API, the
 * one call in this whole tool that scrapes nothing at all.
 *
 * Clicking a deal SEARCHES for it rather than linking out. The price here is
 * one shop's; the point of this tool is the other fifteen, and handing somebody
 * straight to the first seller who caught their eye would be the one thing a
 * price comparison should never do.
 */

/** More than the strip carries, still one screenful on a laptop. */
const PAGE_SIZE = 40;

type Sort = 'discount' | 'price' | 'rating';

export function DealsView({ onPick }: { onPick: (title: string) => void }) {
  const [deals, setDeals] = useState<TickerDeal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<Sort>('discount');

  useEffect(() => {
    let live = true;
    api
      .ticker(PAGE_SIZE)
      .then((r) => live && setDeals(r.deals))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const sorted = useMemo(() => {
    const list = [...(deals ?? [])];
    if (sort === 'price') return list.sort((a, b) => a.salePrice - b.salePrice);
    if (sort === 'rating') return list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return list.sort((a, b) => b.savings - a.savings);
  }, [deals, sort]);

  if (failed) return <div className="empty">{t.dealsFailed}</div>;
  if (!deals) return <p className="settings-intro">{t.dealsLoading}</p>;
  if (deals.length === 0) return <div className="empty">{t.dealsEmpty}</div>;

  return (
    <section>
      <h2 className="deals-title">{t.dealsTitle}</h2>
      <p className="deals-intro">{t.dealsIntro}</p>

      <div className="deals-sort">
        {(['discount', 'price', 'rating'] as Sort[]).map((key) => (
          <button
            key={key}
            className={`deals-sort-btn ${sort === key ? 'on' : ''}`}
            aria-pressed={sort === key}
            onClick={() => setSort(key)}
          >
            {t.dealsSort[key]}
          </button>
        ))}
      </div>

      <ul className="deals-grid">
        {sorted.map((d, i) => (
          <li key={`${d.title}-${i}`}>
            <button className="deal-card" title={t.dealsCardHint} onClick={() => onPick(d.title)}>
              <span className="deal-card-title">{d.title}</span>
              <span className="deal-card-prices">
                <span className="deal-card-now">{nis(d.salePrice)}</span>
                {d.normalPrice > d.salePrice && (
                  <span className="deal-card-was">{nis(d.normalPrice)}</span>
                )}
                <span className="deal-card-pct">{d.savings}%-</span>
              </span>
              {/* Steam's own positive-review percentage, when the feed has it.
                  Shown because a 90%-off game nobody liked is not a deal. */}
              {d.rating != null && <span className="deal-card-rating">{t.dealsRating(d.rating)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="deals-note">{t.dealsNote}</p>
    </section>
  );
}
