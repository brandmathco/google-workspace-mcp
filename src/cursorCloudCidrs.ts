import { FALLBACK_CURSOR_CLOUD_CIDRS } from "./cursorCloudCidrs.fallback.js";

export { FALLBACK_CURSOR_CLOUD_CIDRS };

const CURSOR_IPS_URL = "https://cursor.com/docs/ips.json";

let liveCidrs: readonly string[] = FALLBACK_CURSOR_CLOUD_CIDRS;

export function parseCursorIpsJson(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as {
    cloudAgents?: Record<string, unknown>;
    gitEgressProxy?: unknown;
  };
  const cidrs = new Set<string>();
  if (data.cloudAgents && typeof data.cloudAgents === "object") {
    for (const value of Object.values(data.cloudAgents)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (typeof item === "string" && item.includes("/")) cidrs.add(item);
      }
    }
  }
  if (Array.isArray(data.gitEgressProxy)) {
    for (const item of data.gitEgressProxy) {
      if (typeof item === "string" && item.includes("/")) cidrs.add(item);
    }
  }
  return [...cidrs];
}

export function getCursorCloudCidrs(): readonly string[] {
  return liveCidrs;
}

export async function refreshCursorCloudCidrs(
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const response = await fetchImpl(CURSOR_IPS_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Cursor IP list HTTP ${response.status}`);
  }
  const parsed = parseCursorIpsJson(await response.json());
  if (parsed.length === 0) {
    throw new Error("Cursor IP list was empty");
  }
  liveCidrs = parsed;
  return parsed.length;
}
