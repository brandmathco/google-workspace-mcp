import { GoogleAdsApi, type Customer } from "google-ads-api";
import { getAccountStore } from "../auth/accountStore.js";
import { normalizeCustomerId } from "./adsSafety.js";

function requireDeveloperToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "GOOGLE_ADS_DEVELOPER_TOKEN is required for Google Ads API calls. " +
        "Get one from Google Ads API Center and set it as a secret (never commit it).",
    );
  }
  return token;
}

function requireOAuthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required for Google Ads.",
    );
  }
  return { clientId, clientSecret };
}

export function createGoogleAdsApiClient(): GoogleAdsApi {
  const { clientId, clientSecret } = requireOAuthClient();
  return new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: requireDeveloperToken(),
  });
}

async function resolveAccountEmail(accountEmail?: string): Promise<string> {
  const explicit = accountEmail?.trim().toLowerCase();
  if (explicit) return explicit;

  const envDefault = process.env.GOOGLE_DEFAULT_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (envDefault) return envDefault;

  const store = getAccountStore();
  await store.migrateLegacyIfNeeded();
  const fromStore = await store.getDefaultEmail();
  if (fromStore) return fromStore;

  throw new Error(
    "No Google account authorized. Run /authorize (re-consent to include Google Ads scope), then retry.",
  );
}

export async function getRefreshTokenForAccount(
  accountEmail?: string,
): Promise<{ email: string; refreshToken: string }> {
  if (process.env.GOOGLE_SERVICE_ACCOUNT?.trim()) {
    throw new Error(
      "Google Ads MCP tools require OAuth user refresh tokens (not GOOGLE_SERVICE_ACCOUNT). " +
        "Authorize a Google account that can access the Ads customer, then pass accountEmail.",
    );
  }

  const store = getAccountStore();
  await store.migrateLegacyIfNeeded();
  const email = await resolveAccountEmail(accountEmail);
  const account = await store.getAccount(email);
  if (!account?.refresh_token?.trim()) {
    throw new Error(
      `No refresh token for ${email}. Re-authorize with the updated scopes (includes adwords).`,
    );
  }
  return { email, refreshToken: account.refresh_token };
}

export function resolveLoginCustomerId(loginCustomerId?: string): string | undefined {
  const fromArg = loginCustomerId?.replace(/-/g, "").trim();
  if (fromArg) return normalizeCustomerId(fromArg);
  const fromEnv = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "").trim();
  if (fromEnv) return normalizeCustomerId(fromEnv);
  return undefined;
}

export async function getAdsCustomer(options: {
  customerId: string;
  accountEmail?: string;
  loginCustomerId?: string;
}): Promise<{ customer: Customer; accountEmail: string; customerId: string }> {
  const customerId = normalizeCustomerId(options.customerId);
  const { email, refreshToken } = await getRefreshTokenForAccount(options.accountEmail);
  const client = createGoogleAdsApiClient();
  const loginCustomerId = resolveLoginCustomerId(options.loginCustomerId);

  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
  });

  return { customer, accountEmail: email, customerId };
}

export async function listAccessibleCustomerResourceNames(
  accountEmail?: string,
): Promise<{ accountEmail: string; resourceNames: string[] }> {
  const { email, refreshToken } = await getRefreshTokenForAccount(accountEmail);
  const client = createGoogleAdsApiClient();
  const response = await client.listAccessibleCustomers(refreshToken);
  const resourceNames = [...(response.resource_names ?? [])];
  return { accountEmail: email, resourceNames };
}
