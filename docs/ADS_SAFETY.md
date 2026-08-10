# Google Ads spend safety

This MCP can create Google Ads entities. **Creates never spend by themselves** — campaigns, ad groups, and ads are always created `PAUSED`. Enabling spend is deliberately hard.

## Rules for agents and automations

1. **Read first** — `ads_list_accessible_customers` → `ads_list_campaigns` / `ads_get_campaign` before any mutate.
2. **Dry-run by default** — mutating tools treat `dryRun` as `true` unless the caller passes `dryRun: false`. Always show the dry-run preview to a human before applying.
3. **Budget cap** — daily budgets cannot exceed `GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS` (default **$25/day** = `25000000` micros).
4. **Never enable from automation** — `ads_set_campaign_status` with `ENABLED` requires:
   - Host env `GOOGLE_ADS_ALLOW_ENABLE=true`
   - Tool arg `confirmSpend: "ENABLE_SPEND"`
   - Tool arg `confirmMeasurement: "GTM_OR_EQUIVALENT_VERIFIED"` after a human verifies **Google Tag Manager** (or equivalent: gtag/GA4 + Google Ads conversion tag) fires on the campaign landing URL
   - Prefer leaving `GOOGLE_ADS_ALLOW_ENABLE` `false` on Fly / Cloud agents.
5. **No measurement → no enable** — do not turn spend on until conversion tracking is verified. The MCP cannot scrape GTM for you; the confirmation token is the gate.
6. **Video ads need a YouTube ID** — upload the creative to YouTube first; pass the video id (not a file path). Logos go through `ads_upload_image_asset`.
7. **Idempotency** — pass `idempotencyKey` on creates when retrying so campaign names do not duplicate silently.

## Recommended human workflow

1. Dry-run Demand Gen / RSA create → review JSON preview.
2. Upload logo asset (`dryRun: false`) if needed.
3. Apply create with `dryRun: false` (still **PAUSED**).
4. Human reviews in Google Ads UI **and** verifies GTM / Ads conversion on the landing URL (Tag Assistant / preview).
5. Only then: set `GOOGLE_ADS_ALLOW_ENABLE=true` locally (not on unattended automation), call `ads_set_campaign_status` with `confirmSpend: "ENABLE_SPEND"`, `confirmMeasurement: "GTM_OR_EQUIVALENT_VERIFIED"`, and `dryRun: false`.

## Prerequisites

- Google Ads API enabled on the OAuth GCP project
- `GOOGLE_ADS_DEVELOPER_TOKEN` set
- OAuth refresh tokens re-issued after the `adwords` scope was added (`authorize` / `authorize:all`)
- Optional: `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (MCC), `GOOGLE_ADS_DEFAULT_CUSTOMER_ID`

See [USE_CASES.md](./USE_CASES.md) for copy-paste prompts.
