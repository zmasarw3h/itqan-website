-- Version the canonical weighted checklist without rewriting historical snapshots.
--
-- The 2026-08-09 version applies to the entire Sunday-start tracker week. It
-- keeps Sunday-Wednesday and Saturday unchanged, removes Tafsir from Thursday
-- and Friday, and reallocates those 10 points to each day's existing new-
-- memorization task. Existing checkin_items rows remain the historical label
-- and weight snapshots used by reports and exports.

create or replace function private.checkin_task_definition(
  input_date date,
  input_task_key text default null
)
returns table (task_key text, task_label text, weight integer)
language sql
immutable
set search_path = ''
as $$
  with versioned_definitions(effective_from, task_key, task_label, weight, weekdays) as (
    values
      -- Legacy definition, effective before Sunday 2026-08-09.
      (date '-infinity', 'new_memorization_listening', 'New memorization & Listening', 20, array[0,1,2,3]::integer[]),
      (date '-infinity', 'repeat_new_memorization_3x_listen_1x', 'Repeat new memorization 3 times & listen one time', 20, array[4]::integer[]),
      (date '-infinity', 'repeat_new_memorization_5x_listen_1x', 'Repeat new memorization 5 times & listen one time', 20, array[5]::integer[]),
      (date '-infinity', 'revise_old', 'Revise old', 40, array[0,1,2,3,4,5]::integer[]),
      (date '-infinity', 'revise_new', 'Revise new', 20, array[0,1,2,3,4,5]::integer[]),
      (date '-infinity', 'tafsir', 'Tafsir', 10, array[0,1,2,3,4,5]::integer[]),
      (date '-infinity', 'recite_next_week_memorization', 'Recite next week memorization', 5, array[0,1,2,3,4,5]::integer[]),
      (date '-infinity', 'read_during_salat', 'Read during Salat', 5, array[0,1,2,3,4,5]::integer[]),
      (date '-infinity', 'tafsir_reflection_group', 'Tafsir and sharing reflection on the group', 50, array[6]::integer[]),
      (date '-infinity', 'repeat_week_memorization_2x', 'Repeat the memorization of the week 2 times', 50, array[6]::integer[]),

      -- Version effective at the canonical Sunday tracker-week start.
      (date '2026-08-09', 'new_memorization_listening', 'New memorization & Listening', 20, array[0,1,2,3]::integer[]),
      (date '2026-08-09', 'repeat_new_memorization_3x_listen_1x', 'Repeat new memorization 3 times & listen one time', 30, array[4]::integer[]),
      (date '2026-08-09', 'repeat_new_memorization_5x_listen_1x', 'Repeat new memorization 5 times & listen one time', 30, array[5]::integer[]),
      (date '2026-08-09', 'revise_old', 'Revise old', 40, array[0,1,2,3,4,5]::integer[]),
      (date '2026-08-09', 'revise_new', 'Revise new', 20, array[0,1,2,3,4,5]::integer[]),
      (date '2026-08-09', 'tafsir', 'Tafsir', 10, array[0,1,2,3]::integer[]),
      (date '2026-08-09', 'recite_next_week_memorization', 'Recite next week memorization', 5, array[0,1,2,3,4,5]::integer[]),
      (date '2026-08-09', 'read_during_salat', 'Read during Salat', 5, array[0,1,2,3,4,5]::integer[]),
      (date '2026-08-09', 'tafsir_reflection_group', 'Tafsir and sharing reflection on the group', 50, array[6]::integer[]),
      (date '2026-08-09', 'repeat_week_memorization_2x', 'Repeat the memorization of the week 2 times', 50, array[6]::integer[])
  ),
  active_version as (
    select max(definitions.effective_from) as effective_from
    from versioned_definitions as definitions
    where definitions.effective_from <= input_date
  )
  select definitions.task_key, definitions.task_label, definitions.weight
  from versioned_definitions as definitions
  join active_version
    on active_version.effective_from = definitions.effective_from
  where extract(dow from input_date)::integer = any(definitions.weekdays)
    and (input_task_key is null or definitions.task_key = input_task_key);
$$;

revoke all on function private.checkin_task_definition(date, text)
  from public, anon, authenticated, service_role;
