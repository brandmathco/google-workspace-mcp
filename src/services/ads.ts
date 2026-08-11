import {
  enums,
  ResourceNames,
  services,
  type MutateOperation,
  type resources,
} from "google-ads-api";
import {
  getAdsCustomer,
  listAccessibleCustomerResourceNames,
} from "./adsClient.js";
import {
  assertCanEnableSpend,
  assertDailyBudgetWithinCap,
  buildCampaignName,
  resolveCustomerId,
  resolveDryRun,
  type CampaignStatusAction,
} from "./adsSafety.js";

type MutateOp = MutateOperation<
  | resources.ICampaignBudget
  | resources.ICampaign
  | resources.IAdGroup
  | resources.IAsset
  | resources.IAdGroupAd
  | resources.IAdGroupCriterion
  | resources.ICampaignCriterion
>;

export type KeywordMatchTypeInput = "EXACT" | "PHRASE" | "BROAD";

export interface SearchKeywordInput {
  text: string;
  matchType?: KeywordMatchTypeInput;
  negative?: boolean;
}

function resolveKeywordMatchType(
  matchType: KeywordMatchTypeInput | undefined,
): enums.KeywordMatchType {
  switch (matchType ?? "PHRASE") {
    case "EXACT":
      return enums.KeywordMatchType.EXACT;
    case "PHRASE":
      return enums.KeywordMatchType.PHRASE;
    case "BROAD":
      return enums.KeywordMatchType.BROAD;
    default: {
      const _exhaustive: never = matchType as never;
      throw new Error(`Unsupported keyword matchType: ${String(_exhaustive)}`);
    }
  }
}

function normalizeGeoTargetConstant(idOrResource: string): string {
  const raw = idOrResource.trim();
  if (!raw) throw new Error("geoTargetConstantIds entries must be non-empty.");
  if (raw.startsWith("geoTargetConstants/")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    throw new Error(`Invalid geo target constant: ${idOrResource}`);
  }
  return `geoTargetConstants/${digits}`;
}

function textAssets(texts: string[]): Array<{ text: string }> {
  return texts.map((text) => ({ text: text.trim() })).filter((t) => t.text.length > 0);
}

/** Normalize google-ads-api campaign status (enum number or string) to a label. */
function campaignStatusLabel(status: unknown): string {
  if (typeof status === "string" && status.trim()) return status;
  const numeric = typeof status === "number" ? status : Number(status);
  if (numeric === enums.CampaignStatus.ENABLED) return "ENABLED";
  if (numeric === enums.CampaignStatus.PAUSED) return "PAUSED";
  if (numeric === enums.CampaignStatus.REMOVED) return "REMOVED";
  if (numeric === enums.CampaignStatus.UNKNOWN) return "UNKNOWN";
  if (numeric === enums.CampaignStatus.UNSPECIFIED) return "UNSPECIFIED";
  return status == null || status === "" ? "" : String(status);
}

function summarizeMutateResponse(
  response: services.MutateGoogleAdsResponse | services.IMutateGoogleAdsResponse,
): string[] {
  const names: string[] = [];
  for (const op of response.mutate_operation_responses ?? []) {
    for (const value of Object.values(op as object)) {
      if (
        value &&
        typeof value === "object" &&
        "resource_name" in value &&
        typeof (value as { resource_name?: unknown }).resource_name === "string"
      ) {
        names.push((value as { resource_name: string }).resource_name);
      }
    }
  }
  return names;
}

export async function adsListAccessibleCustomers(accountEmail?: string) {
  const { accountEmail: email, resourceNames } =
    await listAccessibleCustomerResourceNames(accountEmail);
  const customerIds = resourceNames.map((rn) => rn.replace(/^customers\//, ""));
  return {
    accountEmail: email,
    customerIds,
    resourceNames,
    note:
      "Re-authorize accounts after enabling the adwords scope. Use a customerId below for other ads_* tools.",
  };
}

export async function adsListCampaigns(options: {
  customerId?: string;
  accountEmail?: string;
  loginCustomerId?: string;
  maxResults?: number;
  includeRemoved?: boolean;
}) {
  const customerId = resolveCustomerId(options.customerId);
  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: options.accountEmail,
    loginCustomerId: options.loginCustomerId,
  });
  const limit = Math.min(options.maxResults ?? 25, 100);
  // Google Ads rejects filters on UNSPECIFIED; enumerate supported statuses.
  const statusClause = options.includeRemoved
    ? "campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')"
    : "campaign.status IN ('ENABLED', 'PAUSED')";

  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions
    FROM campaign
    WHERE ${statusClause}
    ORDER BY campaign.id DESC
    LIMIT ${limit}
  `);

  return {
    accountEmail,
    customerId,
    campaigns: rows.map((row) => ({
      id: String(row.campaign?.id ?? ""),
      name: row.campaign?.name ?? "",
      status: campaignStatusLabel(row.campaign?.status),
      channel: row.campaign?.advertising_channel_type ?? "",
      dailyBudgetMicros: String(row.campaign_budget?.amount_micros ?? ""),
      costMicros: String(row.metrics?.cost_micros ?? "0"),
      clicks: String(row.metrics?.clicks ?? "0"),
      impressions: String(row.metrics?.impressions ?? "0"),
    })),
  };
}

export async function adsGetCampaign(options: {
  customerId?: string;
  campaignId: string;
  accountEmail?: string;
  loginCustomerId?: string;
}) {
  const customerId = resolveCustomerId(options.customerId);
  const campaignId = options.campaignId.replace(/\D/g, "");
  if (!campaignId) throw new Error("campaignId is required.");

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: options.accountEmail,
    loginCustomerId: options.loginCustomerId,
  });

  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.resource_name,
      campaign_budget.resource_name,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE campaign.id = ${campaignId}
    LIMIT 1
  `);

  const row = rows[0];
  if (!row?.campaign) {
    throw new Error(`Campaign ${campaignId} not found on customer ${customerId}.`);
  }

  return {
    accountEmail,
    customerId,
    campaign: {
      id: String(row.campaign.id ?? ""),
      name: row.campaign.name ?? "",
      status: campaignStatusLabel(row.campaign.status),
      channel: row.campaign.advertising_channel_type ?? "",
      resourceName: row.campaign.resource_name ?? "",
      budgetResourceName: row.campaign_budget?.resource_name ?? "",
      dailyBudgetMicros: String(row.campaign_budget?.amount_micros ?? ""),
      costMicros: String(row.metrics?.cost_micros ?? "0"),
      clicks: String(row.metrics?.clicks ?? "0"),
      impressions: String(row.metrics?.impressions ?? "0"),
      conversions: String(row.metrics?.conversions ?? "0"),
    },
  };
}

export async function adsSearch(options: {
  customerId?: string;
  query: string;
  accountEmail?: string;
  loginCustomerId?: string;
  maxResults?: number;
}) {
  const customerId = resolveCustomerId(options.customerId);
  const query = options.query.trim();
  if (!query) throw new Error("query (GAQL) is required.");
  if (/\b(INSERT|UPDATE|DELETE|MUTATE|CREATE|DROP)\b/i.test(query)) {
    throw new Error("ads_search is read-only. Use create/update tools for mutations.");
  }

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: options.accountEmail,
    loginCustomerId: options.loginCustomerId,
  });

  const limit = Math.min(options.maxResults ?? 50, 100);
  const limitedQuery = /\bLIMIT\b/i.test(query) ? query : `${query}\nLIMIT ${limit}`;
  const rows = await customer.query(limitedQuery);
  return {
    accountEmail,
    customerId,
    rowCount: rows.length,
    rows,
  };
}

export interface DemandGenVideoCampaignInput {
  customerId?: string;
  accountEmail?: string;
  loginCustomerId?: string;
  name: string;
  youtubeVideoId: string;
  finalUrl: string;
  headlines: string[];
  descriptions: string[];
  dailyBudgetMicros: number;
  businessName?: string;
  longHeadlines?: string[];
  logoAssetResourceName?: string;
  targetCpaMicros?: number;
  dryRun?: boolean;
  idempotencyKey?: string;
}

export async function adsCreateDemandGenVideoCampaign(
  input: DemandGenVideoCampaignInput,
) {
  assertDailyBudgetWithinCap(input.dailyBudgetMicros);
  const dryRun = resolveDryRun(input.dryRun);
  const customerId = resolveCustomerId(input.customerId);
  const youtubeVideoId = input.youtubeVideoId.trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(youtubeVideoId)) {
    throw new Error(
      "youtubeVideoId must be a YouTube video id (upload the video to YouTube first).",
    );
  }
  const finalUrl = input.finalUrl.trim();
  if (!/^https?:\/\//i.test(finalUrl)) {
    throw new Error("finalUrl must be an absolute http(s) URL.");
  }
  const headlines = textAssets(input.headlines);
  const descriptions = textAssets(input.descriptions);
  if (headlines.length < 1) throw new Error("Provide at least one headline.");
  if (descriptions.length < 1) throw new Error("Provide at least one description.");

  const campaignName = buildCampaignName(input.name, input.idempotencyKey);
  const businessName = (input.businessName ?? "BrandMatchGrowth").trim();
  const longHeadlines = textAssets(
    input.longHeadlines?.length ? input.longHeadlines : [headlines[0]!.text],
  );
  const logoAssetResourceName = input.logoAssetResourceName?.trim();

  let temp = -1;
  const nextTemp = () => String(temp--);

  const budgetRn = ResourceNames.campaignBudget(customerId, nextTemp());
  const campaignRn = ResourceNames.campaign(customerId, nextTemp());
  const adGroupRn = ResourceNames.adGroup(customerId, nextTemp());
  const videoAssetRn = ResourceNames.asset(customerId, nextTemp());

  const operations: MutateOp[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetRn,
        name: `${campaignName} Budget`,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        amount_micros: input.dailyBudgetMicros,
        explicitly_shared: false,
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignRn,
        name: campaignName,
        status: enums.CampaignStatus.PAUSED,
        advertising_channel_type: enums.AdvertisingChannelType.DEMAND_GEN,
        campaign_budget: budgetRn,
        contains_eu_political_advertising:
          enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...(input.targetCpaMicros
          ? { target_cpa: { target_cpa_micros: input.targetCpaMicros } }
          : { maximize_conversions: {} }),
      },
    },
    {
      entity: "ad_group",
      operation: "create",
      resource: {
        resource_name: adGroupRn,
        name: `${campaignName} Ad group`,
        campaign: campaignRn,
        status: enums.AdGroupStatus.PAUSED,
        demand_gen_ad_group_settings: {
          channel_controls: {
            selected_channels: {
              gmail: false,
              discover: false,
              display: false,
              youtube_in_feed: true,
              youtube_in_stream: true,
              youtube_shorts: true,
            },
          },
        },
      },
    },
    {
      entity: "asset",
      operation: "create",
      resource: {
        resource_name: videoAssetRn,
        name: `${campaignName} YouTube ${youtubeVideoId}`,
        youtube_video_asset: { youtube_video_id: youtubeVideoId },
      },
    },
  ];

  if (!logoAssetResourceName && !dryRun) {
    throw new Error(
      "logoAssetResourceName is required when dryRun is false. " +
        "Upload a logo first with ads_upload_image_asset, then pass its resource name.",
    );
  }

  operations.push({
    entity: "ad_group_ad",
    operation: "create",
    resource: {
      ad_group: adGroupRn,
      status: enums.AdGroupAdStatus.PAUSED,
      ad: {
        name: `${campaignName} Video ad`,
        final_urls: [finalUrl],
        demand_gen_video_responsive_ad: {
          business_name: { text: businessName },
          headlines,
          long_headlines: longHeadlines,
          descriptions,
          videos: [{ asset: videoAssetRn }],
          ...(logoAssetResourceName
            ? { logo_images: [{ asset: logoAssetResourceName }] }
            : {}),
        },
      },
    },
  });

  const preview = {
    dryRun,
    spendSafety: {
      campaignStatus: "PAUSED",
      adGroupStatus: "PAUSED",
      adStatus: "PAUSED",
      dailyBudgetMicros: input.dailyBudgetMicros,
      enableBlockedUnless:
        'GOOGLE_ADS_ALLOW_ENABLE=true and ads_set_campaign_status with confirmSpend: "ENABLE_SPEND"',
    },
    customerId,
    campaignName,
    youtubeVideoId,
    finalUrl,
    logoAssetResourceName: logoAssetResourceName ?? null,
    operations,
  };

  if (dryRun) {
    return {
      ...preview,
      applied: false,
      message:
        "Dry run only — nothing was created. Re-call with dryRun: false after human approval.",
    };
  }

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: input.accountEmail,
    loginCustomerId: input.loginCustomerId,
  });
  const response = await customer.mutateResources(operations);

  return {
    ...preview,
    applied: true,
    accountEmail,
    resourceNames: summarizeMutateResponse(response),
    message:
      "Created PAUSED Demand Gen video campaign. It will not spend until you enable it via ads_set_campaign_status.",
  };
}

export interface ResponsiveSearchAdInput {
  customerId?: string;
  accountEmail?: string;
  loginCustomerId?: string;
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  adGroupResourceName?: string;
  createCampaign?: boolean;
  campaignName?: string;
  dailyBudgetMicros?: number;
  dryRun?: boolean;
  idempotencyKey?: string;
}

export async function adsCreateResponsiveSearchAd(input: ResponsiveSearchAdInput) {
  const dryRun = resolveDryRun(input.dryRun);
  const customerId = resolveCustomerId(input.customerId);
  const headlines = textAssets(input.headlines);
  const descriptions = textAssets(input.descriptions);
  if (headlines.length < 3) {
    throw new Error("Responsive search ads need at least 3 headlines.");
  }
  if (descriptions.length < 2) {
    throw new Error("Responsive search ads need at least 2 descriptions.");
  }
  const finalUrl = input.finalUrl.trim();
  if (!/^https?:\/\//i.test(finalUrl)) {
    throw new Error("finalUrl must be an absolute http(s) URL.");
  }

  const operations: MutateOp[] = [];
  let adGroupRn = input.adGroupResourceName?.trim();

  if (input.createCampaign) {
    if (!input.campaignName?.trim()) {
      throw new Error("campaignName is required when createCampaign is true.");
    }
    if (input.dailyBudgetMicros == null) {
      throw new Error("dailyBudgetMicros is required when createCampaign is true.");
    }
    assertDailyBudgetWithinCap(input.dailyBudgetMicros);
    const campaignName = buildCampaignName(input.campaignName, input.idempotencyKey);
    let temp = -1;
    const nextTemp = () => String(temp--);
    const budgetRn = ResourceNames.campaignBudget(customerId, nextTemp());
    const campaignRn = ResourceNames.campaign(customerId, nextTemp());
    adGroupRn = ResourceNames.adGroup(customerId, nextTemp());

    operations.push(
      {
        entity: "campaign_budget",
        operation: "create",
        resource: {
          resource_name: budgetRn,
          name: `${campaignName} Budget`,
          delivery_method: enums.BudgetDeliveryMethod.STANDARD,
          amount_micros: input.dailyBudgetMicros,
        },
      },
      {
        entity: "campaign",
        operation: "create",
        resource: {
          resource_name: campaignRn,
          name: campaignName,
          status: enums.CampaignStatus.PAUSED,
          advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
          campaign_budget: budgetRn,
          contains_eu_political_advertising:
            enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
          manual_cpc: { enhanced_cpc_enabled: false },
          network_settings: {
            target_google_search: true,
            target_search_network: true,
            target_content_network: false,
          },
        },
      },
      {
        entity: "ad_group",
        operation: "create",
        resource: {
          resource_name: adGroupRn,
          name: `${campaignName} Ad group`,
          campaign: campaignRn,
          status: enums.AdGroupStatus.PAUSED,
          type: enums.AdGroupType.SEARCH_STANDARD,
        },
      },
    );
  }

  if (!adGroupRn) {
    throw new Error(
      "Provide adGroupResourceName, or set createCampaign: true with campaignName + dailyBudgetMicros.",
    );
  }

  operations.push({
    entity: "ad_group_ad",
    operation: "create",
    resource: {
      ad_group: adGroupRn,
      status: enums.AdGroupAdStatus.PAUSED,
      ad: {
        final_urls: [finalUrl],
        responsive_search_ad: {
          headlines: headlines.map((h) => ({ text: h.text })),
          descriptions: descriptions.map((d) => ({ text: d.text })),
        },
      },
    },
  });

  const preview = {
    dryRun,
    spendSafety: {
      status: "PAUSED",
      note: "Search ads stay paused until ads_set_campaign_status enables the campaign.",
    },
    customerId,
    adGroupResourceName: adGroupRn,
    operations,
  };

  if (dryRun) {
    return {
      ...preview,
      applied: false,
      message:
        "Dry run only — nothing was created. Re-call with dryRun: false after human approval.",
    };
  }

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: input.accountEmail,
    loginCustomerId: input.loginCustomerId,
  });
  const response = await customer.mutateResources(operations);
  return {
    ...preview,
    applied: true,
    accountEmail,
    resourceNames: summarizeMutateResponse(response),
    message: "Created PAUSED responsive search ad (and campaign/ad group if requested).",
  };
}

export async function adsUploadImageAsset(options: {
  customerId?: string;
  accountEmail?: string;
  loginCustomerId?: string;
  name: string;
  imageUrl?: string;
  imageBase64?: string;
  dryRun?: boolean;
}) {
  const dryRun = resolveDryRun(options.dryRun);
  const customerId = resolveCustomerId(options.customerId);
  const name = options.name.trim();
  if (!name) throw new Error("name is required for the image asset.");

  let data: Buffer;
  if (options.imageBase64?.trim()) {
    data = Buffer.from(options.imageBase64.trim(), "base64");
  } else if (options.imageUrl?.trim()) {
    const url = options.imageUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("imageUrl must be an absolute http(s) URL.");
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch imageUrl (${res.status} ${res.statusText}).`);
    }
    data = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error("Provide imageUrl or imageBase64.");
  }

  if (data.byteLength < 100 || data.byteLength > 5_000_000) {
    throw new Error("Image must be between 100 bytes and 5MB.");
  }

  const operation: MutateOp = {
    entity: "asset",
    operation: "create",
    resource: {
      name,
      type: enums.AssetType.IMAGE,
      image_asset: {
        data: new Uint8Array(data),
      },
    },
  };

  if (dryRun) {
    return {
      dryRun: true,
      applied: false,
      customerId,
      name,
      byteLength: data.byteLength,
      message:
        "Dry run only — image was fetched/validated but not uploaded. Re-call with dryRun: false to upload.",
    };
  }

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: options.accountEmail,
    loginCustomerId: options.loginCustomerId,
  });
  const response = await customer.mutateResources([operation]);
  const resourceNames = summarizeMutateResponse(response);
  return {
    dryRun: false,
    applied: true,
    accountEmail,
    customerId,
    name,
    resourceName: resourceNames[0] ?? "",
    resourceNames,
    message: "Image asset uploaded. Pass resourceName as logoAssetResourceName for Demand Gen ads.",
  };
}

export async function adsSetCampaignStatus(options: {
  customerId?: string;
  accountEmail?: string;
  loginCustomerId?: string;
  campaignResourceName?: string;
  campaignId?: string;
  status: CampaignStatusAction;
  confirmSpend?: string;
  /** Must be GTM_OR_EQUIVALENT_VERIFIED when enabling spend. */
  confirmMeasurement?: string;
  dryRun?: boolean;
}) {
  const dryRun = resolveDryRun(options.dryRun);
  const customerId = resolveCustomerId(options.customerId);
  const status = options.status;

  if (status === "ENABLED") {
    assertCanEnableSpend(options.confirmSpend, options.confirmMeasurement);
  }
  if (status !== "PAUSED" && status !== "ENABLED" && status !== "REMOVED") {
    const _exhaustive: never = status;
    throw new Error(`Unsupported status: ${String(_exhaustive)}`);
  }

  let resourceName = options.campaignResourceName?.trim();
  if (!resourceName) {
    const campaignId = options.campaignId?.replace(/\D/g, "");
    if (!campaignId) {
      throw new Error("Provide campaignResourceName or campaignId.");
    }
    resourceName = ResourceNames.campaign(customerId, campaignId);
  }

  const statusEnum =
    status === "ENABLED"
      ? enums.CampaignStatus.ENABLED
      : status === "REMOVED"
        ? enums.CampaignStatus.REMOVED
        : enums.CampaignStatus.PAUSED;

  const operations: MutateOp[] = [
    {
      entity: "campaign",
      operation: "update",
      resource: {
        resource_name: resourceName,
        status: statusEnum,
      },
    },
  ];

  if (dryRun) {
    return {
      dryRun: true,
      applied: false,
      customerId,
      campaignResourceName: resourceName,
      status,
      message:
        status === "ENABLED"
          ? "Dry run — would ENABLE campaign (spend). Re-call with dryRun: false only after human approval."
          : `Dry run — would set campaign to ${status}. Re-call with dryRun: false to apply.`,
    };
  }

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: options.accountEmail,
    loginCustomerId: options.loginCustomerId,
  });
  const response = await customer.mutateResources(operations);
  return {
    dryRun: false,
    applied: true,
    accountEmail,
    customerId,
    campaignResourceName: resourceName,
    status,
    resourceNames: summarizeMutateResponse(response),
    message:
      status === "ENABLED"
        ? "Campaign ENABLED — it can spend. Monitor budget closely."
        : `Campaign set to ${status}.`,
  };
}

export async function adsUpdateCampaignBudget(options: {
  customerId?: string;
  accountEmail?: string;
  loginCustomerId?: string;
  budgetResourceName: string;
  dailyBudgetMicros: number;
  dryRun?: boolean;
}) {
  assertDailyBudgetWithinCap(options.dailyBudgetMicros);
  const dryRun = resolveDryRun(options.dryRun);
  const customerId = resolveCustomerId(options.customerId);
  const budgetResourceName = options.budgetResourceName.trim();
  if (!budgetResourceName) throw new Error("budgetResourceName is required.");

  const operations: MutateOp[] = [
    {
      entity: "campaign_budget",
      operation: "update",
      resource: {
        resource_name: budgetResourceName,
        amount_micros: options.dailyBudgetMicros,
      },
    },
  ];

  if (dryRun) {
    return {
      dryRun: true,
      applied: false,
      customerId,
      budgetResourceName,
      dailyBudgetMicros: options.dailyBudgetMicros,
      message: "Dry run — budget not changed. Re-call with dryRun: false to apply.",
    };
  }

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: options.accountEmail,
    loginCustomerId: options.loginCustomerId,
  });
  const response = await customer.mutateResources(operations);
  return {
    dryRun: false,
    applied: true,
    accountEmail,
    customerId,
    budgetResourceName,
    dailyBudgetMicros: options.dailyBudgetMicros,
    resourceNames: summarizeMutateResponse(response),
    message: "Campaign budget updated (still subject to campaign PAUSED/ENABLED status).",
  };
}

export interface ApplySearchTargetingInput {
  customerId?: string;
  accountEmail?: string;
  loginCustomerId?: string;
  dryRun?: boolean;
  campaignId: string;
  adGroupId: string;
  /** Geo target constant IDs or `geoTargetConstants/{id}` resource names. */
  geoTargetConstantIds?: string[];
  keywords?: SearchKeywordInput[];
  /** Campaign-level negative keywords (broad by default). */
  negativeKeywords?: string[];
  /**
   * In-market / affinity user interest IDs (e.g. 80529 = SEO & SEM Services).
   * Added in Observation mode (`bid_only`) so keywords still control eligibility.
   */
  userInterestIds?: string[];
  /** Existing keyword texts to remove (case-insensitive exact text match). */
  removeKeywordTexts?: string[];
  /** When true, remove all existing BROAD match keywords in the ad group. */
  removeExistingBroadKeywords?: boolean;
}

export async function adsApplySearchTargeting(input: ApplySearchTargetingInput) {
  const dryRun = resolveDryRun(input.dryRun);
  const customerId = resolveCustomerId(input.customerId);
  const campaignId = input.campaignId.replace(/\D/g, "");
  const adGroupId = input.adGroupId.replace(/\D/g, "");
  if (!campaignId) throw new Error("campaignId is required.");
  if (!adGroupId) throw new Error("adGroupId is required.");

  const campaignRn = ResourceNames.campaign(customerId, campaignId);
  const adGroupRn = ResourceNames.adGroup(customerId, adGroupId);
  const geoIds = (input.geoTargetConstantIds ?? []).map(normalizeGeoTargetConstant);
  const keywords = (input.keywords ?? [])
    .map((k) => ({
      text: k.text.trim().toLowerCase(),
      matchType: resolveKeywordMatchType(k.matchType),
      negative: Boolean(k.negative),
    }))
    .filter((k) => k.text.length > 0);
  const negativeKeywords = (input.negativeKeywords ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const userInterestIds = (input.userInterestIds ?? [])
    .map((id) => id.replace(/\D/g, ""))
    .filter((id) => id.length > 0);
  const removeTexts = new Set(
    (input.removeKeywordTexts ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
  );

  if (
    geoIds.length === 0 &&
    keywords.length === 0 &&
    negativeKeywords.length === 0 &&
    userInterestIds.length === 0 &&
    removeTexts.size === 0 &&
    !input.removeExistingBroadKeywords
  ) {
    throw new Error(
      "Provide at least one of: geoTargetConstantIds, keywords, negativeKeywords, userInterestIds, removeKeywordTexts, removeExistingBroadKeywords.",
    );
  }

  const { customer, accountEmail } = await getAdsCustomer({
    customerId,
    accountEmail: input.accountEmail,
    loginCustomerId: input.loginCustomerId,
  });

  const existingKeywordRows = await customer.query(`
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.negative,
      ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group.id = ${adGroupId}
      AND ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
  `);

  const existingLocationRows = await customer.query(`
    SELECT
      campaign_criterion.resource_name,
      campaign_criterion.location.geo_target_constant,
      campaign_criterion.negative
    FROM campaign_criterion
    WHERE campaign.id = ${campaignId}
      AND campaign_criterion.type = 'LOCATION'
      AND campaign_criterion.negative = FALSE
  `);

  const existingAudienceRows =
    userInterestIds.length > 0
      ? await customer.query(`
          SELECT
            ad_group_criterion.resource_name,
            ad_group_criterion.user_interest.user_interest_category
          FROM ad_group_criterion
          WHERE ad_group.id = ${adGroupId}
            AND ad_group_criterion.type = 'USER_INTEREST'
            AND ad_group_criterion.status != 'REMOVED'
        `)
      : [];

  const existingKeywordKeys = new Set(
    existingKeywordRows.map((row) => {
      const text = String(row.ad_group_criterion?.keyword?.text ?? "")
        .trim()
        .toLowerCase();
      const matchType = String(row.ad_group_criterion?.keyword?.match_type ?? "");
      const negative = Boolean(row.ad_group_criterion?.negative);
      return `${negative ? "n" : "p"}|${matchType}|${text}`;
    }),
  );
  const existingLocations = new Set(
    existingLocationRows
      .map((row) => String(row.campaign_criterion?.location?.geo_target_constant ?? ""))
      .filter(Boolean),
  );
  const existingInterests = new Set(
    existingAudienceRows
      .map((row) =>
        String(row.ad_group_criterion?.user_interest?.user_interest_category ?? ""),
      )
      .filter(Boolean),
  );

  const operations: MutateOp[] = [];
  const planned = {
    locationsAdded: [] as string[],
    keywordsAdded: [] as string[],
    negativesAdded: [] as string[],
    audiencesAdded: [] as string[],
    keywordsRemoved: [] as string[],
  };

  if (geoIds.length > 0 || userInterestIds.length > 0) {
    operations.push({
      entity: "campaign",
      operation: "update",
      resource: {
        resource_name: campaignRn,
        ...(geoIds.length > 0
          ? {
              geo_target_type_setting: {
                positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE,
                negative_geo_target_type: enums.NegativeGeoTargetType.PRESENCE,
              },
            }
          : {}),
        ...(userInterestIds.length > 0
          ? {
              targeting_setting: {
                target_restrictions: [
                  {
                    targeting_dimension: enums.TargetingDimension.AUDIENCE,
                    bid_only: true,
                  },
                ],
              },
            }
          : {}),
      },
    });
  }

  for (const geo of geoIds) {
    if (existingLocations.has(geo)) continue;
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignRn,
        location: { geo_target_constant: geo },
      },
    });
    planned.locationsAdded.push(geo);
  }

  for (const keyword of keywords) {
    const key = `${keyword.negative ? "n" : "p"}|${keyword.matchType}|${keyword.text}`;
    if (existingKeywordKeys.has(key)) continue;
    operations.push({
      entity: "ad_group_criterion",
      operation: "create",
      resource: {
        ad_group: adGroupRn,
        status: enums.AdGroupCriterionStatus.ENABLED,
        negative: keyword.negative,
        keyword: {
          text: keyword.text,
          match_type: keyword.matchType,
        },
      },
    });
    planned.keywordsAdded.push(
      `${keyword.negative ? "-" : ""}${keyword.text} [${keyword.matchType}]`,
    );
    existingKeywordKeys.add(key);
  }

  for (const text of negativeKeywords) {
    const key = `n|${enums.KeywordMatchType.BROAD}|${text}`;
    if (existingKeywordKeys.has(key)) continue;
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignRn,
        negative: true,
        keyword: {
          text,
          match_type: enums.KeywordMatchType.BROAD,
        },
      },
    });
    planned.negativesAdded.push(text);
    existingKeywordKeys.add(key);
  }

  for (const interestId of userInterestIds) {
    const interestRn = ResourceNames.userInterest(customerId, interestId);
    if (existingInterests.has(interestRn)) continue;
    operations.push({
      entity: "ad_group_criterion",
      operation: "create",
      resource: {
        ad_group: adGroupRn,
        status: enums.AdGroupCriterionStatus.ENABLED,
        user_interest: {
          user_interest_category: interestRn,
        },
      },
    });
    planned.audiencesAdded.push(interestRn);
    existingInterests.add(interestRn);
  }

  for (const row of existingKeywordRows) {
    const text = String(row.ad_group_criterion?.keyword?.text ?? "")
      .trim()
      .toLowerCase();
    const matchType = row.ad_group_criterion?.keyword?.match_type;
    const resourceName = row.ad_group_criterion?.resource_name;
    if (!resourceName || !text) continue;
    const shouldRemove =
      removeTexts.has(text) ||
      (Boolean(input.removeExistingBroadKeywords) &&
        matchType === enums.KeywordMatchType.BROAD &&
        !row.ad_group_criterion?.negative);
    if (!shouldRemove) continue;
    operations.push({
      entity: "ad_group_criterion",
      operation: "remove",
      // google-ads-api expects the resource name string on remove.
      resource: resourceName as unknown as resources.IAdGroupCriterion,
    });
    planned.keywordsRemoved.push(text);
  }

  const preview = {
    dryRun,
    accountEmail,
    customerId,
    campaignId,
    adGroupId,
    planned,
    operationCount: operations.length,
  };

  if (operations.length === 0) {
    return {
      ...preview,
      applied: false,
      message: "Nothing to change — targeting already matches the request.",
    };
  }

  if (dryRun) {
    return {
      ...preview,
      applied: false,
      message:
        "Dry run only — targeting not written. Re-call with dryRun: false after human approval.",
    };
  }

  const response = await customer.mutateResources(operations);
  return {
    ...preview,
    applied: true,
    resourceNames: summarizeMutateResponse(response),
    message:
      "Applied Search targeting (locations / keywords / negatives / audience observation). Campaign status unchanged.",
  };
}
