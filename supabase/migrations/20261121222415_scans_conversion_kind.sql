alter table public.scans drop constraint scans_kind_check;
alter table public.scans add constraint scans_kind_check check (kind = any (array['pentest', 'seo', 'lighthouse', 'conversion']));
