import { google } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";
import { getGoogleAuthClient } from "../auth/googleAuth.js";

type AuthClient = OAuth2Client | JWT;

function analyticsAdmin(auth: AuthClient) {
  return google.analyticsadmin({ version: "v1beta", auth });
}

function analyticsData(auth: AuthClient) {
  return google.analyticsdata({ version: "v1beta", auth });
}

/** Normalize a GA4 property id to `properties/{id}`. */
export function normalizePropertyResourceName(propertyId: string): string {
  const trimmed = propertyId.trim();
  if (!trimmed) {
    throw new Error("propertyId is required");
  }
  if (trimmed.startsWith("properties/")) {
    return trimmed;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid propertyId "${propertyId}". Use a numeric GA4 property ID or properties/{id}.`,
    );
  }
  return `properties/${trimmed}`;
}

export function resolveDefaultPropertyId(propertyId?: string): string {
  const explicit = propertyId?.trim();
  if (explicit) return explicit;

  const fromEnv = process.env.GOOGLE_ANALYTICS_DEFAULT_PROPERTY_ID?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    "propertyId is required (or set GOOGLE_ANALYTICS_DEFAULT_PROPERTY_ID).",
  );
}

export async function analyticsListAccountSummaries(accountEmail?: string) {
  const auth = await getGoogleAuthClient(accountEmail);
  const admin = analyticsAdmin(auth);

  const accounts: Array<{
    account: string;
    displayName: string;
    properties: Array<{ property: string; displayName: string; propertyType?: string }>;
  }> = [];

  let pageToken: string | undefined;
  do {
    const res = await admin.accountSummaries.list({
      pageSize: 200,
      pageToken,
    });
    for (const summary of res.data.accountSummaries ?? []) {
      accounts.push({
        account: summary.account ?? "",
        displayName: summary.displayName ?? "",
        properties: (summary.propertySummaries ?? []).map((p) => ({
          property: p.property ?? "",
          displayName: p.displayName ?? "",
          propertyType: p.propertyType ?? undefined,
        })),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return {
    accountCount: accounts.length,
    propertyCount: accounts.reduce((n, a) => n + a.properties.length, 0),
    accounts,
    hint: "Pass property (e.g. properties/123456789 or 123456789) to analytics_run_report. Re-authorize if you see insufficient scopes.",
  };
}

export interface AnalyticsRunReportInput {
  accountEmail?: string;
  propertyId?: string;
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  limit?: number;
  dimensionFilter?: Record<string, unknown>;
  metricFilter?: Record<string, unknown>;
  orderBys?: Array<Record<string, unknown>>;
  keepEmptyRows?: boolean;
  currencyCode?: string;
}

export async function analyticsRunReport(input: AnalyticsRunReportInput) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const data = analyticsData(auth);
  const property = normalizePropertyResourceName(
    resolveDefaultPropertyId(input.propertyId),
  );

  const metrics = input.metrics.map((name) => ({ name: name.trim() }));
  if (!metrics.length) {
    throw new Error("At least one metric is required (e.g. sessions, activeUsers, totalUsers).");
  }

  const dimensions = (input.dimensions ?? []).map((name) => ({ name: name.trim() }));
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 10000);

  const res = await data.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
      metrics,
      ...(dimensions.length ? { dimensions } : {}),
      limit: String(limit),
      ...(input.dimensionFilter ? { dimensionFilter: input.dimensionFilter } : {}),
      ...(input.metricFilter ? { metricFilter: input.metricFilter } : {}),
      ...(input.orderBys?.length ? { orderBys: input.orderBys } : {}),
      ...(input.keepEmptyRows !== undefined ? { keepEmptyRows: input.keepEmptyRows } : {}),
      ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
    },
  });

  const dimensionHeaders = (res.data.dimensionHeaders ?? []).map((h) => h.name ?? "");
  const metricHeaders = (res.data.metricHeaders ?? []).map((h) => ({
    name: h.name ?? "",
    type: h.type ?? "",
  }));

  const rows = (res.data.rows ?? []).map((row) => {
    const dims: Record<string, string> = {};
    row.dimensionValues?.forEach((v, i) => {
      const key = dimensionHeaders[i] || `dimension_${i}`;
      dims[key] = v.value ?? "";
    });
    const mets: Record<string, string> = {};
    row.metricValues?.forEach((v, i) => {
      const key = metricHeaders[i]?.name || `metric_${i}`;
      mets[key] = v.value ?? "";
    });
    return { dimensions: dims, metrics: mets };
  });

  return {
    property,
    rowCount: res.data.rowCount ?? rows.length,
    dimensionHeaders,
    metricHeaders,
    rows,
    totals: (res.data.totals ?? []).map((row) =>
      Object.fromEntries(
        (row.metricValues ?? []).map((v, i) => [
          metricHeaders[i]?.name || `metric_${i}`,
          v.value ?? "",
        ]),
      ),
    ),
    metadata: res.data.metadata ?? undefined,
  };
}

export interface AnalyticsRealtimeReportInput {
  accountEmail?: string;
  propertyId?: string;
  metrics: string[];
  dimensions?: string[];
  limit?: number;
}

export async function analyticsRunRealtimeReport(
  input: AnalyticsRealtimeReportInput,
) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const data = analyticsData(auth);
  const property = normalizePropertyResourceName(
    resolveDefaultPropertyId(input.propertyId),
  );

  const metrics = input.metrics.map((name) => ({ name: name.trim() }));
  if (!metrics.length) {
    throw new Error(
      "At least one realtime metric is required (e.g. activeUsers).",
    );
  }

  const dimensions = (input.dimensions ?? []).map((name) => ({ name: name.trim() }));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 1000);

  const res = await data.properties.runRealtimeReport({
    property,
    requestBody: {
      metrics,
      ...(dimensions.length ? { dimensions } : {}),
      limit: String(limit),
    },
  });

  const dimensionHeaders = (res.data.dimensionHeaders ?? []).map((h) => h.name ?? "");
  const metricHeaders = (res.data.metricHeaders ?? []).map((h) => ({
    name: h.name ?? "",
    type: h.type ?? "",
  }));

  const rows = (res.data.rows ?? []).map((row) => {
    const dims: Record<string, string> = {};
    row.dimensionValues?.forEach((v, i) => {
      const key = dimensionHeaders[i] || `dimension_${i}`;
      dims[key] = v.value ?? "";
    });
    const mets: Record<string, string> = {};
    row.metricValues?.forEach((v, i) => {
      const key = metricHeaders[i]?.name || `metric_${i}`;
      mets[key] = v.value ?? "";
    });
    return { dimensions: dims, metrics: mets };
  });

  return {
    property,
    rowCount: res.data.rowCount ?? rows.length,
    dimensionHeaders,
    metricHeaders,
    rows,
  };
}

export async function analyticsGetMetadata(input: {
  accountEmail?: string;
  propertyId?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const data = analyticsData(auth);
  const name = `${normalizePropertyResourceName(
    resolveDefaultPropertyId(input.propertyId),
  )}/metadata`;

  const res = await data.properties.getMetadata({ name });

  return {
    property: name.replace(/\/metadata$/, ""),
    dimensions: (res.data.dimensions ?? []).map((d) => ({
      apiName: d.apiName ?? "",
      uiName: d.uiName ?? "",
      description: d.description ?? "",
      category: d.category ?? "",
      customDefinition: d.customDefinition ?? false,
    })),
    metrics: (res.data.metrics ?? []).map((m) => ({
      apiName: m.apiName ?? "",
      uiName: m.uiName ?? "",
      description: m.description ?? "",
      category: m.category ?? "",
      type: m.type ?? "",
      customDefinition: m.customDefinition ?? false,
    })),
  };
}

/** Normalize an Analytics account id to `accounts/{id}`. */
export function normalizeAccountResourceName(accountId: string): string {
  const trimmed = accountId.trim();
  if (!trimmed) {
    throw new Error("accountId is required");
  }
  if (trimmed.startsWith("accounts/")) {
    return trimmed;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid accountId "${accountId}". Use a numeric account ID or accounts/{id}.`,
    );
  }
  return `accounts/${trimmed}`;
}

function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("websiteUrl is required");
  }
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Invalid websiteUrl protocol: ${parsed.protocol}`);
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    throw new Error(`Invalid websiteUrl "${url}"`);
  }
}

export interface AnalyticsCreateWebPropertyInput {
  accountEmail?: string;
  /** Numeric account ID or `accounts/{id}`. Brandmatchco = 302470867. */
  accountId: string;
  displayName: string;
  websiteUrl: string;
  timeZone?: string;
  currencyCode?: string;
}

/**
 * Create a GA4 property + web data stream and return the Measurement ID (G-…).
 * Requires OAuth scope analytics.edit (re-authorize after upgrade).
 */
export async function analyticsCreateWebProperty(
  input: AnalyticsCreateWebPropertyInput,
) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const admin = analyticsAdmin(auth);
  const parent = normalizeAccountResourceName(input.accountId);
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new Error("displayName is required");
  }
  const websiteUrl = normalizeWebsiteUrl(input.websiteUrl);
  const timeZone = (input.timeZone ?? "America/Edmonton").trim();
  const currencyCode = (input.currencyCode ?? "CAD").trim().toUpperCase();

  const propRes = await admin.properties.create({
    requestBody: {
      parent,
      displayName,
      timeZone,
      currencyCode,
    },
  });

  const propertyName = propRes.data.name?.trim();
  if (!propertyName) {
    throw new Error("GA4 property create returned no property name");
  }

  const streamRes = await admin.properties.dataStreams.create({
    parent: propertyName,
    requestBody: {
      type: "WEB_DATA_STREAM",
      displayName: `${displayName} Web`,
      webStreamData: {
        defaultUri: websiteUrl,
      },
    },
  });

  const measurementId = streamRes.data.webStreamData?.measurementId?.trim() ?? "";
  if (!measurementId) {
    throw new Error(
      `Created ${propertyName} but no measurementId on the web data stream. Check Admin → Data streams.`,
    );
  }

  return {
    account: parent,
    property: propertyName,
    propertyId: propertyName.replace(/^properties\//, ""),
    displayName,
    websiteUrl,
    dataStream: streamRes.data.name ?? "",
    measurementId,
    timeZone,
    currencyCode,
  };
}

export interface AnalyticsCreateWebPropertyBatchItem {
  displayName: string;
  websiteUrl: string;
  timeZone?: string;
  currencyCode?: string;
}

/**
 * Create many GA4 web properties under one account. Skips names that already exist
 * when skipExisting is true (matched by case-insensitive displayName).
 */
export async function analyticsCreateWebPropertyBatch(input: {
  accountEmail?: string;
  accountId: string;
  properties: AnalyticsCreateWebPropertyBatchItem[];
  skipExisting?: boolean;
}) {
  const skipExisting = input.skipExisting !== false;
  const existingNames = new Set<string>();
  if (skipExisting) {
    const summaries = await analyticsListAccountSummaries(input.accountEmail);
    const parent = normalizeAccountResourceName(input.accountId);
    for (const account of summaries.accounts) {
      if (account.account !== parent) continue;
      for (const p of account.properties) {
        existingNames.add(p.displayName.trim().toLowerCase());
      }
    }
  }

  const created: Array<Awaited<ReturnType<typeof analyticsCreateWebProperty>>> = [];
  const skipped: Array<{ displayName: string; websiteUrl: string; reason: string }> = [];
  const errors: Array<{ displayName: string; websiteUrl: string; error: string }> = [];

  for (const item of input.properties) {
    const displayName = item.displayName.trim();
    const key = displayName.toLowerCase();
    if (skipExisting && existingNames.has(key)) {
      skipped.push({
        displayName,
        websiteUrl: item.websiteUrl,
        reason: "property displayName already exists on this account",
      });
      continue;
    }
    try {
      const row = await analyticsCreateWebProperty({
        accountEmail: input.accountEmail,
        accountId: input.accountId,
        displayName,
        websiteUrl: item.websiteUrl,
        timeZone: item.timeZone,
        currencyCode: item.currencyCode,
      });
      created.push(row);
      existingNames.add(key);
    } catch (err) {
      errors.push({
        displayName,
        websiteUrl: item.websiteUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    accountId: normalizeAccountResourceName(input.accountId),
    createdCount: created.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    created,
    skipped,
    errors,
  };
}
