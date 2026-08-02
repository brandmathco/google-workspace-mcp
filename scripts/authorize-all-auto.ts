#!/usr/bin/env node
/**
 * Batch OAuth authorize using Playwright to sign in with passwords from
 * scripts/authorize-credentials.json (gitignored).
 *
 * Uses human-like pacing (random delays, typed input) to reduce bot detection.
 * Google may still require 2FA — complete prompts in the browser window.
 *
 * Usage: npm run authorize:all:auto
 */

import { readFileSync, existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import { chromium, type Locator, type Page } from "playwright";
import { loadEnvFile } from "../src/loadEnv.js";
import { assertAuthorizeHashKey } from "../src/auth/authorizeKey.js";
import { renderAuthorizationCompleteHtml } from "../src/auth/authorizeCompleteHtml.js";
import { getAccountStore, saveAuthorizedAccount } from "../src/auth/accountStore.js";
import {
  createOAuthClientForSetup,
  getAuthorizationUrl,
} from "../src/auth/googleAuth.js";
import { consumeOAuthState, createOAuthState } from "../src/auth/oauthStateStore.js";

loadEnvFile();

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Pause between accounts (ms) — default 60–120s so Google doesn't see rapid logins */
const BETWEEN_ACCOUNT_MIN_MS = Number(process.env.AUTH_PACE_BETWEEN_MIN_MS ?? 60_000);
const BETWEEN_ACCOUNT_MAX_MS = Number(process.env.AUTH_PACE_BETWEEN_MAX_MS ?? 120_000);

interface CredentialEntry {
  email: string;
  passwords?: string[];
  notes?: string;
}

function loadCredentials(path: string): CredentialEntry[] {
  if (!existsSync(path)) {
    throw new Error(`Credentials file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as CredentialEntry[];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random pause — mimics reading the page before acting */
async function humanPause(minMs: number, maxMs: number, log = false): Promise<void> {
  const ms = randomInt(minMs, maxMs);
  if (log) {
    console.log(`  … pacing ${Math.round(ms / 1000)}s before next step`);
  }
  await sleep(ms);
}

async function humanType(locator: Locator, text: string): Promise<void> {
  await locator.click();
  await humanPause(400, 900);
  await locator.fill("");
  await humanPause(200, 500);
  await locator.pressSequentially(text, {
    delay: randomInt(70, 160),
  });
  await humanPause(500, 1200);
}

async function humanClick(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
      await humanPause(600, 1400);
      await locator.click({ delay: randomInt(40, 120) });
      await humanPause(800, 1800);
      return true;
    }
  }
  return false;
}

async function googleSignIn(
  page: Page,
  email: string,
  passwords: string[],
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await humanPause(2500, 4500, true);

  const emailInput = page.locator('input[type="email"], input[name="identifier"]').first();
  if (await emailInput.isVisible({ timeout: 12_000 }).catch(() => false)) {
    await humanType(emailInput, email);
    await humanClick(page, ["#identifierNext button", 'button:has-text("Next")']);
    await humanPause(2000, 4000, true);
  }

  if (passwords.length === 0) {
    console.log("  No password on file — complete sign-in manually in the browser (3 min)…");
    await page.waitForURL(/oauth2callback|accounts\.google\.com/, {
      timeout: 180_000,
    }).catch(() => undefined);
    return;
  }

  for (let i = 0; i < passwords.length; i += 1) {
    const password = passwords[i];
    const passInput = page.locator('input[type="password"], input[name="Passwd"]').first();
    if (!(await passInput.isVisible({ timeout: 15_000 }).catch(() => false))) {
      break;
    }

    await humanPause(1500, 3000);
    await humanType(passInput, password);
    await humanClick(page, ["#passwordNext button", 'button:has-text("Next")']);
    await humanPause(2500, 5000);

    const wrongPassword = await page
      .getByText(/wrong password|couldn't find your Google Account|couldn't sign you in/i)
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (wrongPassword && i < passwords.length - 1) {
      console.log(`  Password attempt ${i + 1} failed, trying next…`);
      await humanPause(2000, 4000);
      continue;
    }
    break;
  }

  const consentDeadline = Date.now() + 300_000;
  while (Date.now() < consentDeadline) {
    const currentUrl = page.url();
    if (currentUrl.includes("127.0.0.1:3847/oauth2callback")) {
      return;
    }

    await humanClick(page, [
      'button:has-text("Continue")',
      'button:has-text("Allow")',
      'button:has-text("Accept")',
      "#submit_approve_access",
      'div[role="button"]:has-text("Continue")',
    ]);

    const twoFa = await page
      .getByText(/2-Step Verification|Verify it's you|Confirm your recovery email|Enter a code/i)
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (twoFa) {
      console.log("  2FA / verification required — complete it in the browser…");
    }

    await humanPause(2500, 4500);
  }
}

async function main(): Promise<void> {
  assertAuthorizeHashKey(process.env.AUTHORIZE_HASH_KEY);

  const credentialsPath = join(scriptDir, "authorize-credentials.json");
  const entries = loadCredentials(credentialsPath);
  const store = getAccountStore();
  await store.migrateLegacyIfNeeded();

  const existing = new Set(
    (await store.listAccounts()).map((account) => account.email.toLowerCase()),
  );
  const pending = entries.filter(
    (entry) => !existing.has(entry.email.trim().toLowerCase()),
  );

  console.log("\nGoogle Workspace MCP — automated batch authorize (human-paced)\n");
  console.log(
    `Between accounts: ${Math.round(BETWEEN_ACCOUNT_MIN_MS / 1000)}–${Math.round(BETWEEN_ACCOUNT_MAX_MS / 1000)}s pause\n`,
  );
  console.log(`Accounts to authorize: ${pending.length} (${existing.size} already done)\n`);

  if (pending.length === 0) {
    console.log("All accounts already authorized.");
    return;
  }

  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
    "http://127.0.0.1:3847/oauth2callback";
  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || 3847);
  const oauth = createOAuthClientForSetup();

  let resolveCallback: ((email: string) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;
  let expectedEmail = "";

  const server = createHttpServer(async (req, res) => {
    if (!req.url?.startsWith(redirect.pathname)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const url = new URL(req.url, redirectUri);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const stateRaw = url.searchParams.get("state");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
      rejectCallback?.(new Error(`OAuth error: ${error}`));
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Missing authorization code</h1>");
      return;
    }

    let label = expectedEmail;
    if (stateRaw) {
      try {
        const parsed = JSON.parse(
          Buffer.from(stateRaw, "base64url").toString("utf8"),
        ) as { nonce?: string; label?: string; expectedEmail?: string };
        if (!consumeOAuthState(parsed.nonce)) {
          rejectCallback?.(new Error("Invalid OAuth state"));
          return;
        }
        label = parsed.label ?? parsed.expectedEmail ?? label;
      } catch {
        rejectCallback?.(new Error("Invalid OAuth state"));
        return;
      }
    }

    try {
      const { tokens } = await oauth.getToken(code);
      const account = await saveAuthorizedAccount(
        {
          refresh_token: tokens.refresh_token ?? undefined,
          access_token: tokens.access_token ?? undefined,
          expiry_date: tokens.expiry_date ?? undefined,
          token_type: tokens.token_type ?? undefined,
          scope: tokens.scope ?? undefined,
        },
        { label },
      );

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderAuthorizationCompleteHtml(account.email));
      console.log(`  Saved: ${account.email}`);
      resolveCallback?.(account.email);
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : String(authError);
      rejectCallback?.(authError instanceof Error ? authError : new Error(message));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const browser = await chromium.launch({
    headless: false,
    slowMo: randomInt(80, 150),
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  const page = await context.newPage();

  const completed: string[] = [];
  const failed: string[] = [];

  try {
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      const email = entry.email.trim().toLowerCase();
      expectedEmail = email;
      const passwords = entry.passwords ?? [];

      if (index > 0) {
        console.log("  Cooling down before next account…");
        await humanPause(BETWEEN_ACCOUNT_MIN_MS, BETWEEN_ACCOUNT_MAX_MS, true);
      }

      console.log(`[${index + 1}/${pending.length}] ${email}`);
      if (entry.notes) {
        console.log(`  Note: ${entry.notes}`);
      }

      const statePayload = JSON.stringify({
        nonce: createOAuthState(),
        label: email,
        expectedEmail: email,
      });
      const state = Buffer.from(statePayload, "utf8").toString("base64url");
      const authUrl = getAuthorizationUrl(oauth, state, { loginHint: email });

      const result = await new Promise<string | null>((resolve) => {
        resolveCallback = (saved) => resolve(saved);
        rejectCallback = (error) => {
          console.error(`  Failed: ${error.message}`);
          resolve(null);
        };

        void (async () => {
          try {
            await humanPause(1500, 3000);
            await page.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
            await googleSignIn(page, email, passwords);
            await page.waitForURL(/127\.0\.0\.1:3847\/oauth2callback/, {
              timeout: 300_000,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`  Browser flow error: ${message}`);
            resolve(null);
          }
        })();
      });

      resolveCallback = null;
      rejectCallback = null;

      if (result) {
        completed.push(result);
      } else {
        failed.push(email);
      }

      await context.clearCookies();
      console.log();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log("Done.");
  console.log(`Completed (${completed.length}):`, completed.join(", ") || "—");
  console.log(`Failed (${failed.length}):`, failed.join(", ") || "—");
  console.log(`Store total: ${(await store.listAccounts()).length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
