---
name: google-ads-spend-safe
description: Spend-safe Google Ads via MCP — dry-run default, paused creates, never auto-enable; require GTM/measurement before ENABLE.
---

# Google Ads spend-safe

Use when creating, editing, pausing, or enabling Google Ads through the Google Workspace / Ads MCP tools.

## Hard rules

1. **Read first** — list customers → list/get campaigns before mutate.
2. **`dryRun` defaults true** — only pass `dryRun: false` after explicit human approval.
3. **Creates stay PAUSED** — RSA / Demand Gen never enable themselves.
4. **Automations never enable spend.**
5. **Budgets** — stay under `GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS`.
6. **Measurement before enable** — do **not** enable a campaign until **Google Tag Manager** (or equivalent: gtag/GA4 + Google Ads conversion tag) is verified on the landing URL.
7. **Enable requires all of:**
   - `GOOGLE_ADS_ALLOW_ENABLE=true` on the MCP host
   - `confirmSpend: "ENABLE_SPEND"`
   - `confirmMeasurement: "GTM_OR_EQUIVALENT_VERIFIED"`
   - Interactive human session (not cron)

## Equivalent measurement

Acceptable instead of GTM:

- gtag.js with GA4 **and** a Google Ads conversion tag / event that fires on the conversion action
- Server-side / Consent Mode setups that still record the Ads conversion

Not enough: ads live with only pageviews and no conversion action.
