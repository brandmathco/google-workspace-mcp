export interface LinkedInStoredToken {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

export interface LinkedInStoredAccount extends LinkedInStoredToken {
  /** Stable member id from OpenID `sub` claim. */
  memberId: string;
  email: string;
  name?: string;
  label?: string;
  authorizedAt: string;
  updatedAt: string;
}

export interface LinkedInAccountSummary {
  memberId: string;
  email: string;
  name?: string;
  label?: string;
  isDefault: boolean;
  authorizedAt: string;
  updatedAt: string;
  scopes?: string;
}

export interface LinkedInAccountsFileDocument {
  version: 1;
  defaultMemberId?: string;
  accounts: Record<string, LinkedInStoredAccount>;
}

export interface LinkedInAccountStore {
  listAccounts(): Promise<LinkedInAccountSummary[]>;
  getAccount(memberId: string): Promise<LinkedInStoredAccount | null>;
  getAccountByEmail(email: string): Promise<LinkedInStoredAccount | null>;
  getDefaultMemberId(): Promise<string | null>;
  setDefaultMemberId(memberId: string): Promise<void>;
  upsertAccount(account: LinkedInStoredAccount): Promise<void>;
  removeAccount(memberId: string): Promise<boolean>;
}
