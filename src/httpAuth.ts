import { timingSafeEqual } from "node:crypto";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import type { NextFunction, Request, Response } from "express";
import {
  getCursorCloudCidrs,
  refreshCursorCloudCidrs,
} from "./cursorCloudCidrs.js";

const CURSOR_CIDR_REFRESH_MS = 6 * 60 * 60 * 1000;
const FLY_INTERNAL_CIDRS = ["fdaa::/16"];
const LOCALHOST_CIDRS = ["127.0.0.1/32", "::1/128"];

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function tokensMatch(provided: string | null, expected: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  if (!provided) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  if (providedBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function createRateLimiter(windowMs: number, maxHits: number) {
  const hits = new Map<string, number[]>();

  return (key: string, now = Date.now()): boolean => {
    const windowStart = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((stamp) => stamp > windowStart);
    if (recent.length >= maxHits) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export function requestIp(req: Request): string {
  const fly = req.headers["fly-client-ip"];
  if (typeof fly === "string" && fly.trim()) return fly.trim();

  return req.ip ?? "unknown";
}

export function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCidr(entry: string): { ip: string; prefix: number; kind: "ipv4" | "ipv6" } | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  const ip = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefixRaw = slash === -1 ? undefined : trimmed.slice(slash + 1);
  if (isIPv4(ip)) {
    const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    return { ip, prefix, kind: "ipv4" };
  }
  if (isIPv6(ip)) {
    const prefix = prefixRaw === undefined ? 128 : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    return { ip, prefix, kind: "ipv6" };
  }
  return null;
}

export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  if (!ip || ip === "unknown") return false;
  const list = new BlockList();
  for (const entry of cidrs) {
    const parsed = parseCidr(entry);
    if (!parsed) continue;
    list.addSubnet(parsed.ip, parsed.prefix, parsed.kind);
  }
  if (isIPv4(ip)) return list.check(ip, "ipv4");
  if (isIPv6(ip)) return list.check(ip, "ipv6");
  return false;
}

export function isServicePath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/") || path === "/v1" || path.startsWith("/v1/");
}

export type McpAccessOptions = {
  allowedCidrs: string[];
  allowCursorCloud: boolean;
  cursorCloudCidrs?: () => readonly string[];
  allowServiceCalls: boolean;
  serviceCidrs: string[];
  allowFlyInternal: boolean;
  allowLocalhost: boolean;
};

export function loadMcpAccessOptions(
  env: NodeJS.ProcessEnv = process.env,
): McpAccessOptions {
  return {
    allowedCidrs: splitCsv(env.MCP_ALLOWED_CIDRS),
    allowCursorCloud: env.MCP_ALLOW_CURSOR_CLOUD === "true",
    allowServiceCalls: env.MCP_ALLOW_SERVICE_CALLS !== "false",
    serviceCidrs: splitCsv(env.MCP_SERVICE_CIDRS),
    allowFlyInternal: env.MCP_ALLOW_FLY_INTERNAL !== "false",
    allowLocalhost: env.MCP_ALLOW_LOCALHOST !== "false",
  };
}

export function accessAllowlistEnabled(options: McpAccessOptions): boolean {
  return options.allowedCidrs.length > 0 || options.allowCursorCloud;
}

export function ipAllowedForPath(
  ip: string,
  path: string,
  options: McpAccessOptions,
): boolean {
  if (!accessAllowlistEnabled(options)) return true;

  const cursorCidrs = options.allowCursorCloud
    ? (options.cursorCloudCidrs?.() ?? getCursorCloudCidrs())
    : [];
  const trusted = [
    ...options.allowedCidrs,
    ...cursorCidrs,
    ...(options.allowFlyInternal ? FLY_INTERNAL_CIDRS : []),
    ...(options.allowLocalhost ? LOCALHOST_CIDRS : []),
  ];

  if (isServicePath(path) && options.allowServiceCalls) {
    if (options.serviceCidrs.length === 0) return true;
    return ipInCidrs(ip, [...trusted, ...options.serviceCidrs]);
  }

  return ipInCidrs(ip, trusted);
}

export function applySecurityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Permissions-Policy", "interest-cohort=()");
  next();
}

export function createMcpGuards(
  expectedKey: string | undefined,
  access: McpAccessOptions = loadMcpAccessOptions(),
) {
  const allow = createRateLimiter(60_000, 120);

  return function requireApiKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ip = requestIp(req);
    if (!allow(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    if (!ipAllowedForPath(ip, req.path, access)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!expectedKey) {
      res.status(500).json({ error: "MCP_API_KEY is not configured" });
      return;
    }

    const header =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;
    if (!tokensMatch(extractBearerToken(header), expectedKey)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

export function startCursorCloudAllowlistRefresh(): void {
  if (process.env.MCP_ALLOW_CURSOR_CLOUD !== "true") return;
  void refreshCursorCloudCidrs().catch((error) => {
    console.warn(
      "Cursor Cloud IP refresh failed; using fallback snapshot",
      error instanceof Error ? error.message : "unknown",
    );
  });
  setInterval(() => {
    void refreshCursorCloudCidrs().catch(() => undefined);
  }, CURSOR_CIDR_REFRESH_MS).unref();
}
