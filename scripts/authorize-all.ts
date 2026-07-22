#!/usr/bin/env node
/**
 * Authorize many Google accounts sequentially for google-workspace-mcp.
 * Reads AUTHORIZE_HASH_KEY from .env (validates against itself).
 * Skips accounts already in the store. Opens the browser for each remaining account.
 *
 * Usage: npm run authorize:all
 *        npm run authorize:all -- --dry-run
 *        npm run authorize:all -- --accounts-file=./scripts/authorize-targets.json
 *
 * Copy scripts/authorize-targets.example.json to authorize-targets.json (gitignored).
 */

import { readFileSync, existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { execSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import { loadEnvFile } from "../src/loadEnv.js";
import { assertAuthorizeHashKey } from "../src/auth/authorizeKey.js";
import { renderAuthorizationCompleteHtml } from "../src/auth/authorizeCompleteHtml.js";
import { getAccountStore } from "../src/auth/accountStore.js";
import { saveAuthorizedAccount } from "../src/auth/accountStore.js";
import {
  createOAuthClientForSetup,
  getAuthorizationUrl,
} from "../src/auth/googleAuth.js";
import { consumeOAuthState, createOAuthState } from "../src/auth/oauthStateStore.js";

loadEnvFile();

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

function resolveAccountsFile(): string {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--accounts-file=")) {
      return arg.slice("--accounts-file=".length);
    }
  }
  return join(scriptDir, "authorize-targets.json");
}

function loadTargetEmails(path: string): string[] {
  if (!existsSync(path)) {
    throw new Error(`Accounts file not found: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Accounts file must be a JSON array of emails: ${path}`);
  }
  return parsed
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "darwin") {
      execSync(`open ${JSON.stringify(url)}`, { stdio: "ignore" });
      return;
    }
    if (process.platform === "win32") {
      execSync(`start "" ${JSON.stringify(url)}`, { stdio: "ignore", shell: "cmd.exe" });
      return;
    }
    execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: "ignore" });
  } catch {
    console.log(`Open manually:\n${url}\n`);
  }
}

async function main(): Promise<void> {
  assertAuthorizeHashKey(process.env.AUTHORIZE_HASH_KEY);

  const accountsFile = resolveAccountsFile();
  const targets = loadTargetEmails(accountsFile);
  const store = getAccountStore();
  await store.migrateLegacyIfNeeded();

  const existing = new Set(
    (await store.listAccounts()).map((account) => account.email.toLowerCase()),
  );
  const pending = targets.filter((email) => !existing.has(email));

  console.log("\nGoogle Workspace MCP — batch authorize\n");
  console.log(`Targets file: ${accountsFile}`);
  console.log(`Total targets: ${targets.length}`);
  console.log(`Already authorized: ${existing.size}`);
  console.log(`Remaining: ${pending.length}\n`);

  if (existing.size > 0) {
    console.log("Authorized:", [...existing].sort().join(", "));
    console.log();
  }

  if (pending.length === 0) {
    console.log("All target accounts are already authorized.");
    return;
  }

  if (dryRun) {
    console.log("Dry run — would authorize:");
    for (const email of pending) {
      console.log(`  - ${email}`);
    }
    return;
  }

  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
    "http://127.0.0.1:3847/oauth2callback";
  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || 3847);
  const oauth = createOAuthClientForSetup();
  const rl = readline.createInterface({ input, output });

  let resolveCallback: ((email: string) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;
  let expectedEmail = "";

  const server = createHttpServer(async (req, res) => {
    if (!req.url?.startsWith(redirect.pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
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
          res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Invalid or expired OAuth state</h1>");
          rejectCallback?.(new Error("Invalid or expired OAuth state"));
          return;
        }
        label = parsed.label ?? parsed.expectedEmail ?? label;
      } catch {
        if (!consumeOAuthState(stateRaw)) {
          res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Invalid OAuth state</h1>");
          rejectCallback?.(new Error("Invalid OAuth state"));
          return;
        }
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

      if (
        expectedEmail &&
        account.email.toLowerCase() !== expectedEmail.toLowerCase()
      ) {
        console.warn(
          `\nWarning: expected ${expectedEmail} but Google authorized ${account.email}`,
        );
      }

      console.log(`\nSaved: ${account.email}`);
      resolveCallback?.(account.email);
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : String(authError);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>Token exchange failed</h1><pre>${message}</pre>`);
      rejectCallback?.(authError instanceof Error ? authError : new Error(message));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  console.log(`Callback server: ${redirectUri}\n`);

  const completed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  try {
    for (let index = 0; index < pending.length; index += 1) {
      const email = pending[index];
      expectedEmail = email;

      console.log(`[${index + 1}/${pending.length}] Authorize: ${email}`);
      const answer = await rl.question(
        "Press Enter to open browser (or type s to skip, q to quit): ",
      );
      if (answer.trim().toLowerCase() === "q") {
        console.log("Stopped by user.");
        break;
      }
      if (answer.trim().toLowerCase() === "s") {
        skipped.push(email);
        console.log(`Skipped ${email}\n`);
        continue;
      }

      const statePayload = JSON.stringify({
        nonce: createOAuthState(),
        label: email,
        expectedEmail: email,
      });
      const state = Buffer.from(statePayload, "utf8").toString("base64url");
      const authUrl = getAuthorizationUrl(oauth, state, { loginHint: email });

      const authorizedEmail = await new Promise<string>((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
        openBrowser(authUrl);
        console.log("Waiting for browser sign-in…");
      }).catch((error: Error) => {
        console.error(`Failed ${email}: ${error.message}`);
        failed.push(email);
        return null;
      });

      resolveCallback = null;
      rejectCallback = null;

      if (authorizedEmail) {
        completed.push(authorizedEmail);
      }
      console.log();
    }
  } finally {
    rl.close();
    server.close();
  }

  console.log("\nBatch authorize summary");
  console.log(`Completed (${completed.length}):`, completed.join(", ") || "—");
  console.log(`Skipped (${skipped.length}):`, skipped.join(", ") || "—");
  console.log(`Failed (${failed.length}):`, failed.join(", ") || "—");

  const finalAccounts = await store.listAccounts();
  console.log(`\nStore now has ${finalAccounts.length} account(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
