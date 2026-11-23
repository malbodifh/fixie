-- Usuarios (login con GitHub). El token de GitHub va cifrado (AES-256-GCM) desde el servidor.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null unique,
  login text not null,
  name text,
  avatar_url text,
  github_token_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Proyectos: cada uno vincula un repo, la URL de producción y opcionalmente una base de datos.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  repo text not null check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  app_url text check (app_url is null or app_url ~ '^https?://'),
  ingest_key_hash text not null unique,
  ingest_key_hint text not null,
  db_url_enc text,
  db_label text,
  auto_merge boolean not null default true,
  created_at timestamptz not null default now()
);
create index projects_owner_idx on public.projects(owner_id);

-- Respaldos de la base de datos del cliente (semanales y antes de cada cambio).
create table public.db_backups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reason text not null check (reason in ('semanal', 'antes_de_cambio', 'manual')),
  incident integer,
  storage_path text not null,
  tables integer not null default 0,
  rows bigint not null default 0,
  bytes bigint not null default 0,
  created_at timestamptz not null default now()
);
create index db_backups_project_idx on public.db_backups(project_id, created_at desc);

-- Cambios de estructura propuestos por la IA (solo aditivos, nunca datos).
create table public.db_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  incident integer not null,
  sql text not null,
  reason text not null,
  status text not null check (status in ('probado', 'aplicado', 'rechazado', 'requiere_humano')),
  backup_id uuid references public.db_backups(id),
  error text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index db_changes_project_idx on public.db_changes(project_id, incident);

-- Solo el servidor (clave secreta) accede. Sin políticas: anon y authenticated no ven nada.
alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.db_backups enable row level security;
alter table public.db_changes enable row level security;

-- Bucket privado para los respaldos.
insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
on conflict (id) do nothing;
