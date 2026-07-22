-- Multi-account OAuth refresh token storage for google-workspace-mcp (Fly / shared backend).
-- Apply with: supabase db push (from a linked project) or SQL editor.
-- Access: service role only — never expose refresh tokens to browsers.

CREATE TABLE IF NOT EXISTS public.google_mcp_oauth_accounts (
  email text PRIMARY KEY,
  label text,
  refresh_token_encrypted text NOT NULL,
  access_token text,
  expiry_date bigint,
  token_type text,
  scope text,
  is_default boolean NOT NULL DEFAULT false,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_mcp_oauth_accounts_default_idx
  ON public.google_mcp_oauth_accounts (is_default)
  WHERE is_default = true;

ALTER TABLE public.google_mcp_oauth_accounts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_mcp_oauth_accounts TO service_role;

-- No policies: only service_role (bypasses RLS) may read/write.

COMMENT ON TABLE public.google_mcp_oauth_accounts IS
  'Encrypted Google OAuth refresh tokens for google-workspace-mcp multi-account mode';
