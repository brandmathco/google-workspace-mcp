import { z } from "zod";
import {
  linkedinCreateWebsiteVisitCampaign,
  linkedinGetCampaign,
  linkedinListAccounts,
  linkedinListAuthorizedAccounts,
  linkedinListCampaigns,
  linkedinSetCampaignStatus,
} from "./services/linkedin.js";
import {
  LINKEDIN_ENABLE_SPEND_CONFIRMATION,
  LINKEDIN_MEASUREMENT_CONFIRMATION,
} from "./services/linkedinSafety.js";

const accountEmailProperty = {
  accountEmail: {
    type: "string",
    description:
      "LinkedIn-authorized account email. Defaults to the configured default LinkedIn account.",
  },
} as const;

const adAccountIdProperty = {
  adAccountId: {
    type: "string",
    description:
      "LinkedIn Campaign Manager ad account ID (9 digits). Defaults to LINKEDIN_DEFAULT_AD_ACCOUNT_ID.",
  },
} as const;

const dryRunProperty = {
  dryRun: {
    type: "boolean",
    description:
      "Default true. When true, validate and preview only — no LinkedIn API writes. Pass false only after human approval.",
  },
} as const;

export const linkedinTools = [
  {
    name: "linkedin_list_authorized_accounts",
    description:
      "List LinkedIn member accounts authorized for this MCP (OAuth refresh tokens). Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "linkedin_list_ad_accounts",
    description:
      "List LinkedIn ad accounts accessible to the authorized member. Read-only. Requires Advertising API approval and rw_ads scope.",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty },
    },
  },
  {
    name: "linkedin_list_campaigns",
    description:
      "List campaigns for a LinkedIn ad account (status, objective, budget). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...adAccountIdProperty,
        maxResults: { type: "number", description: "Max campaigns (default 25, max 100)" },
      },
    },
  },
  {
    name: "linkedin_get_campaign",
    description: "Get one LinkedIn campaign by ID. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...adAccountIdProperty,
        campaignId: { type: "string", description: "Numeric campaign ID" },
      },
      required: ["campaignId"],
    },
  },
  {
    name: "linkedin_create_website_visit_campaign",
    description:
      "Create a PAUSED LinkedIn campaign group + PAUSED website-visit (Sponsored Content) campaign. dryRun defaults to true. Does not enable spend. Creative/landing ad still required in Campaign Manager or a future creative tool.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...adAccountIdProperty,
        ...dryRunProperty,
        name: { type: "string", description: "Campaign name" },
        finalUrl: { type: "string", description: "Landing URL for the ad creative" },
        dailyBudgetAmount: {
          type: "number",
          description: "Daily budget in account currency (capped by LINKEDIN_MAX_DAILY_BUDGET_AMOUNT)",
        },
        currencyCode: { type: "string", description: "ISO currency, default CAD" },
        countryCode: { type: "string", description: "Targeting locale country, default CA" },
        languageCode: { type: "string", description: "Targeting locale language, default en" },
        idempotencyKey: { type: "string", description: "Optional suffix to avoid duplicate names" },
        runDays: { type: "number", description: "Schedule length in days (default 14)" },
      },
      required: ["name", "finalUrl", "dailyBudgetAmount"],
    },
  },
  {
    name: "linkedin_set_campaign_status",
    description:
      'Set campaign status PAUSED / ACTIVE / ARCHIVED. ACTIVE requires LINKEDIN_ALLOW_ENABLE=true, confirmSpend: "ENABLE_SPEND", and confirmMeasurement: "INSIGHT_TAG_OR_EQUIVALENT_VERIFIED". dryRun defaults to true.',
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...adAccountIdProperty,
        ...dryRunProperty,
        campaignId: { type: "string", description: "Numeric campaign ID" },
        status: {
          type: "string",
          enum: ["PAUSED", "ACTIVE", "ARCHIVED"],
        },
        confirmSpend: { type: "string", description: 'Must be "ENABLE_SPEND" when status is ACTIVE' },
        confirmMeasurement: {
          type: "string",
          description: 'Must be "INSIGHT_TAG_OR_EQUIVALENT_VERIFIED" when status is ACTIVE',
        },
      },
      required: ["campaignId", "status"],
    },
  },
] as const;

const accountEmailSchema = z.string().email().optional();
const adAccountIdSchema = z.string().optional();
const dryRunSchema = z.boolean().optional();

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleLinkedInTool(
  name: string,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean } | null> {
  switch (name) {
    case "linkedin_list_authorized_accounts":
      return jsonResult(await linkedinListAuthorizedAccounts());
    case "linkedin_list_ad_accounts": {
      const input = z.object({ accountEmail: accountEmailSchema }).parse(args ?? {});
      return jsonResult(await linkedinListAccounts(input));
    }
    case "linkedin_list_campaigns": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adAccountId: adAccountIdSchema,
          maxResults: z.number().int().positive().max(100).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinListCampaigns(input));
    }
    case "linkedin_get_campaign": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adAccountId: adAccountIdSchema,
          campaignId: z.string().min(1),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinGetCampaign(input));
    }
    case "linkedin_create_website_visit_campaign": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adAccountId: adAccountIdSchema,
          dryRun: dryRunSchema,
          name: z.string().min(1),
          finalUrl: z.string().url(),
          dailyBudgetAmount: z.number().positive(),
          currencyCode: z.string().optional(),
          countryCode: z.string().optional(),
          languageCode: z.string().optional(),
          idempotencyKey: z.string().optional(),
          runDays: z.number().int().positive().max(90).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinCreateWebsiteVisitCampaign(input));
    }
    case "linkedin_set_campaign_status": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adAccountId: adAccountIdSchema,
          dryRun: dryRunSchema,
          campaignId: z.string().min(1),
          status: z.enum(["PAUSED", "ACTIVE", "ARCHIVED"]),
          confirmSpend: z.string().optional(),
          confirmMeasurement: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinSetCampaignStatus(input));
    }
    default:
      return null;
  }
}

export { LINKEDIN_ENABLE_SPEND_CONFIRMATION, LINKEDIN_MEASUREMENT_CONFIRMATION };
