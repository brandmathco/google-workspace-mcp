/**
 * Cursor MCP power and security summary for the setup app.
 * Public results never include tokens, headers, or env values.
 */

export type ServerMap = Record<string, Record<string, unknown>>;

const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;

export function isServerName(name: string): boolean {
  return NAME_RE.test(name);
}

export function readServerMap(value: unknown): ServerMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const servers: ServerMap = {};
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isServerName(name)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    servers[name] = structuredClone(entry) as Record<string, unknown>;
  }
  return servers;
}

export function cursorServers(config: unknown): ServerMap {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  return readServerMap((config as { mcpServers?: unknown }).mcpServers);
}

export function stoppedServers(config: unknown): ServerMap {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  return readServerMap((config as { servers?: unknown }).servers);
}

export interface PublicMcp {
  name: string;
  state: "running" | "stopped";
  kind: "local" | "remote";
  detail: string;
  readonly: boolean;
  hasAuth: boolean;
  localReady: boolean | null;
}

function entryDisabled(entry: Record<string, unknown>): boolean {
  return entry.disabled === true;
}

function remoteUrl(entry: Record<string, unknown>): string | null {
  return typeof entry.url === "string" ? entry.url : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "Remote server";
  }
}

function isReadonly(entry: Record<string, unknown>, url: string | null): boolean {
  const headers = entry.headers;
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    const flag = (headers as Record<string, unknown>)["X-MCP-Readonly"];
    if (flag === true || flag === "true") return true;
  }
  return Boolean(url?.includes("/readonly"));
}

function hasAuthorization(entry: Record<string, unknown>): boolean {
  const headers = entry.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return false;
  const auth = (headers as Record<string, unknown>).Authorization;
  return typeof auth === "string" && auth.trim().length > 0;
}

function localReady(entry: Record<string, unknown>, fileExists: (path: string) => boolean): boolean | null {
  if (typeof entry.command !== "string") return null;
  const commandOk =
    entry.command.includes("/") || entry.command.includes("\\") ? fileExists(entry.command) : true;
  const args = Array.isArray(entry.args) ? entry.args : [];
  const script = args.find((item): item is string => typeof item === "string" && (item.endsWith(".js") || item.includes("/")));
  const scriptOk = script ? fileExists(script) : true;
  return commandOk && scriptOk;
}

function describeOne(name: string, entry: Record<string, unknown>, state: "running" | "stopped", fileExists: (path: string) => boolean): PublicMcp {
  const url = remoteUrl(entry);
  if (url) {
    return {
      name,
      state,
      kind: "remote",
      detail: hostOf(url),
      readonly: isReadonly(entry, url),
      hasAuth: hasAuthorization(entry),
      localReady: null,
    };
  }
  return {
    name,
    state,
    kind: "local",
    detail: "This computer",
    readonly: false,
    hasAuth: false,
    localReady: localReady(entry, fileExists),
  };
}

/** Status rows safe to show in the app. Tokens and headers stay on disk. */
export function describeMcps(
  active: ServerMap,
  stopped: ServerMap,
  fileExists: (path: string) => boolean,
): PublicMcp[] {
  const names = new Set([...Object.keys(active), ...Object.keys(stopped)]);
  const rows: PublicMcp[] = [];
  for (const name of names) {
    const live = active[name];
    if (live && !entryDisabled(live)) {
      rows.push(describeOne(name, live, "running", fileExists));
      continue;
    }
    const parked = stopped[name] ?? live;
    if (!parked) continue;
    rows.push(describeOne(name, parked, "stopped", fileExists));
  }
  rows.sort((a, b) => {
    if (a.name === "google-workspace") return -1;
    if (b.name === "google-workspace") return 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export interface ProbeTarget {
  name: string;
  url: string;
}

/** HTTPS targets only. Query strings and embedded passwords are dropped. */
export function probeTargets(active: ServerMap): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  for (const [name, entry] of Object.entries(active)) {
    if (entryDisabled(entry)) continue;
    const raw = remoteUrl(entry);
    if (!raw || !raw.startsWith("https://")) continue;
    try {
      const url = new URL(raw);
      if (url.username || url.password) continue;
      targets.push({ name, url: `${url.origin}${url.pathname}` });
    } catch {
      // skip unusable urls
    }
  }
  return targets;
}

export interface PowerResult {
  active: ServerMap;
  stopped: ServerMap;
  changed: string[];
  error?: string;
}

function withoutDisabled(entry: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(entry);
  delete copy.disabled;
  return copy;
}

function enableOne(active: ServerMap, stopped: ServerMap, name: string): string | null {
  const source = stopped[name] ?? active[name];
  if (!source) return `No MCP named ${name} is saved on this computer.`;
  active[name] = withoutDisabled(source);
  delete stopped[name];
  return null;
}

function disableOne(active: ServerMap, stopped: ServerMap, name: string): string | null {
  const source = active[name] ?? stopped[name];
  if (!source) return `No MCP named ${name} is saved on this computer.`;
  stopped[name] = withoutDisabled(source);
  delete active[name];
  return null;
}

/**
 * Start puts a server back in Cursor's config. Stop removes it so Cursor will not launch it.
 * Shared remote hosts are left running. This only changes this computer's Cursor file.
 */
export function applyPower(
  active: ServerMap,
  stopped: ServerMap,
  body: { name?: unknown; running?: unknown; all?: unknown },
): PowerResult {
  const nextActive = structuredClone(active);
  const nextStopped = structuredClone(stopped);
  const changed: string[] = [];

  if (body.all === "stop" || body.all === "start") {
    const names = body.all === "stop" ? Object.keys(nextActive) : Object.keys(nextStopped);
    for (const name of names) {
      const error = body.all === "stop"
        ? disableOne(nextActive, nextStopped, name)
        : enableOne(nextActive, nextStopped, name);
      if (error) return { active, stopped, changed: [], error };
      changed.push(name);
    }
    return { active: nextActive, stopped: nextStopped, changed };
  }

  if (typeof body.name !== "string" || !isServerName(body.name)) {
    return { active, stopped, changed: [], error: "Choose an MCP on this computer." };
  }
  if (typeof body.running !== "boolean") {
    return { active, stopped, changed: [], error: "Say whether that MCP should be running." };
  }
  const error = body.running
    ? enableOne(nextActive, nextStopped, body.name)
    : disableOne(nextActive, nextStopped, body.name);
  if (error) return { active, stopped, changed: [], error };
  return { active: nextActive, stopped: nextStopped, changed: [body.name] };
}

export function withServers(config: Record<string, unknown>, servers: ServerMap): Record<string, unknown> {
  return { ...config, mcpServers: servers };
}

export function stoppedDocument(servers: ServerMap): { servers: ServerMap } {
  return { servers };
}

export interface SecurityFinding {
  id: string;
  ok: boolean;
  title: string;
  detail: string;
}

/** True when group and world have no permission bits. */
export function privateFileMode(mode: number | null): boolean {
  if (mode === null) return false;
  return ((mode >> 3) & 0o7) === 0 && (mode & 0o7) === 0;
}

export function securityFindings(input: {
  adsAllowEnable?: string;
  hasEncryptionKey: boolean;
  storesAccountsInSupabase: boolean;
  envMode: number | null;
  configMode: number | null;
  stoppedMode: number | null;
  accountCount: number;
  githubUrl?: string | null;
}): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const spendLocked = (input.adsAllowEnable ?? "false").toLowerCase() !== "true";
  findings.push({
    id: "ads-spend",
    ok: spendLocked,
    title: "Google Ads spend is locked",
    detail: spendLocked
      ? "This computer cannot turn ads on. New ads stay paused."
      : "Spend is unlocked in the saved settings. Lock it again before you use Cursor.",
  });

  if (input.hasEncryptionKey) {
    findings.push({
      id: "token-encryption",
      ok: true,
      title: "Google sign-in is encrypted",
      detail: "Refresh tokens are encrypted before they are stored.",
    });
  } else if (input.storesAccountsInSupabase) {
    findings.push({
      id: "token-encryption",
      ok: false,
      title: "Google sign-in is not encrypted",
      detail: "Save setup again so a new encryption key is created before tokens go to Supabase.",
    });
  } else {
    findings.push({
      id: "token-encryption",
      ok: true,
      title: "Google sign-in stays on this computer",
      detail: "Account tokens are not being sent to a hosted database.",
    });
  }

  if (input.envMode === null) {
    findings.push({
      id: "secrets-file",
      ok: false,
      title: "Google keys are not saved yet",
      detail: "Finish the Google keys step so the secret file exists and stays private.",
    });
  } else if (!privateFileMode(input.envMode)) {
    findings.push({
      id: "secrets-file",
      ok: false,
      title: "Google keys are readable by other accounts",
      detail: "The secrets file should be private to you. Save the keys again to tighten it.",
    });
  } else {
    findings.push({
      id: "secrets-file",
      ok: true,
      title: "Google keys are private",
      detail: "Only your user account can read the secrets file.",
    });
  }

  if (input.configMode === null) {
    findings.push({
      id: "cursor-config",
      ok: false,
      title: "Cursor is not connected yet",
      detail: "Write the Cursor config from the finish step when you are ready.",
    });
  } else if (!privateFileMode(input.configMode)) {
    findings.push({
      id: "cursor-config",
      ok: false,
      title: "Cursor config is readable by other accounts",
      detail: "MCP keys in that file should be private to you.",
    });
  } else {
    findings.push({
      id: "cursor-config",
      ok: true,
      title: "Cursor config is private",
      detail: "Only your user account can read the MCP config.",
    });
  }

  if (input.stoppedMode !== null && !privateFileMode(input.stoppedMode)) {
    findings.push({
      id: "stopped-stash",
      ok: false,
      title: "Stopped MCPs are readable by other accounts",
      detail: "The stopped-server file should stay private. Stop one server again to tighten it.",
    });
  } else if (input.stoppedMode !== null) {
    findings.push({
      id: "stopped-stash",
      ok: true,
      title: "Stopped MCPs stay private",
      detail: "Servers you turn off are saved in a private file, not sent anywhere.",
    });
  }

  findings.push({
    id: "google-accounts",
    ok: input.accountCount > 0,
    title: input.accountCount > 0 ? "A Google account is connected" : "No Google account is connected",
    detail:
      input.accountCount > 0
        ? `${input.accountCount} account${input.accountCount === 1 ? "" : "s"} can be used from Cursor.`
        : "Connect Google before asking Cursor to read mail, calendar, or tasks.",
  });

  if (input.githubUrl) {
    const readonly = input.githubUrl.includes("githubcopilot.com/mcp/readonly");
    findings.push({
      id: "github-readonly",
      ok: readonly,
      title: readonly ? "GitHub is read-only" : "GitHub is not the read-only endpoint",
      detail: readonly
        ? "The GitHub connection cannot change repositories."
        : "Reconnect GitHub from the tools step so Cursor uses the read-only endpoint.",
    });
  }

  return findings;
}
