import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";

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

  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${original.messageIdHeader ?? ""}`,
    `References: ${[original.references, original.messageIdHeader].filter(Boolean).join(" ")}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];

  if (options.replyAll && myEmail) {
    headers.splice(1, 0, `Cc: ${original.to}`);
  }

  const rawMessage = `${headers.join("\r\n")}\r\n\r\n${options.body}`;
  const encoded = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
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

export async function listLabels(auth: OAuth2Client | JWT) {
  const gmail = await createGmailClient(auth);
  const response = await gmail.users.labels.list({ userId: "me" });
  return (response.data.labels ?? []).map((label) => ({
    id: label.id ?? "",
    name: label.name ?? "",
    type: label.type ?? "",
  }));
}
