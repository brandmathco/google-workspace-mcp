import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 30 * 60 * 1000;
/** Best-effort replay block on a single machine; signed expiry is the real guard across restarts. */
const consumedNonces = new Map<string, number>();
/** Legacy hex nonces created before signed-state deploy (same process only). */
const legacyPendingStates = new Map<string, number>();

export type OAuthStateClaims = {
  label?: string;
  makeDefault?: boolean;
};

function signingSecret(): string {
  const fromHash = process.env.AUTHORIZE_HASH_KEY?.trim();
  if (fromHash) return fromHash;
  const fromOAuth = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (fromOAuth) return fromOAuth;
  throw new Error(
    "AUTHORIZE_HASH_KEY (or GOOGLE_OAUTH_CLIENT_SECRET) is required to sign OAuth state.",
  );
}

function sign(payloadB64: string): string {
  return createHmac("sha256", signingSecret()).update(payloadB64).digest("base64url");
}

function purgeMaps(now = Date.now()): void {
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= now) consumedNonces.delete(nonce);
  }
  for (const [nonce, expiresAt] of legacyPendingStates) {
    if (expiresAt <= now) legacyPendingStates.delete(nonce);
  }
}

/**
 * Create a signed OAuth state that survives Fly machine restarts.
 * Format: `<payloadB64>.<hmacB64>` where payload is `{ n, exp, label?, makeDefault? }`.
 */
export function createOAuthState(claims: OAuthStateClaims = {}): string {
  const payload = {
    n: randomBytes(16).toString("hex"),
    exp: Date.now() + STATE_TTL_MS,
    ...(claims.label ? { label: claims.label } : {}),
    ...(claims.makeDefault ? { makeDefault: true } : {}),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type ConsumedOAuthState =
  | { ok: true; label?: string; makeDefault: boolean }
  | { ok: false; reason: string };

/**
 * Validate and consume OAuth state from the Google callback `state` query param.
 * Accepts:
 * - New signed tokens (`payload.hmac`)
 * - Legacy wrapper base64url JSON `{ nonce, label, makeDefault }` (nonce may be signed or hex)
 * - Legacy raw hex nonce (same process only)
 */
export function consumeOAuthStateDetailed(state: string | undefined): ConsumedOAuthState {
  if (!state?.trim()) {
    return { ok: false, reason: "Missing OAuth state." };
  }

  purgeMaps();

  // Prefer signed token directly as the Google `state` value.
  if (state.includes(".") && !looksLikeLegacyWrapper(state)) {
    return consumeSignedToken(state);
  }

  // Legacy: base64url(JSON.stringify({ nonce, label, makeDefault }))
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      nonce?: string;
      label?: string;
      makeDefault?: boolean;
    };
    if (typeof parsed.nonce === "string" && parsed.nonce.trim()) {
      if (parsed.nonce.includes(".")) {
        const inner = consumeSignedToken(parsed.nonce);
        if (!inner.ok) return inner;
        return {
          ok: true,
          label: parsed.label ?? inner.label,
          makeDefault: parsed.makeDefault === true || inner.makeDefault,
        };
      }
      const legacy = consumeLegacyHex(parsed.nonce);
      if (!legacy.ok) return legacy;
      return {
        ok: true,
        label: parsed.label,
        makeDefault: parsed.makeDefault === true,
      };
    }
  } catch {
    // not a legacy wrapper — fall through
  }

  if (/^[a-f0-9]{32,}$/i.test(state)) {
    return consumeLegacyHex(state);
  }

  // Last resort: treat as signed even if wrapper heuristic misfired
  if (state.includes(".")) {
    return consumeSignedToken(state);
  }

  return {
    ok: false,
    reason:
      "Invalid or expired OAuth state. Start a fresh /authorize link (do not reuse an old tab).",
  };
}

/** Back-compat boolean API used by scripts/wizard. */
export function consumeOAuthState(state: string | undefined): boolean {
  return consumeOAuthStateDetailed(state).ok;
}

function looksLikeLegacyWrapper(state: string): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      nonce?: unknown;
    };
    return typeof parsed?.nonce === "string";
  } catch {
    return false;
  }
}

function consumeSignedToken(token: string): ConsumedOAuthState {
  const dot = token.lastIndexOf(".");
  const payloadB64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!payloadB64 || !mac) {
    return { ok: false, reason: "Malformed OAuth state signature." };
  }

  let expected: string;
  try {
    expected = sign(payloadB64);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "OAuth state signing secret missing.",
    };
  }

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      ok: false,
      reason:
        "OAuth state signature mismatch (server secret rotated mid-login). Start a fresh /authorize link.",
    };
  }

  let parsed: { n?: string; exp?: number; label?: string; makeDefault?: boolean };
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      n?: string;
      exp?: number;
      label?: string;
      makeDefault?: boolean;
    };
  } catch {
    return { ok: false, reason: "Malformed OAuth state payload." };
  }

  if (!parsed.n?.trim() || typeof parsed.exp !== "number") {
    return { ok: false, reason: "Malformed OAuth state payload." };
  }
  if (parsed.exp <= Date.now()) {
    return {
      ok: false,
      reason: "OAuth state expired. Start a fresh /authorize link and finish within 30 minutes.",
    };
  }

  if (consumedNonces.has(parsed.n)) {
    return {
      ok: false,
      reason: "OAuth state already used. Start a fresh /authorize link.",
    };
  }
  consumedNonces.set(parsed.n, parsed.exp);

  return {
    ok: true,
    label: parsed.label,
    makeDefault: parsed.makeDefault === true,
  };
}

function consumeLegacyHex(nonce: string): ConsumedOAuthState {
  const expiresAt = legacyPendingStates.get(nonce);
  if (!expiresAt || expiresAt <= Date.now()) {
    legacyPendingStates.delete(nonce);
    return {
      ok: false,
      reason:
        "Invalid or expired OAuth state (legacy). Start a fresh /authorize link after the latest deploy.",
    };
  }
  legacyPendingStates.delete(nonce);
  return { ok: true, makeDefault: false };
}
