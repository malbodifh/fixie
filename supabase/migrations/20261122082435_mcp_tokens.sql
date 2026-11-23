alter table public.users
  add column if not exists mcp_token_hash text unique,
  add column if not exists mcp_token_hint text,
  add column if not exists mcp_token_created_at timestamptz;
