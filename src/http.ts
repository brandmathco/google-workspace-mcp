import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadEnvFile } from "./loadEnv.js";
import { registerAuthorizeRoutes } from "./httpAuthorize.js";
import { createGoogleWorkspaceMcpServer } from "./serverFactory.js";

loadEnvFile();

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const mcpApiKey = process.env.MCP_API_KEY?.trim();

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "google-workspace-mcp" });
});

registerAuthorizeRoutes(app);

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!mcpApiKey) {
    res.status(500).json({ error: "MCP_API_KEY is not configured" });
    return;
  }

  const header = req.headers.authorization;
  if (header === `Bearer ${mcpApiKey}`) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

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
});
