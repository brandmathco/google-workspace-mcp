import { google, drive_v3, docs_v1, sheets_v4 } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";
import { Readable } from "node:stream";
import { MAX_RAW_BYTES, GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_FOLDER } from "./driveContent.js";

type Auth = OAuth2Client | JWT;

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function driveClient(auth: Auth) {
  return google.drive({ version: "v3", auth });
}

function docsClient(auth: Auth) {
  return google.docs({ version: "v1", auth });
}

function sheetsClient(auth: Auth) {
  return google.sheets({ version: "v4", auth });
}

function bufferFromArgs(args: Record<string, unknown>): {
  ok: true;
  buffer: Buffer;
  mimeType?: string;
} | { ok: false; error: string } {
  const text = str(args, "text") || str(args, "content");
  const b64 = str(args, "base64") || str(args, "contentBase64");
  if (b64) {
    try {
      const buffer = Buffer.from(b64, "base64");
      if (buffer.length > MAX_RAW_BYTES) {
        return { ok: false, error: `Payload exceeds ${MAX_RAW_BYTES} byte cap` };
      }
      return { ok: true, buffer, mimeType: str(args, "mimeType") || undefined };
    } catch {
      return { ok: false, error: "Invalid base64" };
    }
  }
  if (text) {
    const buffer = Buffer.from(text, "utf8");
    if (buffer.length > MAX_RAW_BYTES) {
      return { ok: false, error: `Payload exceeds ${MAX_RAW_BYTES} byte cap` };
    }
    return {
      ok: true,
      buffer,
      mimeType: str(args, "mimeType") || "text/plain",
    };
  }
  return { ok: false, error: "Provide text/content or base64/contentBase64" };
}

async function fetchUrlBytes(url: string): Promise<
  { ok: true; buffer: Buffer; contentType?: string } | { ok: false; error: string }
> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      return { ok: false, error: `URL fetch HTTP ${res.status}` };
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > MAX_RAW_BYTES) {
      return { ok: false, error: `Remote file exceeds ${MAX_RAW_BYTES} byte cap` };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_RAW_BYTES) {
      return { ok: false, error: `Remote file exceeds ${MAX_RAW_BYTES} byte cap` };
    }
    return {
      ok: true,
      buffer,
      contentType: res.headers.get("content-type") ?? undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "URL fetch failed",
    };
  }
}

export async function driveCreateFolder(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const name = str(args, "name") || str(args, "title");
  if (!name) return { ok: false, error: "name is required" };
  const parentId = str(args, "folderId") || str(args, "parentId");
  const drive = driveClient(auth);
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: GOOGLE_FOLDER,
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id,name,mimeType,webViewLink,parents",
    supportsAllDrives: true,
  });
  return { ok: true, data: { file: res.data } };
}

/** Media used to seed a native Google Doc/Sheet via Drive import conversion. */
export function seedUploadFor(
  googleMime: string,
  seed: string,
): { mimeType: string; buffer: Buffer } | null {
  if (!seed) return null;
  if (googleMime === GOOGLE_SHEET) {
    const csv = seed
      .split(/\r?\n/)
      .map((line) =>
        line
          .split(line.includes("\t") ? "\t" : ",")
          .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
          .join(","),
      )
      .join("\n");
    return { mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") };
  }
  if (googleMime === GOOGLE_DOC) {
    return { mimeType: "text/plain", buffer: Buffer.from(seed, "utf8") };
  }
  return null;
}

export async function driveCreateFile(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const name = str(args, "name") || str(args, "title");
  if (!name) return { ok: false, error: "name is required" };
  const parentId = str(args, "folderId") || str(args, "parentId");
  let mimeType =
    str(args, "mimeType") ||
    (str(args, "type") === "doc"
      ? GOOGLE_DOC
      : str(args, "type") === "sheet"
        ? GOOGLE_SHEET
        : "");

  const drive = driveClient(auth);

  // Native Google Doc/Sheet (optionally seed text afterward)
  if (mimeType === GOOGLE_DOC || mimeType === GOOGLE_SHEET || str(args, "type") === "doc" || str(args, "type") === "sheet") {
    mimeType = mimeType || (str(args, "type") === "sheet" ? GOOGLE_SHEET : GOOGLE_DOC);
    const seed = str(args, "text") || str(args, "content");
    // Seed text is uploaded through the Drive API and converted to a native
    // Google Doc/Sheet in one call. This needs only the Drive scope + Drive API
    // (no separate Docs/Sheets API enablement) and never leaves an empty doc
    // behind when a follow-up Docs/Sheets write fails.
    const seedUpload = seed ? seedUploadFor(mimeType, seed) : null;
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType,
        parents: parentId ? [parentId] : undefined,
      },
      ...(seedUpload
        ? { media: { mimeType: seedUpload.mimeType, body: Readable.from(seedUpload.buffer) } }
        : {}),
      fields: "id,name,mimeType,webViewLink,parents",
      supportsAllDrives: true,
    });
    return { ok: true, data: { file: created.data } };
  }

  const payload = bufferFromArgs(args);
  if (!payload.ok) {
    // Empty file of given mime is OK
    if (!str(args, "text") && !str(args, "base64") && !str(args, "content") && !str(args, "contentBase64")) {
      const created = await drive.files.create({
        requestBody: {
          name,
          mimeType: mimeType || "text/plain",
          parents: parentId ? [parentId] : undefined,
        },
        fields: "id,name,mimeType,webViewLink,parents",
        supportsAllDrives: true,
      });
      return { ok: true, data: { file: created.data } };
    }
    return payload;
  }

  const mediaMime = mimeType || payload.mimeType || "application/octet-stream";
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: mediaMime,
      parents: parentId ? [parentId] : undefined,
    },
    media: {
      mimeType: mediaMime,
      body: Readable.from(payload.buffer),
    },
    fields: "id,name,mimeType,webViewLink,parents,size",
    supportsAllDrives: true,
  });
  return { ok: true, data: { file: created.data } };
}

export async function driveUploadFile(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const name = str(args, "name") || str(args, "title") || "upload.bin";
  const parentId = str(args, "folderId") || str(args, "parentId");
  const url = str(args, "url") || str(args, "sourceUrl");
  let buffer: Buffer;
  let mimeType = str(args, "mimeType") || "application/octet-stream";

  if (url) {
    const fetched = await fetchUrlBytes(url);
    if (!fetched.ok) return fetched;
    buffer = fetched.buffer;
    if (fetched.contentType) mimeType = fetched.contentType.split(";")[0]!.trim() || mimeType;
  } else {
    const payload = bufferFromArgs(args);
    if (!payload.ok) return payload;
    buffer = payload.buffer;
    if (payload.mimeType) mimeType = payload.mimeType;
  }

  const drive = driveClient(auth);
  // Resumable via googleapis media upload
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType,
      parents: parentId ? [parentId] : undefined,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id,name,mimeType,webViewLink,parents,size",
    supportsAllDrives: true,
  });
  return {
    ok: true,
    data: { file: created.data, bytes: buffer.length },
  };
}

export async function driveUpdateFileContent(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const fileId = str(args, "fileId");
  if (!fileId) return { ok: false, error: "fileId is required" };
  const drive = driveClient(auth);
  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
    supportsAllDrives: true,
  });
  const mime = meta.data.mimeType ?? "";
  const mode = str(args, "mode") || "replace"; // replace | append | find_replace | cells | append_rows

  if (mime === GOOGLE_DOC) {
    try {
      return await updateDocViaDocsApi(auth, fileId, mode, args);
    } catch (err) {
      if (!isApiDisabledError(err)) throw err;
      // Docs API is not enabled on the OAuth project: rewrite the doc body
      // through Drive (export text → edit → upload text/plain over the Doc).
      return await updateDocViaDrive(drive, fileId, mode, args);
    }
  }

  if (mime === GOOGLE_SHEET) {
    const sheets = sheetsClient(auth);
    if (mode === "append_rows" || mode === "append") {
      const values = parseSheetValues(args);
      if (!values.ok) return values;
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: fileId,
        range: str(args, "range") || "A1",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: values.values },
      });
      return { ok: true, data: { fileId, mode: "append_rows", result: res.data } };
    }
    const values = parseSheetValues(args);
    if (!values.ok) {
      // allow single cell via text
      const text = str(args, "text") || str(args, "content");
      const range = str(args, "range") || "A1";
      if (!text) return values;
      const res = await sheets.spreadsheets.values.update({
        spreadsheetId: fileId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[text]] },
      });
      return { ok: true, data: { fileId, mode: "cells", range, result: res.data } };
    }
    const range = str(args, "range") || "A1";
    const res = await sheets.spreadsheets.values.update({
      spreadsheetId: fileId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: values.values },
    });
    return { ok: true, data: { fileId, mode: "cells", range, result: res.data } };
  }

  // Binary / plain: new revision upload
  const payload = bufferFromArgs(args);
  if (!payload.ok) return payload;
  const updated = await drive.files.update({
    fileId,
    media: {
      mimeType: mime || payload.mimeType || "application/octet-stream",
      body: Readable.from(payload.buffer),
    },
    fields: "id,name,mimeType,modifiedTime,size,webViewLink",
    supportsAllDrives: true,
  });
  return { ok: true, data: { file: updated.data, mode: "replace_media" } };
}

async function updateDocViaDocsApi(
  auth: Auth,
  fileId: string,
  mode: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const docs = docsClient(auth);

    if (mode === "find_replace") {
      const find = str(args, "find") || str(args, "search");
      const replace = str(args, "replace") || str(args, "replacement");
      if (!find) return { ok: false, error: "find is required for find_replace" };
      const res = await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: {
          requests: [
            {
              replaceAllText: {
                containsText: { text: find, matchCase: bool(args, "matchCase") },
                replaceText: replace,
              },
            },
          ],
        },
      });
      return { ok: true, data: { fileId, mode, result: res.data } };
    }
    const text = str(args, "text") || str(args, "content");
    if (!text) return { ok: false, error: "text/content is required" };
    if (mode === "append") {
      const doc = await docs.documents.get({ documentId: fileId });
      const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;
      const insertAt = Math.max(1, endIndex - 1);
      const res = await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: {
          requests: [
            { insertText: { location: { index: insertAt }, text } },
          ],
        },
      });
      return { ok: true, data: { fileId, mode: "append", result: res.data } };
    }
    // replace: clear body then insert
    const doc = await docs.documents.get({ documentId: fileId });
    const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;
    const requests: docs_v1.Schema$Request[] = [];
    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      });
    }
    requests.push({ insertText: { location: { index: 1 }, text } });
    const res = await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: { requests },
    });
    return { ok: true, data: { fileId, mode: "replace", result: res.data } };
}

/** True when Google says the API (Docs/Sheets) is disabled for the project. */
export function isApiDisabledError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reason = (err as any)?.errors?.[0]?.reason ?? (err as any)?.response?.data?.error?.details?.[0]?.reason;
  return (
    reason === "SERVICE_DISABLED" ||
    reason === "accessNotConfigured" ||
    /has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg)
  );
}

/** Pure text edit used by the Drive-only Doc fallback. */
export function nextDocText(
  current: string,
  mode: string,
  args: Record<string, unknown>,
): { ok: true; text: string } | { ok: false; error: string } {
  const base = current.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (mode === "find_replace") {
    const find = str(args, "find") || str(args, "search");
    const replace = str(args, "replace") || str(args, "replacement");
    if (!find) return { ok: false, error: "find is required for find_replace" };
    const flags = bool(args, "matchCase") ? "g" : "gi";
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    return { ok: true, text: base.replace(re, () => replace) };
  }
  const text = str(args, "text") || str(args, "content");
  if (!text) return { ok: false, error: "text/content is required" };
  if (mode === "append") {
    const trimmed = base.replace(/\s+$/, "");
    return { ok: true, text: trimmed ? `${trimmed}\n${text}` : text };
  }
  return { ok: true, text };
}

async function updateDocViaDrive(
  drive: drive_v3.Drive,
  fileId: string,
  mode: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  let current = "";
  if (mode === "append" || mode === "find_replace") {
    const exported = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );
    current = Buffer.from(exported.data as ArrayBuffer).toString("utf8");
  }
  const next = nextDocText(current, mode, args);
  if (!next.ok) return next;
  const updated = await drive.files.update({
    fileId,
    media: { mimeType: "text/plain", body: Readable.from(Buffer.from(next.text, "utf8")) },
    fields: "id,name,mimeType,modifiedTime,webViewLink",
    supportsAllDrives: true,
  });
  return {
    ok: true,
    data: {
      file: updated.data,
      fileId,
      mode: mode === "append" || mode === "find_replace" ? mode : "replace",
      via: "drive_text_upload",
      note: "Docs API is disabled for this Google project, so the doc text was rewritten through Drive (plain text; formatting is not kept).",
    },
  };
}

function parseSheetValues(
  args: Record<string, unknown>,
): { ok: true; values: string[][] } | { ok: false; error: string } {
  if (Array.isArray(args.values)) {
    const values = args.values.map((row) => {
      if (Array.isArray(row)) {
        return row.map((c) => (c == null ? "" : String(c)));
      }
      return [String(row)];
    });
    return { ok: true, values };
  }
  const text = str(args, "text") || str(args, "content") || str(args, "csv");
  if (!text) return { ok: false, error: "values array or text/csv required" };
  const values = text.split("\n").map((line) => line.split(/,|\t/));
  return { ok: true, values };
}

export async function driveUpdateMetadata(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const fileId = str(args, "fileId");
  if (!fileId) return { ok: false, error: "fileId is required" };
  const requestBody: drive_v3.Schema$File = {};
  const name = str(args, "name") || str(args, "title");
  if (name) requestBody.name = name;
  const description = str(args, "description");
  if (description) requestBody.description = description;
  if (args.appProperties && typeof args.appProperties === "object") {
    requestBody.appProperties = Object.fromEntries(
      Object.entries(args.appProperties as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
  }
  if (args.properties && typeof args.properties === "object") {
    requestBody.properties = Object.fromEntries(
      Object.entries(args.properties as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
  }
  if (!Object.keys(requestBody).length) {
    return { ok: false, error: "Provide name, description, appProperties, and/or properties" };
  }
  const res = await driveClient(auth).files.update({
    fileId,
    requestBody,
    fields: "id,name,description,appProperties,properties,webViewLink",
    supportsAllDrives: true,
  });
  return { ok: true, data: { file: res.data } };
}

export async function driveMoveFile(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const fileId = str(args, "fileId");
  const folderId = str(args, "folderId") || str(args, "parentId");
  if (!fileId || !folderId) {
    return { ok: false, error: "fileId and folderId are required" };
  }
  const drive = driveClient(auth);
  const meta = await drive.files.get({
    fileId,
    fields: "parents",
    supportsAllDrives: true,
  });
  const prev = meta.data.parents ?? [];
  const res = await drive.files.update({
    fileId,
    addParents: folderId,
    removeParents: prev.join(","),
    fields: "id,name,parents,webViewLink",
    supportsAllDrives: true,
  });
  return { ok: true, data: { file: res.data } };
}

export async function driveCopyFile(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const fileId = str(args, "fileId");
  if (!fileId) return { ok: false, error: "fileId is required" };
  const name = str(args, "name") || str(args, "title");
  const folderId = str(args, "folderId") || str(args, "parentId");
  const res = await driveClient(auth).files.copy({
    fileId,
    requestBody: {
      name: name || undefined,
      parents: folderId ? [folderId] : undefined,
    },
    fields: "id,name,mimeType,parents,webViewLink",
    supportsAllDrives: true,
  });
  return { ok: true, data: { file: res.data } };
}

export async function driveTrashFile(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const fileId = str(args, "fileId");
  if (!fileId) return { ok: false, error: "fileId is required" };
  const res = await driveClient(auth).files.update({
    fileId,
    requestBody: { trashed: true },
    fields: "id,name,trashed,webViewLink",
    supportsAllDrives: true,
  });
  return { ok: true, data: { file: res.data } };
}

export async function driveShareFile(
  auth: Auth,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const fileId = str(args, "fileId");
  const email = str(args, "email") || str(args, "emailAddress");
  const role = str(args, "role") || "reader";
  if (!fileId || !email) {
    return { ok: false, error: "fileId and email are required" };
  }
  if (!["reader", "commenter", "writer"].includes(role)) {
    return { ok: false, error: "role must be reader, commenter, or writer" };
  }
  const res = await driveClient(auth).permissions.create({
    fileId,
    requestBody: {
      type: "user",
      role,
      emailAddress: email,
    },
    fields: "id,role,emailAddress,type",
    sendNotificationEmail: bool(args, "sendNotification") || bool(args, "sendNotificationEmail"),
    supportsAllDrives: true,
  });
  return { ok: true, data: { permission: res.data } };
}

export const DRIVE_WRITE_TOOLS = [
  "drive_create_file",
  "drive_create_folder",
  "drive_upload_file",
  "drive_update_file_content",
  "drive_update_metadata",
  "drive_move_file",
  "drive_copy_file",
  "drive_trash_file",
  "drive_share_file",
] as const;

export async function runDriveWriteTool(
  name: string,
  args: Record<string, unknown>,
  auth: Auth,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    switch (name) {
      case "drive_create_file":
        return await driveCreateFile(auth, args);
      case "drive_create_folder":
        return await driveCreateFolder(auth, args);
      case "drive_upload_file":
        return await driveUploadFile(auth, args);
      case "drive_update_file_content":
        return await driveUpdateFileContent(auth, args);
      case "drive_update_metadata":
        return await driveUpdateMetadata(auth, args);
      case "drive_move_file":
        return await driveMoveFile(auth, args);
      case "drive_copy_file":
        return await driveCopyFile(auth, args);
      case "drive_trash_file":
        return await driveTrashFile(auth, args);
      case "drive_share_file":
        return await driveShareFile(auth, args);
      default:
        return { ok: false, error: `Unknown Drive write tool: ${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Drive write failed",
    };
  }
}
