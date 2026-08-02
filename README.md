# Google Workspace MCP

<p align="center">
  <a href="https://www.brandmatchgrowth.com/">
    <img src="./assets/brandmatchgrowth-logo.svg" alt="BrandMatchGrowth" width="420" />
  </a>
</p>

<p align="center">
  <strong>By <a href="https://www.brandmatchgrowth.com/">BrandMatchGrowth</a></strong>
  · performance marketing &amp; product infrastructure
</p>

An [MCP](https://modelcontextprotocol.io/) server that connects AI assistants (Cursor, Claude Desktop, etc.) to **Gmail**, **Google Calendar**, and **Google Tasks**.

Authorize **one or many** Google accounts. Tokens stay on your machine (or your own Supabase project for remote deploy). This repository never ships secrets — you bring your own Google Cloud OAuth client.

**Website:** [brandmatchgrowth.com](https://www.brandmatchgrowth.com/) · **Current version:** see [CHANGELOG.md](./CHANGELOG.md) · **Security:** [SECURITY.md](./SECURITY.md)

![Inbox automation example — triage unread mail, apply labels, draft replies](docs/screenshots/05-inbox-automation-example.png)

## Easy setup (no coding / no npm)

### Recommended — download the installer

From **[GitHub Releases](https://github.com/brandmathco/google-workspace-mcp/releases)**:

| Platform | Installer |
|----------|-----------|
| **macOS** (Apple Silicon) | `Google Workspace MCP Setup-*.dmg` |
| **Windows** | `Google Workspace MCP Setup Setup *.exe` (NSIS) |

1. Open the installer (macOS: drag the app into **Applications**).
2. Launch **Google Workspace MCP Setup**.
3. Follow the in-app wizard: create Google Cloud keys → sign in to one or more Gmail accounts → **Write Cursor MCP config**.
4. Restart Cursor.

The installer **bundles Node.js** and the MCP server. You do **not** need npm, Terminal, or a separate Node install. Cursor is pointed at the Node binary inside the app.

**macOS Gatekeeper:** if macOS says the app can’t be opened, Right-click the app → **Open** → **Open**.

**Tip:** finish dragging to Applications *before* writing the Cursor config, so paths stay stable.

### Alternative — developer clone (requires Node)

```bash
git clone https://github.com/brandmathco/google-workspace-mcp.git
cd google-workspace-mcp
npm install
npm run setup
```

Or double-click `Start Setup.command` (macOS) / `Start Setup.bat` (Windows) after installing [Node.js 20+](https://nodejs.org).

## What you can automate

- **Inbox triage** — label invoices, archive newsletters, flag client mail
- **Replies** — draft or send professional responses in-thread
- **Calendar** — create events from “let’s meet” emails
- **Tasks** — turn action items in mail into Google Tasks
- **Daily/weekly briefings** — unread summary + calendar + open tasks

See **[docs/USE_CASES.md](./docs/USE_CASES.md)** for copy-paste prompts and business workflow templates.

## Tools

| Tool | Description |
|------|-------------|
| `google_list_accounts` | List authorized Google accounts and the default |
| `google_set_default_account` | Set which account is used when `accountEmail` is omitted |
| `google_remove_account` | Remove a stored account and its refresh token |
| `gmail_list_messages` | Search/list Gmail (supports Gmail query syntax) |
| `gmail_get_message` | Read a message by ID |
| `gmail_reply` | Reply (or reply-all) in-thread |
| `gmail_move` | Add/remove labels (archive, trash, etc.) |
| `gmail_list_labels` | List label IDs |
| `calendar_create_event` | Create an event on the primary calendar |
| `calendar_list_upcoming` | List upcoming events |
| `tasks_create` | Create a Google Tasks item |
| `tasks_list` | List open tasks |

All Gmail/Calendar/Tasks tools accept optional **`accountEmail`** (e.g. `you@gmail.com`) to target a specific authorized account. Omit it to use the default.

## Multi-account OAuth

Authorize **many Gmail / Workspace accounts** without replacing the previous one.

| Storage | When to use | Config |
|---------|-------------|--------|
| **File** (default) | Local dev, stdio MCP | Tokens in `~/.config/google-workspace-mcp/accounts.json` |
| **Supabase** | Fly.io / shared remote MCP | `GOOGLE_ACCOUNTS_STORE=supabase` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `GOOGLE_TOKEN_ENCRYPTION_KEY` |

1. Run authorize once per account (same link each time; pick a different Google sign-in):

   ```bash
   npm run authorize -- --hash-key=YOUR_KEY --label=my-label
   ```

   Remote (Fly):

   ```
   https://your-app.fly.dev/authorize?hashKey=YOUR_KEY&label=my-label
   https://your-app.fly.dev/authorize?hashKey=YOUR_KEY&label=my-label&default=1
   ```

2. List accounts from Cursor: `google_list_accounts`

3. Search a specific inbox:

   ```json
   { "accountEmail": "you@gmail.com", "query": "from:example.com", "maxResults": 25 }
   ```

Legacy `GOOGLE_REFRESH_TOKEN` / `token.json` is **auto-migrated** into the multi-account store on first use.

Apply Supabase schema: `supabase/migrations/20260722000000_google_mcp_oauth_accounts.sql`

## Prerequisites

1. **Node.js 20+**
2. A **Google Cloud project** with these APIs enabled:
   - Gmail API
   - Google Calendar API
   - Google Tasks API
3. **OAuth 2.0 Desktop client** credentials from [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)

---

## Visual setup guide

### Step 1 — Create OAuth credentials (Google Cloud)

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** → **Desktop app**. Add this redirect URI:

`http://127.0.0.1:3847/oauth2callback`

![Create OAuth Desktop client in Google Cloud Console](docs/screenshots/01-google-cloud-oauth-setup.png)

Copy the **Client ID** and **Client secret** into your `.env` file.

### Step 2 — Sign in and approve access

Run the authorize script (see [Quick start](#quick-start-local--cursor--claude-desktop) below). Your browser opens Google’s sign-in and consent screens:

![Google account sign-in and OAuth consent for Gmail, Calendar, and Tasks](docs/screenshots/02-google-oauth-consent.png)

Approve access for the Google account you want the AI to use (work or dedicated automation account recommended).

### Step 3 — Authorization complete

After you approve, the local callback saves the account into `~/.config/google-workspace-mcp/accounts.json` (multi-account store):

![Authorization complete — connected to Google Workspace MCP](docs/screenshots/03-authorization-complete.png)

### Step 4 — Add the MCP server in Cursor

**Cursor Settings → MCP → Add new MCP server** (or edit your MCP JSON). Point `args` at your built `dist/index.js`:

![Cursor MCP server configuration for google-workspace](docs/screenshots/04-cursor-mcp-settings.png)

Restart Cursor. You should see `google-workspace` (or your chosen name) with tools listed.

### Step 5 — Automate in chat

Example — business inbox triage with labels:

> Triage my unread business emails from today. Label invoices as `Finance/Invoices`, archive newsletters, and draft replies for client questions. Show a summary table when done.

![Example Cursor chat — inbox triage with labels and draft replies](docs/screenshots/05-inbox-automation-example.png)

More prompts: **[docs/USE_CASES.md](./docs/USE_CASES.md)**

---

## Quick start (local — Cursor / Claude Desktop)

### 1. Clone and install

```bash
git clone https://github.com/brandmathco/google-workspace-mcp.git
cd google-workspace-mcp
npm install
npm run build
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:3847/oauth2callback
AUTHORIZE_HASH_KEY=choose-a-long-random-string
```

### 3. Authorize Google access

```bash
npm run authorize -- --hash-key=choose-a-long-random-string
```

1. Open the URL printed in your terminal.
2. Sign in and approve (see screenshots above).
3. Refresh tokens saved to `~/.config/google-workspace-mcp/accounts.json` (one entry per Google account).

Repeat the authorize command for each Gmail account you need.

### 4. Add to Cursor

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/google-workspace-mcp/dist/index.js"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_OAUTH_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_OAUTH_REDIRECT_URI": "http://127.0.0.1:3847/oauth2callback"
      }
    }
  }
}
```

Replace `/absolute/path/to/google-workspace-mcp` with your clone path. Restart Cursor after saving.

### 5. Try it

- *"List my unread Gmail from the last 24 hours"*
- *"Label unread invoices as Finance/Invoices and archive marketing mail"*
- *"Create a calendar event tomorrow at 2pm titled Team sync"*
- *"Add Google Tasks for every unread email that needs a follow-up"*

---

## Business automation examples

| Goal | Example prompt |
|------|----------------|
| Morning triage | *"Summarize unread mail, archive notifications, label client mail Needs-reply"* |
| Invoicing | *"Find emails with 'invoice' or PDF attachments this week, label Finance/Invoices"* |
| Client replies | *"Draft replies for all Needs-reply threads; wait for my OK before sending"* |
| Scheduling | *"Create 30-min calendar holds for meeting requests in unread mail"* |
| Task capture | *"Create Google Tasks from action items in today's unread email"* |
| Weekly review | *"Briefing: unread by label, this week's calendar, overdue tasks"* |

Full templates and Gmail search tips: **[docs/USE_CASES.md](./docs/USE_CASES.md)**

---

## Remote deployment (optional — Fly.io)

Run the HTTP MCP endpoint so Cursor Cloud or other clients can connect over HTTPS instead of stdio.

### 1. Prepare Fly config

```bash
cp fly.toml.example fly.toml
```

Edit `fly.toml` and set `app` to your Fly app name, then:

```bash
fly apps create your-google-workspace-mcp
fly deploy
```

### 2. Set secrets

```bash
fly secrets set \
  GOOGLE_OAUTH_CLIENT_ID="..." \
  GOOGLE_OAUTH_CLIENT_SECRET="..." \
  GOOGLE_OAUTH_REDIRECT_URI="https://your-app.fly.dev/oauth2callback" \
  GOOGLE_ACCOUNTS_STORE="supabase" \
  SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  GOOGLE_TOKEN_ENCRYPTION_KEY="..." \
  MCP_API_KEY="your-random-api-key" \
  AUTHORIZE_HASH_KEY="your-random-hash-key"
```

Add `https://your-app.fly.dev/oauth2callback` as an **Authorized redirect URI** in Google Cloud Console.

Apply the Supabase migration in `supabase/migrations/` before first authorize.

`GOOGLE_REFRESH_TOKEN` is **optional** — legacy single-token setups are migrated automatically.

### 3. Authorize on the remote host

```
https://your-app.fly.dev/authorize?hashKey=YOUR_AUTHORIZE_HASH_KEY
```

Complete Google sign-in in the browser (same consent flow as local setup). **Run again for each additional account** — tokens accumulate instead of replacing.

```
https://your-app.fly.dev/authorize?hashKey=YOUR_AUTHORIZE_HASH_KEY&label=my-label
```

### 4. Connect Cursor to the remote server

```json
{
  "mcpServers": {
    "google-workspace-remote": {
      "url": "https://your-app.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

Health check: `GET https://your-app.fly.dev/health`

---

## Google Workspace (service account) mode

For a **Google Workspace** domain with domain-wide delegation:

```env
GOOGLE_SERVICE_ACCOUNT={"type":"service_account","client_email":"...","private_key":"..."}
GOOGLE_WORKSPACE_USER_EMAIL=you@yourdomain.com
```

Skip OAuth authorize in this mode. Configure delegation in Google Admin and grant the service account the same API scopes listed in `src/auth/googleAuth.ts`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Open the guided Setup Wizard (beginner-friendly) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run stdio MCP locally (tsx) |
| `npm run dev:http` | Run HTTP server locally |
| `npm run authorize -- --hash-key=KEY` | Authorize one Google account (browser) |
| `npm run authorize:all` | Authorize many accounts from a local email list |
| `npm run authorize:all:auto` | Optional Playwright helper (local passwords file; advanced) |
| `npm run start` | Run compiled stdio server |
| `npm run start:http` | Run compiled HTTP server |

### Batch authorize (advanced)

```bash
cp scripts/authorize-targets.example.json scripts/authorize-targets.json
# edit the JSON array of emails (gitignored)
npm run authorize:all
```

Password-based automation (`authorize:all:auto`) is optional and **not** required for normal use. Copy `scripts/authorize-credentials.example.json` → `authorize-credentials.json` (gitignored). Prefer the Setup Wizard or interactive authorize so passwords never sit on disk.

## Versioning & releases

- SemVer in `package.json` (`1.4.0`, …)
- Human-readable notes in [CHANGELOG.md](./CHANGELOG.md)
- GitHub Releases (includes `.dmg` / Windows installers): [brandmathco/google-workspace-mcp/releases](https://github.com/brandmathco/google-workspace-mcp/releases)

### Building installers (maintainers)

```bash
npm run desktop:dist:mac    # → dist-installers/*.dmg  (Apple Silicon)
npm run desktop:dist:win    # → dist-installers/*Setup*.exe
```

## Security notes

See **[SECURITY.md](./SECURITY.md)** for the full “never commit” list.

- **Never commit** `.env`, `accounts.json`, `token.json`, or `scripts/authorize-credentials.json`.
- `MCP_API_KEY` protects the remote `/mcp` endpoint; generate a strong random value.
- `AUTHORIZE_HASH_KEY` protects `/authorize`; required for both local `npm run authorize` and remote OAuth.
- OAuth refresh tokens are stored locally at `~/.config/google-workspace-mcp/accounts.json` by default (or encrypted in your Supabase project when configured).
- This server requests modify access to Gmail (`gmail.modify`, `gmail.compose`). Use a dedicated Google account or review scopes before connecting production mail.
- **Review AI-drafted replies** before sending to clients.

## About BrandMatchGrowth

Built and maintained by **[BrandMatchGrowth](https://www.brandmatchgrowth.com/)** — we help teams ship growth systems, AI product tooling, and secure app infrastructure.

- Website: https://www.brandmatchgrowth.com/
- Book a call / work with us: https://www.brandmatchgrowth.com/book-a-call

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome at [github.com/brandmathco/google-workspace-mcp](https://github.com/brandmathco/google-workspace-mcp).
