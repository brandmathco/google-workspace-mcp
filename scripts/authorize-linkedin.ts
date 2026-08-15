import { createServer } from "node:http";
import { URL } from "node:url";
import { assertAuthorizeHashKey } from "../src/auth/authorizeKey.js";
import { renderAuthorizationCompleteHtml } from "../src/auth/authorizeCompleteHtml.js";
import {
  exchangeLinkedInAuthorizationCode,
  getLinkedInAuthorizationUrl,
  linkedInOAuthConfig,
} from "../src/auth/linkedinAuth.js";
import { saveAuthorizedLinkedInAccount } from "../src/auth/linkedinAccountStore.js";
import { createOAuthState } from "../src/auth/oauthStateStore.js";

function resolveHashKeyFromArgs(): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--hash-key=")) return arg.slice("--hash-key=".length);
    if (arg === "--hash-key" && args[index + 1]) return args[index + 1];
  }
  return undefined;
}

function resolveLabelFromArgs(): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--label=")) return arg.slice("--label=".length);
    if (arg === "--label" && args[index + 1]) return args[index + 1];
  }
  return undefined;
}

try {
  assertAuthorizeHashKey(resolveHashKeyFromArgs() ?? process.env.AUTHORIZE_HASH_KEY);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(
    "\nUsage: npm run authorize:linkedin [-- --hash-key=YOUR_AUTHORIZE_HASH_KEY] [--label=my-label]",
  );
  process.exit(1);
}

const { redirectUri } = linkedInOAuthConfig();
const redirect = new URL(redirectUri);
const port = Number(redirect.port || 3847);
const label = resolveLabelFromArgs();
const state = createOAuthState({ label });
const authUrl = getLinkedInAuthorizationUrl(state);

console.log("\nLinkedIn Ads MCP authorization\n");
console.log("1. Add this redirect URL in LinkedIn Developer → Auth:\n");
console.log(`   ${redirectUri}\n`);
console.log("2. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n3. Sign in and approve Advertising API scopes.");
console.log(`4. You will be redirected to ${redirectUri}\n`);

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith(redirect.pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const error = url.searchParams.get("error");
  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>LinkedIn authorization failed</h1><p>${error}</p>`);
    server.close();
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h1>Missing authorization code</h1>");
    server.close();
    return;
  }

  try {
    const tokens = await exchangeLinkedInAuthorizationCode(code);
    const account = await saveAuthorizedLinkedInAccount(tokens, { label });
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderAuthorizationCompleteHtml(account.email, "LinkedIn"));
    console.log(`\nSaved LinkedIn account: ${account.email} (${account.memberId})\n`);
  } catch (authError) {
    const message = authError instanceof Error ? authError.message : String(authError);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Token exchange failed</h1><pre>${message}</pre>`);
    console.error(message);
  } finally {
    server.close();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Waiting for callback on ${redirectUri} ...`);
});
