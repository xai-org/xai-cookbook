-- Two private buckets. Users upload source images to their own folder. Only the worker writes videos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('sources', 'sources', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('videos', 'videos', false, 52428800, array['video/mp4'])
on conflict (id) do nothing;

create policy "Users upload source images to their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete their own source images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Reading is also what lets a user create a short-lived signed URL for their own video.
create policy "Users read their own images and videos" on storage.objects
  for select to authenticated
  using (bucket_id in ('sources', 'videos') and (storage.foldername(name))[1] = (select auth.uid())::text);
