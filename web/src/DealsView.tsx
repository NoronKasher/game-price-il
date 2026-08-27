import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/** One screenful, roughly. Small enough that the first paint is quick. */
const PAGE_SIZE = 24;

type Sort = 'discount' | 'price' | 'rating';

export function DealsView({ onPick }: { onPick: (title: string) => void }) {
  const [deals, setDeals] = useState<TickerDeal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<Sort>('discount');
  const [atEnd, setAtEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  /**
   * WHY THE PAGE CURSOR IS A REF AND NOT STATE.
   *
   * The first attempt kept it in state, and the list stopped dead after one
   * page. The sentinel sits 600px below the fold, so on a short first page it
   * is already intersecting the moment it mounts — which is before the first
   * request has resolved and before any setState from it has landed. The
   * observer therefore fired with the cursor still reading 0 and asked for page
   * 0 a second time; every row came back a duplicate, that looked exactly like
   * "the feeds are exhausted", and the list declared itself finished with two
   * thousand more deals behind it.
   *
   * A ref is updated synchronously, so the second caller sees the first
   * caller's page number even within the same tick. `busy` is a ref for the
   * same reason: a `loadingMore` state guard is checked against a value that
   * has not been committed yet.
   */
  const pageRef = useRef(0);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  /**
   * How many consecutive pages added nothing new.
   *
   * A single duplicate page is not the end — the feeds overlap, and one of them
   * can repeat while another still has plenty. Two in a row is.
   */
  const staleRunRef = useRef(0);

  const loadMore = useCallback(async () => {
    if (busyRef.current || doneRef.current) return;
    busyRef.current = true;
    setLoadingMore(true);
    const page = pageRef.current;
    try {
      const r = await api.deals(page, PAGE_SIZE);
      pageRef.current = page + 1;

      // An empty response is the end, flatly. Anything else is judged on
      // whether it added something we did not already have.
      if (r.deals.length === 0) {
        doneRef.current = true;
        setAtEnd(true);
      }
      setDeals((prev) => {
        const have = new Set((prev ?? []).map((d) => d.title.toLowerCase()));
        const fresh = r.deals.filter((d) => !have.has(d.title.toLowerCase()));
        staleRunRef.current = fresh.length === 0 ? staleRunRef.current + 1 : 0;
        if (staleRunRef.current >= 2) {
          doneRef.current = true;
          setAtEnd(true);
        }
        return [...(prev ?? []), ...fresh];
      });
    } catch {
      // One failed page stops the scrolling rather than emptying the screen:
      // everything already loaded is still there and still useful.
      doneRef.current = true;
      setAtEnd(true);
      setFailed(true);
    } finally {
      busyRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  // The first page.
  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  /**
   * Load the next page when the bottom of the list comes into view.
   *
   * An observer rather than a scroll handler: it fires when the sentinel
   * appears instead of on every pixel of movement, and it behaves the same in
   * the extension's tab as on the page.
   */
  useEffect(() => {
    const node = sentinel.current;
    if (!node || atEnd) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      // A screenful of warning, so the next page is usually there before the
      // reader reaches the end of this one.
      { rootMargin: '600px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, atEnd, deals]);

  const sorted = useMemo(() => {
    const list = [...(deals ?? [])];
    if (sort === 'price') return list.sort((a, b) => a.salePrice - b.salePrice);
    if (sort === 'rating') return list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return list.sort((a, b) => b.savings - a.savings);
  }, [deals, sort]);

  if (failed && !deals) return <div className="empty">{t.dealsFailed}</div>;
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
              <span className="deal-card-foot">
                {/* Whose price this is. A number with no attribution is not a
                    price, and the three feeds do not agree on a single shop. */}
                {d.storeName && <span className="deal-card-store">{d.storeName}</span>}
                {d.rating != null && <span className="deal-card-rating">{t.dealsRating(d.rating)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Where the next page is fetched from. Kept in the tree while there is
          more, removed when the feeds run out, so the list ends honestly. */}
      {!atEnd && <div ref={sentinel} className="deals-sentinel" aria-hidden="true" />}
      {loadingMore && <p className="deals-more">{t.dealsLoadingMore}</p>}
      {atEnd && !loadingMore && <p className="deals-more">{t.dealsEnd(deals.length)}</p>}

      <p className="deals-note">{t.dealsNote}</p>
    </section>
  );
}
