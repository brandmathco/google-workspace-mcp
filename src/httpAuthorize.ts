import type { Express, Request, Response } from "express";
import {
  assertAuthorizeHashKey,
  extractAuthorizeHashKeyFromRequest,
} from "./auth/authorizeKey.js";
import {
  createOAuthClientForSetup,
  getAuthorizationUrl,
  resolveTokenPath,
  saveStoredToken,
} from "./auth/googleAuth.js";
import { consumeOAuthState, createOAuthState } from "./auth/oauthStateStore.js";

function sendAuthorizeDenied(res: Response, message: string): void {
  res.status(403).json({ error: message });
}

function queryParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requireAuthorizeHashKey(req: Request, res: Response): boolean {
  try {
    assertAuthorizeHashKey(
      extractAuthorizeHashKeyFromRequest({
        headerValue: req.headers["x-authorize-hash-key"],
        queryValue: queryParam(req.query.hashKey),
      }),
    );
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid or missing authorize hash key.";
    sendAuthorizeDenied(res, message);
    return false;
  }
}

export function registerAuthorizeRoutes(app: Express): void {
  app.get("/authorize", (req, res) => {
    if (!requireAuthorizeHashKey(req, res)) {
      return;
    }

    try {
      const oauth = createOAuthClientForSetup();
      const state = createOAuthState();
      const authUrl = getAuthorizationUrl(oauth, state);
      res.redirect(authUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.get("/oauth2callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    if (!consumeOAuthState(state)) {
      sendAuthorizeDenied(res, "Invalid or expired OAuth state. Start from /authorize with a valid hash key.");
      return;
    }

    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    if (error) {
      res.status(400).type("html").send(`<h1>Authorization failed</h1><p>${error}</p>`);
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    if (!code) {
      res.status(400).type("html").send("<h1>Missing authorization code</h1>");
      return;
    }

    try {
      const oauth = createOAuthClientForSetup();
      const { tokens } = await oauth.getToken(code);
      saveStoredToken({
        refresh_token: tokens.refresh_token ?? undefined,
        access_token: tokens.access_token ?? undefined,
        expiry_date: tokens.expiry_date ?? undefined,
        token_type: tokens.token_type ?? undefined,
        scope: tokens.scope ?? undefined,
      });
      const tokenPath = resolveTokenPath();

      res
        .status(200)
        .type("html")
        .send(
          "<h1>Authorization complete</h1><p>Google Workspace MCP is connected. You can close this tab.</p>",
        );

      console.log(`Saved refresh token to ${tokenPath}`);
      if (tokens.refresh_token) {
        console.log("Update GOOGLE_REFRESH_TOKEN in Fly secrets if this app uses env-based tokens.");
      }
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : String(authError);
      res.status(500).type("html").send(`<h1>Token exchange failed</h1><pre>${message}</pre>`);
    }
  });
}
