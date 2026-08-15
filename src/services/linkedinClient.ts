import {
  getLinkedInAccountStore,
} from "../auth/linkedinAccountStore.js";
import type { LinkedInStoredAccount } from "../auth/linkedinAccountTypes.js";
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

async function resolveLinkedInAccount(options?: {
  memberId?: string;
  accountEmail?: string;
}): Promise<LinkedInStoredAccount> {
  const store = getLinkedInAccountStore();
  const byEmail = resolveAccountEmail(options?.accountEmail);
  if (byEmail) {
    const account = await store.getAccountByEmail(byEmail);
    if (!account?.refresh_token?.trim()) {
      throw new Error(
        `No LinkedIn refresh token for ${byEmail}. Authorize: /authorize/linkedin?hashKey=...`,
      );
    }
    return account;
  }

  const memberId =
    resolveMemberId(options?.memberId) ?? (await store.getDefaultMemberId());
  if (!memberId) {
    throw new Error(
      "No LinkedIn account authorized. Run /authorize/linkedin or pass accountEmail.",
    );
  }

  const account = await store.getAccount(memberId);
  if (!account?.refresh_token?.trim()) {
    throw new Error(
      `No LinkedIn refresh token for member ${memberId}. Re-authorize: /authorize/linkedin?hashKey=...`,
    );
  }
  return account;
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
    token_type: refreshed.token_type ?? account.token_type,
    updatedAt: new Date().toISOString(),
  };
  await store.upsertAccount(updated);
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
    const message =
      typeof payload === "object" &&
      payload &&
      "message" in payload &&
      typeof (payload as { message: unknown }).message === "string"
        ? (payload as { message: string }).message
        : text.slice(0, 500) || `HTTP ${response.status}`;
    throw new Error(`LinkedIn API ${response.status}: ${message}`);
  }

  return payload as T;
}
