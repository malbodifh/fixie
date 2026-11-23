alter table public.scans drop constraint scans_kind_check;
alter table public.scans add constraint scans_kind_check check (kind = any (array['pentest', 'seo', 'lighthouse', 'conversion', 'deps']));
create index if not exists scans_project_kind_created_idx on public.scans (project_id, kind, created_at desc);
