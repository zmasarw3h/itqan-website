-- Remove historical below-70 accountability obligations before the May 31-June 6, 2026 week.
-- The application gate is also constrained to avoid recreating obligations before this week.

delete from public.accountability_obligations
where week_start < date '2026-05-31';
