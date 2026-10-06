import type { drive_v3 } from "googleapis";
import { google } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";

export const MAX_RAW_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
export const MAX_INLINE_BASE64_BYTES = 8 * 1024 * 1024;

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";
export const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

export type DriveContentStrategy =
  | { kind: "export"; exportMime: string; contentKind: "text" | "csv"; alsoMarkdown?: boolean }
  | { kind: "media"; contentKind: "text" | "csv" | "pdf" | "docx" | "xlsx" | "image" | "binary" }
  | { kind: "unsupported"; reason: string };

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  md5Checksum?: string;
};

export type DriveFileContent = {
  file: DriveFileMeta;
  text?: string;
  markdown?: string;
  contentKind: string;
  needs_ocr?: boolean;
  base64?: string;
  mimeType?: string;
  rawBase64?: string;
  rawSizeBytes?: number;
  rawTruncated?: boolean;
  truncated?: boolean;
  note?: string;
};

/** Pure mapping used by tests and the reader. */
export function resolveDriveContentStrategy(mimeType: string): DriveContentStrategy {
  const mime = (mimeType || "").toLowerCase();
  if (mime === GOOGLE_FOLDER) {
    return { kind: "unsupported", reason: "Folders have no file content" };
  }
  if (mime === GOOGLE_DOC) {
    return {
      kind: "export",
      exportMime: "text/plain",
      contentKind: "text",
      alsoMarkdown: true,
    };
  }
  if (mime === GOOGLE_SHEET) {
    return { kind: "export", exportMime: "text/csv", contentKind: "csv" };
  }
  if (mime === GOOGLE_SLIDE) {
    return { kind: "export", exportMime: "text/plain", contentKind: "text" };
  }
  if (mime === "application/pdf") {
    return { kind: "media", contentKind: "pdf" };
  }
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return { kind: "media", contentKind: "docx" };
  }
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) {
    return { kind: "media", contentKind: "xlsx" };
  }
  if (mime.startsWith("image/")) {
    return { kind: "media", contentKind: "image" };
  }
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/csv" ||
    mime === "text/csv"
  ) {
    return { kind: "media", contentKind: mime.includes("csv") ? "csv" : "text" };
  }
  return { kind: "media", contentKind: "binary" };
}

export function truncateText(text: string, max = MAX_TEXT_CHARS): {
  text: string;
  truncated: boolean;
} {
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (cleaned.length <= max) {
    return { text: cleaned, truncated: false };
  }
  return {
    text: `${cleaned.slice(0, max)}\n…[truncated]`,
    truncated: true,
  };
}

function metaFrom(file: drive_v3.Schema$File): DriveFileMeta {
  return {
    id: file.id ?? "",
    name: file.name ?? "",
    mimeType: file.mimeType ?? "application/octet-stream",
    modifiedTime: file.modifiedTime ?? undefined,
    size: file.size ?? undefined,
    webViewLink: file.webViewLink ?? undefined,
    md5Checksum: file.md5Checksum ?? undefined,
  };
}

async function downloadExport(
  drive: drive_v3.Drive,
  fileId: string,
  exportMime: string,
): Promise<Buffer> {
  const res = await drive.files.export(
    { fileId, mimeType: exportMime },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

async function downloadMedia(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Import the library entry (not package root) — root pdf-parse runs a test PDF open.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default ?? mod;
  const parsed = await pdfParse(buffer);
  return parsed.text ?? "";
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function extractXlsxCsv(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`# Sheet: ${name}\n${csv}`);
  }
  return parts.join("\n\n");
}

function maybeRaw(
  buffer: Buffer,
  includeRaw: boolean,
): Pick<DriveFileContent, "rawBase64" | "rawSizeBytes" | "rawTruncated"> {
  if (!includeRaw) return {};
  const rawSizeBytes = buffer.length;
  if (rawSizeBytes > MAX_RAW_BYTES) {
    return {
      rawSizeBytes,
      rawTruncated: true,
      rawBase64: buffer.subarray(0, MAX_RAW_BYTES).toString("base64"),
    };
  }
  return {
    rawSizeBytes,
    rawTruncated: false,
    rawBase64: buffer.toString("base64"),
  };
}

export async function readDriveFileContent(
  auth: OAuth2Client | JWT,
  input: {
    fileId: string;
    includeText?: boolean;
    includeMarkdown?: boolean;
    includeRaw?: boolean;
    exportFormat?: "plain" | "markdown";
  },
): Promise<{ ok: true; data: DriveFileContent } | { ok: false; error: string }> {
  const fileId = input.fileId.trim();
  if (!fileId) {
    return { ok: false, error: "fileId is required" };
  }
  const includeText = input.includeText !== false;
  const includeRaw = input.includeRaw === true;
  const includeMarkdown =
    input.includeMarkdown === true || input.exportFormat === "markdown";

  const drive = google.drive({ version: "v3", auth });
  let metaRes: { data: drive_v3.Schema$File };
  try {
    metaRes = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,modifiedTime,size,webViewLink,md5Checksum",
      supportsAllDrives: true,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Drive metadata failed",
    };
  }

  const file = metaFrom(metaRes.data);
  if (!file.id) {
    return { ok: false, error: "Drive file metadata was empty" };
  }

  const strategy = resolveDriveContentStrategy(file.mimeType);
  if (strategy.kind === "unsupported") {
    return {
      ok: true,
      data: {
        file,
        contentKind: "unsupported",
        note: strategy.reason,
      },
    };
  }

  if (!includeText && !includeRaw && strategy.contentKind !== "image") {
    return {
      ok: true,
      data: {
        file,
        contentKind: strategy.contentKind,
        note: "Metadata only (includeText=false).",
      },
    };
  }

  try {
    if (strategy.kind === "export") {
      const buf = await downloadExport(drive, fileId, strategy.exportMime);
      const sized = Number(file.size ?? "0");
      if (Number.isFinite(sized) && sized > MAX_RAW_BYTES && !includeText) {
        return {
          ok: true,
          data: {
            file,
            contentKind: strategy.contentKind,
            note: `File exceeds ${MAX_RAW_BYTES} byte cap.`,
            ...maybeRaw(buf, includeRaw),
          },
        };
      }
      const out: DriveFileContent = {
        file,
        contentKind: strategy.contentKind,
        ...maybeRaw(buf, includeRaw),
      };
      if (includeText) {
        const { text, truncated } = truncateText(buf.toString("utf8"));
        out.text = text;
        out.truncated = truncated;
      }
      if (includeMarkdown && strategy.alsoMarkdown) {
        try {
          const mdBuf = await downloadExport(drive, fileId, "text/markdown");
          const { text: md, truncated } = truncateText(mdBuf.toString("utf8"));
          out.markdown = md;
          if (truncated) out.truncated = true;
        } catch {
          // text/markdown export is not always available
          out.note = (out.note ? `${out.note} ` : "") + "Markdown export unavailable; plain text returned.";
        }
      }
      return { ok: true, data: out };
    }

    // media download
    const sizeHint = Number(file.size ?? "0");
    if (Number.isFinite(sizeHint) && sizeHint > MAX_RAW_BYTES) {
      return {
        ok: true,
        data: {
          file,
          contentKind: strategy.contentKind,
          note: `File is ${sizeHint} bytes; exceeds ${MAX_RAW_BYTES} byte download cap.`,
          rawSizeBytes: sizeHint,
          rawTruncated: true,
        },
      };
    }

    const buf = await downloadMedia(drive, fileId);
    const raw = maybeRaw(buf, includeRaw || strategy.contentKind === "image" || strategy.contentKind === "binary");

    if (strategy.contentKind === "image") {
      if (buf.length > MAX_INLINE_BASE64_BYTES) {
        return {
          ok: true,
          data: {
            file,
            contentKind: "image",
            mimeType: file.mimeType,
            note: `Image exceeds ${MAX_INLINE_BASE64_BYTES} byte inline cap.`,
            rawSizeBytes: buf.length,
            rawTruncated: true,
            ...(includeRaw ? maybeRaw(buf, true) : {}),
          },
        };
      }
      return {
        ok: true,
        data: {
          file,
          contentKind: "image",
          mimeType: file.mimeType,
          base64: buf.toString("base64"),
          ...maybeRaw(buf, includeRaw),
        },
      };
    }

    if (strategy.contentKind === "binary" && !includeText) {
      return {
        ok: true,
        data: {
          file,
          contentKind: "binary",
          mimeType: file.mimeType,
          note: "Binary type — set include_raw=true for base64 bytes.",
          ...raw,
        },
      };
    }

    if (!includeText) {
      return {
        ok: true,
        data: {
          file,
          contentKind: strategy.contentKind,
          note: "Metadata/raw only (includeText=false).",
          ...raw,
        },
      };
    }

    if (strategy.contentKind === "pdf") {
      const extracted = await extractPdfText(buf);
      const { text, truncated } = truncateText(extracted);
      if (!text) {
        const inline =
          buf.length <= MAX_INLINE_BASE64_BYTES
            ? buf.toString("base64")
            : undefined;
        return {
          ok: true,
          data: {
            file,
            contentKind: "pdf",
            text: "",
            needs_ocr: true,
            base64: inline,
            mimeType: "application/pdf",
            note: inline
              ? "No text layer; needs_ocr=true with base64 payload for caller OCR."
              : "No text layer; PDF too large to inline base64 for OCR.",
            truncated: false,
            ...maybeRaw(buf, includeRaw),
          },
        };
      }
      return {
        ok: true,
        data: {
          file,
          contentKind: "pdf",
          text,
          truncated,
          needs_ocr: false,
          ...maybeRaw(buf, includeRaw),
        },
      };
    }

    if (strategy.contentKind === "docx") {
      const { text, truncated } = truncateText(await extractDocxText(buf));
      return {
        ok: true,
        data: {
          file,
          contentKind: "docx",
          text,
          truncated,
          ...maybeRaw(buf, includeRaw),
        },
      };
    }

    if (strategy.contentKind === "xlsx" || strategy.contentKind === "csv") {
      let body = "";
      if (strategy.contentKind === "xlsx") {
        body = await extractXlsxCsv(buf);
      } else {
        body = buf.toString("utf8");
      }
      const { text, truncated } = truncateText(body);
      return {
        ok: true,
        data: {
          file,
          contentKind: strategy.contentKind,
          text,
          truncated,
          ...maybeRaw(buf, includeRaw),
        },
      };
    }

    if (strategy.contentKind === "text") {
      const { text, truncated } = truncateText(buf.toString("utf8"));
      return {
        ok: true,
        data: {
          file,
          contentKind: "text",
          text,
          truncated,
          ...maybeRaw(buf, includeRaw),
        },
      };
    }

    // binary with includeText requested
    return {
      ok: true,
      data: {
        file,
        contentKind: "binary",
        mimeType: file.mimeType,
        note: "No text extractor for this mime type.",
        ...maybeRaw(buf, true),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Drive content read failed",
    };
  }
}
