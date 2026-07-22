import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function resolveEncryptionKey(): Buffer | null {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  return Buffer.from(raw, "utf8").subarray(0, 32);
}

export function encryptionRequired(): boolean {
  return process.env.GOOGLE_ACCOUNTS_STORE?.trim().toLowerCase() === "supabase";
}

export function encryptSecret(plaintext: string): string {
  const key = resolveEncryptionKey();
  if (!key || key.length < 32) {
    if (encryptionRequired()) {
      throw new Error(
        "GOOGLE_TOKEN_ENCRYPTION_KEY (64-char hex or 32+ byte secret) is required when GOOGLE_ACCOUNTS_STORE=supabase",
      );
    }
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key.subarray(0, 32), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  if (!value.startsWith("enc:v1:")) {
    return value;
  }

  const key = resolveEncryptionKey();
  if (!key || key.length < 32) {
    throw new Error(
      "Encrypted token found but GOOGLE_TOKEN_ENCRYPTION_KEY is missing or invalid",
    );
  }

  const parts = value.split(":");
  if (parts.length !== 5) {
    throw new Error("Invalid encrypted token format");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const encrypted = Buffer.from(parts[4], "base64url");
  const decipher = createDecipheriv(ALGORITHM, key.subarray(0, 32), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
