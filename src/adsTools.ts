import { z } from "zod";
import {
  adsApplySearchTargeting,
  adsCreateDemandGenVideoCampaign,
  adsCreateResponsiveSearchAd,
  adsGetCampaign,
  adsListAccessibleCustomers,
  adsListCampaigns,
  adsSearch,
  adsSetCampaignStatus,
  adsUpdateCampaignBudget,
  adsUploadImageAsset,
} from "./services/ads.js";
import {
  ENABLE_SPEND_CONFIRMATION,
  MEASUREMENT_CONFIRMATION,
} from "./services/adsSafety.js";

const accountEmailProperty = {
  accountEmail: {
    type: "string",
    description:
      "Google account email to use (e.g. you@gmail.com). Defaults to the configured default account.",
  },
} as const;

const customerIdProperty = {
  customerId: {
    type: "string",
    description:
      "Google Ads customer ID (digits; dashes optional). Defaults to GOOGLE_ADS_DEFAULT_CUSTOMER_ID.",
  },
} as const;

const loginCustomerIdProperty = {
  loginCustomerId: {
    type: "string",
    description:
      "Manager (MCC) customer ID when accessing a client account. Defaults to GOOGLE_ADS_LOGIN_CUSTOMER_ID.",
  },
} as const;

const dryRunProperty = {
  dryRun: {
    type: "boolean",
    description:
      "Default true. When true, validate and preview only — no Ads API writes. Pass false only after human approval.",
  },
} as const;

export const adsTools = [
  {
    name: "ads_list_accessible_customers",
    description:
      "List Google Ads customer IDs accessible to the authorized Google account. Read-only. Run this before creating ads. Requires GOOGLE_ADS_DEVELOPER_TOKEN and adwords OAuth scope (re-authorize after upgrade).",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty },
    },
  },
  {
    name: "ads_list_campaigns",
    description:
      "List campaigns for a Google Ads customer (status, channel, budget, cost). Read-only. Prefer this before any create/enable.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        maxResults: { type: "number", description: "Max campaigns (default 25, max 100)" },
        includeRemoved: {
          type: "boolean",
          description: "Include REMOVED campaigns (default false)",
        },
      },
    },
  },
  {
    name: "ads_get_campaign",
    description: "Get one campaign with budget and recent metrics. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        campaignId: { type: "string", description: "Numeric campaign ID" },
      },
      required: ["campaignId"],
    },
  },
  {
    name: "ads_search",
    description:
      "Run a read-only Google Ads Query Language (GAQL) SELECT. Max 100 rows. Mutations are rejected.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        query: { type: "string", description: "GAQL SELECT query" },
        maxResults: { type: "number", description: "Max rows if query has no LIMIT (default 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "ads_create_demand_gen_video_campaign",
    description:
      "Create a PAUSED Demand Gen campaign with a YouTube video responsive ad (budget + campaign + ad group + video asset + ad). dryRun defaults to true. Never enables spend. Requires a YouTube video ID (upload video to YouTube first) and, when applying, a logo asset resource name from ads_upload_image_asset.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        ...dryRunProperty,
        name: { type: "string", description: "Campaign name" },
        youtubeVideoId: {
          type: "string",
          description: "YouTube video ID (not a full URL)",
        },
        finalUrl: { type: "string", description: "Landing page URL" },
        headlines: {
          type: "array",
          items: { type: "string" },
          description: "Ad headlines (at least 1)",
        },
        descriptions: {
          type: "array",
          items: { type: "string" },
          description: "Ad descriptions (at least 1)",
        },
        dailyBudgetMicros: {
          type: "number",
          description: "Daily budget in micros (1e6 = $1). Capped by GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS (default $25).",
        },
        businessName: { type: "string", description: "Business name shown on the ad" },
        longHeadlines: {
          type: "array",
          items: { type: "string" },
          description: "Long headlines (defaults to first headline)",
        },
        logoAssetResourceName: {
          type: "string",
          description: "customers/{id}/assets/{assetId} from ads_upload_image_asset (required when dryRun=false)",
        },
        targetCpaMicros: {
          type: "number",
          description: "Optional Target CPA in micros; otherwise maximize conversions",
        },
        idempotencyKey: {
          type: "string",
          description: "Optional suffix appended to campaign name to avoid duplicate creates",
        },
      },
      required: [
        "name",
        "youtubeVideoId",
        "finalUrl",
        "headlines",
        "descriptions",
        "dailyBudgetMicros",
      ],
    },
  },
  {
    name: "ads_create_responsive_search_ad",
    description:
      "Create a PAUSED responsive search ad. Attach to an existing ad group, or create a PAUSED Search campaign+budget+ad group when createCampaign=true. dryRun defaults to true. Never enables spend.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        ...dryRunProperty,
        headlines: {
          type: "array",
          items: { type: "string" },
          description: "At least 3 headlines",
        },
        descriptions: {
          type: "array",
          items: { type: "string" },
          description: "At least 2 descriptions",
        },
        finalUrl: { type: "string", description: "Landing page URL" },
        adGroupResourceName: {
          type: "string",
          description: "Existing ad group resource name (if not creating a campaign)",
        },
        createCampaign: {
          type: "boolean",
          description: "If true, create PAUSED Search campaign + budget + ad group",
        },
        campaignName: { type: "string", description: "Required when createCampaign=true" },
        dailyBudgetMicros: {
          type: "number",
          description: "Required when createCampaign=true; capped by env max",
        },
        idempotencyKey: { type: "string" },
      },
      required: ["headlines", "descriptions", "finalUrl"],
    },
  },
  {
    name: "ads_upload_image_asset",
    description:
      "Upload an image asset (logo/marketing image) for Demand Gen ads. dryRun defaults to true (validates/fetches only). Pass dryRun:false to upload. Use returned resourceName as logoAssetResourceName.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        ...dryRunProperty,
        name: { type: "string", description: "Asset display name" },
        imageUrl: { type: "string", description: "Public https image URL to fetch" },
        imageBase64: { type: "string", description: "Raw base64 image bytes (alternative to imageUrl)" },
      },
      required: ["name"],
    },
  },
  {
    name: "ads_set_campaign_status",
    description:
      `Set campaign status. PAUSED/REMOVED always allowed. ENABLED requires GOOGLE_ADS_ALLOW_ENABLE=true, confirmSpend: "${ENABLE_SPEND_CONFIRMATION}", AND confirmMeasurement: "${MEASUREMENT_CONFIRMATION}" after verifying GTM (or gtag/GA4 + Ads conversion) on the landing URL. dryRun defaults to true. Automations must never enable spend.`,
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        ...dryRunProperty,
        campaignId: { type: "string", description: "Numeric campaign ID" },
        campaignResourceName: {
          type: "string",
          description: "customers/{cid}/campaigns/{id} (alternative to campaignId)",
        },
        status: {
          type: "string",
          enum: ["PAUSED", "ENABLED", "REMOVED"],
          description: "Target status",
        },
        confirmSpend: {
          type: "string",
          description: `Must be "${ENABLE_SPEND_CONFIRMATION}" when status is ENABLED`,
        },
        confirmMeasurement: {
          type: "string",
          description: `Must be "${MEASUREMENT_CONFIRMATION}" when status is ENABLED (GTM or equivalent conversion tagging verified on landing URL)`,
        },
      },
      required: ["status"],
    },
  },
  {
    name: "ads_update_campaign_budget",
    description:
      "Update a campaign budget amount (micros), capped by GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS. dryRun defaults to true.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        ...dryRunProperty,
        budgetResourceName: {
          type: "string",
          description: "customers/{cid}/campaignBudgets/{id}",
        },
        dailyBudgetMicros: { type: "number", description: "New daily budget in micros" },
      },
      required: ["budgetResourceName", "dailyBudgetMicros"],
    },
  },
  {
    name: "ads_apply_search_targeting",
    description:
      "Add Search campaign locations, keywords, campaign negatives, and in-market audiences (Observation / bid_only). Optionally remove broad or listed keywords. dryRun defaults to true. Does not enable spend.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...customerIdProperty,
        ...loginCustomerIdProperty,
        ...dryRunProperty,
        campaignId: { type: "string", description: "Numeric campaign ID" },
        adGroupId: { type: "string", description: "Numeric ad group ID" },
        geoTargetConstantIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Geo IDs (e.g. 2124 Canada, 2840 US, 1001801 Calgary) or geoTargetConstants/{id}",
        },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              matchType: {
                type: "string",
                enum: ["EXACT", "PHRASE", "BROAD"],
              },
              negative: { type: "boolean" },
            },
            required: ["text"],
          },
          description: "Ad group keywords (default matchType PHRASE)",
        },
        negativeKeywords: {
          type: "array",
          items: { type: "string" },
          description: "Campaign-level broad negative keywords",
        },
        userInterestIds: {
          type: "array",
          items: { type: "string" },
          description: "In-market user interest IDs (Observation mode)",
        },
        removeKeywordTexts: {
          type: "array",
          items: { type: "string" },
          description: "Existing keyword texts to remove (case-insensitive)",
        },
        removeExistingBroadKeywords: {
          type: "boolean",
          description: "Remove all existing BROAD keywords in the ad group",
        },
      },
      required: ["campaignId", "adGroupId"],
    },
  },
] as const;

const accountEmailSchema = z.string().email().optional();
const customerIdSchema = z.string().optional();
const loginCustomerIdSchema = z.string().optional();
const dryRunSchema = z.boolean().optional();

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleAdsTool(
  name: string,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true } | null> {
  switch (name) {
    case "ads_list_accessible_customers": {
      const input = z.object({ accountEmail: accountEmailSchema }).parse(args ?? {});
      return jsonResult(await adsListAccessibleCustomers(input.accountEmail));
    }
    case "ads_list_campaigns": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          maxResults: z.number().int().positive().max(100).optional(),
          includeRemoved: z.boolean().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsListCampaigns(input));
    }
    case "ads_get_campaign": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          campaignId: z.string().min(1),
        })
        .parse(args ?? {});
      return jsonResult(await adsGetCampaign(input));
    }
    case "ads_search": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          query: z.string().min(1),
          maxResults: z.number().int().positive().max(100).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsSearch(input));
    }
    case "ads_create_demand_gen_video_campaign": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          dryRun: dryRunSchema,
          name: z.string().min(1),
          youtubeVideoId: z.string().min(1),
          finalUrl: z.string().url(),
          headlines: z.array(z.string()).min(1),
          descriptions: z.array(z.string()).min(1),
          dailyBudgetMicros: z.number().int().positive(),
          businessName: z.string().optional(),
          longHeadlines: z.array(z.string()).optional(),
          logoAssetResourceName: z.string().optional(),
          targetCpaMicros: z.number().int().positive().optional(),
          idempotencyKey: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsCreateDemandGenVideoCampaign(input));
    }
    case "ads_create_responsive_search_ad": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          dryRun: dryRunSchema,
          headlines: z.array(z.string()).min(3),
          descriptions: z.array(z.string()).min(2),
          finalUrl: z.string().url(),
          adGroupResourceName: z.string().optional(),
          createCampaign: z.boolean().optional(),
          campaignName: z.string().optional(),
          dailyBudgetMicros: z.number().int().positive().optional(),
          idempotencyKey: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsCreateResponsiveSearchAd(input));
    }
    case "ads_upload_image_asset": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          dryRun: dryRunSchema,
          name: z.string().min(1),
          imageUrl: z.string().url().optional(),
          imageBase64: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsUploadImageAsset(input));
    }
    case "ads_set_campaign_status": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          dryRun: dryRunSchema,
          campaignId: z.string().optional(),
          campaignResourceName: z.string().optional(),
          status: z.enum(["PAUSED", "ENABLED", "REMOVED"]),
          confirmSpend: z.string().optional(),
          confirmMeasurement: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsSetCampaignStatus(input));
    }
    case "ads_update_campaign_budget": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          dryRun: dryRunSchema,
          budgetResourceName: z.string().min(1),
          dailyBudgetMicros: z.number().int().positive(),
        })
        .parse(args ?? {});
      return jsonResult(await adsUpdateCampaignBudget(input));
    }
    case "ads_apply_search_targeting": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          customerId: customerIdSchema,
          loginCustomerId: loginCustomerIdSchema,
          dryRun: dryRunSchema,
          campaignId: z.string().min(1),
          adGroupId: z.string().min(1),
          geoTargetConstantIds: z.array(z.string()).optional(),
          keywords: z
            .array(
              z.object({
                text: z.string().min(1),
                matchType: z.enum(["EXACT", "PHRASE", "BROAD"]).optional(),
                negative: z.boolean().optional(),
              }),
            )
            .optional(),
          negativeKeywords: z.array(z.string()).optional(),
          userInterestIds: z.array(z.string()).optional(),
          removeKeywordTexts: z.array(z.string()).optional(),
          removeExistingBroadKeywords: z.boolean().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsApplySearchTargeting(input));
    }
    default:
      return null;
  }
}
