import { z } from "zod";
import {
  adsenseGenerateReport,
  adsenseListAccounts,
  adsenseListAdClients,
  adsenseListAdUnits,
  adsenseListPayments,
  adsenseListSites,
} from "./services/adsense.js";
import { ADSENSE_DATE_RANGES } from "./services/adsenseFormat.js";

const accountEmailProperty = {
  accountEmail: {
    type: "string",
    description:
      "Google account email to use. Defaults to the configured default account.",
  },
} as const;

const accountProperty = {
  account: {
    type: "string",
    description:
      "AdSense account: pub-…, ca-pub-…, or accounts/pub-…. Defaults to the only visible account or GOOGLE_ADSENSE_DEFAULT_ACCOUNT.",
  },
} as const;

const pageProperties = {
  pageSize: { type: "number", description: "Page size (default 50, max 100)." },
  pageToken: { type: "string", description: "Page token from a previous list response." },
} as const;

export const adsenseTools = [
  {
    name: "adsense_list_accounts",
    description:
      "List AdSense accounts for the authorized Google account. Read-only. Requires adsense.readonly (re-authorize after upgrade) and the AdSense Management API enabled in Google Cloud.",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty, ...pageProperties },
    },
  },
  {
    name: "adsense_list_sites",
    description: "List sites on an AdSense account. Read-only.",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty, ...accountProperty, ...pageProperties },
    },
  },
  {
    name: "adsense_list_ad_clients",
    description:
      "List AdSense ad clients (product codes such as AFC). Read-only. Pass the returned name to adsense_list_ad_units.",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty, ...accountProperty, ...pageProperties },
    },
  },
  {
    name: "adsense_list_ad_units",
    description: "List ad units under an AdSense ad client. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        adClient: {
          type: "string",
          description: "Ad client resource name from adsense_list_ad_clients.",
        },
        ...pageProperties,
      },
      required: ["adClient"],
    },
  },
  {
    name: "adsense_list_payments",
    description: "List AdSense payments, including unpaid earnings. Read-only.",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty, ...accountProperty },
    },
  },
  {
    name: "adsense_generate_report",
    description:
      "Generate an AdSense earnings report. Read-only. Default metrics: ESTIMATED_EARNINGS, PAGE_VIEWS, IMPRESSIONS, CLICKS. Dimensions e.g. DATE, DOMAIN_NAME, AD_UNIT_NAME, COUNTRY_CODE.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountProperty,
        dateRange: {
          type: "string",
          enum: [...ADSENSE_DATE_RANGES],
          description: "Preset range. Ignored when startDate and endDate are set.",
        },
        startDate: { type: "string", description: "YYYY-MM-DD. Pair with endDate." },
        endDate: { type: "string", description: "YYYY-MM-DD. Pair with startDate." },
        metrics: { type: "array", items: { type: "string" } },
        dimensions: { type: "array", items: { type: "string" } },
        filters: {
          type: "array",
          items: { type: "string" },
          description: 'AdSense filter expressions, e.g. DOMAIN_NAME=="example.com".',
        },
        currencyCode: { type: "string", description: "ISO 4217 currency, e.g. CAD." },
        limit: { type: "number", description: "Max rows (default 100, max 500)." },
        orderBy: { type: "array", items: { type: "string" } },
      },
    },
  },
] as const;

const accountEmailSchema = z.string().email().optional();
const pageSchema = {
  pageSize: z.number().int().positive().max(100).optional(),
  pageToken: z.string().min(1).optional(),
};

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleAdsenseTool(
  name: string,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true } | null> {
  switch (name) {
    case "adsense_list_accounts": {
      const input = z.object({ accountEmail: accountEmailSchema, ...pageSchema }).parse(args ?? {});
      return jsonResult(await adsenseListAccounts(input));
    }
    case "adsense_list_sites": {
      const input = z
        .object({ accountEmail: accountEmailSchema, account: z.string().optional(), ...pageSchema })
        .parse(args ?? {});
      return jsonResult(await adsenseListSites(input));
    }
    case "adsense_list_ad_clients": {
      const input = z
        .object({ accountEmail: accountEmailSchema, account: z.string().optional(), ...pageSchema })
        .parse(args ?? {});
      return jsonResult(await adsenseListAdClients(input));
    }
    case "adsense_list_ad_units": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          adClient: z.string().min(1),
          ...pageSchema,
        })
        .parse(args ?? {});
      return jsonResult(await adsenseListAdUnits(input));
    }
    case "adsense_list_payments": {
      const input = z
        .object({ accountEmail: accountEmailSchema, account: z.string().optional() })
        .parse(args ?? {});
      return jsonResult(await adsenseListPayments(input));
    }
    case "adsense_generate_report": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          account: z.string().optional(),
          dateRange: z.enum(ADSENSE_DATE_RANGES).optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          metrics: z.array(z.string().min(1)).max(20).optional(),
          dimensions: z.array(z.string().min(1)).max(10).optional(),
          filters: z.array(z.string().min(1)).max(10).optional(),
          currencyCode: z.string().length(3).optional(),
          limit: z.number().int().positive().max(500).optional(),
          orderBy: z.array(z.string().min(1)).max(5).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await adsenseGenerateReport(input));
    }
    default:
      return null;
  }
}
