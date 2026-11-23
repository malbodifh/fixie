alter table public.scans drop constraint scans_kind_check;
alter table public.scans add constraint scans_kind_check check (kind = any (array['pentest','seo','lighthouse','conversion','deps','errors','pentest_deep']));
alter table public.scans drop constraint scans_status_check;
alter table public.scans add constraint scans_status_check check (status = any (array['ok','error','needs_public_url','running','needs_setup']));
