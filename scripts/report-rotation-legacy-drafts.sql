-- Read-only production preflight for the teacher-driven rotation rollout.
-- Run against a production-shaped database copy or production with a
-- read-only role before enabling the Sol wizard. This query does not mutate.

select
  drafts.id as legacy_draft_id,
  drafts.masjid_id,
  masajid.name as masjid_name,
  drafts.cohort_id,
  cohorts.name as cohort_name,
  drafts.week_start,
  drafts.halaqa_saturday,
  drafts.revision_number,
  drafts.state_version,
  drafts.source_state_digest,
  drafts.created_by,
  drafts.updated_by,
  drafts.created_at,
  drafts.updated_at,
  current_version.id as current_published_version_id,
  current_version.version_number as current_published_version_number,
  current_version.published_at as current_published_at
from public.session_roster_drafts as drafts
join public.masajid
  on masajid.id = drafts.masjid_id
join public.cohorts
  on cohorts.id = drafts.cohort_id
left join lateral (
  select versions.id, versions.version_number, versions.published_at
  from public.session_roster_versions as versions
  where versions.cohort_id = drafts.cohort_id
    and versions.week_start = drafts.week_start
  order by versions.version_number desc
  limit 1
) as current_version on true
where drafts.status = 'draft'
  and drafts.wizard_mode = 'legacy'
order by drafts.masjid_id, drafts.cohort_id, drafts.week_start, drafts.revision_number;
