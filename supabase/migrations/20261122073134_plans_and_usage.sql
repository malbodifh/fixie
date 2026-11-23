alter table public.users
  add column if not exists plan text not null default 'free' check (plan in ('free', 'pro', 'max', 'enterprise')),
  add column if not exists plan_started_at timestamptz;

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  kind text not null,
  incident integer,
  critical boolean not null default false,
  model text not null,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_created on public.usage_events (user_id, created_at);
alter table public.usage_events enable row level security;
