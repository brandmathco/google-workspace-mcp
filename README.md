# Google Workspace MCP

An [MCP](https://modelcontextprotocol.io/) server that connects AI assistants (Cursor, Claude Desktop, etc.) to **Gmail**, **Google Calendar**, and **Google Tasks**.

Use it to let an AI agent search and reply to email, create calendar events, and manage task lists — with your own Google OAuth credentials. Nothing in this repo contains secrets; you bring your own Google Cloud project and tokens.

## Tools

| Tool | Description |
|------|-------------|
| `gmail_list_messages` | Search/list Gmail (supports Gmail query syntax) |
| `gmail_get_message` | Read a message by ID |
| `gmail_reply` | Reply (or reply-all) in-thread |
| `gmail_move` | Add/remove labels (archive, trash, etc.) |
| `gmail_list_labels` | List label IDs |
| `calendar_create_event` | Create an event on the primary calendar |
| `calendar_list_upcoming` | List upcoming events |
| `tasks_create` | Create a Google Tasks item |
| `tasks_list` | List open tasks |

## Prerequisites

1. **Node.js 20+**
2. A **Google Cloud project** with these APIs enabled:
   - Gmail API
   - Google Calendar API
   - Google Tasks API
3. **OAuth 2.0 Desktop client** credentials from [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)

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
```

In Google Cloud Console, add **Authorized redirect URI**:

`http://127.0.0.1:3847/oauth2callback`

Also set a random **authorize hash key** (used to protect the OAuth setup script):

```env
AUTHORIZE_HASH_KEY=choose-a-long-random-string
```

### 3. Authorize Google access

```bash
npm run authorize -- --hash-key=choose-a-long-random-string
```

1. Open the URL printed in your terminal.
2. Sign in with the Google account you want the MCP to use.
3. Approve the requested scopes.
4. A refresh token is saved to `~/.config/google-workspace-mcp/token.json`.

### 4. Add to Cursor

**Cursor Settings → MCP → Add new MCP server**, or edit your MCP config (see `cursor-mcp.example.json`):

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

In Cursor chat, ask something like:

- *"List my unread Gmail from the last 24 hours"*
- *"Create a calendar event tomorrow at 2pm titled Team sync"*
- *"Add a Google Task: Follow up with client"*

## Remote deployment (optional — Fly.io)

Run the HTTP MCP endpoint so Cursor Cloud or other clients can connect over HTTPS instead of stdio.

### 1. Prepare Fly config

```bash
cp fly.toml.example fly.toml
```

Edit `fly.toml` and set `app` to your Fly app name, then create the app:

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
  GOOGLE_REFRESH_TOKEN="..." \
  MCP_API_KEY="your-random-api-key" \
  AUTHORIZE_HASH_KEY="your-random-hash-key"
```

Add `https://your-app.fly.dev/oauth2callback` as an **Authorized redirect URI** in Google Cloud Console.

### 3. Authorize on the remote host

Open in a browser (replace values):

```
https://your-app.fly.dev/authorize?hashKey=YOUR_AUTHORIZE_HASH_KEY
```

Complete Google sign-in. The refresh token is stored on the Fly volume / token path configured for the app.

### 4. Connect Cursor to the remote server

Use an **HTTP** MCP entry (Cursor Cloud Automations require this — not local `command`/`args`):

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

## Google Workspace (service account) mode

For a **Google Workspace** domain with domain-wide delegation, set in `.env`:

```env
GOOGLE_SERVICE_ACCOUNT={"type":"service_account","client_email":"...","private_key":"..."}
GOOGLE_WORKSPACE_USER_EMAIL=you@yourdomain.com
```

Skip OAuth authorize in this mode. Configure delegation in Google Admin and grant the service account the same API scopes listed in `src/auth/googleAuth.ts`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run stdio MCP locally (tsx) |
| `npm run dev:http` | Run HTTP server locally |
| `npm run authorize -- --hash-key=KEY` | One-time OAuth setup |
| `npm run start` | Run compiled stdio server |
| `npm run start:http` | Run compiled HTTP server |

## Security notes

- **Never commit** `.env`, `token.json`, or OAuth tokens.
- `MCP_API_KEY` protects the remote `/mcp` endpoint; generate a strong random value.
- `AUTHORIZE_HASH_KEY` protects `/authorize`; required for both local `npm run authorize` and remote OAuth.
- OAuth tokens are stored locally at `~/.config/google-workspace-mcp/token.json` by default.
- This server requests modify access to Gmail (`gmail.modify`, `gmail.compose`). Use a dedicated Google account or review scopes before connecting production mail.

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome at [github.com/brandmathco/google-workspace-mcp](https://github.com/brandmathco/google-workspace-mcp).
