import { createServer } from "node:http";
import { URL } from "node:url";
import {
  assertAuthorizeHashKey,
} from "../src/auth/authorizeKey.js";
import {
  createOAuthClientForSetup,
  getAuthorizationUrl,
  saveStoredToken,
  resolveTokenPath,
} from "../src/auth/googleAuth.js";
import { loadEnvFile } from "../src/loadEnv.js";

loadEnvFile();

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

try {
  assertAuthorizeHashKey(resolveHashKeyFromArgs());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(
    "\nUsage: npm run authorize -- --hash-key=YOUR_AUTHORIZE_HASH_KEY",
  );
  console.error(
    "The hash key must match AUTHORIZE_HASH_KEY configured in .env (not read automatically from .env).",
  );
  process.exit(1);
}

const redirectUri =
  process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
  "http://127.0.0.1:3847/oauth2callback";

const redirect = new URL(redirectUri);
const port = Number(redirect.port || 3847);

const oauth = createOAuthClientForSetup();
const authUrl = getAuthorizationUrl(oauth);

console.log("\nGoogle Workspace MCP authorization\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Sign in and approve access.");
console.log(`3. You will be redirected to ${redirectUri}\n`);

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith(redirect.pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

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

  try {
    const { tokens } = await oauth.getToken(code);
    saveStoredToken(tokens);
    const tokenPath = resolveTokenPath();

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>Authorization complete</h1><p>You can close this tab and return to Cursor.</p>",
    );

    console.log(`Saved refresh token to ${tokenPath}`);
    if (tokens.refresh_token) {
      console.log(
        "\nOptional: add this to your .env for explicit configuration:\n",
      );
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
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
