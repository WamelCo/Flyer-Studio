-- ── Storage ──────────────────────────────────────────────────────────────────
-- flyers:  generated art, uploads and thumbnails. Public-read (paths are random UUIDs
--          under the owner's folder) so Konva can load them with CORS for export.
-- exports: finished PNG/PDF files. Private; served through short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('flyers', 'flyers', true, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('exports', 'exports', false, 52428800, array['image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "Users upload into their own flyer folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users read their own flyer files"
  on storage.objects for select to authenticated
  using (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users replace their own flyer files"
  on storage.objects for update to authenticated
  using (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own flyer files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Exports are written through server-issued signed upload URLs; users may only read.
create policy "Users read their own exports"
  on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
