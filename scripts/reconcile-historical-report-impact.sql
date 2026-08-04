-- Slice 4 reviewer-only impact reconciliation.
--
-- Run only against the disposable clone restored from the verified production
-- backup. This transaction is explicitly read-only and emits identifiers and
-- numeric/reporting evidence only: no names, contact data, notes, or Auth data.
\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;

with recursive
report_weeks as (
  select distinct week_start, masjid_id
  from private.raw_historical_report_week_scopes()
),
effective_memberships as (
  select rw.week_start, m.student_id, m.id as membership_id, m.starts_on,
         m.ends_on, g.id as group_id, c.id as cohort_id, c.masjid_id,
         count(*) over (partition by rw.week_start, m.student_id) as membership_count,
         row_number() over (
           partition by rw.week_start, m.student_id
           order by m.starts_on desc, m.id desc
         ) as membership_precedence
  from report_weeks rw
  join public.student_group_memberships m
    on m.starts_on <= rw.week_start
   and (m.ends_on is null or m.ends_on >= rw.week_start)
  join public.halaqa_groups g on g.id = m.group_id
  join public.cohorts c on c.id = g.cohort_id and c.masjid_id = rw.masjid_id
),
eligible as (
  select em.*
  from effective_memberships em
  join public.profiles p on p.id = em.student_id
  where em.membership_precedence = 1
    and p.score_starts_on is not null
    and p.score_starts_on <= em.week_start
),
score_components as (
  select e.*,
    least(700::numeric, greatest(0::numeric, coalesce(old_ci.points, 0))) as old_daily,
    least(150::numeric, greatest(0::numeric, coalesce(old_pr.points, 0))) as old_partner,
    least(150::numeric, greatest(0::numeric, coalesce(old_hg.points, 0))) as old_halaqa,
    least(700::numeric, greatest(0::numeric, coalesce(new_ci.points, 0))) as corrected_daily,
    least(150::numeric, greatest(0::numeric, coalesce(new_pr.points, 0))) as corrected_partner,
    least(150::numeric, greatest(0::numeric, coalesce(new_hg.points, 0))) as corrected_halaqa
  from eligible e
  left join lateral (
    select sum(coalesce(ci.daily_score, 0))::numeric as points
    from public.checkins ci
    where ci.student_id = e.student_id and ci.date between e.week_start and e.week_start + 6
  ) old_ci on true
  left join lateral (
    select sum(round_points)::numeric as points
    from (
      select pr.round, greatest(0::numeric, least(75::numeric, max(coalesce(pr.points, 0)))) as round_points
      from public.partner_recitations pr
      where pr.student_id = e.student_id and pr.week_start = e.week_start
      group by pr.round
    ) rounds
  ) old_pr on true
  left join lateral (
    select greatest(0::numeric, least(150::numeric,
      coalesce(hg.attendance_points, 0) + coalesce(hg.recitation_points, 0))) as points
    from public.halaqa_grades hg
    where hg.student_id = e.student_id and hg.week_start = e.week_start
    order by hg.id
    limit 1
  ) old_hg on true
  left join lateral (
    select sum(coalesce(ci.daily_score, 0))::numeric as points
    from public.checkins ci
    where ci.student_id = e.student_id and ci.date between e.week_start and e.week_start + 6
      and private.raw_historical_report_activity_is_attributable(
        e.student_id, e.week_start, ci.masjid_id, ci.cohort_id, ci.halaqa_group_id)
  ) new_ci on true
  left join lateral (
    select sum(round_points)::numeric as points
    from (
      select pr.round, greatest(0::numeric, least(75::numeric, max(coalesce(pr.points, 0)))) as round_points
      from public.partner_recitations pr
      where pr.student_id = e.student_id and pr.week_start = e.week_start
        and private.raw_historical_report_activity_is_attributable(
          e.student_id, e.week_start, pr.masjid_id, pr.cohort_id, pr.halaqa_group_id)
      group by pr.round
    ) rounds
  ) new_pr on true
  left join lateral (
    select greatest(0::numeric, least(150::numeric,
      coalesce(hg.attendance_points, 0) + coalesce(hg.recitation_points, 0))) as points
    from public.halaqa_grades hg
    where hg.student_id = e.student_id and hg.week_start = e.week_start
      and private.raw_historical_report_activity_is_attributable(
        e.student_id, e.week_start, hg.masjid_id, hg.cohort_id, hg.halaqa_group_id)
    order by hg.id
    limit 1
  ) new_hg on true
),
scores as (
  select sc.*,
    round(old_daily + old_partner + old_halaqa, 2) as old_total,
    round(corrected_daily + corrected_partner + corrected_halaqa, 2) as corrected_total,
    round((old_daily + old_partner + old_halaqa) / 10, 2) as old_percentage,
    round((corrected_daily + corrected_partner + corrected_halaqa) / 10, 2) as corrected_percentage
  from score_components sc
),
ranked as (
  select s.*,
    row_number() over (partition by week_start, cohort_id order by old_percentage desc, p.name, student_id) as old_rank,
    row_number() over (partition by week_start, cohort_id order by corrected_percentage desc, p.name, student_id) as corrected_rank
  from scores s join public.profiles p on p.id = s.student_id
),
changed as (
  select * from ranked where old_total is distinct from corrected_total
),
changed_enriched as (
  select ch.*,
    prev.old_percentage as prev_old_percentage,
    prev.corrected_percentage as prev_corrected_percentage,
    prev2.old_percentage as prev2_old_percentage,
    prev2.corrected_percentage as prev2_corrected_percentage,
    coalesce((select jsonb_agg(ba.id order by ba.id) from public.badge_awards ba
              where ba.student_id = ch.student_id and ba.week_start = ch.week_start), '[]'::jsonb) as badge_award_ids,
    coalesce((select jsonb_agg(wir.id order by wir.id) from public.weekly_incentive_runs wir
              where wir.week_start = ch.week_start and wir.masjid_id = ch.masjid_id), '[]'::jsonb) as incentive_run_ids,
    ao.id as obligation_id, ao.status as obligation_status
  from changed ch
  left join scores prev on prev.student_id = ch.student_id and prev.week_start = ch.week_start - 7
  left join scores prev2 on prev2.student_id = ch.student_id and prev2.week_start = ch.week_start - 14
  left join public.accountability_obligations ao
    on ao.student_id = ch.student_id and ao.week_start = ch.week_start
),
activity as (
  select 'checkins'::text source_table, ci.id row_id, ci.student_id,
         ci.date report_date, public.week_start_for_date(ci.date) week_start,
         ci.masjid_id stored_masjid_id, ci.cohort_id stored_cohort_id,
         ci.halaqa_group_id stored_group_id, null::text source_round
  from public.checkins ci
  union all
  select 'partner_recitations', pr.id, pr.student_id, pr.week_start, pr.week_start,
         pr.masjid_id, pr.cohort_id, pr.halaqa_group_id, pr.round::text
  from public.partner_recitations pr
  union all
  select 'halaqa_grades', hg.id, hg.student_id, hg.week_start, hg.week_start,
         hg.masjid_id, hg.cohort_id, hg.halaqa_group_id, null::text
  from public.halaqa_grades hg
),
activity_evaluated as (
  select a.*, em.membership_id, em.starts_on membership_starts_on,
         em.ends_on membership_ends_on, em.masjid_id expected_masjid_id,
         em.cohort_id expected_cohort_id, em.group_id expected_group_id,
         coalesce(em.membership_count, 0) membership_count,
         exists (
           select 1 from public.student_group_memberships bm
           join public.halaqa_groups bg on bg.id = bm.group_id
           join public.cohorts bc on bc.id = bg.cohort_id
           where bm.student_id = a.student_id
             and bm.starts_on <= a.report_date
             and (bm.ends_on is null or bm.ends_on >= a.report_date)
             and bc.masjid_id = a.stored_masjid_id and bc.id = a.stored_cohort_id
             and bg.id = a.stored_group_id
         ) as stored_scope_matches_activity_date_membership
  from activity a
  left join lateral (
    select candidates.membership_id, candidates.starts_on, candidates.ends_on,
           candidates.masjid_id, candidates.cohort_id, candidates.group_id,
           candidates.membership_count
    from (
      select m.id membership_id, m.starts_on, m.ends_on,
             c.masjid_id, c.id cohort_id, g.id group_id,
             count(*) over () membership_count
      from public.student_group_memberships m
      join public.halaqa_groups g on g.id = m.group_id
      join public.cohorts c on c.id = g.cohort_id
      where m.student_id = a.student_id
        and m.starts_on <= a.week_start
        and (m.ends_on is null or m.ends_on >= a.week_start)
    ) candidates
    order by candidates.starts_on desc, candidates.membership_id desc
    limit 1
  ) em on true
),
mismatches as (
  select ae.*,
    case
      when membership_count > 1 then 'multiple_membership_ambiguity'
      when expected_group_id is null then 'no_historical_membership'
      when stored_scope_matches_activity_date_membership and report_date <> week_start
        then 'membership_boundary_conflict'
      else 'stored_scope_mismatch'
    end as reason_code,
    case
      when membership_count > 1 then 'excluded_ambiguous_historical_membership'
      when expected_group_id is null then 'excluded_no_historical_membership'
      when stored_masjid_id is null then 'counted_legacy_missing_masjid_by_unambiguous_membership'
      when stored_masjid_id is distinct from expected_masjid_id then 'excluded_cross_masjid_scope_mismatch'
      when stored_cohort_id is distinct from expected_cohort_id
        or stored_group_id is distinct from expected_group_id
        then 'counted_same_masjid_placement_mismatch'
      else 'counted_exact_scope'
    end as scoring_disposition,
    case ae.source_table
      when 'checkins' then coalesce((
        select least(700::numeric, sum(coalesce(ci.daily_score, 0))) <>
               least(700::numeric, sum(coalesce(ci.daily_score, 0)) filter (where ci.id <> ae.row_id))
        from public.checkins ci
        where ci.student_id = ae.student_id and ci.date between ae.week_start and ae.week_start + 6
      ), false)
      when 'partner_recitations' then coalesce((
        select
          (select least(150::numeric, coalesce(sum(round_points), 0)) from (
             select greatest(0::numeric, least(75::numeric, max(coalesce(pr.points, 0)))) round_points
             from public.partner_recitations pr
             where pr.student_id = ae.student_id and pr.week_start = ae.week_start group by pr.round
           ) all_rounds) <>
          (select least(150::numeric, coalesce(sum(round_points), 0)) from (
             select greatest(0::numeric, least(75::numeric, max(coalesce(pr.points, 0)))) round_points
             from public.partner_recitations pr
             where pr.student_id = ae.student_id and pr.week_start = ae.week_start and pr.id <> ae.row_id
             group by pr.round
           ) remaining_rounds)
      ), false)
      when 'halaqa_grades' then coalesce((
        select greatest(0::numeric, least(150::numeric,
          coalesce(hg.attendance_points, 0) + coalesce(hg.recitation_points, 0))) <> 0
        from public.halaqa_grades hg where hg.id = ae.row_id
      ), false)
      else false
    end as excluding_this_row_changes_student_week_score
  from activity_evaluated ae
  where expected_group_id is null
     or stored_masjid_id is distinct from expected_masjid_id
     or stored_cohort_id is distinct from expected_cohort_id
     or stored_group_id is distinct from expected_group_id
),
evidence as (
  select ch.student_id, ch.week_start,
    (select count(*) from mismatches m where m.student_id = ch.student_id and m.week_start = ch.week_start) mismatch_rows,
    (select count(distinct (m.stored_masjid_id, m.stored_cohort_id, m.stored_group_id))
       from mismatches m where m.student_id = ch.student_id and m.week_start = ch.week_start) mismatched_scope_count,
    (select count(*) from activity_evaluated a where a.student_id = ch.student_id and a.week_start = ch.week_start
       and a.stored_masjid_id is not distinct from ch.masjid_id
       and a.stored_cohort_id is not distinct from ch.cohort_id
       and a.stored_group_id is not distinct from ch.group_id) matching_activity_rows,
    (select count(*) from activity_evaluated a where a.student_id = ch.student_id and a.week_start = ch.week_start) total_activity_rows,
    (select jsonb_agg(jsonb_build_object('membership_id', m.id, 'starts_on', m.starts_on,
              'ends_on', m.ends_on, 'group_id', m.group_id) order by m.starts_on, m.id)
       from public.student_group_memberships m
       where m.student_id = ch.student_id
         and daterange(m.starts_on, coalesce(m.ends_on, 'infinity'::date), '[]') &&
             daterange(ch.week_start - 14, ch.week_start + 20, '[]')) adjacent_memberships,
    (select jsonb_agg(jsonb_build_object('plan_id', wp.id, 'week_start', wp.week_start,
              'masjid_id', wp.masjid_id, 'cohort_id', wp.cohort_id, 'group_id', wp.halaqa_group_id)
              order by wp.week_start, wp.id)
       from public.weekly_plans wp where wp.student_id = ch.student_id
         and wp.week_start between ch.week_start - 7 and ch.week_start + 13) weekly_plan_scope,
    (select count(*) from public.super_admin_audit_events sae
       where sae.target_id = ch.student_id
          or sae.before_data @> jsonb_build_object('student_id', ch.student_id)
          or sae.after_data @> jsonb_build_object('student_id', ch.student_id)
          or sae.metadata @> jsonb_build_object('student_id', ch.student_id)) related_audit_event_count
  from changed ch
),
packet as (
  select 'student_week_impact'::text section, ce.student_id::text || ':' || ce.week_start::text record_key,
    jsonb_build_object(
      'student_id', ce.student_id, 'week_start', ce.week_start,
      'historical_masjid_id', ce.masjid_id, 'historical_cohort_id', ce.cohort_id,
      'historical_group_id', ce.group_id, 'membership_id', ce.membership_id,
      'old_daily', ce.old_daily, 'corrected_daily', ce.corrected_daily,
      'daily_delta', ce.corrected_daily - ce.old_daily,
      'old_partner', ce.old_partner, 'corrected_partner', ce.corrected_partner,
      'partner_delta', ce.corrected_partner - ce.old_partner,
      'old_halaqa', ce.old_halaqa, 'corrected_halaqa', ce.corrected_halaqa,
      'halaqa_delta', ce.corrected_halaqa - ce.old_halaqa,
      'old_total', ce.old_total, 'corrected_total', ce.corrected_total,
      'total_delta', ce.corrected_total - ce.old_total,
      'old_percentage', ce.old_percentage, 'corrected_percentage', ce.corrected_percentage,
      'old_status', case when ce.old_percentage >= 70 then 'passing' else 'below_70' end,
      'corrected_status', case when ce.corrected_percentage >= 70 then 'passing' else 'below_70' end,
      'old_accountability_amount_cents', case when ce.old_percentage >= 70 then 0
        else ceil((70 - ce.old_percentage) / 10) * 500 end,
      'corrected_accountability_amount_cents', case when ce.corrected_percentage >= 70 then 0
        else ceil((70 - ce.corrected_percentage) / 10) * 500 end,
      'crosses_70', (ce.old_percentage >= 70) <> (ce.corrected_percentage >= 70),
      'old_badges', greatest(0, floor(ce.old_percentage)::int - 90),
      'corrected_badges', greatest(0, floor(ce.corrected_percentage)::int - 90),
      'badge_outcome_changes', greatest(0, floor(ce.old_percentage)::int - 90) <>
        greatest(0, floor(ce.corrected_percentage)::int - 90),
      'below70_two_week_changes',
        ((ce.old_percentage < 70 and ce.prev_old_percentage < 70) <>
         (ce.corrected_percentage < 70 and ce.prev_corrected_percentage < 70)),
      'passing_three_week_changes',
        ((ce.old_percentage >= 70 and ce.prev_old_percentage >= 70 and ce.prev2_old_percentage >= 70) <>
         (ce.corrected_percentage >= 70 and ce.prev_corrected_percentage >= 70 and ce.prev2_corrected_percentage >= 70)),
      'old_rank', ce.old_rank, 'corrected_rank', ce.corrected_rank,
      'rank_changes', ce.old_rank <> ce.corrected_rank,
      'accountability_obligation_id', ce.obligation_id,
      'accountability_obligation_status', ce.obligation_status,
      'badge_award_ids', ce.badge_award_ids, 'completed_incentive_run_ids', ce.incentive_run_ids,
      'reason_codes', (select coalesce(jsonb_agg(distinct m.reason_code), '[]'::jsonb)
                       from mismatches m where m.student_id = ce.student_id and m.week_start = ce.week_start),
      'evidence_classification', case
        when ev.mismatch_rows = 0 or ev.mismatched_scope_count > 1 then 'ambiguous_requires_stakeholder_review'
        when exists (select 1 from mismatches m where m.student_id = ce.student_id and m.week_start = ce.week_start
                     and m.reason_code in ('no_historical_membership','multiple_membership_ambiguity'))
          then 'ambiguous_requires_stakeholder_review'
        when ev.matching_activity_rows > 0 and ev.matching_activity_rows >= ev.mismatch_rows
          then 'membership_history_trusted_snapshot_wrong'
        when exists (select 1 from mismatches m where m.student_id = ce.student_id and m.week_start = ce.week_start
                     and m.reason_code = 'membership_boundary_conflict')
          then 'both_sources_consistent_after_boundary_interpretation'
        else 'ambiguous_requires_stakeholder_review' end,
      'recommended_treatment', case
        when ev.matching_activity_rows > 0 and ev.matching_activity_rows >= ev.mismatch_rows
          then 'accept_corrected_report_result_preserve_malformed_source_row'
        else 'require_stakeholder_confirmation' end,
      'evidence', jsonb_build_object(
        'mismatch_rows', ev.mismatch_rows, 'matching_activity_rows', ev.matching_activity_rows,
        'total_activity_rows', ev.total_activity_rows, 'adjacent_memberships', ev.adjacent_memberships,
        'weekly_plan_scope_saturday_key_noted_separately', ev.weekly_plan_scope,
        'related_audit_event_count', ev.related_audit_event_count)
    ) record
  from changed_enriched ce join evidence ev using (student_id, week_start)

  union all
  select 'source_row_reconciliation', m.source_table || ':' || m.row_id,
    jsonb_build_object(
      'source_table', m.source_table, 'row_id', m.row_id, 'student_id', m.student_id,
      'date_or_week', m.report_date, 'week_start', m.week_start,
      'stored_masjid_id', m.stored_masjid_id, 'stored_cohort_id', m.stored_cohort_id,
      'stored_group_id', m.stored_group_id, 'expected_masjid_id', m.expected_masjid_id,
      'expected_cohort_id', m.expected_cohort_id, 'expected_group_id', m.expected_group_id,
      'effective_membership_id', m.membership_id, 'membership_starts_on', m.membership_starts_on,
      'membership_ends_on', m.membership_ends_on, 'reason_code', m.reason_code,
      'scoring_disposition', m.scoring_disposition,
      'excluding_this_row_changes_student_week_score', m.excluding_this_row_changes_student_week_score)
  from mismatches m

  union all
  select 'settled_obligation_analysis', ao.id::text,
    jsonb_build_object(
      'obligation_id', ao.id, 'student_id', ao.student_id, 'week_start', ao.week_start,
      'status', ao.status, 'amount_cents', ao.amount_cents,
      'stored_weekly_percentage', ao.weekly_percentage,
      'corrected_weekly_percentage', s.corrected_percentage,
      'stored_masjid_id', ao.masjid_id, 'stored_cohort_id', ao.cohort_id,
      'stored_group_id', ao.halaqa_group_id, 'expected_masjid_id', em.masjid_id,
      'expected_cohort_id', em.cohort_id, 'expected_group_id', em.group_id,
      'historical_membership_exists', em.membership_id is not null,
      'corrected_outcome', case
        when em.membership_id is null then 'eliminate_obligation'
        when s.corrected_percentage >= 70 then 'eliminate_obligation'
        when ao.amount_cents <> ceil((70 - s.corrected_percentage) / 10) * 500 then 'change_amount'
        else 'outcome_unchanged' end,
      'linked_to_changed_score', ch.student_id is not null,
      'created_at', ao.created_at, 'attested_paid_at', ao.attested_paid_at,
      'waived_at', ao.waived_at,
      'reason_code', case when em.membership_id is null then 'settled_no_historical_membership'
                          else 'settled_stored_scope_mismatch' end)
  from public.accountability_obligations ao
  left join lateral (
    select m.id membership_id, g.id group_id, c.id cohort_id, c.masjid_id
    from public.student_group_memberships m
    join public.halaqa_groups g on g.id = m.group_id
    join public.cohorts c on c.id = g.cohort_id
    where m.student_id = ao.student_id
      and m.starts_on <= ao.week_start
      and (m.ends_on is null or m.ends_on >= ao.week_start)
    order by m.starts_on desc, m.id desc
    limit 1
  ) em on true
  left join scores s on s.student_id = ao.student_id and s.week_start = ao.week_start
  left join changed ch on ch.student_id = ao.student_id and ch.week_start = ao.week_start
  where ao.status in ('attested_paid', 'waived')
    and (em.membership_id is null or ao.masjid_id is distinct from em.masjid_id
      or ao.cohort_id is distinct from em.cohort_id or ao.halaqa_group_id is distinct from em.group_id)
),
summary as (
  select jsonb_build_object(
    'changed_student_weeks', (select count(*) from changed),
    'scores_increasing', (select count(*) from changed where corrected_total > old_total),
    'scores_decreasing', (select count(*) from changed where corrected_total < old_total),
    'mismatched_student_weeks_unchanged_by_revised_attribution', (
      select count(*) from (
        select distinct m.student_id, m.week_start from mismatches m
        except
        select ch.student_id, ch.week_start from changed ch
      ) unchanged
    ),
    'below70_to_passing', (select count(*) from changed where old_percentage < 70 and corrected_percentage >= 70),
    'passing_to_below70', (select count(*) from changed where old_percentage >= 70 and corrected_percentage < 70),
    'accountability_threshold_changes', (select count(*) from changed
      where (old_percentage >= 70) <> (corrected_percentage >= 70)),
    'badge_outcome_changes', (select count(*) from changed where greatest(0, floor(old_percentage)::int - 90) <>
      greatest(0, floor(corrected_percentage)::int - 90)),
    'weekly_incentive_outcome_changes', (select count(*) from changed
      where (old_percentage >= 70) <> (corrected_percentage >= 70)
         or greatest(0, floor(old_percentage)::int - 90) <>
            greatest(0, floor(corrected_percentage)::int - 90)),
    'streak_outcome_changes', (select count(*) from changed_enriched
      where (old_percentage < 70 and prev_old_percentage < 70) <>
            (corrected_percentage < 70 and prev_corrected_percentage < 70)
         or (old_percentage >= 70 and prev_old_percentage >= 70 and prev2_old_percentage >= 70) <>
            (corrected_percentage >= 70 and prev_corrected_percentage >= 70
              and prev2_corrected_percentage >= 70)),
    'leaderboard_rank_changes', (select count(*) from changed where old_rank <> corrected_rank),
    'obligations_linked_to_changed_scores', (select count(*) from changed ch join public.accountability_obligations ao
      on ao.student_id = ch.student_id and ao.week_start = ch.week_start),
    'settled_obligations', (select count(*) from packet where section = 'settled_obligation_analysis'),
    'settled_financial_outcomes_that_would_differ', (select count(*) from packet
      where section = 'settled_obligation_analysis'
        and record->>'corrected_outcome' <> 'outcome_unchanged'),
    'ambiguous_student_weeks', (select count(*) from packet where section = 'student_week_impact'
      and record->>'evidence_classification' = 'ambiguous_requires_stakeholder_review'),
    'source_mismatch_counts', (select jsonb_object_agg(source_table, count_rows)
      from (select source_table, count(*) count_rows from mismatches group by source_table) counts)
  ) record
)
select section, record_key, record
from packet
union all
select 'impact_summary', 'summary', record from summary
order by section, record_key;

commit;
