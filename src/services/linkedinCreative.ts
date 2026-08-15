import {
  linkedInApiFetch,
  linkedInPutBinary,
} from "./linkedinClient.js";
import {
  organizationUrn,
  resolveAdAccountId,
  resolveDryRun,
  resolveOrganizationId,
  resolveOrganizationVanityName,
  sponsoredAccountUrn,
  sponsoredCampaignUrn,
  type LinkedInCreativeCtaLabel,
} from "./linkedinSafety.js";

const DEFAULT_IMAGE_URL =
  "https://www.brandmatchgrowth.com/site-assets/uploads/brandmatchco.png";

function contentTypeFromUrl(imageUrl: string): string {
  const lower = imageUrl.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".gif")) return "image/gif";
  return "image/jpeg";
}

async function fetchImageBytes(imageUrl: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image ${imageUrl}: HTTP ${response.status}`,
    );
  }
  const buffer = await response.arrayBuffer();
  const headerType = response.headers.get("content-type")?.split(";")[0]?.trim();
  return {
    bytes: new Uint8Array(buffer),
    contentType: headerType?.startsWith("image/") ? headerType : contentTypeFromUrl(imageUrl),
  };
}

export async function linkedinResolveOrganization(options?: {
  organizationId?: string;
  vanityName?: string;
  accountEmail?: string;
}) {
  const explicitId = resolveOrganizationId(options?.organizationId);
  if (explicitId) {
    return {
      organizationId: explicitId,
      organizationUrn: organizationUrn(explicitId),
      source: "argument_or_env" as const,
    };
  }

  const vanityName = resolveOrganizationVanityName(options?.vanityName);
  const data = await linkedInApiFetch<{
    elements?: Array<{ id?: number; localizedName?: string; vanityName?: string }>;
  }>(
    `/rest/organizations?q=vanityName&vanityName=${encodeURIComponent(vanityName)}`,
    { accountEmail: options?.accountEmail },
  );

  const match = data.elements?.[0];
  if (!match?.id) {
    throw new Error(
      `Could not resolve LinkedIn organization for vanity "${vanityName}". ` +
        "Set LINKEDIN_DEFAULT_ORGANIZATION_ID or pass organizationId.",
    );
  }

  return {
    organizationId: String(match.id),
    organizationUrn: organizationUrn(String(match.id)),
    localizedName: match.localizedName ?? "",
    vanityName: match.vanityName ?? vanityName,
    source: "vanity_lookup" as const,
  };
}

async function waitForImageAvailable(options: {
  imageUrn: string;
  accountEmail?: string;
  maxAttempts?: number;
}): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const encoded = encodeURIComponent(options.imageUrn);
    const image = await linkedInApiFetch<{ status?: string }>(
      `/rest/images/${encoded}`,
      { accountEmail: options.accountEmail },
    );
    const status = image.status ?? "";
    if (status === "AVAILABLE") return;
    if (status === "PROCESSING_FAILED") {
      throw new Error(`LinkedIn image processing failed for ${options.imageUrn}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export async function linkedinUploadImageFromUrl(options: {
  imageUrl: string;
  organizationId?: string;
  vanityName?: string;
  accountEmail?: string;
  dryRun?: boolean;
}) {
  const dryRun = resolveDryRun(options.dryRun);
  const org = await linkedinResolveOrganization({
    organizationId: options.organizationId,
    vanityName: options.vanityName,
    accountEmail: options.accountEmail,
  });

  const preview = {
    dryRun,
    imageUrl: options.imageUrl,
    organizationId: org.organizationId,
    organizationUrn: org.organizationUrn,
    note: "Registers upload, PUTs bytes, waits for AVAILABLE status.",
  };

  if (dryRun) {
    return { ...preview, applied: false };
  }

  const init = await linkedInApiFetch<{
    value?: { uploadUrl?: string; image?: string };
  }>("/rest/images?action=initializeUpload", {
    method: "POST",
    accountEmail: options.accountEmail,
    body: {
      initializeUploadRequest: {
        owner: org.organizationUrn,
      },
    },
  });

  const uploadUrl = init.value?.uploadUrl;
  const imageUrn = init.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new Error("LinkedIn initializeUpload did not return uploadUrl/image.");
  }

  const { bytes, contentType } = await fetchImageBytes(options.imageUrl);
  await linkedInPutBinary(uploadUrl, bytes, contentType, {
    accountEmail: options.accountEmail,
  });
  await waitForImageAvailable({
    imageUrn,
    accountEmail: options.accountEmail,
  });

  return {
    ...preview,
    applied: true,
    imageUrn,
    contentType,
    byteLength: bytes.byteLength,
  };
}

export async function linkedinCreateSponsoredImageCreative(options: {
  adAccountId?: string;
  campaignId: string;
  accountEmail?: string;
  dryRun?: boolean;
  organizationId?: string;
  vanityName?: string;
  imageUrl?: string;
  imageUrn?: string;
  commentary: string;
  mediaTitle: string;
  landingPageUrl: string;
  ctaLabel?: LinkedInCreativeCtaLabel;
  intendedStatus?: "DRAFT" | "ACTIVE";
  creativeName?: string;
}) {
  const adAccountId = resolveAdAccountId(options.adAccountId);
  const dryRun = resolveDryRun(options.dryRun);
  const campaignId = options.campaignId.replace(/\D/g, "");
  if (!campaignId) throw new Error("campaignId is required.");

  const org = await linkedinResolveOrganization({
    organizationId: options.organizationId,
    vanityName: options.vanityName,
    accountEmail: options.accountEmail,
  });

  const accountUrn = sponsoredAccountUrn(adAccountId);
  const campaignUrn = sponsoredCampaignUrn(campaignId);
  const ctaLabel = options.ctaLabel ?? "LEARN_MORE";
  const intendedStatus = options.intendedStatus ?? "DRAFT";
  const imageUrl = options.imageUrl?.trim() || DEFAULT_IMAGE_URL;

  let imageUrn = options.imageUrn?.trim();
  let uploadResult: Awaited<ReturnType<typeof linkedinUploadImageFromUrl>> | undefined;

  if (!imageUrn && !dryRun) {
    uploadResult = await linkedinUploadImageFromUrl({
      imageUrl,
      organizationId: org.organizationId,
      vanityName: options.vanityName,
      accountEmail: options.accountEmail,
      dryRun: false,
    });
    if (!("imageUrn" in uploadResult) || !uploadResult.imageUrn) {
      throw new Error("LinkedIn image upload did not return imageUrn.");
    }
    imageUrn = uploadResult.imageUrn;
  }

  const creativeBody = {
    creative: {
      campaign: campaignUrn,
      intendedStatus,
      ...(options.creativeName ? { name: options.creativeName } : {}),
      inlineContent: {
        post: {
          adContext: {
            dscAdAccount: accountUrn,
            dscStatus: "ACTIVE",
          },
          author: org.organizationUrn,
          commentary: options.commentary,
          visibility: "PUBLIC",
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: true,
          contentCallToActionLabel: ctaLabel,
          contentLandingPage: options.landingPageUrl,
          content: {
            media: {
              title: options.mediaTitle,
              id: imageUrn ?? "urn:li:image:DRY_RUN_PLACEHOLDER",
            },
          },
        },
      },
    },
  };

  const preview = {
    dryRun,
    adAccountId,
    campaignId,
    campaignUrn,
    organizationId: org.organizationId,
    organizationUrn: org.organizationUrn,
    imageUrl,
    imageUrn: imageUrn ?? null,
    uploadResult,
    creativeBody,
  };

  if (dryRun) {
    return { ...preview, applied: false };
  }

  if (!imageUrn) {
    throw new Error("imageUrn is required when dryRun is false.");
  }

  const result = await linkedInApiFetch<{ id?: string | number }>(
    `/rest/adAccounts/${adAccountId}/creatives?action=createInline`,
    {
      method: "POST",
      accountEmail: options.accountEmail,
      body: creativeBody,
    },
  );

  return {
    ...preview,
    applied: true,
    creativeId: result.id ? String(result.id) : undefined,
    creativeUrn:
      typeof result.id === "string"
        ? result.id
        : result.id
          ? `urn:li:sponsoredCreative:${result.id}`
          : undefined,
    campaignManagerUrl: `https://www.linkedin.com/campaignmanager/accounts/${adAccountId}/campaigns/${campaignId}`,
  };
}

export async function linkedinListCreatives(options: {
  adAccountId?: string;
  campaignId?: string;
  accountEmail?: string;
  maxResults?: number;
}) {
  const adAccountId = resolveAdAccountId(options.adAccountId);
  const limit = Math.min(options.maxResults ?? 25, 100);
  const campaignId = options.campaignId?.replace(/\D/g, "");

  const searchParts = ["status:(values:List(ACTIVE,PAUSED,DRAFT,ARCHIVED,CANCELED))"];
  if (campaignId) {
    searchParts.push(
      `campaign:(values:List(urn:li:sponsoredCampaign:${campaignId}))`,
    );
  }

  const data = await linkedInApiFetch<{
    elements?: Array<{
      id?: string;
      name?: string;
      intendedStatus?: string;
      campaign?: string;
      content?: { reference?: string };
    }>;
  }>(
    `/rest/adAccounts/${adAccountId}/creatives?q=search&search=(${searchParts.join(",")})&count=${limit}`,
    { accountEmail: options?.accountEmail },
  );

  return {
    adAccountId,
    campaignId: campaignId || null,
    creatives: (data.elements ?? []).map((row) => ({
      id: row.id ?? "",
      name: row.name ?? "",
      intendedStatus: row.intendedStatus ?? "",
      campaignUrn: row.campaign ?? "",
      contentReference: row.content?.reference ?? "",
    })),
  };
}
