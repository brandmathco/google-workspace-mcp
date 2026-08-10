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
