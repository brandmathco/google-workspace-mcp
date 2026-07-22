import { FileAccountStore } from "./fileAccountStore.js";
import { SupabaseAccountStore } from "./supabaseAccountStore.js";
import type { AccountStore } from "./accountTypes.js";
import type { StoredToken } from "./googleAuth.js";
import { resolveEmailFromTokens } from "./oauthProfile.js";
import type { StoredAccount } from "./accountTypes.js";

let cachedStore: AccountStore | null = null;

function resolveStoreKind(): "file" | "supabase" {
  const explicit = process.env.GOOGLE_ACCOUNTS_STORE?.trim().toLowerCase();
  if (explicit === "file") return "file";
  if (explicit === "supabase") return "supabase";

  const hasSupabase =
    Boolean(process.env.SUPABASE_URL?.trim()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  return hasSupabase ? "supabase" : "file";
}

export function getAccountStore(): AccountStore {
  if (cachedStore) {
    return cachedStore;
  }

  cachedStore =
    resolveStoreKind() === "supabase"
      ? new SupabaseAccountStore()
      : new FileAccountStore();
  return cachedStore;
}

export async function saveAuthorizedAccount(
  tokens: StoredToken,
  options?: { label?: string; makeDefault?: boolean },
): Promise<StoredAccount> {
  if (!tokens.refresh_token?.trim()) {
    throw new Error(
      "Google did not return a refresh token. Re-run authorize with prompt=consent.",
    );
  }

  const email = await resolveEmailFromTokens(tokens);
  const now = new Date().toISOString();
  const store = getAccountStore();
  const existing = await store.getAccount(email);

  const account: StoredAccount = {
    email,
    label: options?.label?.trim() || existing?.label,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
    token_type: tokens.token_type,
    scope: tokens.scope,
    authorizedAt: existing?.authorizedAt ?? now,
    updatedAt: now,
  };

  await store.upsertAccount(account);

  if (options?.makeDefault ?? !(await store.getDefaultEmail())) {
    await store.setDefaultEmail(email);
  }

  return account;
}

export function resetAccountStoreCache(): void {
  cachedStore = null;
}
