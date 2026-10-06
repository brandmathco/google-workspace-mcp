import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRIVE_WRITE_TOOLS } from "./driveWrite.js";

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
