import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";
import {
  collectAttachments,
  type EmailAttachmentMeta,
} from "./gmailAttachments.js";
import {
  buildRawEmail,
  encodeRawMessage,
  type ComposeEmailInput,
} from "./gmailMime.js";

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  labelIds: string[];
}

export interface EmailDetail extends EmailSummary {
  bodyText: string;
  bodyHtml?: string;
  messageIdHeader?: string;
  references?: string;
  attachments: EmailAttachmentMeta[];
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function extractHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  const match = headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return match?.value ?? "";
}

function extractBody(part: gmail_v1.Schema$MessagePart | undefined): {
  text: string;
  html?: string;
} {
  if (!part) return { text: "" };

  if (part.mimeType === "text/plain" && part.body?.data) {
    return { text: decodeBase64Url(part.body.data) };
  }

  if (part.mimeType === "text/html" && part.body?.data) {
    return { text: "", html: decodeBase64Url(part.body.data) };
  }

  let text = "";
  let html: string | undefined;

  for (const child of part.parts ?? []) {
    const nested = extractBody(child);
    text = text || nested.text;
    html = html || nested.html;
  }

  return { text, html };
}

function toSummary(message: gmail_v1.Schema$Message): EmailSummary {
  const headers = message.payload?.headers;
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    subject: extractHeader(headers, "Subject") || "(no subject)",
    from: extractHeader(headers, "From"),
    to: extractHeader(headers, "To"),
    date: extractHeader(headers, "Date"),
    snippet: message.snippet ?? "",
    labelIds: message.labelIds ?? [],
  };
}

export async function createGmailClient(auth: OAuth2Client | JWT) {
  return google.gmail({ version: "v1", auth });
}

export async function listMessages(
  auth: OAuth2Client | JWT,
  options: { query?: string; maxResults?: number; labelIds?: string[] },
): Promise<EmailSummary[]> {
  const gmail = await createGmailClient(auth);
  const list = await gmail.users.messages.list({
    userId: "me",
    q: options.query,
    maxResults: options.maxResults ?? 10,
    labelIds: options.labelIds,
  });

  const messages = list.data.messages ?? [];
  const summaries: EmailSummary[] = [];

  for (const item of messages) {
    if (!item.id) continue;
    const full = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "To", "Date"],
    });
    summaries.push(toSummary(full.data));
  }

  return summaries;
}

export async function getMessage(
  auth: OAuth2Client | JWT,
  messageId: string,
): Promise<EmailDetail> {
  const gmail = await createGmailClient(auth);
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const message = response.data;
  const headers = message.payload?.headers;
  const body = extractBody(message.payload);

  return {
    ...toSummary(message),
    bodyText: body.text || message.snippet || "",
    bodyHtml: body.html,
    messageIdHeader: extractHeader(headers, "Message-ID") || undefined,
    references: extractHeader(headers, "References") || undefined,
    attachments: collectAttachments(message.payload),
  };
}

function buildOutboundHeaders(options: {
  to: string;
  subject: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string[] {
  const headers = [
    `To: ${options.to.trim()}`,
    `Subject: ${options.subject.trim()}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];
  if (options.cc?.trim()) {
    headers.splice(1, 0, `Cc: ${options.cc.trim()}`);
  }
  if (options.bcc?.trim()) {
    headers.splice(1, 0, `Bcc: ${options.bcc.trim()}`);
  }
  if (options.inReplyTo?.trim()) {
    headers.push(`In-Reply-To: ${options.inReplyTo.trim()}`);
  }
  if (options.references?.trim()) {
    headers.push(`References: ${options.references.trim()}`);
  }
  return headers;
}

/** Save a new outbound message as a Gmail draft (does not send). */
export async function createDraftMessage(
  auth: OAuth2Client | JWT,
  options: ComposeEmailInput,
): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const gmail = await createGmailClient(auth);
  const created = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodeRawMessage(buildRawEmail(options)),
      },
    },
  });

  return {
    draftId: created.data.id ?? "",
    messageId: created.data.message?.id ?? "",
    threadId: created.data.message?.threadId ?? "",
  };
}

/** Save a reply as a Gmail draft in the original thread (does not send). */
export async function createDraftReply(
  auth: OAuth2Client | JWT,
  options: {
    messageId: string;
    body: string;
    replyAll?: boolean;
  },
): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const gmail = await createGmailClient(auth);
  const original = await getMessage(auth, options.messageId);

  const profile = await gmail.users.getProfile({ userId: "me" });
  const myEmail = profile.data.emailAddress ?? "";

  const to = options.replyAll ? original.to || original.from : original.from;
  const subject = original.subject.startsWith("Re:")
    ? original.subject
    : `Re: ${original.subject}`;
  const references = [original.references, original.messageIdHeader]
    .filter(Boolean)
    .join(" ");

  const headers = buildOutboundHeaders({
    to,
    subject,
    cc: options.replyAll && myEmail ? original.to : undefined,
    inReplyTo: original.messageIdHeader,
    references,
  });

  const rawMessage = `${headers.join("\r\n")}\r\n\r\n${options.body}`;
  const created = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodeRawMessage(rawMessage),
        threadId: original.threadId,
      },
    },
  });

  return {
    draftId: created.data.id ?? "",
    messageId: created.data.message?.id ?? "",
    threadId: created.data.message?.threadId ?? original.threadId,
  };
}

export async function sendMessage(
  auth: OAuth2Client | JWT,
  options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  },
): Promise<{ id: string; threadId: string }> {
  const gmail = await createGmailClient(auth);
  const headers = buildOutboundHeaders(options);
  const rawMessage = `${headers.join("\r\n")}\r\n\r\n${options.body}`;
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodeRawMessage(rawMessage),
    },
  });

  return {
    id: sent.data.id ?? "",
    threadId: sent.data.threadId ?? "",
  };
}

export async function replyToMessage(
  auth: OAuth2Client | JWT,
  options: {
    messageId: string;
    body: string;
    replyAll?: boolean;
  },
): Promise<{ id: string; threadId: string }> {
  const gmail = await createGmailClient(auth);
  const original = await getMessage(auth, options.messageId);

  const profile = await gmail.users.getProfile({ userId: "me" });
  const myEmail = profile.data.emailAddress ?? "";

  const to = options.replyAll ? original.to || original.from : original.from;
  const subject = original.subject.startsWith("Re:")
    ? original.subject
    : `Re: ${original.subject}`;

  const headers = buildOutboundHeaders({
    to,
    subject,
    cc: options.replyAll && myEmail ? original.to : undefined,
    inReplyTo: original.messageIdHeader,
    references: [original.references, original.messageIdHeader]
      .filter(Boolean)
      .join(" "),
  });

  const rawMessage = `${headers.join("\r\n")}\r\n\r\n${options.body}`;

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodeRawMessage(rawMessage),
      threadId: original.threadId,
    },
  });

  return {
    id: sent.data.id ?? "",
    threadId: sent.data.threadId ?? original.threadId,
  };
}

export async function moveMessage(
  auth: OAuth2Client | JWT,
  options: {
    messageId: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  },
): Promise<{ id: string; labelIds: string[] }> {
  const gmail = await createGmailClient(auth);
  const response = await gmail.users.messages.modify({
    userId: "me",
    id: options.messageId,
    requestBody: {
      addLabelIds: options.addLabelIds,
      removeLabelIds: options.removeLabelIds,
    },
  });

  return {
    id: response.data.id ?? options.messageId,
    labelIds: response.data.labelIds ?? [],
  };
}

export async function trashMessage(
  auth: OAuth2Client | JWT,
  messageId: string,
): Promise<{ id: string; trashed: boolean }> {
  const gmail = await createGmailClient(auth);
  const response = await gmail.users.messages.trash({
    userId: "me",
    id: messageId,
  });
  return {
    id: response.data.id ?? messageId,
    trashed: true,
  };
}

export async function untrashMessage(
  auth: OAuth2Client | JWT,
  messageId: string,
): Promise<{ id: string; trashed: boolean }> {
  const gmail = await createGmailClient(auth);
  const response = await gmail.users.messages.untrash({
    userId: "me",
    id: messageId,
  });
  return {
    id: response.data.id ?? messageId,
    trashed: false,
  };
}

export async function deleteMessage(
  auth: OAuth2Client | JWT,
  messageId: string,
): Promise<{ id: string; deleted: boolean }> {
  const gmail = await createGmailClient(auth);
  await gmail.users.messages.delete({
    userId: "me",
    id: messageId,
  });
  return {
    id: messageId,
    deleted: true,
  };
}

export async function markMessageRead(
  auth: OAuth2Client | JWT,
  messageId: string,
): Promise<{ id: string; isRead: boolean; labelIds: string[] }> {
  const res = await moveMessage(auth, {
    messageId,
    removeLabelIds: ["UNREAD"],
  });
  return {
    id: res.id,
    isRead: !res.labelIds.includes("UNREAD"),
    labelIds: res.labelIds,
  };
}

export async function markMessageUnread(
  auth: OAuth2Client | JWT,
  messageId: string,
): Promise<{ id: string; isRead: boolean; labelIds: string[] }> {
  const res = await moveMessage(auth, {
    messageId,
    addLabelIds: ["UNREAD"],
  });
  return {
    id: res.id,
    isRead: false,
    labelIds: res.labelIds,
  };
}

export async function listLabels(auth: OAuth2Client | JWT) {
  const gmail = await createGmailClient(auth);
  const response = await gmail.users.labels.list({ userId: "me" });
  return (response.data.labels ?? []).map((label) => ({
    id: label.id ?? "",
    name: label.name ?? "",
    type: label.type ?? "",
  }));
}

export async function createLabel(
  auth: OAuth2Client | JWT,
  options: { name: string },
): Promise<{ id: string; name: string; type: string }> {
  const gmail = await createGmailClient(auth);
  const response = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: options.name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  return {
    id: response.data.id ?? "",
    name: response.data.name ?? options.name,
    type: response.data.type ?? "user",
  };
}

export async function batchModifyMessages(
  auth: OAuth2Client | JWT,
  options: {
    ids: string[];
    addLabelIds?: string[];
    removeLabelIds?: string[];
  },
): Promise<{ ids: string[]; success: boolean }> {
  const gmail = await createGmailClient(auth);
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: options.ids,
      addLabelIds: options.addLabelIds,
      removeLabelIds: options.removeLabelIds,
    },
  });
  return {
    ids: options.ids,
    success: true,
  };
}
