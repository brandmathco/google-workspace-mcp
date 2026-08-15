import type { LinkedInTokenResponse } from "./linkedinAuth.js";

export interface LinkedInUserInfo {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
}

export async function fetchLinkedInUserInfo(
  accessToken: string,
): Promise<LinkedInUserInfo> {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = (await response.json()) as LinkedInUserInfo & {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.message ?? payload.error ?? `LinkedIn userinfo failed (${response.status})`,
    );
  }

  if (!payload.sub?.trim()) {
    throw new Error("LinkedIn userinfo did not return sub (member id).");
  }

  return payload;
}

export async function resolveLinkedInIdentity(
  tokens: LinkedInTokenResponse,
): Promise<{ memberId: string; email: string; name?: string }> {
  if (!tokens.access_token?.trim()) {
    throw new Error("LinkedIn token response missing access_token.");
  }

  const profile = await fetchLinkedInUserInfo(tokens.access_token);
  const email = profile.email?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      "LinkedIn did not return email. Ensure the app requests openid profile email scopes.",
    );
  }

  const name =
    profile.name?.trim() ||
    [profile.given_name, profile.family_name].filter(Boolean).join(" ").trim() ||
    undefined;

  return { memberId: profile.sub.trim(), email, name };
}
