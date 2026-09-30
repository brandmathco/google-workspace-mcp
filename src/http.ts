import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ZodError } from "zod";
import { handleAdsTool } from "./adsTools.js";
import { handleAnalyticsTool } from "./analyticsTools.js";
import { handleAdsenseTool } from "./adsenseTools.js";
import { handleCommerceTool } from "./commerceTools.js";
import { handleTagManagerTool } from "./tagManagerTools.js";
import { handleLinkedInTool } from "./linkedinTools.js";
import {
  applySecurityHeaders,
  createMcpGuards,
  startCursorCloudAllowlistRefresh,
} from "./httpAuth.js";
import { loadEnvFile } from "./loadEnv.js";
import { registerAuthorizeRoutes } from "./httpAuthorize.js";
import { createGoogleWorkspaceMcpServer } from "./serverFactory.js";

loadEnvFile();

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const mcpApiKey = process.env.MCP_API_KEY?.trim();
const requireApiKey = createMcpGuards(mcpApiKey);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(applySecurityHeaders);
app.use(express.json({ limit: "2mb" }));

const bootStartedMs = Date.now();
let mcpReady = false;

async function warmupMcp(): Promise<void> {
  // Preload heavy tool modules so the first Cursor MCP handshake is fast.
  createGoogleWorkspaceMcpServer().close();
  mcpReady = true;
  console.log(`MCP warmup complete in ${Date.now() - bootStartedMs}ms`);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "google-workspace-mcp",
    mcpReady,
    bootMs: Date.now() - bootStartedMs,
  });
});

registerAuthorizeRoutes(app);

function parseAdsToolContent(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

/**
 * Thin JSON shim for non-Cursor clients (admin-module Edge proxy).
 * Same Ads handlers and spend guards as MCP `ads_*` tools.
 */
app.post("/api/ads", requireApiKey, async (req, res) => {
  try {
    const tool =
      typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
    if (!tool.startsWith("ads_")) {
      res.status(400).json({
        error: "Only ads_* tools are allowed on /api/ads",
      });
      return;
    }

    const args =
      req.body?.arguments && typeof req.body.arguments === "object"
        ? req.body.arguments
        : {};

    const result = await handleAdsTool(tool, args);
    if (!result) {
      res.status(404).json({ error: `Unknown ads tool: ${tool}` });
      return;
    }

    const text = result.content?.[0]?.text ?? "";
    const data = parseAdsToolContent(text);

    if (result.isError) {
      res.status(400).json({
        error: typeof data === "object" && data && "message" in data
          ? String((data as { message: unknown }).message)
          : text || "Ads tool error",
        data,
      });
      return;
    }

    res.json({ success: true, tool, data });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: error.errors.map((e) => e.message).join("; ") || "Invalid arguments",
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("POST /api/ads error:", error);
    // google-ads-api failures often put a useful message on nested errors[].message
    const nested =
      error &&
      typeof error === "object" &&
      "errors" in error &&
      Array.isArray((error as { errors: unknown[] }).errors)
        ? (error as { errors: Array<{ message?: string }> }).errors
            .map((e) => e?.message)
            .filter(Boolean)
            .join("; ")
        : "";
    res.status(502).json({ error: nested || message });
  }
});

app.post("/api/linkedin", requireApiKey, async (req, res) => {
  try {
    const tool =
      typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
    if (!tool.startsWith("linkedin_")) {
      res.status(400).json({
        error: "Only linkedin_* tools are allowed on /api/linkedin",
      });
      return;
    }

    const args =
      req.body?.arguments && typeof req.body.arguments === "object"
        ? req.body.arguments
        : {};

    const result = await handleLinkedInTool(tool, args);
    if (!result) {
      res.status(404).json({ error: `Unknown linkedin tool: ${tool}` });
      return;
    }

    const text = result.content?.[0]?.text ?? "";
    const data = parseAdsToolContent(text);

    if (result.isError) {
      res.status(400).json({
        error: typeof data === "object" && data && "message" in data
          ? String((data as { message: unknown }).message)
          : text || "LinkedIn tool error",
        data,
      });
      return;
    }

    res.json({ success: true, tool, data });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: error.errors.map((e) => e.message).join("; ") || "Invalid arguments",
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("POST /api/linkedin error:", error);
    res.status(502).json({ error: message });
  }
});

app.post("/api/analytics", requireApiKey, async (req, res) => {
  try {
    const tool =
      typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
    if (!tool.startsWith("analytics_")) {
      res.status(400).json({
        error: "Only analytics_* tools are allowed on /api/analytics",
      });
      return;
    }

    const args =
      req.body?.arguments && typeof req.body.arguments === "object"
        ? req.body.arguments
        : {};

    const result = await handleAnalyticsTool(tool, args);
    if (!result) {
      res.status(404).json({ error: `Unknown analytics tool: ${tool}` });
      return;
    }

    const text = result.content?.[0]?.text ?? "";
    const data = parseAdsToolContent(text);

    if (result.isError) {
      res.status(400).json({
        error:
          typeof data === "object" && data && "message" in data
            ? String((data as { message: unknown }).message)
            : text || "Analytics tool error",
        data,
      });
      return;
    }

    res.json({ success: true, tool, data });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: error.errors.map((e) => e.message).join("; ") || "Invalid arguments",
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("POST /api/analytics error:", error);
    res.status(502).json({ error: message });
  }
});

function registerPrefixedToolRoute(
  path: string,
  prefix: string,
  label: string,
  handle: (
    name: string,
    args: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true } | null>,
): void {
  app.post(path, requireApiKey, async (req, res) => {
    try {
      const tool = typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
      if (!tool.startsWith(prefix)) {
        res.status(400).json({ error: `Only ${prefix}* tools are allowed on ${path}` });
        return;
      }
      const args =
        req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {};
      const result = await handle(tool, args);
      if (!result) {
        res.status(404).json({ error: `Unknown ${label} tool: ${tool}` });
        return;
      }
      const text = result.content?.[0]?.text ?? "";
      const data = parseAdsToolContent(text);
      if (result.isError) {
        res.status(400).json({
          error:
            typeof data === "object" && data && "message" in data
              ? String((data as { message: unknown }).message)
              : text || `${label} tool error`,
          data,
        });
        return;
      }
      res.json({ success: true, tool, data });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: error.errors.map((e) => e.message).join("; ") || "Invalid arguments",
        });
        return;
      }
      const message = error instanceof Error ? error.message : "Internal server error";
      console.error(`POST ${path} error:`, error);
      res.status(502).json({ error: message });
    }
  });
}

registerPrefixedToolRoute("/api/adsense", "adsense_", "AdSense", handleAdsenseTool);
registerPrefixedToolRoute("/api/commerce", "commerce_", "Commerce", handleCommerceTool);

app.post("/api/tagmanager", requireApiKey, async (req, res) => {
  try {
    const tool =
      typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
    if (!tool.startsWith("tagmanager_")) {
      res.status(400).json({
        error: "Only tagmanager_* tools are allowed on /api/tagmanager",
      });
      return;
    }

    const args =
      req.body?.arguments && typeof req.body.arguments === "object"
        ? req.body.arguments
        : {};

    const result = await handleTagManagerTool(tool, args);
    if (!result) {
      res.status(404).json({ error: `Unknown tagmanager tool: ${tool}` });
      return;
    }

    const text = result.content?.[0]?.text ?? "";
    const data = parseAdsToolContent(text);

    if (result.isError) {
      res.status(400).json({
        error:
          typeof data === "object" && data && "message" in data
            ? String((data as { message: unknown }).message)
            : text || "Tag Manager tool error",
        data,
      });
      return;
    }

    res.json({ success: true, tool, data });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: error.errors.map((e) => e.message).join("; ") || "Invalid arguments",
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("POST /api/tagmanager error:", error);
    res.status(502).json({ error: message });
  }
});

app.post("/mcp", requireApiKey, async (req, res) => {
  const server = createGoogleWorkspaceMcpServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", requireApiKey, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
});

app.delete("/mcp", requireApiKey, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
});

app.listen(port, host, () => {
  console.log(`google-workspace-mcp listening on http://${host}:${port}`);
  startCursorCloudAllowlistRefresh();
  void warmupMcp();
});
