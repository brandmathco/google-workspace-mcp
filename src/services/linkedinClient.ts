import {
  getLinkedInAccountStore,
} from "../auth/linkedinAccountStore.js";
import type {
  LinkedInAccountSummary,
  LinkedInStoredAccount,
} from "../auth/linkedinAccountTypes.js";
import { refreshLinkedInAccessToken } from "../auth/linkedinAuth.js";
import { linkedInApiVersion } from "./linkedinSafety.js";

function resolveMemberId(memberId?: string): string | undefined {
  const explicit = memberId?.trim();
  if (explicit) return explicit;
  const envDefault = process.env.LINKEDIN_DEFAULT_MEMBER_ID?.trim();
  return envDefault || undefined;
}

function resolveAccountEmail(accountEmail?: string): string | undefined {
  const explicit = accountEmail?.trim().toLowerCase();
  if (explicit) return explicit;
  const envDefault = process.env.LINKEDIN_DEFAULT_ACCOUNT_EMAIL?.trim().toLowerCase();
  return envDefault || undefined;
}

export function envLinkedInAccount(): LinkedInStoredAccount | null {
  const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN?.trim();
  if (!refreshToken) return null;

  const memberId =
    process.env.LINKEDIN_DEFAULT_MEMBER_ID?.trim() || "fly-env-account";
  const email =
    process.env.LINKEDIN_DEFAULT_ACCOUNT_EMAIL?.trim().toLowerCase() ||
    `linkedin-${memberId}@oauth.local`;
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
  const expiryRaw = process.env.LINKEDIN_ACCESS_TOKEN_EXPIRY_MS?.trim();
  const expiryDate = expiryRaw ? Number(expiryRaw) : undefined;
  const now = new Date().toISOString();

  return {
    memberId,
    email,
    name: "LinkedIn Ads (env)",
    refresh_token: refreshToken,
    access_token: accessToken,
    expiry_date:
      expiryDate && Number.isFinite(expiryDate) ? expiryDate : undefined,
    scope: process.env.LINKEDIN_OAUTH_SCOPES?.trim() || "r_ads rw_ads r_ads_reporting",
    authorizedAt: now,
    updatedAt: now,
  };
}

export function envLinkedInAccountSummary(): LinkedInAccountSummary | null {
  const account = envLinkedInAccount();
  if (!account) return null;
  return {
    memberId: account.memberId,
    email: account.email,
    name: account.name,
    label: "env",
    isDefault: true,
    authorizedAt: account.authorizedAt,
    updatedAt: account.updatedAt,
    scopes: account.scope,
  };
}

async function resolveLinkedInAccount(options?: {
  memberId?: string;
  accountEmail?: string;
}): Promise<LinkedInStoredAccount> {
  const envAccount = envLinkedInAccount();
  const store = getLinkedInAccountStore();
  const byEmail = resolveAccountEmail(options?.accountEmail);
  if (byEmail) {
    const account = await store.getAccountByEmail(byEmail);
    if (account?.refresh_token?.trim()) {
      return account;
    }
    if (envAccount && envAccount.email === byEmail) {
      return envAccount;
    }
    throw new Error(
      `No LinkedIn refresh token for ${byEmail}. Authorize: /authorize/linkedin?hashKey=...`,
    );
  }

  const memberId =
    resolveMemberId(options?.memberId) ?? (await store.getDefaultMemberId());
  if (memberId) {
    const account = await store.getAccount(memberId);
    if (account?.refresh_token?.trim()) {
      return account;
    }
  }

  if (envAccount) {
    return envAccount;
  }

  throw new Error(
    "No LinkedIn account authorized. Run /authorize/linkedin or set LINKEDIN_REFRESH_TOKEN.",
  );
}

async function ensureAccessToken(account: LinkedInStoredAccount): Promise<string> {
  const stillValid =
    account.access_token &&
    account.expiry_date &&
    account.expiry_date > Date.now() + 60_000;

  if (stillValid && account.access_token) {
    return account.access_token;
  }

  const refreshed = await refreshLinkedInAccessToken(account.refresh_token!);
  const store = getLinkedInAccountStore();
  const updated: LinkedInStoredAccount = {
    ...account,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? account.refresh_token,
    expiry_date: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope ?? account.scope,
    updatedAt: new Date().toISOString(),
  };
  if (!envLinkedInAccount()) {
    await store.upsertAccount(updated);
  }
  return refreshed.access_token;
}

export async function getLinkedInAccessToken(options?: {
  memberId?: string;
  accountEmail?: string;
}): Promise<{ accessToken: string; account: LinkedInStoredAccount }> {
  const account = await resolveLinkedInAccount(options);
  const accessToken = await ensureAccessToken(account);
  return { accessToken, account };
}

function resolveCreatedResourceId(response: Response, payload: unknown): number | undefined {
  if (typeof payload === "object" && payload && "id" in payload) {
    const rawId = (payload as { id: unknown }).id;
    if (typeof rawId === "number" && Number.isFinite(rawId)) return rawId;
    if (typeof rawId === "string" && /^\d+$/.test(rawId)) return Number(rawId);
  }

  for (const headerName of ["x-restli-id", "x-linkedin-id"]) {
    const raw = response.headers.get(headerName)?.trim();
    if (!raw) continue;
    const match = raw.replace(/[()]/g, "").match(/:(\d+)$/);
    if (match) return Number(match[1]);
  }

  const location = response.headers.get("location") ?? response.headers.get("Location");
  if (location) {
    const match = location.match(/(\d+)\/?$/);
    if (match) return Number(match[1]);
  }

  return undefined;
}

export async function linkedInApiFetch<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    memberId?: string;
    accountEmail?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const { accessToken, account } = await getLinkedInAccessToken({
    memberId: options.memberId,
    accountEmail: options.accountEmail,
  });

  const url = path.startsWith("http")
    ? path
    : `https://api.linkedin.com${path.startsWith("/") ? "" : "/"}${path}`;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": linkedInApiVersion(),
      "X-Restli-Protocol-Version": "2.0.0",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `LinkedIn API ${response.status} non-JSON response for ${path}: ${text.slice(0, 500)}`,
    );
  }

  if (!response.ok) {
    let message =
      typeof payload === "object" &&
      payload &&
      "message" in payload &&
      typeof (payload as { message: unknown }).message === "string"
        ? (payload as { message: string }).message
        : text.slice(0, 500) || `HTTP ${response.status}`;
    if (
      typeof payload === "object" &&
      payload &&
      "errorDetails" in payload &&
      (payload as { errorDetails: unknown }).errorDetails
    ) {
      message += ` | details: ${JSON.stringify((payload as { errorDetails: unknown }).errorDetails).slice(0, 1500)}`;
    }
    throw new Error(`LinkedIn API ${response.status}: ${message}`);
  }

  const createdId = resolveCreatedResourceId(response, payload);
  if (
    createdId &&
    typeof payload === "object" &&
    payload &&
    !("id" in payload && (payload as { id?: unknown }).id)
  ) {
    return { ...(payload as object), id: createdId } as T;
  }

  return payload as T;
}
