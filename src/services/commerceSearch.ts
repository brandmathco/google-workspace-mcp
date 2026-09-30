import { google } from "googleapis";
import type { JWT, OAuth2Client } from "google-auth-library";
import { getGoogleAuthClient } from "../auth/googleAuth.js";
import {
  branchParent,
  catalogParent,
  clampPageSize,
  projectNumberFromOAuthClientId,
  servingConfigName,
  shapeCommerceProduct,
  shapeCommerceSearch,
  type CommerceProduct,
} from "./commerceFormat.js";

type AuthClient = OAuth2Client | JWT;

function retail(auth: AuthClient) {
  return google.retail({ version: "v2", auth });
}

export function resolveCommerceProject(projectId?: string): string {
  const explicit = projectId?.trim();
  if (explicit) return explicit;
  const fromEnv =
    process.env.GOOGLE_COMMERCE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    projectNumberFromOAuthClientId(process.env.GOOGLE_OAUTH_CLIENT_ID);
  if (!fromEnv) {
    throw new Error(
      "Could not find a Google Cloud project. The MCP normally uses the project number on GOOGLE_OAUTH_CLIENT_ID.",
    );
  }
  return fromEnv;
}

function catalogId(): string {
  return process.env.GOOGLE_COMMERCE_CATALOG?.trim() || "default_catalog";
}

export async function commerceListServingConfigs(input: {
  accountEmail?: string;
  projectId?: string;
  pageSize?: number;
  pageToken?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const parent = catalogParent(resolveCommerceProject(input.projectId), catalogId());
  const res = await retail(auth).projects.locations.catalogs.servingConfigs.list({
    parent,
    pageSize: clampPageSize(input.pageSize, 50, 100),
    pageToken: input.pageToken,
  });
  return {
    catalog: parent,
    servingConfigs: (res.data.servingConfigs ?? []).map((config) => ({
      name: config.name ?? "",
      displayName: config.displayName ?? "",
      modelId: config.modelId ?? undefined,
      priceRerankingLevel: config.priceRerankingLevel ?? undefined,
    })),
    nextPageToken: res.data.nextPageToken ?? undefined,
    hint: "Pass the serving config id (last path segment) to commerce_search. Re-authorize with cloud-platform if you see insufficient scopes. Enable AI Commerce Search (Retail API) on the project.",
  };
}

export interface CommerceSearchInput {
  accountEmail?: string;
  projectId?: string;
  servingConfig?: string;
  query: string;
  visitorId?: string;
  filter?: string;
  pageSize?: number;
  pageToken?: string;
  offset?: number;
  orderBy?: string;
  branch?: string;
}

export async function commerceSearch(input: CommerceSearchInput) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const project = resolveCommerceProject(input.projectId);
  const serving =
    input.servingConfig?.trim() ||
    process.env.GOOGLE_COMMERCE_SERVING_CONFIG?.trim() ||
    "default_search";
  const placement = servingConfigName(project, serving, catalogId());
  const visitorId = (input.visitorId?.trim() || "mcp-readonly").slice(0, 128);
  const res = await retail(auth).projects.locations.catalogs.servingConfigs.search({
    placement,
    requestBody: {
      query: input.query,
      visitorId,
      pageSize: clampPageSize(input.pageSize, 10, 50),
      ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      ...(input.filter ? { filter: input.filter } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.orderBy ? { orderBy: input.orderBy } : {}),
      ...(input.branch
        ? { branch: branchParent(project, input.branch, catalogId()) }
        : {}),
    },
  });
  return {
    placement,
    query: input.query,
    ...shapeCommerceSearch({
      results: res.data.results,
      nextPageToken: res.data.nextPageToken,
      totalSize: res.data.totalSize,
      correctedQuery: res.data.correctedQuery,
      attributionToken: res.data.attributionToken,
    }),
  };
}

export async function commerceListProducts(input: {
  accountEmail?: string;
  projectId?: string;
  branch?: string;
  filter?: string;
  pageSize?: number;
  pageToken?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const project = resolveCommerceProject(input.projectId);
  const branch = input.branch?.trim() || process.env.GOOGLE_COMMERCE_BRANCH?.trim() || "default_branch";
  const parent = branchParent(project, branch, catalogId());
  const res = await retail(auth).projects.locations.catalogs.branches.products.list({
    parent,
    pageSize: clampPageSize(input.pageSize, 20, 100),
    pageToken: input.pageToken,
    ...(input.filter ? { filter: input.filter } : {}),
  });
  return {
    parent,
    products: (res.data.products ?? []).map((product) =>
      shapeCommerceProduct(product as CommerceProduct, product.id ?? undefined),
    ),
    nextPageToken: res.data.nextPageToken ?? undefined,
  };
}

export async function commerceGetProduct(input: {
  accountEmail?: string;
  projectId?: string;
  productId: string;
  branch?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const project = resolveCommerceProject(input.projectId);
  const branch = input.branch?.trim() || process.env.GOOGLE_COMMERCE_BRANCH?.trim() || "default_branch";
  const parent = branchParent(project, branch, catalogId());
  const productId = input.productId.trim();
  if (!productId || productId.includes("/")) {
    throw new Error("productId must be the catalog product id, not a full resource path.");
  }
  const name = `${parent}/products/${productId}`;
  const res = await retail(auth).projects.locations.catalogs.branches.products.get({ name });
  return {
    name,
    product: shapeCommerceProduct(res.data as CommerceProduct, res.data.id ?? productId),
  };
}
