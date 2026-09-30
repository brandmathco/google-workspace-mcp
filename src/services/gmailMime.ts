export type ComposeEmailInput = {
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  cc?: string;
  bcc?: string;
};

export function encodeRawMessage(rawMessage: string): string {
  return Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function headerLines(input: ComposeEmailInput): string[] {
  const headers = [
    `To: ${input.to.trim()}`,
    `Subject: ${input.subject.trim()}`,
    "MIME-Version: 1.0",
  ];
  if (input.cc?.trim()) {
    headers.splice(1, 0, `Cc: ${input.cc.trim()}`);
  }
  if (input.bcc?.trim()) {
    headers.splice(1, 0, `Bcc: ${input.bcc.trim()}`);
  }
  return headers;
}

/**
 * Builds an RFC 822 message. Uses multipart/alternative when htmlBody is set.
 */
export function buildRawEmail(input: ComposeEmailInput): string {
  const headers = headerLines(input);
  const html = input.htmlBody?.trim();
  if (!html) {
    headers.push("Content-Type: text/plain; charset=utf-8");
    return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
  }

  const boundary = `bmcg-alt-${Date.now().toString(16)}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    `--${boundary}--`,
    "",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}
