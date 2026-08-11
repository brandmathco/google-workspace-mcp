/**
 * Apply locations + keywords + negatives + in-market audiences to the three
 * PAUSED Search campaigns on BMG client 2783461815.
 *
 * Usage:
 *   npx tsx scripts/apply-search-targeting-packs.ts
 *   npx tsx scripts/apply-search-targeting-packs.ts --apply
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { adsApplySearchTargeting } from "../src/services/ads.js";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.env.HOME ?? "", ".config/google-workspace-mcp/.env"));

const APPLY = process.argv.includes("--apply");

const SHARED = {
  accountEmail: "mamadou@brandmatchco.com",
  customerId: "2783461815",
  loginCustomerId: "5238277142",
  dryRun: !APPLY,
} as const;

type Pack = Parameters<typeof adsApplySearchTargeting>[0];

const packs: Pack[] = [
  {
    ...SHARED,
    campaignId: "24129340534",
    adGroupId: "196339660702",
    geoTargetConstantIds: ["2124"], // Canada
    userInterestIds: ["80529", "80543", "80517"], // SEO & SEM, Web Design, Advertising
    removeExistingBroadKeywords: true,
    keywords: [
      { text: "therapist website redesign", matchType: "PHRASE" },
      { text: "therapist website SEO", matchType: "PHRASE" },
      { text: "counselling website SEO", matchType: "PHRASE" },
      { text: "SEO for therapists Canada", matchType: "PHRASE" },
      { text: "psychologist website Canada", matchType: "PHRASE" },
      { text: "therapy practice website", matchType: "PHRASE" },
      { text: "therapy practice website rebuild", matchType: "PHRASE" },
      { text: "counsellor website redesign", matchType: "PHRASE" },
      { text: "private practice website design Canada", matchType: "PHRASE" },
      { text: "therapist website redesign", matchType: "EXACT" },
      { text: "therapist website SEO", matchType: "EXACT" },
      { text: "SEO for therapists", matchType: "PHRASE" },
      { text: "counsellor website SEO", matchType: "PHRASE" },
    ],
    negativeKeywords: [
      "jobs",
      "salary",
      "hiring",
      "internship",
      "student",
      "free wordpress theme",
      "wordpress theme",
      "diy",
      "template",
      "wix free",
      "squarespace tutorial",
      "course",
      "certificate",
      "near me jobs",
      "vibecode",
    ],
  },
  {
    ...SHARED,
    campaignId: "24124370297",
    adGroupId: "202867439887",
    geoTargetConstantIds: ["2840", "2124"], // US + Canada
    userInterestIds: ["80523", "80279", "80530"], // Merchant payments, Biz software, Enterprise SW
    keywords: [
      { text: "retail POS system", matchType: "PHRASE" },
      { text: "multi-store point of sale", matchType: "PHRASE" },
      { text: "inventory management software for retailers", matchType: "PHRASE" },
      { text: "retail loyalty member pricing", matchType: "PHRASE" },
      { text: "white label online store POS", matchType: "PHRASE" },
      { text: "Square alternative for retail", matchType: "PHRASE" },
      { text: "grocery specialty market POS", matchType: "PHRASE" },
      { text: "point of sale for multi store", matchType: "PHRASE" },
      { text: "retail register software", matchType: "PHRASE" },
      { text: "POS inventory loyalty online", matchType: "PHRASE" },
      { text: "retail POS system", matchType: "EXACT" },
      { text: "multi store POS", matchType: "PHRASE" },
    ],
    negativeKeywords: [
      "docusign",
      "docusign alternative",
      "e-sign",
      "esignature",
      "electronic signature",
      "pdf sign",
      "digital signage",
      "opensignlabs",
      "opensign.me",
      "job",
      "salary",
      "free wordpress",
      "diy",
    ],
  },
  {
    ...SHARED,
    campaignId: "24129400273",
    adGroupId: "202022327671",
    geoTargetConstantIds: ["1001801"], // Calgary city
    userInterestIds: ["80517", "80463"], // Advertising & Marketing, Business Services
    keywords: [
      { text: "free influencer signup calgary", matchType: "PHRASE" },
      { text: "calgary influencer platform", matchType: "PHRASE" },
      { text: "join brand campaigns calgary", matchType: "PHRASE" },
      { text: "creator marketplace calgary", matchType: "PHRASE" },
      { text: "brand collabs for influencers calgary", matchType: "PHRASE" },
      { text: "free creator account canada", matchType: "PHRASE" },
      { text: "calgary creator platform", matchType: "PHRASE" },
      { text: "influencer marketplace calgary", matchType: "EXACT" },
      { text: "brandmatchco signup", matchType: "PHRASE" },
    ],
    negativeKeywords: [
      "jobs",
      "salary",
      "hiring",
      "agency jobs",
      "onlyfans",
      "tiktok shop scam",
      "free followers",
      "buy followers",
    ],
  },
];

async function main() {
  console.log(APPLY ? "APPLY mode — writing targeting" : "DRY-RUN mode (pass --apply to write)");
  for (const pack of packs) {
    const label = `${pack.campaignId} / ad group ${pack.adGroupId}`;
    console.log(`\n=== ${label} ===`);
    try {
      const result = await adsApplySearchTargeting(pack);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`FAILED ${label}:`, err);
      process.exitCode = 1;
    }
  }
}

main();
