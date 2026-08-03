# Deploy Google Workspace MCP to Fly.io

Prefer the **Setup Wizard** (desktop installer or `npm run setup`) — it installs the Fly CLI, walks you through Google + Supabase, collects env values, runs `fly secrets set`, and deploys.

## What you need

1. **Cursor** — AI editor that calls this MCP ([cursor.com](https://cursor.com/download))
2. **Google Cloud OAuth Desktop client** — Client ID + secret
3. **Supabase project** — Project URL + **service_role** key + SQL migration for multi-account
4. **Fly.io account** — free tier works for light use

## Wizard path

1. Cursor — what it is + download  
2. Ready — installer / build  
3. Google — open Console pages, paste Client ID/Secret  
4. Supabase — create project, run SQL, paste URL + service_role  
5. Accounts — connect Gmail locally (optional first)  
6. Fly.io — Install CLI → Sign in → fill deploy form → **Set secrets & deploy**  
7. Finish — add redirect URI in Google, authorize on Fly, paste Cursor remote MCP JSON  

## Manual CLI (advanced)

```bash
cp fly.toml.example fly.toml
# set app name
fly apps create your-app-name
fly secrets set \
  GOOGLE_OAUTH_CLIENT_ID="..." \
  GOOGLE_OAUTH_CLIENT_SECRET="..." \
  GOOGLE_OAUTH_REDIRECT_URI="https://your-app-name.fly.dev/oauth2callback" \
  GOOGLE_ACCOUNTS_STORE="supabase" \
  SUPABASE_URL="https://xxxx.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  GOOGLE_TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  MCP_API_KEY="$(openssl rand -hex 24)" \
  AUTHORIZE_HASH_KEY="$(openssl rand -hex 24)" \
  GOOGLE_ADS_DEVELOPER_TOKEN="..." \
  GOOGLE_ADS_LOGIN_CUSTOMER_ID="..." \
  GOOGLE_ADS_DEFAULT_CUSTOMER_ID="..." \
  GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS="25000000" \
  GOOGLE_ADS_ALLOW_ENABLE="false"
fly deploy
```

**Google Ads on Fly:** keep `GOOGLE_ADS_ALLOW_ENABLE=false` so Cloud Automations cannot turn campaigns on. Creates stay PAUSED; see [ADS_SAFETY.md](./ADS_SAFETY.md). After deploying a build that adds the `adwords` OAuth scope, re-authorize every account.

Apply `supabase/migrations/20260722000000_google_mcp_oauth_accounts.sql` in the Supabase SQL editor before authorizing accounts.

Authorize: `https://your-app-name.fly.dev/authorize?hashKey=YOUR_AUTHORIZE_HASH_KEY`

Cursor remote MCP:

```json
{
  "mcpServers": {
    "google-workspace-remote": {
      "url": "https://your-app-name.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

Built by [BrandMatchGrowth](https://www.brandmatchgrowth.com/).
