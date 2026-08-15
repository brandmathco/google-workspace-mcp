import type { Express, Request, Response } from "express";
import {
  assertAuthorizeHashKey,
  extractAuthorizeHashKeyFromRequest,
} from "./auth/authorizeKey.js";
import { renderAuthorizationCompleteHtml } from "./auth/authorizeCompleteHtml.js";
import { saveAuthorizedAccount } from "./auth/accountStore.js";
import {
  createOAuthClientForSetup,
  getAuthorizationUrl,
} from "./auth/googleAuth.js";
import {
  exchangeLinkedInAuthorizationCode,
  getLinkedInAuthorizationUrl,
} from "./auth/linkedinAuth.js";
import { saveAuthorizedLinkedInAccount } from "./auth/linkedinAccountStore.js";
import {
  consumeOAuthStateDetailed,
  createOAuthState,
} from "./auth/oauthStateStore.js";

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
      const label = queryParam(req.query.label);
      const makeDefault = queryParam(req.query.default) === "1";
      // Signed state survives Fly restarts; do not nest in a second encoding layer.
      const state = createOAuthState({ label, makeDefault });
      const authUrl = getAuthorizationUrl(oauth, state);
      res.redirect(authUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.get("/oauth2callback", async (req, res) => {
    const stateRaw = typeof req.query.state === "string" ? req.query.state : undefined;
    const consumed = consumeOAuthStateDetailed(stateRaw);
    if (!consumed.ok) {
      sendAuthorizeDenied(res, consumed.reason);
      return;
    }
    const label = consumed.label;
    const makeDefault = consumed.makeDefault;

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
      const account = await saveAuthorizedAccount(
        {
          refresh_token: tokens.refresh_token ?? undefined,
          access_token: tokens.access_token ?? undefined,
          expiry_date: tokens.expiry_date ?? undefined,
          token_type: tokens.token_type ?? undefined,
          scope: tokens.scope ?? undefined,
        },
        { label, makeDefault },
      );

      res.status(200).type("html").send(renderAuthorizationCompleteHtml(account.email));

      console.log(`Saved Google account ${account.email} to multi-account store`);
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : String(authError);
      res.status(500).type("html").send(`<h1>Token exchange failed</h1><pre>${message}</pre>`);
    }
  });

  app.get("/authorize/linkedin", (req, res) => {
    if (!requireAuthorizeHashKey(req, res)) {
      return;
    }

    try {
      const label = queryParam(req.query.label);
      const makeDefault = queryParam(req.query.default) === "1";
      const state = createOAuthState({ label, makeDefault });
      const authUrl = getLinkedInAuthorizationUrl(state);
      res.redirect(authUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.get("/oauth2callback/linkedin", async (req, res) => {
    const stateRaw = typeof req.query.state === "string" ? req.query.state : undefined;
    const consumed = consumeOAuthStateDetailed(stateRaw);
    if (!consumed.ok) {
      sendAuthorizeDenied(res, consumed.reason);
      return;
    }

    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    if (error) {
      res.status(400).type("html").send(`<h1>LinkedIn authorization failed</h1><p>${error}</p>`);
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    if (!code) {
      res.status(400).type("html").send("<h1>Missing LinkedIn authorization code</h1>");
      return;
    }

    try {
      const tokens = await exchangeLinkedInAuthorizationCode(code);
      const account = await saveAuthorizedLinkedInAccount(tokens, {
        label: consumed.label,
        makeDefault: consumed.makeDefault,
      });

      res
        .status(200)
        .type("html")
        .send(renderAuthorizationCompleteHtml(account.email, "LinkedIn"));

      console.log(`Saved LinkedIn account ${account.email} to linkedin account store`);
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : String(authError);
      res
        .status(500)
        .type("html")
        .send(`<h1>LinkedIn token exchange failed</h1><pre>${message}</pre>`);
    }
  });
}
