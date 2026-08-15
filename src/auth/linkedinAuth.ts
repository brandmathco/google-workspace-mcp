/** LinkedIn Marketing API OAuth scopes for ad read/write. */
export const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "r_ads",
  "rw_ads",
  "r_ads_reporting",
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

export function getLinkedInAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = linkedInOAuthConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
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
