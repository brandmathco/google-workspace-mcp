import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  LinkedInAccountStore,
  LinkedInAccountSummary,
  LinkedInAccountsFileDocument,
  LinkedInStoredAccount,
} from "./linkedinAccountTypes.js";
import type { LinkedInTokenResponse } from "./linkedinAuth.js";
import { resolveLinkedInIdentity } from "./linkedinProfile.js";
import { decryptSecret, encryptSecret } from "./tokenEncryption.js";

function resolveLinkedInAccountsPath(): string {
  return (
    process.env.LINKEDIN_ACCOUNTS_PATH?.trim() ??
    join(homedir(), ".config", "google-workspace-mcp", "linkedin-accounts.json")
  );
}

function emptyDocument(): LinkedInAccountsFileDocument {
  return { version: 1, accounts: {} };
}

function readDocument(path: string): LinkedInAccountsFileDocument {
  if (!existsSync(path)) return emptyDocument();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LinkedInAccountsFileDocument;
    if (parsed.version !== 1 || typeof parsed.accounts !== "object") {
      return emptyDocument();
    }
    return parsed;
  } catch {
    return emptyDocument();
  }
}

function writeDocument(path: string, document: LinkedInAccountsFileDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(document, null, 2), "utf8");
}

function toSummary(
  account: LinkedInStoredAccount,
  isDefault: boolean,
): LinkedInAccountSummary {
  return {
    memberId: account.memberId,
    email: account.email,
    name: account.name,
    label: account.label,
    isDefault,
    authorizedAt: account.authorizedAt,
    updatedAt: account.updatedAt,
    scopes: account.scope,
  };
}

let cachedStore: FileLinkedInAccountStore | null = null;

export class FileLinkedInAccountStore implements LinkedInAccountStore {
  private readonly path: string;

  constructor(path = resolveLinkedInAccountsPath()) {
    this.path = path;
  }

  private load(): LinkedInAccountsFileDocument {
    return readDocument(this.path);
  }

  private save(document: LinkedInAccountsFileDocument): void {
    writeDocument(this.path, document);
  }

  async listAccounts(): Promise<LinkedInAccountSummary[]> {
    const document = this.load();
    const defaultMemberId = document.defaultMemberId;
    return Object.values(document.accounts)
      .map((account) => toSummary(account, account.memberId === defaultMemberId))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  async getAccount(memberId: string): Promise<LinkedInStoredAccount | null> {
    const document = this.load();
    const account = document.accounts[memberId.trim()];
    if (!account) return null;
    return {
      ...account,
      refresh_token: account.refresh_token
        ? decryptSecret(account.refresh_token)
        : undefined,
      access_token: account.access_token
        ? decryptSecret(account.access_token)
        : undefined,
    };
  }

  async getAccountByEmail(email: string): Promise<LinkedInStoredAccount | null> {
    const normalized = email.trim().toLowerCase();
    const document = this.load();
    const account = Object.values(document.accounts).find(
      (entry) => entry.email === normalized,
    );
    if (!account) return null;
    return this.getAccount(account.memberId);
  }

  async getDefaultMemberId(): Promise<string | null> {
    const document = this.load();
    if (document.defaultMemberId) return document.defaultMemberId;
    const ids = Object.keys(document.accounts);
    return ids[0] ?? null;
  }

  async setDefaultMemberId(memberId: string): Promise<void> {
    const document = this.load();
    if (!document.accounts[memberId]) {
      throw new Error(`LinkedIn account not found: ${memberId}`);
    }
    document.defaultMemberId = memberId;
    this.save(document);
  }

  async upsertAccount(account: LinkedInStoredAccount): Promise<void> {
    const document = this.load();
    const now = new Date().toISOString();
    document.accounts[account.memberId] = {
      ...account,
      refresh_token: account.refresh_token
        ? encryptSecret(account.refresh_token)
        : undefined,
      access_token: account.access_token
        ? encryptSecret(account.access_token)
        : undefined,
      updatedAt: now,
      authorizedAt: document.accounts[account.memberId]?.authorizedAt ?? now,
    };
    if (!document.defaultMemberId) {
      document.defaultMemberId = account.memberId;
    }
    this.save(document);
  }

  async removeAccount(memberId: string): Promise<boolean> {
    const document = this.load();
    if (!document.accounts[memberId]) return false;
    delete document.accounts[memberId];
    if (document.defaultMemberId === memberId) {
      document.defaultMemberId = Object.keys(document.accounts)[0];
    }
    this.save(document);
    return true;
  }
}

export function getLinkedInAccountStore(): LinkedInAccountStore {
  if (!cachedStore) {
    cachedStore = new FileLinkedInAccountStore();
  }
  return cachedStore;
}

export async function saveAuthorizedLinkedInAccount(
  tokens: LinkedInTokenResponse,
  options?: { label?: string; makeDefault?: boolean },
): Promise<LinkedInStoredAccount> {
  if (!tokens.refresh_token?.trim()) {
    throw new Error(
      "LinkedIn did not return a refresh token. Re-authorize with all rw_ads scopes.",
    );
  }

  const identity = await resolveLinkedInIdentity(tokens);
  const store = getLinkedInAccountStore();
  const existing = await store.getAccount(identity.memberId);
  const now = new Date().toISOString();
  const expiryDate = tokens.expires_in
    ? Date.now() + tokens.expires_in * 1000
    : undefined;

  const account: LinkedInStoredAccount = {
    memberId: identity.memberId,
    email: identity.email,
    name: identity.name,
    label: options?.label?.trim() || existing?.label,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: expiryDate,
    token_type: tokens.token_type,
    scope: tokens.scope,
    authorizedAt: existing?.authorizedAt ?? now,
    updatedAt: now,
  };

  await store.upsertAccount(account);

  if (options?.makeDefault ?? !(await store.getDefaultMemberId())) {
    await store.setDefaultMemberId(identity.memberId);
  }

  return account;
}
