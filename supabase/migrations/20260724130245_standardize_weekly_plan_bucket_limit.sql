-- The weekly-plans bucket is shared by every masjid and cohort. Keep its
-- server-enforced limit aligned with the application's documented 3 MB limit.
update storage.buckets
set
  file_size_limit = 3 * 1024 * 1024,
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'application/pdf'
  ]::text[]
where id = 'weekly-plans';
