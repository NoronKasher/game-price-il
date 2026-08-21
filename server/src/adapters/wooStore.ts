/**
 * WooCommerce Store API reader.
 *
 * Several of the Israeli shops run WooCommerce, and WooCommerce ships a public,
 * documented, read-only JSON API at /wp-json/wc/store/v1/products. Where a shop
 * has it enabled, that is strictly better than parsing its theme's HTML: the
 * price arrives as an integer in minor units instead of text scraped out of a
 * span, stock is a boolean rather than a guess at a CSS class, and a theme
 * redesign can't silently break it.
 *
 * It is not universal though — it ships with WooCommerce Blocks, so a shop on an
 * older stack simply 404s. `wooSearch` returns null in that case (as opposed to
 * an empty array for "no such game"), which lets an adapter keep its existing
 * HTML path as a fallback rather than losing the store entirely.
 */

import { isAllowedScrapeUrl } from '../net.ts';

const UA = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const TIMEOUT_MS = 20_000;
const CACHE_TTL = 10 * 60 * 1000;

export interface WooProduct {
  name: string;
  /** Price in major units (already scaled by currency_minor_unit). */
  price: number;
  /** Pre-discount price in major units, when the shop is running one. */
  regularPrice: number | null;
  currency: string;
  inStock: boolean;
  url: string;
  image?: string;
  /** Category slugs. Some shops file a game by console far more reliably than
   *  they name it in the title, so the caller may prefer these. */
  categories: string[];
}

interface RawWooProduct {
  name?: string;
  permalink?: string;
  is_in_stock?: boolean;
  images?: { src?: string }[];
  categories?: { slug?: string; name?: string }[];
  prices?: {
    price?: string;
    regular_price?: string;
    currency_code?: string;
    currency_minor_unit?: number;
  };
}

const cache = new Map<string, { products: WooProduct[] | null; at: number }>();

/**
 * Minor units → major. WooCommerce states the scale per response
 * (`currency_minor_unit`), so this never has to guess the way a bare integer
 * would — an assumed /100 is exactly how a zero-decimal currency turns into a
 * hundredfold error.
 */
function toMajor(raw: string | undefined, minorUnit: number | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const scale = 10 ** (Number.isFinite(minorUnit) ? (minorUnit as number) : 2);
  return n / scale;
}

/**
 * Search a WooCommerce shop's Store API.
 * Returns products, or null when the shop doesn't expose the API (or is down),
 * so the caller can fall back to whatever it did before.
 */
export async function wooSearch(base: string, title: string, limit = 24): Promise<WooProduct[] | null> {
  const url = `${base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(title)}&per_page=${limit}`;
  // Same allowlist the scraper obeys: this reaches out to a shop, so it may only
  // ever reach a shop we deliberately read.
  if (!isAllowedScrapeUrl(url)) return null;

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.products;

  let products: WooProduct[] | null = null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const raw = (await res.json()) as unknown;
      if (Array.isArray(raw)) {
        products = [];
        for (const p of raw as RawWooProduct[]) {
          const price = toMajor(p.prices?.price, p.prices?.currency_minor_unit);
          if (!p.name || !p.permalink || price == null) continue;
          // Pre-orders and "call us" listings come through priced at zero.
          if (!(price > 0)) continue;
          const regular = toMajor(p.prices?.regular_price, p.prices?.currency_minor_unit);
          products.push({
            name: p.name,
            price,
            regularPrice: regular != null && regular > price ? regular : null,
            currency: p.prices?.currency_code?.trim() || 'ILS',
            inStock: p.is_in_stock !== false,
            url: p.permalink,
            image: p.images?.[0]?.src,
            categories: (p.categories ?? []).map((c) => c.slug ?? '').filter(Boolean),
          });
        }
      }
    }
  } catch {
    products = null;
  }
  cache.set(url, { products, at: Date.now() });
  return products;
}
