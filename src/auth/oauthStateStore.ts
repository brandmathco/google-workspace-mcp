import { randomBytes } from "node:crypto";

const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function purgeExpiredStates(now = Date.now()): void {
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt <= now) {
      pendingStates.delete(state);
    }
  }
}

export function createOAuthState(): string {
  purgeExpiredStates();
  const state = randomBytes(24).toString("hex");
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

export function consumeOAuthState(state: string | undefined): boolean {
  if (!state?.trim()) {
    return false;
  }

  purgeExpiredStates();
  const expiresAt = pendingStates.get(state);
  if (!expiresAt || expiresAt <= Date.now()) {
    pendingStates.delete(state);
    return false;
  }

  pendingStates.delete(state);
  return true;
}
