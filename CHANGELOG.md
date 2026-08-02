# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] — 2026-08-01

### Added

- Setup Wizard guided path for **Cursor**, **Google Cloud**, **Supabase multi-account**, and **Fly.io deploy**
- One-click openers for Google Console / Supabase / Cursor / Fly pages
- Fly CLI install + sign-in + deploy form that sets secrets for you
- Supabase SQL loader/copy for the multi-account migration
- `docs/DEPLOY_FLY.md` and `Dockerfile.fly` for wizard/packaged deploys

## [1.4.0] — 2026-08-01

### Added

- **BrandMatchGrowth** branding across README, Setup Wizard, OAuth success page, and desktop installers
- App icon (BrandMatchGrowth mark) for macOS `.dmg` / Windows NSIS
- Website links to [brandmatchgrowth.com](https://www.brandmatchgrowth.com/) in the app menu, wizard, and repo docs

### Changed

- Purple/gold BrandMatchGrowth theme in the Setup Wizard UI
- Package homepage points to BrandMatchGrowth

## [1.3.0] — 2026-08-01

### Added

- **Desktop installers** (no npm / no separate Node.js):
  - macOS `.dmg` — *Google Workspace MCP Setup*
  - Windows NSIS `.exe`
  - Bundles a portable Node.js runtime + MCP server for Cursor
  - In-app Setup Wizard (Electron) teaches Google Cloud OAuth and writes `~/.cursor/mcp.json`
- Secrets for installer users live under `~/.config/google-workspace-mcp/.env` (outside the app bundle)
- Build scripts: `npm run desktop:dist:mac` / `desktop:dist:win`

### Changed

- README leads with installer download from GitHub Releases

## [1.2.0] — 2026-08-01

### Added

- **Guided Setup Wizard** for non-developers (`Start Setup.command` on macOS, `Start Setup.bat` on Windows)
  - Walks through Google Cloud OAuth client creation
  - Saves `.env` locally (never committed)
  - Connects one or many Google accounts
  - Writes Cursor `mcp.json` for you
- Multi-account batch helpers:
  - `npm run authorize:all` — interactive browser authorize from a local email list
  - `npm run authorize:all:auto` — optional Playwright helper (passwords stay in a **gitignored** local file)
- Example credential template: `scripts/authorize-credentials.example.json`
- `SECURITY.md` — what must never be published

### Changed

- README quick path highlights the Setup Wizard and multi-account storage
- Token storage docs clarify `~/.config/google-workspace-mcp/accounts.json`

## [1.1.0] — 2026-07-21

### Added

- Multi-account OAuth with file and Supabase token storage
- MCP tools: `google_list_accounts`, `google_set_default_account`, `google_remove_account`
- Optional `accountEmail` on Gmail / Calendar / Tasks tools
- Legacy `GOOGLE_REFRESH_TOKEN` / `token.json` auto-migration

## [1.0.0] — 2026-07-05

### Added

- Initial public release: Gmail, Calendar, and Tasks MCP tools
- Local authorize script and optional Fly.io HTTP MCP endpoint

[1.5.0]: https://github.com/brandmathco/google-workspace-mcp/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/brandmathco/google-workspace-mcp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/brandmathco/google-workspace-mcp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/brandmathco/google-workspace-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/brandmathco/google-workspace-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/brandmathco/google-workspace-mcp/releases/tag/v1.0.0
