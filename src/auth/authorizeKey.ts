import { timingSafeEqual } from "node:crypto";

export function getExpectedAuthorizeHashKey(): string | null {
  return process.env.AUTHORIZE_HASH_KEY?.trim() || null;
}

export function isValidAuthorizeHashKey(
  provided: string | null | undefined,
): boolean {
  const expected = getExpectedAuthorizeHashKey();
  if (!expected || !provided?.trim()) {
    return false;
  }

  const providedBuffer = Buffer.from(provided.trim(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function assertAuthorizeHashKey(
  provided: string | null | undefined,
): void {
  if (!getExpectedAuthorizeHashKey()) {
    throw new Error(
      "AUTHORIZE_HASH_KEY is not configured. Set it in .env before running authorize.",
    );
  }

  if (!isValidAuthorizeHashKey(provided)) {
    throw new Error("Invalid or missing authorize hash key.");
  }
}

export function extractAuthorizeHashKeyFromRequest(input: {
  headerValue?: string | string[];
  queryValue?: string | string[];
}): string | undefined {
  if (typeof input.headerValue === "string" && input.headerValue.trim()) {
    return input.headerValue.trim();
  }

  if (typeof input.queryValue === "string" && input.queryValue.trim()) {
    return input.queryValue.trim();
  }

  return undefined;
}
