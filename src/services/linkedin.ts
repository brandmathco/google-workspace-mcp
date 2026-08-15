import { getLinkedInAccountStore } from "../auth/linkedinAccountStore.js";
import {
  envLinkedInAccountSummary,
  linkedInApiFetch,
} from "./linkedinClient.js";
import {
  assertCanEnableLinkedInSpend,
  assertDailyBudgetWithinCap,
  buildLinkedInCampaignName,
  linkedInApiVersion,
  resolveAdAccountId,
  resolveDryRun,
  sponsoredAccountUrn,
  type LinkedInCampaignStatusAction,
} from "./linkedinSafety.js";

interface LinkedInAdAccountRow {
  id?: number;
  name?: string;
  currency?: string;
  status?: string;
  type?: string;
}

interface LinkedInCampaignRow {
  id?: number;
  name?: string;
  status?: string;
  objectiveType?: string;
  type?: string;
  dailyBudget?: { amount?: string; currencyCode?: string };
  campaignGroup?: string;
}

function runScheduleStartMs(): number {
  return Date.now();
}

function runScheduleEndMs(days = 14): number {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

export async function linkedinListAccounts(options?: { accountEmail?: string }) {
  const store = getLinkedInAccountStore();
  const localAccounts = await store.listAccounts();

  const data = await linkedInApiFetch<{
    elements?: LinkedInAdAccountRow[];
  }>("/rest/adAccountUsers?q=authenticatedUser", {
    accountEmail: options?.accountEmail,
  });

  const accountUrns =
    data.elements?.map((row) => (row as { account?: string }).account).filter(Boolean) ??
    [];

  const adAccounts: Array<{
    id: string;
    name: string;
    currency: string;
    status: string;
    urn: string;
  }> = [];

  for (const urn of accountUrns) {
    const id = String(urn).replace("urn:li:sponsoredAccount:", "");
    try {
      const account = await linkedInApiFetch<LinkedInAdAccountRow>(
        `/rest/adAccounts/${id}`,
        { accountEmail: options?.accountEmail },
      );
      adAccounts.push({
        id,
        name: account.name ?? "",
        currency: account.currency ?? "",
        status: account.status ?? "",
        urn: `urn:li:sponsoredAccount:${id}`,
      });
    } catch {
      adAccounts.push({
        id,
        name: "",
        currency: "",
        status: "UNKNOWN",
        urn: String(urn),
      });
    }
  }

  return {
    authorizedLinkedInAccounts: localAccounts,
    adAccounts,
    apiVersion: linkedInApiVersion(),
    note:
      "Development-tier apps must map ad accounts in LinkedIn Developer Portal → Products → View Ad Accounts.",
  };
}

export async function linkedinListCampaigns(options: {
  adAccountId?: string;
  accountEmail?: string;
  maxResults?: number;
}) {
  const adAccountId = resolveAdAccountId(options.adAccountId);
  const limit = Math.min(options.maxResults ?? 25, 100);
  const accountUrn = sponsoredAccountUrn(adAccountId);

  const data = await linkedInApiFetch<{ elements?: LinkedInCampaignRow[] }>(
    `/rest/adAccounts/${adAccountId}/adCampaigns?q=search&search=(status:(values:List(ACTIVE,PAUSED,DRAFT,ARCHIVED,CANCELED)))&count=${limit}`,
    { accountEmail: options?.accountEmail },
  );

  return {
    adAccountId,
    accountUrn,
    campaigns: (data.elements ?? []).map((row) => ({
      id: String(row.id ?? ""),
      name: row.name ?? "",
      status: row.status ?? "",
      objectiveType: row.objectiveType ?? "",
      type: row.type ?? "",
      dailyBudgetAmount: row.dailyBudget?.amount ?? "",
      dailyBudgetCurrency: row.dailyBudget?.currencyCode ?? "",
      campaignGroupUrn: row.campaignGroup ?? "",
    })),
  };
}

export async function linkedinGetCampaign(options: {
  adAccountId?: string;
  campaignId: string;
  accountEmail?: string;
}) {
  const adAccountId = resolveAdAccountId(options.adAccountId);
  const campaignId = options.campaignId.replace(/\D/g, "");
  if (!campaignId) throw new Error("campaignId is required.");

  const row = await linkedInApiFetch<LinkedInCampaignRow>(
    `/rest/adCampaigns/${campaignId}`,
    { accountEmail: options?.accountEmail },
  );

  return {
    adAccountId,
    campaign: {
      id: campaignId,
      name: row.name ?? "",
      status: row.status ?? "",
      objectiveType: row.objectiveType ?? "",
      type: row.type ?? "",
      dailyBudgetAmount: row.dailyBudget?.amount ?? "",
      dailyBudgetCurrency: row.dailyBudget?.currencyCode ?? "",
      campaignGroupUrn: row.campaignGroup ?? "",
    },
  };
}

export async function linkedinCreateWebsiteVisitCampaign(options: {
  adAccountId?: string;
  accountEmail?: string;
  dryRun?: boolean;
  name: string;
  finalUrl: string;
  dailyBudgetAmount: number;
  currencyCode?: string;
  countryCode?: string;
  languageCode?: string;
  idempotencyKey?: string;
  runDays?: number;
}) {
  const adAccountId = resolveAdAccountId(options.adAccountId);
  const dryRun = resolveDryRun(options.dryRun);
  const currencyCode = (options.currencyCode ?? "CAD").toUpperCase();
  const countryCode = (options.countryCode ?? "CA").toUpperCase();
  const languageCode = (options.languageCode ?? "en").toLowerCase();
  assertDailyBudgetWithinCap(options.dailyBudgetAmount);

  const campaignName = buildLinkedInCampaignName(options.name, options.idempotencyKey);
  const accountUrn = sponsoredAccountUrn(adAccountId);
  const runDays = options.runDays ?? 14;

  const campaignGroupBody = {
    account: accountUrn,
    name: `${campaignName} | Group`,
    status: "PAUSED",
    runSchedule: {
      start: runScheduleStartMs(),
      end: runScheduleEndMs(runDays),
    },
  };

  const campaignBody = {
    account: accountUrn,
    name: campaignName,
    status: "PAUSED",
    type: "SPONSORED_UPDATES",
    objectiveType: "WEBSITE_VISIT",
    costType: "CPC",
    creativeSelection: "OPTIMIZE",
    audienceExpansionEnabled: false,
    offsiteDeliveryEnabled: true,
    locale: { country: countryCode, language: languageCode },
    dailyBudget: {
      amount: String(options.dailyBudgetAmount),
      currencyCode,
    },
    unitCost: {
      amount: String(Math.max(2, Math.min(options.dailyBudgetAmount, 10))),
      currencyCode,
    },
    runSchedule: {
      start: runScheduleStartMs(),
      end: runScheduleEndMs(runDays),
    },
  };

  const preview = {
    dryRun,
    adAccountId,
    accountUrn,
    finalUrl: options.finalUrl,
    campaignGroupBody,
    campaignBody,
    note:
      "Creates PAUSED campaign group + PAUSED website-visit campaign. Add a sponsored creative in Campaign Manager or a future linkedin_create_creative tool. finalUrl is for your creative — not written until creative step.",
  };

  if (dryRun) {
    return { ...preview, applied: false };
  }

  const groupResult = await linkedInApiFetch<{ id?: number }>(
    "/rest/adCampaignGroups",
    {
      method: "POST",
      accountEmail: options.accountEmail,
      body: campaignGroupBody,
    },
  );

  const campaignGroupUrn = `urn:li:sponsoredCampaignGroup:${groupResult.id}`;
  const createCampaignBody = {
    ...campaignBody,
    campaignGroup: campaignGroupUrn,
  };

  const campaignResult = await linkedInApiFetch<{ id?: number }>("/rest/adCampaigns", {
    method: "POST",
    accountEmail: options.accountEmail,
    body: createCampaignBody,
  });

  return {
    ...preview,
    applied: true,
    campaignGroupId: String(groupResult.id ?? ""),
    campaignGroupUrn,
    campaignId: String(campaignResult.id ?? ""),
    campaignUrn: `urn:li:sponsoredCampaign:${campaignResult.id}`,
    status: "PAUSED",
    nextSteps: [
      "Upload or select a single-image/video creative in Campaign Manager.",
      `Set landing URL to ${options.finalUrl}.`,
      "Verify LinkedIn Insight Tag on the landing page before enabling spend.",
    ],
  };
}

export async function linkedinSetCampaignStatus(options: {
  adAccountId?: string;
  accountEmail?: string;
  dryRun?: boolean;
  campaignId: string;
  status: LinkedInCampaignStatusAction;
  confirmSpend?: string;
  confirmMeasurement?: string;
}) {
  const dryRun = resolveDryRun(options.dryRun);
  const campaignId = options.campaignId.replace(/\D/g, "");
  if (!campaignId) throw new Error("campaignId is required.");

  if (options.status === "ACTIVE") {
    assertCanEnableLinkedInSpend(options.confirmSpend, options.confirmMeasurement);
  }

  const patchBody = { patch: { $set: { status: options.status } } };
  const preview = {
    dryRun,
    campaignId,
    status: options.status,
    patchBody,
  };

  if (dryRun) {
    return { ...preview, applied: false };
  }

  await linkedInApiFetch(`/rest/adCampaigns/${campaignId}`, {
    method: "POST",
    accountEmail: options.accountEmail,
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
    body: patchBody,
  });

  return { ...preview, applied: true };
}

export async function linkedinListAuthorizedAccounts() {
  const store = getLinkedInAccountStore();
  const fileAccounts = await store.listAccounts();
  const envSummary = envLinkedInAccountSummary();
  const accounts = envSummary
    ? [
        envSummary,
        ...fileAccounts.filter((row) => row.email !== envSummary.email),
      ]
    : fileAccounts;
  const defaultMemberId =
    envSummary?.memberId ?? (await store.getDefaultMemberId());
  return {
    defaultMemberId,
    accounts,
    source: envSummary ? "env+file" : "file",
  };
}
