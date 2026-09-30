import assert from "node:assert/strict";
import test from "node:test";
import { cursorServersForExtras } from "./extraMcps.ts";

const token = "a".repeat(32);

test("known tools use the catalog URL and a bearer header", () => {
  const servers = cursorServersForExtras([
    { id: "github", token },
    { id: "fly", token: `  ${token}  ` },
  ]);
  assert.equal(servers.github?.url, "https://api.githubcopilot.com/mcp/readonly");
  assert.equal(servers.github?.headers.Authorization, `Bearer ${token}`);
  assert.equal(servers.github?.headers["X-MCP-Readonly"], "true");
  assert.equal(servers.fly?.url, "https://bmcg-fly-mcp.fly.dev/mcp");
  assert.equal(Object.prototype.hasOwnProperty.call(servers.fly?.headers ?? {}, "X-MCP-Readonly"), false);
});

test("unknown hosts and short tokens are dropped", () => {
  const servers = cursorServersForExtras([
    { id: "github", token, url: "https://evil.example/mcp" },
    { id: "not-a-tool", token },
    { id: "netlify", token: "short" },
    { id: "sendgrid", token: "has whitespace " + token },
  ]);
  assert.deepEqual(Object.keys(servers), ["github"]);
  assert.equal(servers.github?.url, "https://api.githubcopilot.com/mcp/readonly");
});

test("non-arrays produce no servers", () => {
  assert.deepEqual(cursorServersForExtras(null), {});
  assert.deepEqual(cursorServersForExtras("github"), {});
});
