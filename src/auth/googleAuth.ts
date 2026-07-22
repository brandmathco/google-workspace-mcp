import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { JWT, OAuth2Client } from "google-auth-library";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
];

export interface ServiceAccountConfig {
  client_email: string;
  private_key: string;
}

export interface StoredToken {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

export function parseServiceAccount(json: string): ServiceAccountConfig | null {
  try {
    let raw = json.trim().replace(/^\uFEFF/, "");
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }

    let parsed: unknown = JSON.parse(raw);
    for (let i = 0; i < 2 && typeof parsed === "string"; i += 1) {
      parsed = JSON.parse(parsed.trim());
    }

    const sa = parsed as Record<string, unknown>;
    if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
      return null;
    }

    const privateKey = sa.private_key.includes("\\n")
      ? sa.private_key.replace(/\\n/g, "\n")
      : sa.private_key;

    return { client_email: sa.client_email, private_key: privateKey };
  } catch {
    return null;
  }
}

export function resolveTokenPath(): string {
  return (
    process.env.GOOGLE_TOKEN_PATH ??
    join(homedir(), ".config", "google-workspace-mcp", "token.json")
  );
}

export function loadStoredToken(path = resolveTokenPath()): StoredToken | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

export function saveStoredToken(token: StoredToken, path = resolveTokenPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(token, null, 2), "utf8");
}

function createServiceAccountAuth(): OAuth2Client | JWT {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!json) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT is not configured");
  }

  const sa = parseServiceAccount(json);
  if (!sa) {
    throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT JSON");
  }

  const subject = process.env.GOOGLE_WORKSPACE_USER_EMAIL?.trim();
  if (!subject) {
    throw new Error(
      "GOOGLE_WORKSPACE_USER_EMAIL is required when using GOOGLE_SERVICE_ACCOUNT",
    );
  }

  return new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: GMAIL_SCOPES,
    subject,
  });
}

function createOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, or use GOOGLE_SERVICE_ACCOUNT + GOOGLE_WORKSPACE_USER_EMAIL",
    );
  }

  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
    "http://127.0.0.1:3847/oauth2callback";

  const oauth = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
  });

  const refreshToken =
    process.env.GOOGLE_REFRESH_TOKEN?.trim() ??
    loadStoredToken()?.refresh_token;

  if (!refreshToken) {
    throw new Error(
      "No refresh token found. Run `npm run authorize` in google-workspace-mcp after setting OAuth env vars.",
    );
  }

  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}

export async function getGoogleAuthClient(): Promise<OAuth2Client | JWT> {
  if (process.env.GOOGLE_SERVICE_ACCOUNT?.trim()) {
    return createServiceAccountAuth();
  }
  return createOAuthClient();
}

export function createOAuthClientForSetup(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET");
  }

  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
    "http://127.0.0.1:3847/oauth2callback";

  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

export function getAuthorizationUrl(
  oauth: OAuth2Client,
  state?: string,
): string {
  return oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    ...(state ? { state } : {}),
  });
}
