/** Pure AdSense account, date, and report shaping helpers. */

const ACCOUNT_ID = /^pub-\d+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const ADSENSE_DATE_RANGES = [
  "TODAY",
  "YESTERDAY",
  "MONTH_TO_DATE",
  "YEAR_TO_DATE",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
] as const;

export type AdsenseDateRange = (typeof ADSENSE_DATE_RANGES)[number];

export interface IsoDateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Normalize an AdSense account id to `accounts/pub-{digits}`.
 * Accepts `pub-…`, `ca-pub-…`, and `accounts/pub-…`.
 */
export function normalizeAdsenseAccount(account: string): string {
  const trimmed = account.trim();
  if (!trimmed) {
    throw new Error("AdSense account is required.");
  }
  const withoutResource = trimmed.replace(/^accounts\//, "");
  const id = withoutResource.replace(/^ca-/, "");
  if (!ACCOUNT_ID.test(id)) {
    throw new Error(
      `Invalid AdSense account "${account}". Use pub-123, ca-pub-123, or accounts/pub-123.`,
    );
  }
  return `accounts/${id}`;
}

/** Parse a calendar date. Rejects impossible days such as 2026-02-31. */
export function parseIsoDateParts(iso: string): IsoDateParts {
  const match = ISO_DATE.exec(iso.trim());
  if (!match) {
    throw new Error(`Invalid date "${iso}". Use YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date "${iso}".`);
  }
  return { year, month, day };
}

export interface AdsenseHeader {
  name?: string | null;
  type?: string | null;
  currencyCode?: string | null;
}

export interface AdsenseCell {
  value?: string | null;
}

export interface AdsenseRow {
  cells?: AdsenseCell[] | null;
}

export interface AdsenseLooseDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

export interface AdsenseReportResult {
  headers?: AdsenseHeader[] | null;
  rows?: AdsenseRow[] | null;
  totals?: AdsenseRow | null;
  averages?: AdsenseRow | null;
  totalMatchedRows?: string | null;
  warnings?: string[] | null;
  startDate?: AdsenseLooseDate | null;
  endDate?: AdsenseLooseDate | null;
}

function formatParts(parts: AdsenseLooseDate | null | undefined): string | undefined {
  if (!parts?.year || !parts.month || !parts.day) return undefined;
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function rowToRecord(
  headers: string[],
  row: AdsenseRow | null | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  (row?.cells ?? []).forEach((cell, index) => {
    const key = headers[index] || `column_${index}`;
    record[key] = cell.value ?? "";
  });
  return record;
}

/** Turn a raw AdSense GenerateReport payload into rows keyed by header name. */
export function shapeAdsenseReport(result: AdsenseReportResult) {
  const headers = (result.headers ?? []).map((header, index) => ({
    name: header.name || `column_${index}`,
    type: header.type ?? "",
    currencyCode: header.currencyCode ?? undefined,
  }));
  const names = headers.map((header) => header.name);
  return {
    startDate: formatParts(result.startDate),
    endDate: formatParts(result.endDate),
    totalMatchedRows: result.totalMatchedRows ?? undefined,
    warnings: result.warnings ?? [],
    headers,
    rows: (result.rows ?? []).map((row) => rowToRecord(names, row)),
    totals: result.totals ? rowToRecord(names, result.totals) : undefined,
    averages: result.averages ? rowToRecord(names, result.averages) : undefined,
  };
}
