-- Resultados de los análisis: pentesting, SEO y Lighthouse.
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('pentest', 'seo', 'lighthouse')),
  status text not null check (status in ('ok', 'error', 'needs_public_url')),
  score integer check (score between 0 and 100),
  summary text not null default '',
  findings jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index scans_project_kind_idx on public.scans(project_id, kind, created_at desc);
alter table public.scans enable row level security;

-- Verificación de dueño (para pruebas activas del pentesting).
alter table public.projects add column verified_at timestamptz;
