# LinkedIn Ads MCP

Spend-safe LinkedIn Marketing API tools alongside Google Ads in `google-workspace-mcp`.

## Prerequisites

1. LinkedIn Developer app with **Advertising API** product approved
2. Redirect URLs in **Auth** tab:
   - `http://127.0.0.1:3847/oauth2callback/linkedin` (local)
   - `https://bmcg-google-workspace-mcp.fly.dev/oauth2callback/linkedin` (Fly)
3. **Development tier:** map ad accounts under Products → View Ad Accounts
4. Campaign Manager role: **Campaign Manager** or **Account Manager**

## Authorize

Local:

```bash
npm run authorize:linkedin
```

Fly:

```
GET https://bmcg-google-workspace-mcp.fly.dev/authorize/linkedin?hashKey=YOUR_AUTHORIZE_HASH_KEY
```

## MCP tools

| Tool | Purpose |
|------|---------|
| `linkedin_list_authorized_accounts` | OAuth accounts on this host |
| `linkedin_list_ad_accounts` | Ad accounts for the member |
| `linkedin_list_campaigns` | Campaigns in an ad account |
| `linkedin_get_campaign` | One campaign |
| `linkedin_create_website_visit_campaign` | PAUSED group + PAUSED website-visit campaign (`dryRun` default true) |
| `linkedin_set_campaign_status` | PAUSED / ACTIVE / ARCHIVED (ACTIVE gated) |

## Safety

Same pattern as Google Ads:

- Creates stay **PAUSED**
- `dryRun` defaults to **true**
- `LINKEDIN_ALLOW_ENABLE=false` on Fly by default
- Enabling **ACTIVE** requires `confirmSpend: "ENABLE_SPEND"` and `confirmMeasurement: "INSIGHT_TAG_OR_EQUIVALENT_VERIFIED"`

## Fly secrets (add to existing MCP app)

```bash
fly secrets set \
  LINKEDIN_OAUTH_CLIENT_ID="..." \
  LINKEDIN_OAUTH_CLIENT_SECRET="..." \
  LINKEDIN_OAUTH_REDIRECT_URI="https://bmcg-google-workspace-mcp.fly.dev/oauth2callback/linkedin" \
  LINKEDIN_ALLOW_ENABLE=false \
  -a bmcg-google-workspace-mcp
```

Never commit client secrets to git.
