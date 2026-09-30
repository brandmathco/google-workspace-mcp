import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_SCOPES,
  GOOGLE_SCOPES_QUICK,
  scopesForSetupPreset,
} from "./googleAuth.js";

test("quick setup includes mail, calendar, tasks, and read-only analytics tools", () => {
  const scopes = scopesForSetupPreset("quick");
  assert.deepEqual(scopes, [...GOOGLE_SCOPES_QUICK]);
  assert.equal(scopes.some((scope) => scope.includes("analytics.readonly")), true);
  assert.equal(scopes.some((scope) => scope.includes("adsense.readonly")), true);
  assert.equal(scopes.some((scope) => scope.includes("tagmanager.readonly")), true);
  assert.equal(scopes.some((scope) => scope.includes("cloud-platform")), false);
  assert.equal(scopes.some((scope) => scope.includes("adwords")), false);
  assert.equal(scopes.some((scope) => scope.includes("tagmanager.publish")), false);
});

test("full setup keeps the complete operator scope list", () => {
  assert.deepEqual(scopesForSetupPreset("full"), [...GOOGLE_SCOPES]);
  assert.deepEqual(scopesForSetupPreset(undefined), [...GOOGLE_SCOPES]);
  for (const scope of GOOGLE_SCOPES_QUICK) {
    assert.ok(GOOGLE_SCOPES.includes(scope));
  }
});
