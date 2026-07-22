import type {
  AccountStore,
  AccountSummary,
  StoredAccount,
} from "./accountTypes.js";
import { decryptSecret, encryptSecret } from "./tokenEncryption.js";

interface SupabaseAccountRow {
  email: string;
  label: string | null;
  refresh_token_encrypted: string;
  access_token: string | null;
  expiry_date: number | null;
  token_type: string | null;
  scope: string | null;
  is_default: boolean;
  authorized_at: string;
  updated_at: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requireSupabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when GOOGLE_ACCOUNTS_STORE=supabase",
    );
  }
  return { url: url.replace(/\/$/, ""), serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey: string, prefer?: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function rowToStoredAccount(row: SupabaseAccountRow): StoredAccount {
  return {
    email: row.email,
    label: row.label ?? undefined,
    refresh_token: decryptSecret(row.refresh_token_encrypted),
    access_token: row.access_token ?? undefined,
    expiry_date: row.expiry_date ?? undefined,
    token_type: row.token_type ?? undefined,
    scope: row.scope ?? undefined,
    authorizedAt: row.authorized_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: SupabaseAccountRow): AccountSummary {
  return {
    email: row.email,
    label: row.label ?? undefined,
    isDefault: row.is_default,
    authorizedAt: row.authorized_at,
    updatedAt: row.updated_at,
    scopes: row.scope ?? undefined,
  };
}

export class SupabaseAccountStore implements AccountStore {
  private readonly url: string;
  private readonly serviceRoleKey: string;
  private readonly table = "google_mcp_oauth_accounts";

  constructor() {
    const config = requireSupabaseConfig();
    this.url = config.url;
    this.serviceRoleKey = config.serviceRoleKey;
  }

  private async fetchRows(query = ""): Promise<SupabaseAccountRow[]> {
    const response = await fetch(
      `${this.url}/rest/v1/${this.table}?${query}`,
      {
        headers: supabaseHeaders(this.serviceRoleKey),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase list failed (${response.status}): ${body}`);
    }

    return (await response.json()) as SupabaseAccountRow[];
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const rows = await this.fetchRows(
      "select=email,label,is_default,authorized_at,updated_at,scope&order=email.asc",
    );
    return rows.map(rowToSummary);
  }

  async getAccount(email: string): Promise<StoredAccount | null> {
    const normalized = normalizeEmail(email);
    const rows = await this.fetchRows(
      `email=eq.${encodeURIComponent(normalized)}&limit=1`,
    );
    const row = rows[0];
    return row ? rowToStoredAccount(row) : null;
  }

  async getDefaultEmail(): Promise<string | null> {
    const rows = await this.fetchRows("is_default=eq.true&limit=1");
    if (rows[0]?.email) {
      return rows[0].email;
    }

    const all = await this.fetchRows("select=email&order=authorized_at.asc&limit=1");
    return all[0]?.email ?? null;
  }

  async setDefaultEmail(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const account = await this.getAccount(normalized);
    if (!account) {
      throw new Error(`Account not found: ${email}`);
    }

    await fetch(`${this.url}/rest/v1/${this.table}?is_default=eq.true`, {
      method: "PATCH",
      headers: supabaseHeaders(this.serviceRoleKey, "return=minimal"),
      body: JSON.stringify({ is_default: false }),
    });

    const response = await fetch(
      `${this.url}/rest/v1/${this.table}?email=eq.${encodeURIComponent(normalized)}`,
      {
        method: "PATCH",
        headers: supabaseHeaders(this.serviceRoleKey, "return=minimal"),
        body: JSON.stringify({ is_default: true, updated_at: new Date().toISOString() }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase set default failed (${response.status}): ${body}`);
    }
  }

  async upsertAccount(account: StoredAccount): Promise<void> {
    if (!account.refresh_token?.trim()) {
      throw new Error("refresh_token is required when saving an account");
    }

    const normalized = normalizeEmail(account.email);
    const now = new Date().toISOString();
    const existingRows = await this.fetchRows(
      `email=eq.${encodeURIComponent(normalized)}&limit=1`,
    );
    const isDefault =
      existingRows[0]?.is_default ??
      (await this.listAccounts()).length === 0;

    const payload = {
      email: normalized,
      label: account.label ?? null,
      refresh_token_encrypted: encryptSecret(account.refresh_token),
      access_token: account.access_token ?? null,
      expiry_date: account.expiry_date ?? null,
      token_type: account.token_type ?? null,
      scope: account.scope ?? null,
      is_default: isDefault,
      authorized_at:
        existingRows[0]?.authorized_at ?? account.authorizedAt ?? now,
      updated_at: now,
    };

    const response = await fetch(
      `${this.url}/rest/v1/${this.table}?on_conflict=email`,
      {
      method: "POST",
      headers: supabaseHeaders(
        this.serviceRoleKey,
        "resolution=merge-duplicates,return=minimal",
      ),
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase upsert failed (${response.status}): ${body}`);
    }
  }

  async removeAccount(email: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    const response = await fetch(
      `${this.url}/rest/v1/${this.table}?email=eq.${encodeURIComponent(normalized)}`,
      {
        method: "DELETE",
        headers: supabaseHeaders(this.serviceRoleKey, "return=representation"),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase delete failed (${response.status}): ${body}`);
    }

    const deleted = (await response.json()) as SupabaseAccountRow[];
    if (deleted.length === 0) {
      return false;
    }

    if (deleted[0]?.is_default) {
      const remaining = await this.fetchRows("select=email&order=authorized_at.asc&limit=1");
      if (remaining[0]?.email) {
        await this.setDefaultEmail(remaining[0].email);
      }
    }

    return true;
  }

  async migrateLegacyIfNeeded(): Promise<void> {
    const { migrateLegacyTokenIntoStore } = await import("./legacyMigration.js");
    await migrateLegacyTokenIntoStore(this);
  }
}
