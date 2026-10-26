-- One row each time the app hands a file to Grok. Append-only, and each user sees only their own.
create table public.file_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  object_name text not null,                 -- path inside the files bucket: "<user id>/<file>"
  mode text not null check (mode in ('signed_url', 'upload')),
  url_expires_at timestamptz,                -- when the signed URL stops working; null for uploads
  question text not null check (char_length(question) <= 2000),
  created_at timestamptz not null default now(),
  constraint file_reads_own_folder check (split_part(object_name, '/', 1) = user_id::text)
);
create index file_reads_user_id_created_at_idx on public.file_reads (user_id, created_at desc);
alter table public.file_reads enable row level security;
create policy "Users see their own reads" on public.file_reads for select to authenticated
using (user_id = (select auth.uid()));
create policy "Users record their own reads" on public.file_reads for insert to authenticated
with check (user_id = (select auth.uid()));
-- Default privileges give the API roles everything on a new table, so take it all back and grant only what
-- the app needs. Nobody can update or delete a read.
revoke all on table public.file_reads from anon, authenticated, public;
grant select, insert on table public.file_reads to authenticated;
