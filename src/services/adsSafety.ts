/** Spend-safety guards for Google Ads MCP tools. */

export const ENABLE_SPEND_CONFIRMATION = "ENABLE_SPEND" as const;

/** Human must verify GTM (or gtag/GA4 + Ads conversion) on the landing URL before enable. */
export const MEASUREMENT_CONFIRMATION = "GTM_OR_EQUIVALENT_VERIFIED" as const;

export const DEFAULT_MAX_DAILY_BUDGET_MICROS = 25_000_000; // $25/day

export type CampaignStatusAction = "PAUSED" | "ENABLED" | "REMOVED";

export function getMaxDailyBudgetMicros(): number {
  const raw = process.env.GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS?.trim();
  if (!raw) return DEFAULT_MAX_DAILY_BUDGET_MICROS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      "GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS must be a positive integer (micros).",
    );
  }
  return Math.floor(parsed);
}

export function isAdsEnableAllowed(): boolean {
  return process.env.GOOGLE_ADS_ALLOW_ENABLE?.trim().toLowerCase() === "true";
}

export function assertDailyBudgetWithinCap(dailyBudgetMicros: number): void {
  const max = getMaxDailyBudgetMicros();
  if (!Number.isFinite(dailyBudgetMicros) || dailyBudgetMicros <= 0) {
    throw new Error("dailyBudgetMicros must be a positive integer.");
  }
  if (dailyBudgetMicros > max) {
    throw new Error(
      `dailyBudgetMicros ${dailyBudgetMicros} exceeds cap ${max} ` +
        `(GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS / default $25/day). ` +
        `Raise the env cap only if you intentionally allow higher spend.`,
    );
  }
}

/**
 * dryRun defaults to true — mutating tools must not write unless the caller
 * explicitly passes dryRun: false.
 */
export function resolveDryRun(dryRun: boolean | undefined): boolean {
  return dryRun !== false;
}

export function assertCanEnableSpend(
  confirmSpend: string | undefined,
  confirmMeasurement?: string | undefined,
): void {
  if (!isAdsEnableAllowed()) {
    throw new Error(
      "Enabling campaigns is blocked. Set GOOGLE_ADS_ALLOW_ENABLE=true on the MCP host " +
        "AND pass confirmSpend: \"ENABLE_SPEND\" only after a human reviews the draft. " +
        `Also pass confirmMeasurement: "${MEASUREMENT_CONFIRMATION}" after verifying ` +
        "GTM (or equivalent conversion measurement) on the landing URL.",
    );
  }
  if (confirmSpend !== ENABLE_SPEND_CONFIRMATION) {
    throw new Error(
      `To enable spend, pass confirmSpend: "${ENABLE_SPEND_CONFIRMATION}" after human approval. ` +
        "Creates always stay PAUSED; never enable from automation without an explicit review.",
    );
  }
  if (confirmMeasurement !== MEASUREMENT_CONFIRMATION) {
    throw new Error(
      `To enable spend, pass confirmMeasurement: "${MEASUREMENT_CONFIRMATION}" after verifying ` +
        "Google Tag Manager (or equivalent: gtag/GA4 + Google Ads conversion tag) fires on the " +
        "campaign landing URL. Do not enable campaigns without conversion measurement.",
    );
  }
}

export function normalizeCustomerId(customerId: string): string {
  const cleaned = customerId.replace(/-/g, "").trim();
  if (!/^\d{6,12}$/.test(cleaned)) {
    throw new Error(
      `Invalid customerId "${customerId}". Use digits only (dashes optional), e.g. 1234567890.`,
    );
  }
  return cleaned;
}

export function resolveCustomerId(customerId?: string): string {
  const fromArg = customerId?.trim();
  if (fromArg) return normalizeCustomerId(fromArg);
  const fromEnv = process.env.GOOGLE_ADS_DEFAULT_CUSTOMER_ID?.trim();
  if (fromEnv) return normalizeCustomerId(fromEnv);
  throw new Error(
    "customerId is required (or set GOOGLE_ADS_DEFAULT_CUSTOMER_ID).",
  );
}

export function buildCampaignName(name: string, idempotencyKey?: string): string {
  const base = name.trim();
  if (!base) throw new Error("Campaign name is required.");
  const key = idempotencyKey?.trim();
  if (!key) return base;
  return `${base} [${key}]`;
}
