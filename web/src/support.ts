/**
 * Where a tip goes, if anybody wants to leave one.
 *
 * The tool is free, AGPL, and runs entirely on the user's own machine — there
 * is no hosting bill to cover and nothing is gated. So this is a tip jar, not a
 * funding model, and it is built to behave like one: one line in Settings, no
 * banner, no popup, no counter, no "support us" nag on a screen somebody opened
 * to compare prices. A link that is easy to ignore is the only kind that
 * belongs in a tool nobody is paying for.
 *
 * WHY THESE TWO, having looked at what an Israeli maintainer can actually use:
 *
 *   GitHub Sponsors takes NO platform fee, pays out to an Israeli bank through
 *   Stripe (Israel has been supported since 2022), and puts a Sponsor button on
 *   the repository itself via .github/FUNDING.yml — so most people who would
 *   ever tip an open-source project find it without this screen existing.
 *
 *   Ko-fi takes 0% on one-off tips too, and unlike Buy Me a Coffee (5%, Stripe
 *   only) it can pay out through PayPal, which matters here: plenty of Israeli
 *   users have PayPal and no interest in creating a GitHub account to give
 *   somebody five shekels.
 *
 * Affiliate links were the alternative and are refused. An affiliate link pays
 * per click-through, which would give this project a reason to prefer the
 * sellers that pay it — and the sort order of a price comparison is the entire
 * product. A tip is the only funding that cannot bend the results.
 *
 * A link with no id is not shown. Nothing here is enabled until the account
 * behind it actually exists; a Sponsor button leading to "not accepting
 * sponsorships" is worse than no button.
 */

export interface SupportLink {
  id: string;
  label: string;
  url: string;
  note: string;
}

/** The maintainer's GitHub account — the Sponsors URL is derived from it. */
const GITHUB_USER = 'NoronKasher';

/**
 * Where a bug report or an idea goes.
 *
 * GitHub's issue form is the primary route because it needs no mail client:
 * the whole report travels in the URL, the user presses one button on a page
 * that is already filled in, and the thread is public and followable rather
 * than a message that vanishes into an inbox.
 *
 * The address is the NOREPLY one GitHub issues for privacy, not a personal
 * mailbox — the same reason the commits use it. It exists as a fallback for
 * people who would rather not have a GitHub account, which is a real
 * preference and not one to argue with.
 */
export const CONTACT = {
  repo: `${GITHUB_USER}/game-price-il`,
  email: `${GITHUB_USER}@users.noreply.github.com`,
};

/**
 * Ko-fi page name, once one exists. Empty until then, and an empty entry is
 * simply not rendered.
 */
const KOFI_USER = '';

export function supportLinks(): SupportLink[] {
  const links: SupportLink[] = [];
  if (GITHUB_USER) {
    links.push({
      id: 'github',
      label: 'GitHub Sponsors',
      url: `https://github.com/sponsors/${GITHUB_USER}`,
      note: 'ללא עמלת פלטפורמה',
    });
  }
  if (KOFI_USER) {
    links.push({
      id: 'kofi',
      label: 'Ko-fi',
      url: `https://ko-fi.com/${KOFI_USER}`,
      note: 'תמיכה חד־פעמית, אפשר גם ב‑PayPal',
    });
  }
  return links;
}
