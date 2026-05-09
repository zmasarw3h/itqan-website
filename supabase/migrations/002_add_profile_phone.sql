-- Add optional display-only phone numbers for student/admin profiles.
-- Email remains required and is still used for authentication.

alter table public.profiles
  add column if not exists phone text null;
