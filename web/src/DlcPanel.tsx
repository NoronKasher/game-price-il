import { useEffect, useState } from 'react';
import { api } from './api';
import { nis, t } from './he';
import { safeUrl } from './url';
import type { GameHit, Offer, Platform, SourceRef } from './types';

/**
 * A game's add-ons, on the game's own page.
 *
 * Add-ons are hidden from search results on purpose — someone looking for Far
 * Cry 6 wants the game, not its eleven credit packs. But once you are *on* a
 * game's page, its expansions are exactly the thing you might want next, and
 * making people run a second search with a checkbox ticked to find them is
 * silly.
 *
 * Nothing is fetched until the section is opened. Finding add-ons costs a whole
 * fan-out across the stores, and spending that on every board open — for the
 * majority of games that have none, and for the majority of visitors who never
 * look — would be rude to the shops and slow for everyone.
 */

interface DlcGroup {
  key: string;
  title: string;
  image?: string;
  refs: SourceRef[];
}

/** Accent- and punctuation-insensitive, so "Assassin's" and "Assassins" agree. */
function norm(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Add-ons belonging to THIS game.
 *
 * A search for a game's add-ons returns other games' add-ons too, because store
 * search is fuzzy. An add-on for this game almost always carries the game's name
 * — "Elden Ring: Shadow of the Erdtree" — so requiring that is a cheap filter
 * that is wrong far less often than showing everything would be.
 */
function belongsTo(hitTitle: string, gameTitle: string): boolean {
  const base = norm(gameTitle);
  return base.length > 2 && norm(hitTitle).includes(base);
}

const EXPANDED_KEY = 'gp_dlc_expanded';

function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveExpanded(v: boolean): void {
  try {
    localStorage.setItem(EXPANDED_KEY, v ? '1' : '0');
  } catch {
    /* private browsing; the preference simply will not persist */
  }
}

export function DlcPanel({ title, platform }: { title: string; platform: Platform }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<DlcGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<DlcGroup | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [offersFailed, setOffersFailed] = useState(false);
  // Remembered across visits: someone who wants the bigger card usually wants it
  // every time, and re-expanding it on every game is a small daily annoyance.
  const [expanded, setExpanded] = useState(loadExpanded);

  // Load once, on first open.
  useEffect(() => {
    if (!open || groups !== null) return;
    let live = true;
    setFailed(false);
    api
      .search(title, true)
      .then((r) => {
        if (!live) return;
        const byKey = new Map<string, DlcGroup>();
        for (const hit of r.games as GameHit[]) {
          if (!hit.dlc || hit.platform !== platform || !belongsTo(hit.title, title)) continue;
          const g = byKey.get(hit.groupKey) ?? { key: hit.groupKey, title: hit.title, image: hit.image, refs: [] };
          g.image ??= hit.image;
          g.refs.push({ sourceId: hit.sourceId, sourceGameId: hit.sourceGameId });
          byKey.set(hit.groupKey, g);
        }
        setGroups([...byKey.values()]);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, groups, title, platform]);

  // Prices for the chosen add-on.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setOffers(null);
    setOffersFailed(false);
    api
      .offers(selected.refs, platform)
      .then((r) => live && setOffers(r.offers))
      .catch(() => live && setOffersFailed(true));
    return () => {
      live = false;
    };
  }, [selected, platform]);

  const toggleSize = () => {
    const next = !expanded;
    setExpanded(next);
    saveExpanded(next);
  };

  const shown = offers ? (expanded ? offers : offers.slice(0, 3)) : null;

  return (
    <section className="dlc-panel">
      <button
        className={`dlc-head ${open ? 'on' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dlc-head-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        {t.dlcSectionTitle}
        {groups && <span className="dlc-count">{groups.length}</span>}
      </button>

      {open && (
        <div className="dlc-body">
          {failed && <p className="dlc-note">{t.dlcFailed}</p>}
          {!failed && groups === null && <p className="dlc-note">{t.dlcLoading}</p>}
          {groups?.length === 0 && <p className="dlc-note">{t.dlcNone}</p>}

          {groups && groups.length > 0 && (
            <div className="dlc-chips">
              {groups.map((g) => (
                <button
                  key={g.key}
                  className={`dlc-chip ${selected?.key === g.key ? 'on' : ''}`}
                  onClick={() => setSelected(selected?.key === g.key ? null : g)}
                  title={g.title}
                >
                  {g.image ? (
                    <img className="dlc-chip-art" src={safeUrl(g.image)} alt="" loading="lazy" />
                  ) : (
                    <span className="dlc-chip-art dlc-chip-noart" aria-hidden="true">＋</span>
                  )}
                  <span className="dlc-chip-name">{g.title}</span>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <article className={`dlc-card ${expanded ? 'big' : 'small'}`}>
              <header className="dlc-card-head">
                {selected.image && (
                  <img className="dlc-card-art" src={safeUrl(selected.image)} alt="" />
                )}
                <h4 className="dlc-card-title">{selected.title}</h4>
                {/* The control says what will happen, not what is true now — a
                    button labelled with the current state reads as a claim. */}
                <button className="dlc-size" onClick={toggleSize} aria-expanded={expanded}>
                  {expanded ? t.dlcCollapse : t.dlcExpand}
                </button>
              </header>

              {offersFailed && <p className="dlc-note">{t.dlcOffersFailed}</p>}
              {!offersFailed && offers === null && <p className="dlc-note">{t.depLoading}</p>}
              {offers?.length === 0 && <p className="dlc-note">{t.dlcNoOffers}</p>}

              {shown && shown.length > 0 && (
                <ul className="dlc-offers">
                  {shown.map((o, i) => (
                    <li key={`${o.store}-${o.region ?? ''}-${i}`}>
                      <span className="dlc-offer-store">
                        {o.flag && <span aria-hidden="true">{o.flag} </span>}
                        {o.store}
                      </span>
                      {o.url ? (
                        <a className="dlc-offer-price" href={o.url} target="_blank" rel="noopener noreferrer">
                          {nis(o.priceILS)}
                        </a>
                      ) : (
                        <span className="dlc-offer-price">{nis(o.priceILS)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {offers && offers.length > 3 && !expanded && (
                <p className="dlc-note dlc-more">{t.dlcMore(offers.length - 3)}</p>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  );
}
