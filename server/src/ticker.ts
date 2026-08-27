/**
 * Kept as the name the rest of the tool imports.
 *
 * The deals feed grew from one source to three and moved to deals.ts; this
 * re-export means the ticker's callers — the Express route, the extension
 * handler, the tests — did not all have to change to say so.
 */
export { tickerDeals, dealsPage, type TickerDeal } from './deals.ts';
