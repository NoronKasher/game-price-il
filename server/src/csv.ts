import { exportAll } from './db.ts';

/**
 * Price history as a spreadsheet.
 *
 * The JSON export exists to be re-imported by the tool; this exists to be opened
 * by a person. One row per recorded price, flattened so a pivot table or a chart
 * in Sheets/Excel works without any preparation.
 */

/**
 * RFC 4180 escaping. A store name really can contain a comma ("מוכרי מפתחות ·
 * GG.deals" is tame, but titles carry commas and quotes routinely), and one
 * unescaped field shifts every column after it — a silently wrong spreadsheet
 * rather than a broken one.
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const COLUMNS = [
  'game',
  'platform',
  'store',
  'region',
  'kind',
  'price',
  'currency',
  'price_ils',
  'checked_at',
] as const;

/**
 * The whole tracked history as CSV text.
 *
 * Prefixed with a UTF-8 BOM on purpose: without it Excel reads the file in the
 * system codepage and every Hebrew store and game name arrives as mojibake. It
 * costs three bytes and is the difference between a usable file and a support
 * question.
 */
export function historyCsv(): string {
  const lines: string[] = [COLUMNS.join(',')];
  for (const item of exportAll()) {
    for (const h of item.history) {
      lines.push(
        [
          cell(item.title),
          cell(item.platform),
          cell(h.store),
          cell(h.region),
          cell(h.kind),
          cell(h.price),
          cell(h.currency),
          cell(h.price_ils),
          // Space-separated UTC, which Sheets and Excel both parse as a date.
          cell(h.checked_at),
        ].join(',')
      );
    }
  }
  // CRLF: the line ending every spreadsheet app agrees on.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
