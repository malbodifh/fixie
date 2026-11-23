-- Cerrar sesión invalida todas las cookies emitidas antes (también una robada).
alter table public.users add column if not exists session_version integer not null default 0;
