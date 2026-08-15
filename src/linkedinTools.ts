import { z } from "zod";
import {
  linkedinCreateWebsiteVisitCampaign,
  linkedinGetAdAccount,
  linkedinGetCampaign,
  linkedinListAccounts,
  linkedinListAuthorizedAccounts,
  linkedinListCampaigns,
  linkedinSetCampaignStatus,
} from "./services/linkedin.js";
import {
  linkedinCreateSponsoredImageCreative,
  linkedinListCreatives,
  linkedinResolveOrganization,
  linkedinUploadImageFromUrl,
} from "./services/linkedinCreative.js";
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
    name: "linkedin_get_ad_account",
    description: "Get LinkedIn ad account metadata (name, currency, linked entities). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...adAccountIdProperty,
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
  {
    name: "linkedin_resolve_organization",
    description:
      "Resolve LinkedIn company page organization ID from vanity name or LINKEDIN_DEFAULT_ORGANIZATION_ID. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        organizationId: {
          type: "string",
          description: "Optional numeric organization ID (overrides vanity lookup)",
        },
        vanityName: {
          type: "string",
          description: "Company vanity slug, default brandmatchco-inc-consulting",
        },
      },
    },
  },
  {
    name: "linkedin_upload_image_from_url",
    description:
      "Upload a PNG/JPG/GIF from a public URL to LinkedIn Images API for the company page. dryRun defaults to true.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...dryRunProperty,
        imageUrl: { type: "string", description: "Public HTTPS image URL" },
        organizationId: { type: "string", description: "Optional org ID" },
        vanityName: { type: "string", description: "Optional company vanity slug" },
      },
      required: ["imageUrl"],
    },
  },
  {
    name: "linkedin_create_sponsored_image_creative",
    description:
      "Create a DRAFT single-image sponsored creative on a website-visit campaign. Uploads image, creates a sponsored post, then attaches it to the campaign. dryRun defaults to true.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...adAccountIdProperty,
        ...dryRunProperty,
        campaignId: { type: "string", description: "Numeric campaign ID" },
        organizationId: { type: "string", description: "Optional org ID" },
        vanityName: { type: "string", description: "Optional company vanity slug" },
        imageUrl: { type: "string", description: "Public image URL (default BMG og:image)" },
        imageUrn: { type: "string", description: "Skip upload when reusing an existing urn:li:image" },
        commentary: { type: "string", description: "Primary ad copy / intro text" },
        mediaTitle: { type: "string", description: "Image headline/title shown on the ad" },
        landingPageUrl: { type: "string", description: "Click-through URL" },
        ctaLabel: {
          type: "string",
          enum: [
            "APPLY",
            "DOWNLOAD",
            "VIEW_QUOTE",
            "LEARN_MORE",
            "SIGN_UP",
            "SUBSCRIBE",
            "REGISTER",
            "JOIN",
            "ATTEND",
            "REQUEST_DEMO",
            "SEE_MORE",
          ],
          description: "CTA button label, default LEARN_MORE",
        },
        intendedStatus: {
          type: "string",
          enum: ["DRAFT", "ACTIVE"],
          description: "Creative status, default DRAFT",
        },
        creativeName: { type: "string", description: "Optional display name in Campaign Manager" },
      },
      required: ["campaignId", "commentary", "mediaTitle", "landingPageUrl"],
    },
  },
  {
    name: "linkedin_list_creatives",
    description: "List creatives in an ad account, optionally filtered by campaign. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...adAccountIdProperty,
        campaignId: { type: "string", description: "Optional campaign filter" },
        maxResults: { type: "number", description: "Max creatives (default 25, max 100)" },
      },
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
    case "linkedin_get_ad_account": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adAccountId: adAccountIdSchema,
        })
        .parse(args ?? {});
      return jsonResult(await linkedinGetAdAccount(input));
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
    case "linkedin_resolve_organization": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          organizationId: z.string().optional(),
          vanityName: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinResolveOrganization(input));
    }
    case "linkedin_upload_image_from_url": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          dryRun: dryRunSchema,
          imageUrl: z.string().url(),
          organizationId: z.string().optional(),
          vanityName: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinUploadImageFromUrl(input));
    }
    case "linkedin_create_sponsored_image_creative": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adAccountId: adAccountIdSchema,
          dryRun: dryRunSchema,
          campaignId: z.string().min(1),
          organizationId: z.string().optional(),
          vanityName: z.string().optional(),
          imageUrl: z.string().url().optional(),
          imageUrn: z.string().optional(),
          commentary: z.string().min(1),
          mediaTitle: z.string().min(1),
          landingPageUrl: z.string().url(),
          ctaLabel: z
            .enum([
              "APPLY",
              "DOWNLOAD",
              "VIEW_QUOTE",
              "LEARN_MORE",
              "SIGN_UP",
              "SUBSCRIBE",
              "REGISTER",
              "JOIN",
              "ATTEND",
              "REQUEST_DEMO",
              "SEE_MORE",
            ])
            .optional(),
          intendedStatus: z.enum(["DRAFT", "ACTIVE"]).optional(),
          creativeName: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinCreateSponsoredImageCreative(input));
    }
    case "linkedin_list_creatives": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adAccountId: adAccountIdSchema,
          campaignId: z.string().optional(),
          maxResults: z.number().int().positive().max(100).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await linkedinListCreatives(input));
    }
    default:
      return null;
  }
}

export { LINKEDIN_ENABLE_SPEND_CONFIRMATION, LINKEDIN_MEASUREMENT_CONFIRMATION };
