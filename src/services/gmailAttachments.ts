import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { google, type gmail_v1 } from "googleapis";
import type { JWT, OAuth2Client } from "google-auth-library";

function gmailClient(auth: OAuth2Client | JWT) {
  return google.gmail({ version: "v1", auth });
}

/** Gmail's documented attachment cap. */
export const GMAIL_ATTACHMENT_ABSOLUTE_MAX_BYTES = 25 * 1024 * 1024;
/** Default cap when returning file bytes through MCP. */
export const GMAIL_ATTACHMENT_DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export interface EmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  partId?: string;
  inline?: boolean;
  downloadable: boolean;
  reason?: string;
}

export interface DownloadedAttachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  savedTo?: string;
  textPreview?: string;
  textTruncated?: boolean;
  /** Standard base64 (not base64url). Omitted when bytes are not returned. */
  dataBase64?: string;
  includedAs: "image" | "audio" | "resource" | "text" | "omitted";
}

export function isRemoteMcpHost(): boolean {
  return Boolean(process.env.FLY_APP_NAME || process.env.FLY_MACHINE_ID);
}

function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

export function safeFilename(name: string): string {
  const trimmed = name.trim() || "attachment";
  const base = trimmed.replace(/[/\\?%*:|"<>]/g, "_").replace(/\0/g, "");
  return (base.replace(/^\.+/, "") || "attachment").slice(0, 200);
}

function isMultipart(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("multipart/");
}

function isBodyTextPart(part: gmail_v1.Schema$MessagePart): boolean {
  const mime = (part.mimeType ?? "").toLowerCase();
  const filename = part.filename?.trim() ?? "";
  return (mime === "text/plain" || mime === "text/html") && filename === "";
}

export function collectAttachments(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: EmailAttachmentMeta[] = [],
): EmailAttachmentMeta[] {
  if (!part) return acc;

  const mimeType = part.mimeType ?? "application/octet-stream";
  if (!isMultipart(mimeType) && !isBodyTextPart(part)) {
    const filename = part.filename?.trim() ?? "";
    const attachmentId = part.body?.attachmentId ?? "";
    const hasInlineData = Boolean(part.body?.data);
    const disposition = headerValue(part.headers, "Content-Disposition").toLowerCase();
    const looksAttached =
      filename !== "" ||
      attachmentId !== "" ||
      disposition.includes("attachment") ||
      disposition.includes("inline");

    if (looksAttached) {
      const googleApp = mimeType.startsWith("application/vnd.google-apps.");
      const downloadable = Boolean(attachmentId || hasInlineData) && !googleApp;
      acc.push({
        attachmentId,
        filename: filename || `attachment-${acc.length + 1}`,
        mimeType,
        size: part.body?.size ?? 0,
        partId: part.partId || undefined,
        inline: disposition.includes("inline") || undefined,
        downloadable,
        reason: downloadable
          ? undefined
          : googleApp
            ? "Google Drive / Workspace file — open the link in the message body."
            : "No attachment payload on this MIME part.",
      });
    }
  }

  for (const child of part.parts ?? []) {
    collectAttachments(child, acc);
  }
  return acc;
}

function findPart(
  part: gmail_v1.Schema$MessagePart | undefined,
  predicate: (candidate: gmail_v1.Schema$MessagePart) => boolean,
): gmail_v1.Schema$MessagePart | undefined {
  if (!part) return undefined;
  if (predicate(part)) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function isTextLike(mimeType: string, filename: string): boolean {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml" || mime === "application/csv") {
    return true;
  }
  return /\.(txt|csv|json|xml|md|html|htm|ics|log)$/i.test(filename);
}

function isImageMime(mimeType: string): boolean {
  return /^(image\/(jpeg|jpg|png|gif|webp|bmp))$/i.test(mimeType);
}

function isAudioMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("audio/");
}

function defaultSaveDir(): string {
  const override = process.env.GMAIL_ATTACHMENT_DIR?.trim();
  if (override) return resolve(override);
  return join(homedir(), "Downloads", "gmail-attachments");
}

function assertSafeSavePath(targetPath: string): string {
  const resolved = resolve(targetPath);
  const allowedRoots = [
    homedir(),
    tmpdir(),
    process.cwd(),
    process.env.GMAIL_ATTACHMENT_DIR?.trim(),
  ]
    .filter((root): root is string => Boolean(root))
    .map((root) => resolve(root));

  const allowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${sep}`),
  );
  if (!allowed) {
    throw new Error(
      `savePath must be under your home directory, the current workspace, /tmp, or GMAIL_ATTACHMENT_DIR. Got: ${resolved}`,
    );
  }
  return resolved;
}

function resolveSavePath(filename: string, savePath?: string): string {
  const safeName = safeFilename(filename);
  if (!savePath?.trim()) {
    return join(defaultSaveDir(), safeName);
  }

  const raw = savePath.trim();
  const candidate = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  const looksLikeDir =
    raw.endsWith("/") ||
    raw.endsWith(sep) ||
    (existsSync(candidate) && statSync(candidate).isDirectory());

  return looksLikeDir ? join(candidate, safeName) : candidate;
}

export async function listMessageAttachments(
  auth: OAuth2Client | JWT,
  messageId: string,
): Promise<{ messageId: string; attachments: EmailAttachmentMeta[] }> {
  const gmail = gmailClient(auth);
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return {
    messageId: response.data.id ?? messageId,
    attachments: collectAttachments(response.data.payload),
  };
}

export async function downloadMessageAttachment(
  auth: OAuth2Client | JWT,
  options: {
    messageId: string;
    attachmentId?: string;
    filename?: string;
    partId?: string;
    saveToDisk?: boolean;
    savePath?: string;
    includeData?: boolean;
    maxBytes?: number;
  },
): Promise<DownloadedAttachment> {
  const maxBytes = Math.min(
    options.maxBytes ?? GMAIL_ATTACHMENT_DEFAULT_MAX_BYTES,
    GMAIL_ATTACHMENT_ABSOLUTE_MAX_BYTES,
  );
  if (options.saveToDisk && isRemoteMcpHost()) {
    throw new Error(
      "This MCP is running remotely (Fly). Omit saveToDisk; file bytes are returned in the tool result so Cursor can save them locally.",
    );
  }

  const gmail = gmailClient(auth);
  const response = await gmail.users.messages.get({
    userId: "me",
    id: options.messageId,
    format: "full",
  });
  const payload = response.data.payload;
  const attachments = collectAttachments(payload);

  const wantedId = options.attachmentId?.trim() ?? "";
  const wantedName = options.filename?.trim().toLowerCase() ?? "";
  const wantedPart = options.partId?.trim() ?? "";

  if (!wantedId && !wantedName && !wantedPart) {
    throw new Error(
      "Provide attachmentId, filename, or partId. Call gmail_list_attachments or gmail_get_message first.",
    );
  }

  const part = findPart(payload, (candidate) => {
    if (wantedId && candidate.body?.attachmentId === wantedId) return true;
    if (wantedPart && candidate.partId === wantedPart) return true;
    if (wantedName && (candidate.filename ?? "").trim().toLowerCase() === wantedName) {
      return true;
    }
    return false;
  });

  if (!part) {
    const names = attachments.map((item) => item.filename).join(", ") || "(none)";
    throw new Error(`Attachment not found on this message. Available files: ${names}`);
  }

  const filename = part.filename?.trim() || wantedName || `attachment-${wantedId || "file"}`;
  const mimeType = part.mimeType ?? "application/octet-stream";
  const attachmentId = part.body?.attachmentId ?? wantedId;
  const googleApp = mimeType.startsWith("application/vnd.google-apps.");
  if (googleApp || (!attachmentId && !part.body?.data)) {
    throw new Error(
      googleApp
        ? "This is a Google Drive / Workspace file, not a downloadable MIME attachment. Open the link in the message body."
        : "This MIME part has no downloadable payload.",
    );
  }

  let bytes: Buffer;
  if (attachmentId) {
    const attached = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: options.messageId,
      id: attachmentId,
    });
    if (!attached.data.data) {
      throw new Error("Gmail returned an empty attachment payload.");
    }
    bytes = decodeBase64Url(attached.data.data);
  } else {
    bytes = decodeBase64Url(part.body?.data ?? "");
  }

  const saveToDisk = options.saveToDisk === true;
  if (bytes.length > maxBytes && !(saveToDisk && !isRemoteMcpHost())) {
    throw new Error(
      `Attachment is ${bytes.length} bytes, over the ${maxBytes} byte limit. Raise maxBytes (max ${GMAIL_ATTACHMENT_ABSOLUTE_MAX_BYTES}) or set saveToDisk on a local MCP.`,
    );
  }

  let savedTo: string | undefined;
  if (saveToDisk) {
    const target = assertSafeSavePath(resolveSavePath(filename, options.savePath));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    savedTo = target;
  }

  const includeData = options.includeData ?? !saveToDisk;
  const textLike = isTextLike(mimeType, filename);
  const includedAs: DownloadedAttachment["includedAs"] = !includeData
    ? "omitted"
    : isImageMime(mimeType)
      ? "image"
      : isAudioMime(mimeType)
        ? "audio"
        : textLike
          ? "text"
          : "resource";
  const text = textLike ? bytes.toString("utf8") : undefined;

  return {
    messageId: response.data.id ?? options.messageId,
    attachmentId,
    filename: safeFilename(filename),
    mimeType,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    savedTo,
    textPreview: text ? text.slice(0, 20_000) : undefined,
    textTruncated: text != null && text.length > 20_000 ? true : undefined,
    dataBase64: includeData && includedAs !== "text" ? bytes.toString("base64") : undefined,
    includedAs,
  };
}
