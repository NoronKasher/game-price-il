import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { nis, t } from './he';
import { loadOwned, toggleOwned } from './owned';
import type { Bundle } from './types';

/**
 * "I already own three of these five — is the bundle still worth it?"
 *
 * The question the price board cannot answer, because the only number that
 * matters is what the games you do NOT already own would cost separately, and
 * no store knows what you own. Every shop shows the sticker price of a bundle
 * and none of them show that.
 *
 * The answer flips more often than people expect: a ₪100 bundle whose only new
 * game sells for ₪40 on its own is a bad deal, and the shop's own "save 33%!"
 * badge is telling the truth about a comparison that is not yours.
 *
 * WHAT YOU OWN IS YOUR CLAIM, not something this tool works out. Reading a
 * Steam library needs an account this tool does not ask for, so the ticks are
 * by hand — and because they are, they work for every store rather than only
 * the one with an API. They are remembered per browser and travel in the
 * portable token, so a list ticked once is not ticked again on the next
 * machine.
 */

export function BundlePanel({ steamAppId }: { steamAppId: string }) {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [open, setOpen] = useState(false);
  /** Bumped on every tick so the sums recompute; the set itself lives in storage. */
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    let live = true;
    setBundles(null);
    setOpen(false);
    api
      .bundles(steamAppId)
      .then((r) => live && setBundles(r.bundles))
      // A bundle panel that cannot load is a missing panel, never a broken board.
      .catch(() => live && setBundles([]));
    return () => {
      live = false;
    };
  }, [steamAppId]);

  const owned = useMemo(() => loadOwned(), [ticks]);

  if (!bundles || bundles.length === 0) return null;

  return (
    <section className="bundles">
      <button className="bundles-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {t.bundlesTitle(bundles.length)}
      </button>

      {open && (
        <>
          <p className="bundles-intro">{t.bundlesIntro}</p>
          {bundles.map((bundle) => (
            <BundleCard
              key={bundle.packageId}
              bundle={bundle}
              owned={owned}
              onToggle={(appId) => {
                toggleOwned(appId);
                setTicks((n) => n + 1);
              }}
            />
          ))}
        </>
      )}
    </section>
  );
}

function BundleCard({
  bundle,
  owned,
  onToggle,
}: {
  bundle: Bundle;
  owned: Set<string>;
  onToggle: (appId: string) => void;
}) {
  // The same arithmetic the server exposes, done here so a tick is instant
  // rather than a round trip. verdictFor in server/src/bundle.ts is the
  // definition; this mirrors it, and its tests are what pin the behaviour.
  const { separate, ownedCount, unpriceable } = useMemo(() => {
    let sum = 0;
    let count = 0;
    const missing: string[] = [];
    for (const app of bundle.apps) {
      if (owned.has(app.appId)) {
        count++;
        continue;
      }
      if (app.priceILS === null) missing.push(app.title);
      else sum += app.priceILS;
    }
    return { separate: Math.round(sum * 100) / 100, ownedCount: count, unpriceable: missing };
  }, [bundle, owned]);

  const saving = Math.round((separate - bundle.priceILS) * 100) / 100;
  const allOwned = ownedCount === bundle.apps.length;
  const stillNeeded = bundle.apps.length - ownedCount;
  /**
   * Nothing left can be bought on its own, so there is no comparison to print.
   *
   * Found by using it: own the two priced games in The Orange Box and the five
   * that remain have no standalone price, so the separate total is ₪0 and the
   * card announced "buying separately is ₪73.95 cheaper" — about games that
   * cannot be bought separately at any price. That is not an imprecise saving,
   * it is a route that does not exist, so the card stops comparing and says so.
   */
  const onlyViaBundle = stillNeeded > 0 && unpriceable.length === stillNeeded;
  // Some of it is unbuyable alone but not all: the sum is a floor, not a lie.
  const exact = unpriceable.length === 0;

  return (
    <div className="bundle">
      <div className="bundle-head">
        <span className="bundle-name">{bundle.name}</span>
        <span className="bundle-price">{nis(bundle.priceILS)}</span>
        {bundle.discountPercent > 0 && <span className="bundle-cut">{bundle.discountPercent}%-</span>}
      </div>

      <ul className="bundle-apps">
        {bundle.apps.map((app) => (
          <li key={app.appId}>
            <label className={owned.has(app.appId) ? 'bundle-app owned' : 'bundle-app'}>
              <input type="checkbox" checked={owned.has(app.appId)} onChange={() => onToggle(app.appId)} />
              <span className="bundle-app-title">{app.title}</span>
              <span className="bundle-app-price">
                {app.priceILS === null ? t.bundleNoSolo : nis(app.priceILS)}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className={`bundle-verdict ${allOwned || onlyViaBundle ? 'none' : saving > 0 ? 'good' : 'bad'}`}>
        {allOwned
          ? t.bundleAllOwned
          : onlyViaBundle
            ? t.bundleOnlyWay(stillNeeded)
            : ownedCount === 0
              ? t.bundleNoneOwned(nis(separate))
              : t.bundleSome(ownedCount, nis(separate))}
      </p>
      {!allOwned && !onlyViaBundle && (
        <p className="bundle-math">
          {saving > 0 ? t.bundleSaves(nis(saving)) : t.bundleCosts(nis(Math.abs(saving)))}
          {!exact && <span className="bundle-floor"> · {t.bundleFloor(unpriceable)}</span>}
        </p>
      )}
    </div>
  );
}
