import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVE_WRITE_TOOLS,
  isApiDisabledError,
  nextDocText,
  seedUploadFor,
} from "./driveWrite.js";
import { GOOGLE_DOC, GOOGLE_SHEET } from "./driveContent.js";

describe("DRIVE_WRITE_TOOLS", () => {
  it("lists expected write operations", () => {
    for (const name of [
      "drive_create_file",
      "drive_create_folder",
      "drive_upload_file",
      "drive_update_file_content",
      "drive_update_metadata",
      "drive_move_file",
      "drive_copy_file",
      "drive_trash_file",
      "drive_share_file",
    ]) {
      assert.ok((DRIVE_WRITE_TOOLS as readonly string[]).includes(name));
    }
  });
});

describe("seedUploadFor (Drive-only native Doc/Sheet creation)", () => {
  it("uploads Doc seed as text/plain for Drive conversion", () => {
    const up = seedUploadFor(GOOGLE_DOC, "Hello from Prime");
    assert.equal(up?.mimeType, "text/plain");
    assert.equal(up?.buffer.toString("utf8"), "Hello from Prime");
  });
  it("uploads Sheet seed as CSV (tabs → commas, quotes escaped)", () => {
    const up = seedUploadFor(GOOGLE_SHEET, 'a\tb\n1\tsay "hi", ok');
    assert.equal(up?.mimeType, "text/csv");
    assert.equal(up?.buffer.toString("utf8"), 'a,b\n1,"say ""hi"", ok"');
  });
  it("returns null without seed text", () => {
    assert.equal(seedUploadFor(GOOGLE_DOC, ""), null);
  });
});

describe("Docs API disabled fallback", () => {
  it("detects SERVICE_DISABLED errors", () => {
    assert.ok(
      isApiDisabledError(
        new Error("Google Docs API has not been used in project 123 before or it is disabled."),
      ),
    );
    assert.ok(!isApiDisabledError(new Error("File not found")));
  });
  it("computes replace / append / find_replace text", () => {
    assert.deepEqual(nextDocText("old", "replace", { text: "new" }), { ok: true, text: "new" });
    assert.deepEqual(nextDocText("\uFEFFline1\r\n", "append", { text: "line2" }), {
      ok: true,
      text: "line1\nline2",
    });
    assert.deepEqual(nextDocText("Hi Bob, bob.", "find_replace", { find: "bob", replace: "Ann" }), {
      ok: true,
      text: "Hi Ann, Ann.",
    });
    assert.equal(nextDocText("x", "append", {}).ok, false);
  });
});
