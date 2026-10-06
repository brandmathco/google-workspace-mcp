import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GOOGLE_DOC,
  GOOGLE_SHEET,
  GOOGLE_SLIDE,
  resolveDriveContentStrategy,
  truncateText,
} from "./driveContent.js";

describe("resolveDriveContentStrategy", () => {
  it("exports Google Docs as plain text with optional markdown", () => {
    const s = resolveDriveContentStrategy(GOOGLE_DOC);
    assert.equal(s.kind, "export");
    if (s.kind === "export") {
      assert.equal(s.exportMime, "text/plain");
      assert.equal(s.alsoMarkdown, true);
    }
  });

  it("exports Sheets as CSV", () => {
    const s = resolveDriveContentStrategy(GOOGLE_SHEET);
    assert.deepEqual(s, {
      kind: "export",
      exportMime: "text/csv",
      contentKind: "csv",
    });
  });

  it("exports Slides as plain text", () => {
    const s = resolveDriveContentStrategy(GOOGLE_SLIDE);
    assert.equal(s.kind, "export");
    if (s.kind === "export") {
      assert.equal(s.exportMime, "text/plain");
      assert.equal(s.contentKind, "text");
    }
  });

  it("maps PDF/DOCX/XLSX/images/text", () => {
    assert.deepEqual(resolveDriveContentStrategy("application/pdf"), {
      kind: "media",
      contentKind: "pdf",
    });
    assert.deepEqual(
      resolveDriveContentStrategy(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      { kind: "media", contentKind: "docx" },
    );
    assert.deepEqual(
      resolveDriveContentStrategy(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
      { kind: "media", contentKind: "xlsx" },
    );
    assert.deepEqual(resolveDriveContentStrategy("image/png"), {
      kind: "media",
      contentKind: "image",
    });
    assert.deepEqual(resolveDriveContentStrategy("text/plain"), {
      kind: "media",
      contentKind: "text",
    });
    assert.deepEqual(resolveDriveContentStrategy("text/csv"), {
      kind: "media",
      contentKind: "csv",
    });
  });

  it("rejects folders", () => {
    const s = resolveDriveContentStrategy(
      "application/vnd.google-apps.folder",
    );
    assert.equal(s.kind, "unsupported");
  });
});

describe("truncateText", () => {
  it("flags truncation", () => {
    const { text, truncated } = truncateText("abcdefghij", 5);
    assert.equal(truncated, true);
    assert.match(text, /truncated/);
  });
});
