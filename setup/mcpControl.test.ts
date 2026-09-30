import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPower,
  cursorServers,
  describeMcps,
  privateFileMode,
  probeTargets,
  securityFindings,
  stoppedServers,
} from "./mcpControl.ts";

const secret = "super-secret-token-value";
const active = {
  "google-workspace": {
    command: "/Apps/node",
    args: ["/Apps/dist/index.js"],
    env: { GOOGLE_MCP_ENV_FILE: "/secret.env" },
  },
  github: {
    url: "https://api.githubcopilot.com/mcp/readonly?token=leak",
    headers: { Authorization: `Bearer ${secret}`, "X-MCP-Readonly": "true" },
  },
};

test("public status hides tokens and headers", () => {
  const rows = describeMcps(active, {}, (path) => path === "/Apps/node" || path.endsWith("index.js"));
  const json = JSON.stringify(rows);
  assert.equal(json.includes(secret), false);
  assert.equal(json.includes("Authorization"), false);
  assert.equal(json.includes("leak"), false);
  assert.equal(json.includes("/secret.env"), false);
  const github = rows.find((row) => row.name === "github");
  assert.equal(github?.kind, "remote");
  assert.equal(github?.readonly, true);
  assert.equal(github?.hasAuth, true);
  assert.equal(github?.detail, "api.githubcopilot.com");
  assert.equal(rows[0]?.name, "google-workspace");
  assert.equal(rows[0]?.localReady, true);
});

test("stop removes a server from Cursor and start puts it back", () => {
  const stopped = applyPower(active, {}, { name: "github", running: false });
  assert.equal(stopped.error, undefined);
  assert.equal(stopped.active.github, undefined);
  assert.equal(stopped.stopped.github?.url, active.github.url);
  const started = applyPower(stopped.active, stopped.stopped, { name: "github", running: true });
  assert.equal(started.active.github?.url, active.github.url);
  assert.equal(started.stopped.github, undefined);
  assert.equal(Object.hasOwn(started.active.github ?? {}, "disabled"), false);
});

test("stop all parks every server and leaves the original maps alone", () => {
  const parked = applyPower(active, {}, { all: "stop" });
  assert.deepEqual(Object.keys(parked.active), []);
  assert.deepEqual(Object.keys(parked.stopped).sort(), ["github", "google-workspace"]);
  assert.equal(active.github.headers.Authorization.includes(secret), true);
});

test("unknown names are refused", () => {
  const refused = applyPower(active, {}, { name: "../evil", running: false });
  assert.equal(typeof refused.error, "string");
  assert.equal(refused.active.github?.url, active.github.url);
});

test("probe targets stay on https without query secrets", () => {
  const targets = probeTargets({
    ...active,
    http: { url: "http://example.com/mcp" },
    user: { url: "https://user:pass@example.com/mcp" },
  });
  assert.deepEqual(targets, [
    { name: "github", url: "https://api.githubcopilot.com/mcp/readonly" },
  ]);
});

test("security flags unlocked spend and a world-readable secrets file", () => {
  const findings = securityFindings({
    adsAllowEnable: "true",
    hasEncryptionKey: false,
    storesAccountsInSupabase: true,
    envMode: 0o644,
    configMode: 0o600,
    stoppedMode: null,
    accountCount: 0,
    githubUrl: "https://evil.example/mcp",
  });
  const byId = Object.fromEntries(findings.map((item) => [item.id, item.ok]));
  assert.equal(byId["ads-spend"], false);
  assert.equal(byId["token-encryption"], false);
  assert.equal(byId["secrets-file"], false);
  assert.equal(byId["cursor-config"], true);
  assert.equal(byId["google-accounts"], false);
  assert.equal(byId["github-readonly"], false);
  assert.equal(privateFileMode(0o600), true);
  assert.equal(privateFileMode(0o640), false);
});

test("cursor and stopped files ignore junk entries", () => {
  assert.deepEqual(Object.keys(cursorServers({ mcpServers: { "bad name": { command: "x" }, ok: { command: "node" } } })), ["ok"]);
  assert.deepEqual(Object.keys(stoppedServers({ servers: { fly: { url: "https://example.com/mcp" } } })), ["fly"]);
  assert.deepEqual(stoppedServers(null), {});
});
