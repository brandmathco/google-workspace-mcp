import { z } from "zod";
import {
  commerceGetProduct,
  commerceListProducts,
  commerceListServingConfigs,
  commerceSearch,
} from "./services/commerceSearch.js";

const accountEmailProperty = {
  accountEmail: {
    type: "string",
    description: "Google account email. Must be re-authorized with cloud-platform after this upgrade.",
  },
} as const;

const projectProperty = {
  projectId: {
    type: "string",
    description:
      "Optional. Defaults to the Cloud project that already owns this MCP OAuth client.",
  },
} as const;

export const commerceTools = [
  {
    name: "commerce_list_serving_configs",
    description:
      "List AI Commerce Search serving configs on the Retail catalog. Read-only. Enable AI Commerce Search (Retail API) on the Cloud project and re-authorize so the token includes cloud-platform.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...projectProperty,
        pageSize: { type: "number", description: "Page size (default 50, max 100)." },
        pageToken: { type: "string" },
      },
    },
  },
  {
    name: "commerce_search",
    description:
      "Run an AI Commerce Search query (Retail Search). Read-only. Returns product id, title, price, and availability. Does not import products or write user events.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...projectProperty,
        query: { type: "string", description: "Shopper search text." },
        servingConfig: {
          type: "string",
          description: "Serving config id (default default_search or GOOGLE_COMMERCE_SERVING_CONFIG).",
        },
        visitorId: {
          type: "string",
          description: "Pseudonymous visitor id (max 128 chars). Defaults to mcp-readonly.",
        },
        filter: { type: "string", description: "Retail filter expression, e.g. availability: ANY(\"IN_STOCK\")." },
        pageSize: { type: "number", description: "Page size (default 10, max 50)." },
        pageToken: { type: "string" },
        offset: { type: "number" },
        orderBy: { type: "string", description: "Optional order, e.g. price desc." },
        branch: { type: "string", description: "Catalog branch id. Default default_branch." },
      },
      required: ["query"],
    },
  },
  {
    name: "commerce_list_products",
    description: "List products in an AI Commerce Search catalog branch. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...projectProperty,
        branch: { type: "string", description: "Branch id (default default_branch)." },
        filter: { type: "string", description: 'List filter, e.g. type = "PRIMARY".' },
        pageSize: { type: "number", description: "Page size (default 20, max 100)." },
        pageToken: { type: "string" },
      },
    },
  },
  {
    name: "commerce_get_product",
    description: "Get one AI Commerce Search product by id. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...projectProperty,
        productId: { type: "string", description: "Product id (not the full resource name)." },
        branch: { type: "string" },
      },
      required: ["productId"],
    },
  },
] as const;

const accountEmailSchema = z.string().email().optional();
const projectIdSchema = z.string().min(6).max(30).optional();

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleCommerceTool(
  name: string,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true } | null> {
  switch (name) {
    case "commerce_list_serving_configs": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          projectId: projectIdSchema,
          pageSize: z.number().int().positive().max(100).optional(),
          pageToken: z.string().min(1).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await commerceListServingConfigs(input));
    }
    case "commerce_search": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          projectId: projectIdSchema,
          query: z.string().min(1).max(5000),
          servingConfig: z.string().min(1).max(63).optional(),
          visitorId: z.string().min(1).max(128).optional(),
          filter: z.string().max(5000).optional(),
          pageSize: z.number().int().positive().max(50).optional(),
          pageToken: z.string().min(1).optional(),
          offset: z.number().int().nonnegative().max(1000).optional(),
          orderBy: z.string().max(200).optional(),
          branch: z.string().min(1).max(63).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await commerceSearch(input));
    }
    case "commerce_list_products": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          projectId: projectIdSchema,
          branch: z.string().min(1).max(63).optional(),
          filter: z.string().max(2000).optional(),
          pageSize: z.number().int().positive().max(100).optional(),
          pageToken: z.string().min(1).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await commerceListProducts(input));
    }
    case "commerce_get_product": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          projectId: projectIdSchema,
          productId: z.string().min(1).max(128),
          branch: z.string().min(1).max(63).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await commerceGetProduct(input));
    }
    default:
      return null;
  }
}
