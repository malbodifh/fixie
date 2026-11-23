-- Asesor de Supabase: índice duplicado en scans y dos llaves foráneas sin índice.
drop index if exists public.scans_project_kind_created_idx;
create index if not exists db_changes_backup_idx on public.db_changes (backup_id);
create index if not exists usage_events_project_idx on public.usage_events (project_id);
