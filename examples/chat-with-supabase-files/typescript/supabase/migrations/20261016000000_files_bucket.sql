-- A private bucket for each user's documents. Objects live at "<user id>/<file name>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false,
  52428800, -- 50 MiB, the Files API's upload limit, so the upload fallback takes anything the bucket does
  array['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json'])
on conflict (id) do nothing;

-- storage.objects already has RLS on. A user sees, adds, and removes only objects in their own folder.
-- Signing a URL needs SELECT: Storage looks the object up as the caller before it signs anything.
create policy "Users read files in their own folder" on storage.objects for select to authenticated
using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload files to their own folder" on storage.objects for insert to authenticated
with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete files in their own folder" on storage.objects for delete to authenticated
using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No UPDATE policy: files are replaced by deleting and uploading again, so upsert is off.
