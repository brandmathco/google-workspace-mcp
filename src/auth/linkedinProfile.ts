import type { LinkedInTokenResponse } from "./linkedinAuth.js";
import { linkedInApiVersion } from "../services/linkedinSafety.js";

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

async function fetchLinkedInMemberFromAdAccountUsers(
  accessToken: string,
): Promise<{ memberId: string; email?: string; name?: string }> {
  const response = await fetch(
    "https://api.linkedin.com/rest/adAccountUsers?q=authenticatedUser",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": linkedInApiVersion(),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    },
  );

  const payload = (await response.json()) as {
    elements?: Array<{
      user?: string;
      account?: string;
    }>;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.message ??
        `LinkedIn adAccountUsers lookup failed (${response.status})`,
    );
  }

  const userUrn = payload.elements?.[0]?.user?.trim();
  if (!userUrn) {
    throw new Error(
      "LinkedIn adAccountUsers did not return a user URN. Map an ad account under Products → View Ad Accounts.",
    );
  }

  const memberId = userUrn.replace(/^urn:li:(?:person|member):/, "");
  return {
    memberId,
    email: `linkedin-${memberId}@oauth.local`,
    name: "LinkedIn Ads user",
  };
}

export async function resolveLinkedInIdentity(
  tokens: LinkedInTokenResponse,
): Promise<{ memberId: string; email: string; name?: string }> {
  if (!tokens.access_token?.trim()) {
    throw new Error("LinkedIn token response missing access_token.");
  }

  const scopeList = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
  const hasOpenId = scopeList.includes("openid");

  if (hasOpenId) {
    try {
      const profile = await fetchLinkedInUserInfo(tokens.access_token);
      const email = profile.email?.trim().toLowerCase();
      if (email) {
        const name =
          profile.name?.trim() ||
          [profile.given_name, profile.family_name].filter(Boolean).join(" ").trim() ||
          undefined;
        return { memberId: profile.sub.trim(), email, name };
      }
    } catch {
      // Fall through to Marketing API identity lookup.
    }
  }

  const fromAds = await fetchLinkedInMemberFromAdAccountUsers(tokens.access_token);
  return {
    memberId: fromAds.memberId,
    email: fromAds.email ?? `linkedin-${fromAds.memberId}@oauth.local`,
    name: fromAds.name,
  };
}
