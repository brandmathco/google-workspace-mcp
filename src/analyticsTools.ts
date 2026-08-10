import { z } from "zod";
import {
  analyticsGetMetadata,
  analyticsListAccountSummaries,
  analyticsRunRealtimeReport,
  analyticsRunReport,
} from "./services/analytics.js";

const accountEmailProperty = {
  accountEmail: {
    type: "string",
    description:
      "Google account email to use (e.g. you@gmail.com). Defaults to the configured default account.",
  },
} as const;

const propertyIdProperty = {
  propertyId: {
    type: "string",
    description:
      "GA4 property ID (numeric or properties/{id}). Defaults to GOOGLE_ANALYTICS_DEFAULT_PROPERTY_ID.",
  },
} as const;

export const analyticsTools = [
  {
    name: "analytics_list_account_summaries",
    description:
      "List Google Analytics 4 accounts and properties accessible to the authorized Google account. Read-only. Run this first to discover property IDs. Requires analytics.readonly OAuth scope (re-authorize after upgrade) and Google Analytics Admin API enabled in GCP.",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty },
    },
  },
  {
    name: "analytics_get_metadata",
    description:
      "List available GA4 dimensions and metrics for a property (useful before analytics_run_report). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...propertyIdProperty,
      },
    },
  },
  {
    name: "analytics_run_report",
    description:
      "Run a Google Analytics Data API (GA4) report. Read-only. Example metrics: sessions, activeUsers, totalUsers, screenPageViews, bounceRate. Example dimensions: date, sessionDefaultChannelGroup, pagePath, country.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...propertyIdProperty,
        startDate: {
          type: "string",
          description: "Start date: YYYY-MM-DD, yesterday, today, or NdaysAgo",
        },
        endDate: {
          type: "string",
          description: "End date: YYYY-MM-DD, yesterday, today, or NdaysAgo",
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "GA4 metric apiNames (e.g. sessions, activeUsers)",
        },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Optional GA4 dimension apiNames (e.g. date, pagePath)",
        },
        limit: {
          type: "number",
          description: "Max rows (default 100, max 10000)",
        },
        keepEmptyRows: {
          type: "boolean",
          description: "Include rows with all metrics = 0 (default false)",
        },
        currencyCode: {
          type: "string",
          description: "Optional ISO 4217 currency code for currency metrics",
        },
      },
      required: ["startDate", "endDate", "metrics"],
    },
  },
  {
    name: "analytics_run_realtime_report",
    description:
      "Run a GA4 realtime report (active users right now). Read-only. Common metric: activeUsers. Dimensions e.g. country, unifiedScreenName.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...propertyIdProperty,
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Realtime metric apiNames (e.g. activeUsers)",
        },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Optional realtime dimension apiNames",
        },
        limit: {
          type: "number",
          description: "Max rows (default 50, max 1000)",
        },
      },
      required: ["metrics"],
    },
  },
] as const;

const accountEmailSchema = z.string().email().optional();
const propertyIdSchema = z.string().optional();

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleAnalyticsTool(
  name: string,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true } | null> {
  switch (name) {
    case "analytics_list_account_summaries": {
      const input = z.object({ accountEmail: accountEmailSchema }).parse(args ?? {});
      return jsonResult(await analyticsListAccountSummaries(input.accountEmail));
    }
    case "analytics_get_metadata": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          propertyId: propertyIdSchema,
        })
        .parse(args ?? {});
      return jsonResult(await analyticsGetMetadata(input));
    }
    case "analytics_run_report": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          propertyId: propertyIdSchema,
          startDate: z.string().min(1),
          endDate: z.string().min(1),
          metrics: z.array(z.string().min(1)).min(1),
          dimensions: z.array(z.string().min(1)).optional(),
          limit: z.number().int().positive().max(10000).optional(),
          keepEmptyRows: z.boolean().optional(),
          currencyCode: z.string().min(3).max(3).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await analyticsRunReport(input));
    }
    case "analytics_run_realtime_report": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          propertyId: propertyIdSchema,
          metrics: z.array(z.string().min(1)).min(1),
          dimensions: z.array(z.string().min(1)).optional(),
          limit: z.number().int().positive().max(1000).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await analyticsRunRealtimeReport(input));
    }
    default:
      return null;
  }
}
