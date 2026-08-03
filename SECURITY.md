# Security

## Never commit these (local only)

| Path / secret | Why |
|---------------|-----|
| `.env` / `.env.local` | OAuth client secret, hash keys, API keys |
| `~/.config/google-workspace-mcp/accounts.json` | Refresh tokens for every connected Google account |
| `~/.config/google-workspace-mcp/token.json` | Legacy single-account token |
| `scripts/authorize-targets.json` | Your real account email list |
| `scripts/authorize-credentials.json` | **Passwords** for optional auto-authorize — treat as highly sensitive |
| `fly.toml` with real app names + any committed secrets | Prefer `fly secrets set` |
| Supabase **service role** key | Full database access |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API access — set via env / `fly secrets`, never commit |
| `GOOGLE_ADS_ALLOW_ENABLE=true` | Allows enabling campaigns (spend). Keep `false` on unattended hosts |

Templates that **are** safe to publish: `.env.example`, `scripts/authorize-targets.example.json`, `scripts/authorize-credentials.example.json`, `fly.toml.example`, `cursor-mcp.example.json`.

Ads spend policy: [`docs/ADS_SAFETY.md`](./docs/ADS_SAFETY.md).

## Safe public publish checklist

1. Confirm `.gitignore` covers the paths above (`fly.toml`, `.env`, authorize credential JSON, etc.).
2. Run `git status` and ensure no `.env` or credential JSON is staged.
3. Prefer the Setup Wizard or `npm run authorize` (browser sign-in) over storing passwords.
4. For remote MCP, set secrets with `fly secrets set` — never bake them into the image or repo.
5. Keep `GOOGLE_ADS_ALLOW_ENABLE=false` on Fly / Cloud hosts.
6. Rotate any key that was ever pasted into chat, a screenshot, or a public gist.
7. Before making a fork public: scan **git history** (not only the current tree) for secrets and local paths; rewrite history and rotate if anything was ever committed.

## Where secrets live (safe)

| Secret | Location |
|--------|----------|
| OAuth + Ads env | `~/.config/google-workspace-mcp/.env` (Setup Wizard) or process env |
| Refresh tokens | `~/.config/google-workspace-mcp/accounts.json` or encrypted Supabase rows |
| Fly production | `fly secrets` on your app only |

The public GitHub tree must not contain any of the above.

## Reporting issues

Open a private security advisory or email the maintainers via the GitHub org if you believe a secret was exposed in this repository.
