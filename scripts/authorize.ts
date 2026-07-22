import { createServer } from "node:http";
import { URL } from "node:url";
import {
  assertAuthorizeHashKey,
} from "../src/auth/authorizeKey.js";
import { renderAuthorizationCompleteHtml } from "../src/auth/authorizeCompleteHtml.js";
import { saveAuthorizedAccount } from "../src/auth/accountStore.js";
import {
  createOAuthClientForSetup,
  getAuthorizationUrl,
} from "../src/auth/googleAuth.js";
import { createOAuthState } from "../src/auth/oauthStateStore.js";

function resolveHashKeyFromArgs(): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--hash-key=")) {
      return arg.slice("--hash-key=".length);
    }
    if (arg === "--hash-key" && args[index + 1]) {
      return args[index + 1];
    }
  }

  return undefined;
}

function resolveLabelFromArgs(): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--label=")) {
      return arg.slice("--label=".length);
    }
    if (arg === "--label" && args[index + 1]) {
      return args[index + 1];
    }
  }
  return undefined;
}

try {
  assertAuthorizeHashKey(resolveHashKeyFromArgs() ?? process.env.AUTHORIZE_HASH_KEY);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(
    "\nUsage: npm run authorize [-- --hash-key=YOUR_AUTHORIZE_HASH_KEY] [--label=my-label]",
  );
  console.error(
    "Hash key is read from --hash-key or AUTHORIZE_HASH_KEY in .env.",
  );
  process.exit(1);
}

const redirectUri =
  process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
  "http://127.0.0.1:3847/oauth2callback";

const redirect = new URL(redirectUri);
const port = Number(redirect.port || 3847);
const label = resolveLabelFromArgs();

const oauth = createOAuthClientForSetup();
const statePayload = JSON.stringify({ nonce: createOAuthState(), label });
const state = Buffer.from(statePayload, "utf8").toString("base64url");
const authUrl = getAuthorizationUrl(oauth, state);

console.log("\nGoogle Workspace MCP authorization (multi-account)\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Sign in and approve access.");
console.log(`3. You will be redirected to ${redirectUri}`);
console.log("4. Repeat for each Gmail / Workspace account you need.\n");

const server = createServer(async (req, res) => {
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
    console.error(`Authorization failed: ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Missing authorization code</h1>");
    return;
  }

  let parsedLabel = label;
  if (stateRaw) {
    try {
      const parsed = JSON.parse(
        Buffer.from(stateRaw, "base64url").toString("utf8"),
      ) as { label?: string };
      parsedLabel = parsed.label ?? parsedLabel;
    } catch {
      // ignore malformed state
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
      { label: parsedLabel },
    );

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderAuthorizationCompleteHtml(account.email));

    console.log(`Saved account ${account.email} to multi-account store`);
    if (label) {
      console.log(`Label: ${label}`);
    }
  } catch (authError) {
    const message =
      authError instanceof Error ? authError.message : String(authError);
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>Token exchange failed</h1><pre>${message}</pre>`);
    console.error(message);
    process.exit(1);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Waiting for OAuth callback on ${redirectUri}`);
});
