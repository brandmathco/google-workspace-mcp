/** Spend-safety guards for LinkedIn Ads MCP tools. */

export const LINKEDIN_ENABLE_SPEND_CONFIRMATION = "ENABLE_SPEND" as const;

export const LINKEDIN_MEASUREMENT_CONFIRMATION =
  "INSIGHT_TAG_OR_EQUIVALENT_VERIFIED" as const;

export const DEFAULT_MAX_DAILY_BUDGET_AMOUNT = 25;

export type LinkedInCampaignStatusAction = "PAUSED" | "ACTIVE" | "ARCHIVED";

export function getMaxDailyBudgetAmount(): number {
  const raw = process.env.LINKEDIN_MAX_DAILY_BUDGET_AMOUNT?.trim();
  if (!raw) return DEFAULT_MAX_DAILY_BUDGET_AMOUNT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("LINKEDIN_MAX_DAILY_BUDGET_AMOUNT must be a positive number.");
  }
  return parsed;
}

export function isLinkedInEnableAllowed(): boolean {
  return process.env.LINKEDIN_ALLOW_ENABLE?.trim().toLowerCase() === "true";
}

export function assertDailyBudgetWithinCap(dailyBudgetAmount: number): void {
  const max = getMaxDailyBudgetAmount();
  if (!Number.isFinite(dailyBudgetAmount) || dailyBudgetAmount <= 0) {
    throw new Error("dailyBudgetAmount must be a positive number.");
  }
  if (dailyBudgetAmount > max) {
    throw new Error(
      `dailyBudgetAmount ${dailyBudgetAmount} exceeds cap ${max} ` +
        `(LINKEDIN_MAX_DAILY_BUDGET_AMOUNT / default $25/day).`,
    );
  }
}

export function resolveDryRun(dryRun: boolean | undefined): boolean {
  return dryRun !== false;
}

export function assertCanEnableLinkedInSpend(
  confirmSpend: string | undefined,
  confirmMeasurement?: string | undefined,
): void {
  if (!isLinkedInEnableAllowed()) {
    throw new Error(
      "Enabling LinkedIn campaigns is blocked. Set LINKEDIN_ALLOW_ENABLE=true on the MCP host " +
        'AND pass confirmSpend: "ENABLE_SPEND" only after a human reviews the draft. ' +
        `Also pass confirmMeasurement: "${LINKEDIN_MEASUREMENT_CONFIRMATION}" after verifying ` +
        "LinkedIn Insight Tag (or equivalent conversion measurement) on the landing URL.",
    );
  }
  if (confirmSpend !== LINKEDIN_ENABLE_SPEND_CONFIRMATION) {
    throw new Error(
      `To enable spend, pass confirmSpend: "${LINKEDIN_ENABLE_SPEND_CONFIRMATION}" after human approval.`,
    );
  }
  if (confirmMeasurement !== LINKEDIN_MEASUREMENT_CONFIRMATION) {
    throw new Error(
      `To enable spend, pass confirmMeasurement: "${LINKEDIN_MEASUREMENT_CONFIRMATION}" after verifying ` +
        "LinkedIn Insight Tag or equivalent conversion tracking on the landing URL.",
    );
  }
}

export function normalizeAdAccountId(adAccountId: string): string {
  const cleaned = adAccountId.replace(/\D/g, "").trim();
  if (!/^\d{6,12}$/.test(cleaned)) {
    throw new Error(
      `Invalid adAccountId "${adAccountId}". Use digits only (9-digit Campaign Manager ID).`,
    );
  }
  return cleaned;
}

export function resolveAdAccountId(adAccountId?: string): string {
  const fromArg = adAccountId?.trim();
  if (fromArg) return normalizeAdAccountId(fromArg);
  const fromEnv = process.env.LINKEDIN_DEFAULT_AD_ACCOUNT_ID?.trim();
  if (fromEnv) return normalizeAdAccountId(fromEnv);
  throw new Error(
    "adAccountId is required (or set LINKEDIN_DEFAULT_AD_ACCOUNT_ID).",
  );
}

export function sponsoredAccountUrn(adAccountId: string): string {
  return `urn:li:sponsoredAccount:${normalizeAdAccountId(adAccountId)}`;
}

export function buildLinkedInCampaignName(name: string, idempotencyKey?: string): string {
  const base = name.trim();
  if (!base) throw new Error("Campaign name is required.");
  const key = idempotencyKey?.trim();
  if (!key) return base;
  return `${base} [${key}]`;
}

export function linkedInApiVersion(): string {
  return process.env.LINKEDIN_API_VERSION?.trim() || "202601";
}

const LINKEDIN_GEO_URN: Record<string, string> = {
  CA: "urn:li:geo:101174742",
  US: "urn:li:geo:103644278",
};

const LINKEDIN_LOCALE_URN: Record<string, string> = {
  CA: "urn:li:locale:en_US",
  US: "urn:li:locale:en_US",
};

/** Minimal geo + interface locale targeting required by LinkedIn REST campaigns API. */
export function buildLinkedInGeoTargetingCriteria(
  countryCode: string,
  languageCode = "en",
): Record<string, unknown> {
  const country = countryCode.trim().toUpperCase();
  const geoUrn = LINKEDIN_GEO_URN[country] ?? LINKEDIN_GEO_URN.CA;
  const localeUrn =
    LINKEDIN_LOCALE_URN[country] ??
    (languageCode.toLowerCase().startsWith("fr")
      ? "urn:li:locale:fr_CA"
      : "urn:li:locale:en_US");

  return {
    include: {
      and: [
        {
          or: {
            "urn:li:adTargetingFacet:locations": [geoUrn],
          },
        },
        {
          or: {
            "urn:li:adTargetingFacet:interfaceLocales": [localeUrn],
          },
        },
      ],
    },
  };
}
