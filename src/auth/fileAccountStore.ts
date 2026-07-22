import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AccountStore,
  AccountSummary,
  AccountsFileDocument,
  StoredAccount,
} from "./accountTypes.js";
import { decryptSecret, encryptSecret } from "./tokenEncryption.js";

function resolveAccountsPath(): string {
  return (
    process.env.GOOGLE_ACCOUNTS_PATH?.trim() ??
    join(homedir(), ".config", "google-workspace-mcp", "accounts.json")
  );
}

function emptyDocument(): AccountsFileDocument {
  return { version: 1, accounts: {} };
}

function readDocument(path: string): AccountsFileDocument {
  if (!existsSync(path)) {
    return emptyDocument();
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as AccountsFileDocument;
    if (parsed.version !== 1 || typeof parsed.accounts !== "object") {
      return emptyDocument();
    }
    return parsed;
  } catch {
    return emptyDocument();
  }
}

function writeDocument(path: string, document: AccountsFileDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(document, null, 2), "utf8");
}

function toSummary(
  account: StoredAccount,
  isDefault: boolean,
): AccountSummary {
  return {
    email: account.email,
    label: account.label,
    isDefault,
    authorizedAt: account.authorizedAt,
    updatedAt: account.updatedAt,
    scopes: account.scope,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class FileAccountStore implements AccountStore {
  private readonly path: string;

  constructor(path = resolveAccountsPath()) {
    this.path = path;
  }

  private load(): AccountsFileDocument {
    return readDocument(this.path);
  }

  private save(document: AccountsFileDocument): void {
    writeDocument(this.path, document);
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const document = this.load();
    const defaultEmail = document.defaultAccountEmail;
    return Object.values(document.accounts)
      .map((account) => toSummary(account, account.email === defaultEmail))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  async getAccount(email: string): Promise<StoredAccount | null> {
    const document = this.load();
    const account = document.accounts[normalizeEmail(email)];
    if (!account) return null;

    return {
      ...account,
      refresh_token: account.refresh_token
        ? decryptSecret(account.refresh_token)
        : undefined,
    };
  }

  async getDefaultEmail(): Promise<string | null> {
    const document = this.load();
    if (document.defaultAccountEmail) {
      return document.defaultAccountEmail;
    }

    const emails = Object.keys(document.accounts);
    return emails[0] ?? null;
  }

  async setDefaultEmail(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const document = this.load();
    if (!document.accounts[normalized]) {
      throw new Error(`Account not found: ${email}`);
    }
    document.defaultAccountEmail = normalized;
    this.save(document);
  }

  async upsertAccount(account: StoredAccount): Promise<void> {
    const normalized = normalizeEmail(account.email);
    const document = this.load();
    const now = new Date().toISOString();

    document.accounts[normalized] = {
      ...account,
      email: normalized,
      refresh_token: account.refresh_token
        ? encryptSecret(account.refresh_token)
        : undefined,
      updatedAt: now,
      authorizedAt: document.accounts[normalized]?.authorizedAt ?? now,
    };

    if (!document.defaultAccountEmail) {
      document.defaultAccountEmail = normalized;
    }

    this.save(document);
  }

  async removeAccount(email: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    const document = this.load();
    if (!document.accounts[normalized]) {
      return false;
    }

    delete document.accounts[normalized];
    if (document.defaultAccountEmail === normalized) {
      document.defaultAccountEmail = Object.keys(document.accounts)[0];
    }
    this.save(document);
    return true;
  }

  async migrateLegacyIfNeeded(): Promise<void> {
    const { migrateLegacyTokenIntoStore } = await import("./legacyMigration.js");
    await migrateLegacyTokenIntoStore(this);
  }
}

export function resolveAccountsFilePath(): string {
  return resolveAccountsPath();
}
