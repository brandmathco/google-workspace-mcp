import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_SCOPES,
  GOOGLE_SCOPES_QUICK,
  scopesForSetupPreset,
} from "./googleAuth.js";

test("quick setup asks only for Gmail, Calendar, and Tasks", () => {
  const scopes = scopesForSetupPreset("quick");
  assert.deepEqual(scopes, [...GOOGLE_SCOPES_QUICK]);
  assert.equal(scopes.some((scope) => scope.includes("cloud-platform")), false);
  assert.equal(scopes.some((scope) => scope.includes("adwords")), false);
  assert.equal(scopes.some((scope) => scope.includes("adsense")), false);
});

test("full setup keeps the complete operator scope list", () => {
  assert.deepEqual(scopesForSetupPreset("full"), [...GOOGLE_SCOPES]);
  assert.deepEqual(scopesForSetupPreset(undefined), [...GOOGLE_SCOPES]);
  for (const scope of GOOGLE_SCOPES_QUICK) {
    assert.ok(GOOGLE_SCOPES.includes(scope));
  }
});
