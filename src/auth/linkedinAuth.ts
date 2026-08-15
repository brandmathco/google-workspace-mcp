/** LinkedIn Marketing API OAuth scopes for ad read/write. */
export const LINKEDIN_ADS_SCOPES = [
  "r_ads",
  "rw_ads",
  "r_ads_reporting",
  "w_organization_social",
] as const;

export const LINKEDIN_BASIC_SCOPES = ["openid", "profile", "email"] as const;

export function resolveLinkedInScopes(basicOnly = false): string[] {
  const fromEnv = process.env.LINKEDIN_OAUTH_SCOPES?.trim();
  if (fromEnv) {
    return fromEnv.split(/[\s,]+/).filter(Boolean);
  }

  if (basicOnly) {
    return [...LINKEDIN_BASIC_SCOPES];
  }

  // Advertising API apps often lack openid/profile/email unless "Sign In with
  // LinkedIn" is added — default to Marketing API scopes only.
  const includeBasic =
    process.env.LINKEDIN_INCLUDE_BASIC_SCOPES?.trim().toLowerCase() === "true";
  return includeBasic
    ? [...LINKEDIN_BASIC_SCOPES, ...LINKEDIN_ADS_SCOPES]
    : [...LINKEDIN_ADS_SCOPES];
}

/** @deprecated use resolveLinkedInScopes() */
export const LINKEDIN_SCOPES = [
  ...LINKEDIN_BASIC_SCOPES,
  ...LINKEDIN_ADS_SCOPES,
] as const;

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

export function linkedInOAuthConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.LINKEDIN_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Set LINKEDIN_OAUTH_CLIENT_ID and LINKEDIN_OAUTH_CLIENT_SECRET");
  }

  const redirectUri =
    process.env.LINKEDIN_OAUTH_REDIRECT_URI?.trim() ??
    "http://127.0.0.1:3847/oauth2callback/linkedin";

  return { clientId, clientSecret, redirectUri };
}

export function getLinkedInAuthorizationUrl(state: string, basicOnly = false): string {
  const { clientId, redirectUri } = linkedInOAuthConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: resolveLinkedInScopes(basicOnly).join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export function getLinkedInOAuthPreview(basicOnly = false) {
  const { clientId, redirectUri } = linkedInOAuthConfig();
  return {
    clientId,
    redirectUri,
    scopes: resolveLinkedInScopes(basicOnly),
    linkedInRedirectUrlsToRegister: [redirectUri],
    note:
      "Add redirectUri EXACTLY (character-for-character) under LinkedIn Developer → Auth → Authorized redirect URLs. " +
      "Default scopes are r_ads rw_ads r_ads_reporting only (openid requires Sign In with LinkedIn product). " +
      "Use basic=1 only if Sign In with LinkedIn is enabled on the app.",
  };
}

export async function exchangeLinkedInAuthorizationCode(
  code: string,
): Promise<LinkedInTokenResponse> {
  const { clientId, clientSecret, redirectUri } = linkedInOAuthConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = (await response.json()) as LinkedInTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        `LinkedIn token exchange failed (${response.status})`,
    );
  }

  return payload;
}

export async function refreshLinkedInAccessToken(
  refreshToken: string,
): Promise<LinkedInTokenResponse> {
  const { clientId, clientSecret } = linkedInOAuthConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = (await response.json()) as LinkedInTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        `LinkedIn token refresh failed (${response.status})`,
    );
  }

  return payload;
}
