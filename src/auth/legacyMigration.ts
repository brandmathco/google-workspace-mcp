import {
  loadStoredToken,
  resolveTokenPath,
  type StoredToken,
} from "./googleAuth.js";
import type { AccountStore, StoredAccount } from "./accountTypes.js";
import { resolveEmailFromTokens } from "./oauthProfile.js";

export async function migrateLegacyTokenIntoStore(
  store: AccountStore,
): Promise<void> {
  const accounts = await store.listAccounts();
  if (accounts.length > 0) {
    return;
  }

  const envToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  const fileToken = loadStoredToken()?.refresh_token?.trim();
  const refreshToken = envToken || fileToken;
  if (!refreshToken) {
    return;
  }

  const tokens: StoredToken = {
    refresh_token: refreshToken,
    ...loadStoredToken(),
  };

  let email: string;
  try {
    email = await resolveEmailFromTokens(tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Legacy token migration skipped: ${message}`);
    return;
  }

  const now = new Date().toISOString();
  const account: StoredAccount = {
    email,
    refresh_token: refreshToken,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
    token_type: tokens.token_type,
    scope: tokens.scope,
    label: "legacy-migration",
    authorizedAt: now,
    updatedAt: now,
  };

  await store.upsertAccount(account);
  await store.setDefaultEmail(email);
  console.log(
    `Migrated legacy Google token into multi-account store for ${email} (was ${resolveTokenPath()} / GOOGLE_REFRESH_TOKEN)`,
  );
}
