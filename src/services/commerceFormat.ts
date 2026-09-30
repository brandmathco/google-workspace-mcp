/** Path builders and response shaping for AI Commerce Search (Retail API). */

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const PROJECT_NUMBER = /^\d{6,20}$/;
const RESOURCE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;

const OAUTH_CLIENT_PROJECT = /^(\d{6,20})-/;

/**
 * Google OAuth client ids look like `{projectNumber}-{secret}.apps.googleusercontent.com`.
 * The numeric prefix is the Cloud project this MCP is already registered in.
 */
export function projectNumberFromOAuthClientId(clientId: string | undefined): string | undefined {
  const match = OAUTH_CLIENT_PROJECT.exec((clientId ?? "").trim());
  return match?.[1];
}

export function assertCommerceProject(project: string): string {
  const id = project.trim();
  if (!PROJECT_ID.test(id) && !PROJECT_NUMBER.test(id)) {
    throw new Error(
      `Invalid Google Cloud project "${project}". Use a project id or project number.`,
    );
  }
  return id;
}

export function assertResourceId(value: string, label: string): string {
  const id = value.trim();
  if (!RESOURCE_ID.test(id)) {
    throw new Error(`Invalid ${label} "${value}".`);
  }
  return id;
}

export function catalogParent(project: string, catalog = "default_catalog"): string {
  const projectId = assertCommerceProject(project);
  const catalogId = assertResourceId(catalog, "catalog");
  return `projects/${projectId}/locations/global/catalogs/${catalogId}`;
}

export function servingConfigName(
  project: string,
  servingConfig = "default_search",
  catalog = "default_catalog",
): string {
  const parent = catalogParent(project, catalog);
  const servingId = assertResourceId(servingConfig, "serving config");
  return `${parent}/servingConfigs/${servingId}`;
}

export function branchParent(
  project: string,
  branch = "default_branch",
  catalog = "default_catalog",
): string {
  const parent = catalogParent(project, catalog);
  const branchId = branch.trim() === "0" ? "0" : assertResourceId(branch, "branch");
  return `${parent}/branches/${branchId}`;
}

export function clampPageSize(pageSize: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(pageSize ?? fallback, 1), max);
}

export interface CommercePriceInfo {
  price?: number | null;
  originalPrice?: number | null;
  currencyCode?: string | null;
}

export interface CommerceProduct {
  id?: string | null;
  title?: string | null;
  uri?: string | null;
  availability?: string | null;
  brands?: string[] | null;
  priceInfo?: CommercePriceInfo | null;
}

export function shapeCommerceProduct(product: CommerceProduct | null | undefined, fallbackId?: string) {
  if (!product && !fallbackId) return undefined;
  return {
    id: product?.id || fallbackId || "",
    title: product?.title ?? "",
    uri: product?.uri ?? undefined,
    availability: product?.availability ?? undefined,
    brands: product?.brands ?? [],
    price: product?.priceInfo?.price ?? undefined,
    originalPrice: product?.priceInfo?.originalPrice ?? undefined,
    currencyCode: product?.priceInfo?.currencyCode ?? undefined,
  };
}

export interface CommerceSearchResult {
  id?: string | null;
  product?: CommerceProduct | null;
}

export function shapeCommerceSearch(input: {
  results?: CommerceSearchResult[] | null;
  nextPageToken?: string | null;
  totalSize?: number | null;
  correctedQuery?: string | null;
  attributionToken?: string | null;
}) {
  return {
    totalSize: input.totalSize ?? undefined,
    correctedQuery: input.correctedQuery ?? undefined,
    nextPageToken: input.nextPageToken ?? undefined,
    attributionToken: input.attributionToken ?? undefined,
    results: (input.results ?? []).map((result) =>
      shapeCommerceProduct(result.product, result.id ?? undefined),
    ),
  };
}
