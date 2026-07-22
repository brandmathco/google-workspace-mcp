import type { StoredToken } from "./googleAuth.js";

export interface StoredAccount extends StoredToken {
  email: string;
  label?: string;
  authorizedAt: string;
  updatedAt: string;
}

export interface AccountSummary {
  email: string;
  label?: string;
  isDefault: boolean;
  authorizedAt: string;
  updatedAt: string;
  scopes?: string;
}

export interface AccountStore {
  listAccounts(): Promise<AccountSummary[]>;
  getAccount(email: string): Promise<StoredAccount | null>;
  getDefaultEmail(): Promise<string | null>;
  setDefaultEmail(email: string): Promise<void>;
  upsertAccount(account: StoredAccount): Promise<void>;
  removeAccount(email: string): Promise<boolean>;
  migrateLegacyIfNeeded(): Promise<void>;
}

export interface AccountsFileDocument {
  version: 1;
  defaultAccountEmail?: string;
  accounts: Record<string, StoredAccount>;
}
