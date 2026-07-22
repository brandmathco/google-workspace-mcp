import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { createOAuthClientForSetup, type StoredToken } from "./googleAuth.js";

export async function resolveEmailFromTokens(
  tokens: StoredToken,
): Promise<string> {
  const oauth = createOAuthClientForSetup();
  oauth.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
    token_type: tokens.token_type,
    scope: tokens.scope,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth as OAuth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress?.trim().toLowerCase();

  if (!email) {
    throw new Error("Could not resolve Gmail profile email after OAuth");
  }

  return email;
}
