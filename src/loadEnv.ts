import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUserEnvPath } from "./paths.js";

function applyEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadEnvFile(): void {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.GOOGLE_MCP_ENV_FILE?.trim(),
    resolveUserEnvPath(),
    join(moduleDir, "..", ".env"),
    join(moduleDir, "..", ".env.local"),
    join(process.cwd(), ".env"),
  ].filter((path): path is string => Boolean(path));

  // First file wins for each key (applyEnvFile only sets unset keys).
  // Prefer explicit/user env over repo .env so installer secrets stay outside the app bundle.
  const ordered = [...new Set(candidates)];
  for (const path of ordered) {
    applyEnvFile(path);
  }
}
