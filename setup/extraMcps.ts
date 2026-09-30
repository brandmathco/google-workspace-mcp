/**
 * Optional Cursor MCP servers the setup wizard can add on this computer.
 * URLs are fixed. Tokens come from the person using the installer and are
 * never stored in the app bundle.
 */

export interface ExtraMcpDefinition {
  id: string;
  label: string;
  detail: string;
  url: string;
  /** GitHub remote toolset that cannot change repositories. */
  readonly?: boolean;
}

export const EXTRA_MCP_CATALOG: readonly ExtraMcpDefinition[] = [
  {
    id: "github",
    label: "GitHub",
    detail:
      "Official GitHub MCP, read-only. Create a personal access token at github.com/settings/tokens and paste it here. It stays in Cursor on this computer.",
    url: "https://api.githubcopilot.com/mcp/readonly",
    readonly: true,
  },
  {
    id: "fly",
    label: "Fly.io",
    detail:
      "BrandMatchGrowth Fly gateway. Paste the gateway API key (not your Fly account token).",
    url: "https://bmcg-fly-mcp.fly.dev/mcp",
  },
  {
    id: "netlify",
    label: "Netlify",
    detail:
      "BrandMatchGrowth Netlify gateway. Paste the gateway API key (not your Netlify personal access token).",
    url: "https://bmcg-netlify-mcp.fly.dev/mcp",
  },
  {
    id: "godaddy",
    label: "GoDaddy",
    detail: "BrandMatchGrowth GoDaddy gateway. Paste the gateway API key.",
    url: "https://bmcg-godaddy-mcp.fly.dev/mcp",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    detail: "BrandMatchGrowth SendGrid gateway. Paste the gateway API key.",
    url: "https://bmcg-sendgrid-mcp.fly.dev/mcp",
  },
  {
    id: "quickbooks",
    label: "QuickBooks",
    detail: "BrandMatchGrowth QuickBooks gateway. Paste the gateway API key.",
    url: "https://bmcg-quickbooks-mcp.fly.dev/mcp",
  },
];

const catalogById = new Map(EXTRA_MCP_CATALOG.map((item) => [item.id, item]));

export interface CursorHttpServer {
  url: string;
  headers: Record<string, string>;
}

/**
 * Build Cursor `mcpServers` entries from installer choices.
 * Unknown ids and empty tokens are ignored so the page cannot point a key at another host.
 */
export function cursorServersForExtras(choices: unknown): Record<string, CursorHttpServer> {
  if (!Array.isArray(choices)) return {};
  const servers: Record<string, CursorHttpServer> = {};
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const record = choice as { id?: unknown; token?: unknown };
    if (typeof record.id !== "string" || typeof record.token !== "string") continue;
    const item = catalogById.get(record.id);
    const token = record.token.trim();
    if (!item || token.length < 16 || token.length > 512 || /\s/.test(token)) continue;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (item.readonly) headers["X-MCP-Readonly"] = "true";
    servers[item.id] = { url: item.url, headers };
  }
  return servers;
}
