import { google } from "googleapis";
import type { JWT, OAuth2Client } from "google-auth-library";
import { getGoogleAuthClient } from "../auth/googleAuth.js";
import {
  normalizeAdsenseAccount,
  parseIsoDateParts,
  shapeAdsenseReport,
  type AdsenseDateRange,
} from "./adsenseFormat.js";

type AuthClient = OAuth2Client | JWT;

function adsense(auth: AuthClient) {
  return google.adsense({ version: "v2", auth });
}

function clampPageSize(pageSize: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(pageSize ?? fallback, 1), max);
}

export async function adsenseListAccounts(input: {
  accountEmail?: string;
  pageSize?: number;
  pageToken?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const res = await adsense(auth).accounts.list({
    pageSize: clampPageSize(input.pageSize, 50, 100),
    pageToken: input.pageToken,
  });
  const accounts = (res.data.accounts ?? []).map((account) => ({
    name: account.name ?? "",
    displayName: account.displayName ?? "",
    state: account.state ?? "",
    timeZone: account.timeZone?.id ?? undefined,
    premium: account.premium ?? false,
  }));
  return {
    accounts,
    nextPageToken: res.data.nextPageToken ?? undefined,
    hint: "Pass name (accounts/pub-…) to other adsense_* tools. Re-authorize if you see insufficient scopes (adsense.readonly). Enable the AdSense Management API in Google Cloud.",
  };
}

async function resolveAccount(accountEmail: string | undefined, account: string | undefined) {
  const explicit = account?.trim();
  if (explicit) return normalizeAdsenseAccount(explicit);
  const fromEnv = process.env.GOOGLE_ADSENSE_DEFAULT_ACCOUNT?.trim();
  if (fromEnv) return normalizeAdsenseAccount(fromEnv);
  const listed = await adsenseListAccounts({ accountEmail, pageSize: 2 });
  if (listed.accounts.length === 1 && listed.accounts[0]?.name) {
    return listed.accounts[0].name;
  }
  throw new Error(
    "account is required when more than one AdSense account is visible (or set GOOGLE_ADSENSE_DEFAULT_ACCOUNT).",
  );
}

export async function adsenseListSites(input: {
  accountEmail?: string;
  account?: string;
  pageSize?: number;
  pageToken?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const parent = await resolveAccount(input.accountEmail, input.account);
  const res = await adsense(auth).accounts.sites.list({
    parent,
    pageSize: clampPageSize(input.pageSize, 50, 100),
    pageToken: input.pageToken,
  });
  return {
    account: parent,
    sites: (res.data.sites ?? []).map((site) => ({
      name: site.name ?? "",
      domain: site.domain ?? "",
      state: site.state ?? "",
      autoAdsEnabled: site.autoAdsEnabled ?? false,
      reportingDimensionId: site.reportingDimensionId ?? undefined,
    })),
    nextPageToken: res.data.nextPageToken ?? undefined,
  };
}

export async function adsenseListAdClients(input: {
  accountEmail?: string;
  account?: string;
  pageSize?: number;
  pageToken?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const parent = await resolveAccount(input.accountEmail, input.account);
  const res = await adsense(auth).accounts.adclients.list({
    parent,
    pageSize: clampPageSize(input.pageSize, 50, 100),
    pageToken: input.pageToken,
  });
  return {
    account: parent,
    adClients: (res.data.adClients ?? []).map((client) => ({
      name: client.name ?? "",
      productCode: client.productCode ?? "",
      state: client.state ?? "",
      reportingDimensionId: client.reportingDimensionId ?? undefined,
    })),
    nextPageToken: res.data.nextPageToken ?? undefined,
  };
}

export async function adsenseListAdUnits(input: {
  accountEmail?: string;
  adClient: string;
  pageSize?: number;
  pageToken?: string;
}) {
  const parent = input.adClient.trim();
  if (!parent.includes("/adclients/")) {
    throw new Error(
      "adClient must be a resource name from adsense_list_ad_clients (accounts/pub-…/adclients/…).",
    );
  }
  const auth = await getGoogleAuthClient(input.accountEmail);
  const res = await adsense(auth).accounts.adclients.adunits.list({
    parent,
    pageSize: clampPageSize(input.pageSize, 50, 100),
    pageToken: input.pageToken,
  });
  return {
    adClient: parent,
    adUnits: (res.data.adUnits ?? []).map((unit) => ({
      name: unit.name ?? "",
      displayName: unit.displayName ?? "",
      state: unit.state ?? "",
      reportingDimensionId: unit.reportingDimensionId ?? undefined,
      size: unit.contentAdsSettings?.size ?? undefined,
      type: unit.contentAdsSettings?.type ?? undefined,
    })),
    nextPageToken: res.data.nextPageToken ?? undefined,
  };
}

export async function adsenseListPayments(input: {
  accountEmail?: string;
  account?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const parent = await resolveAccount(input.accountEmail, input.account);
  const res = await adsense(auth).accounts.payments.list({ parent });
  return {
    account: parent,
    payments: (res.data.payments ?? []).map((payment) => ({
      name: payment.name ?? "",
      amount: payment.amount ?? "",
      date:
        payment.date?.year && payment.date.month && payment.date.day
          ? `${payment.date.year}-${String(payment.date.month).padStart(2, "0")}-${String(payment.date.day).padStart(2, "0")}`
          : undefined,
    })),
  };
}

export interface AdsenseGenerateReportInput {
  accountEmail?: string;
  account?: string;
  dateRange?: AdsenseDateRange;
  startDate?: string;
  endDate?: string;
  metrics?: string[];
  dimensions?: string[];
  filters?: string[];
  currencyCode?: string;
  limit?: number;
  orderBy?: string[];
}

export async function adsenseGenerateReport(input: AdsenseGenerateReportInput) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const account = await resolveAccount(input.accountEmail, input.account);
  const metrics = (input.metrics?.length
    ? input.metrics
    : ["ESTIMATED_EARNINGS", "PAGE_VIEWS", "IMPRESSIONS", "CLICKS"]
  ).map((metric) => metric.trim());
  const dimensions = (input.dimensions ?? []).map((dimension) => dimension.trim()).filter(Boolean);
  const start = input.startDate ? parseIsoDateParts(input.startDate) : undefined;
  const end = input.endDate ? parseIsoDateParts(input.endDate) : undefined;
  if (Boolean(start) !== Boolean(end)) {
    throw new Error("startDate and endDate must be provided together.");
  }
  if (!start && !input.dateRange) {
    throw new Error("Provide dateRange or both startDate and endDate.");
  }

  const res = await adsense(auth).accounts.reports.generate({
    account,
    metrics,
    ...(dimensions.length ? { dimensions } : {}),
    ...(input.dateRange ? { dateRange: input.dateRange } : {}),
    ...(start
      ? {
          "startDate.year": start.year,
          "startDate.month": start.month,
          "startDate.day": start.day,
          "endDate.year": end?.year,
          "endDate.month": end?.month,
          "endDate.day": end?.day,
          dateRange: "CUSTOM",
        }
      : {}),
    ...(input.filters?.length ? { filters: input.filters } : {}),
    ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
    ...(input.orderBy?.length ? { orderBy: input.orderBy } : {}),
    limit: clampPageSize(input.limit, 100, 500),
  });

  return {
    account,
    ...shapeAdsenseReport(res.data),
  };
}
