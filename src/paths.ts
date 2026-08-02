import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** User-writable config/token dir (never inside the .app / Program Files tree). */
export function resolveUserConfigDir(): string {
  const override = process.env.GOOGLE_MCP_USER_DIR?.trim();
  if (override) {
    mkdirSync(override, { recursive: true });
    return override;
  }
  const dir = join(homedir(), ".config", "google-workspace-mcp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveUserEnvPath(): string {
  const explicit = process.env.GOOGLE_MCP_ENV_FILE?.trim();
  if (explicit) return explicit;
  return join(resolveUserConfigDir(), ".env");
}

/**
 * App/package root containing `dist/` and production `node_modules/`.
 * Installer sets GOOGLE_MCP_APP_ROOT; local clone falls back to repo root.
 */
export function resolveAppRoot(moduleUrl = import.meta.url): string {
  const override = process.env.GOOGLE_MCP_APP_ROOT?.trim();
  if (override) return override;
  return join(dirname(fileURLToPath(moduleUrl)), "..");
}

export function resolveBundledNodePath(): string | null {
  const explicit = process.env.GOOGLE_MCP_BUNDLED_NODE?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  return null;
}

export function isPackagedInstall(): boolean {
  return (
    process.env.GOOGLE_MCP_PACKAGED === "1" ||
    process.env.GOOGLE_MCP_PACKAGED === "true"
  );
}
