import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.RLS_SUPABASE_URL ?? "";
const anonKey = process.env.RLS_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.RLS_SUPABASE_SERVICE_ROLE_KEY ?? "";
const dbContainer = process.env.RLS_DB_CONTAINER ?? "";
const password = "LocalRls2026!";

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !anonKey || !serviceRoleKey || !dbContainer) {
  throw new Error("Below-70 streak reset tests require local Supabase credentials and RLS_DB_CONTAINER.");
}

type ReadRow = {
  student_id: string;
  active_streak_length: number;
  streak_through_week_start: string;
  latest_reset_id: string | null;
  latest_reset_masjid_id: string | null;
  latest_reset_cohort_id: string | null;
  latest_reset_group_id: string | null;
  latest_reset_effective_through_week_start: string | null;
  latest_reset_previous_streak_length: number | null;
  latest_reset_passed_test_confirmation: boolean | null;
  latest_reset_admin_note: string | null;
  latest_reset_actor_id: string | null;
  latest_reset_created_at: string | null;
};

type ResetResult = {
  status: "reset" | "replayed";
  reset_id: string;
  student_id: string;
  masjid_id: string;
  cohort_id: string;
  halaqa_group_id: string;
  effective_through_week_start: string;
  previous_streak_length: number;
  passed_test_confirmation: boolean;
  admin_note: string | null;
  actor_id: string;
  created_at: string;
  active_streak_length: number;
};

function client(key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

async function signIn(email: string) {
  const signedIn = client(anonKey);
  const { error } = await signedIn.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `sign in ${email}: ${error?.message}`);
  return signedIn;
}

async function requireData<T>(label: string, promise: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await promise;
  assert.equal(error, null, `${label}: ${error?.message ?? "missing data"}`);
  assert.notEqual(data, null, `${label}: missing data`);
  return data as T;
}

async function createUser(service: SupabaseClient, label: string, role: "student" | "admin") {
  const email = `${label}-${randomUUID()}@below70.local`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  assert.equal(error, null, `create ${label}: ${error?.message}`);
  assert.ok(data.user, `create ${label}: missing auth user`);

  await requireData(
    `insert ${label} profile`,
    service.from("profiles").insert({
      id: data.user.id,
      name: label,
      email,
      phone: null,
      role,
      active: true
    }).select("id")
  );

  return { id: data.user.id, email };
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekStartForDate(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  return addDays(date, -value.getUTCDay());
}

function torontoCivilDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function latestCompletedWeekFromEffectiveDate(effectiveDate: string) {
  return addDays(weekStartForDate(effectiveDate), -7);
}

async function runLocalPsql(sql: string) {
  const marker = `below70_sql_complete_${randomUUID()}`;
  const process = spawn(
    "docker",
    ["exec", "-i", dbContainer, "psql", "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", "postgres"],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let output = "";
  let stderr = "";

  const ready = new Promise<void>((resolve, reject) => {
    process.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(marker)) resolve();
    });
    process.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code !== 0) reject(new Error(`local SQL failed: ${stderr || output}`));
    });
  });

  process.stdin.end(`${sql}\n\\echo ${marker}\n`);
  await ready;
}

async function expectDenied(clientToTest: SupabaseClient, args: Record<string, unknown>, label: string) {
  const { data, error } = await clientToTest.rpc("reset_student_below70_streak", args);
  assert.ok(error, `${label} should be denied`);
  assert.equal(data, null, `${label} returned mutation data after denial`);
}

async function readStreak(clientToTest: SupabaseClient, studentId: string, throughWeekStart: string): Promise<ReadRow> {
  const { data, error } = await clientToTest.rpc("get_student_below70_streak", {
    input_student_id: studentId,
    input_through_week_start: throughWeekStart
  });
  assert.equal(error, null, `read streak: ${error?.message}`);
  assert.ok(Array.isArray(data) && data.length === 1, "read streak should return one typed row");
  return data[0] as ReadRow;
}

async function expectBatchDenied(clientToTest: SupabaseClient, studentId: string, throughWeekStart: string, label: string) {
  const { data, error } = await clientToTest.rpc("get_students_below70_streaks", {
    input_student_ids: [studentId],
    input_through_week_start: throughWeekStart
  });
  assert.ok(error, `${label} should be denied`);
  assert.equal(data, null, `${label} returned data after denial`);
}

function assertFullResetMetadata(row: ReadRow, reset: ResetResult, label: string) {
  assert.equal(row.latest_reset_id, reset.reset_id, `${label}: reset id`);
  assert.equal(row.latest_reset_masjid_id, reset.masjid_id, `${label}: masjid id`);
  assert.equal(row.latest_reset_cohort_id, reset.cohort_id, `${label}: cohort id`);
  assert.equal(row.latest_reset_group_id, reset.halaqa_group_id, `${label}: group id`);
  assert.equal(
    row.latest_reset_effective_through_week_start,
    reset.effective_through_week_start,
    `${label}: effective-through week`
  );
  assert.equal(row.latest_reset_previous_streak_length, reset.previous_streak_length, `${label}: previous streak`);
  assert.equal(
    row.latest_reset_passed_test_confirmation,
    reset.passed_test_confirmation,
    `${label}: passed-test confirmation`
  );
  assert.equal(row.latest_reset_admin_note, reset.admin_note, `${label}: admin note`);
  assert.equal(row.latest_reset_actor_id, reset.actor_id, `${label}: actor id`);
  assert.equal(row.latest_reset_created_at, reset.created_at, `${label}: created timestamp`);
}

function assertStudentMinimalProjection(row: ReadRow, studentId: string, throughWeekStart: string) {
  assert.equal(row.student_id, studentId);
  assert.equal(row.streak_through_week_start, throughWeekStart);
  assert.equal(row.latest_reset_id, null, "student read exposed the reset id");
  assert.equal(row.latest_reset_masjid_id, null, "student read exposed the reset masjid");
  assert.equal(row.latest_reset_cohort_id, null, "student read exposed the reset cohort");
  assert.equal(row.latest_reset_group_id, null, "student read exposed the reset group");
  assert.equal(row.latest_reset_effective_through_week_start, null, "student read exposed the reset boundary");
  assert.equal(row.latest_reset_previous_streak_length, null, "student read exposed the previous streak");
  assert.equal(row.latest_reset_passed_test_confirmation, null, "student read exposed test confirmation");
  assert.equal(row.latest_reset_admin_note, null, "student read exposed the admin note");
  assert.equal(row.latest_reset_actor_id, null, "student read exposed the reset actor");
  assert.equal(row.latest_reset_created_at, null, "student read exposed the reset timestamp");
}

async function countResetAudits(service: SupabaseClient, studentId: string) {
  const { data, error } = await service
    .from("super_admin_audit_events")
    .select("id")
    .eq("action", "below70_streak_reset")
    .eq("target_table", "below70_streak_resets")
    .contains("metadata", { student_id: studentId });
  assert.equal(error, null, `audit count: ${error?.message}`);
  return data?.length ?? 0;
}

async function main() {
  const service = client(serviceRoleKey);
  const adminA = await signIn("admina@rls.local");
  const adminB = await signIn("adminb@rls.local");
  const ordinaryTeacher = await signIn("teachera@rls.local");
  const superAdmin = await signIn("superadmin@rls.local");
  const existingStudent = await signIn("studenta@rls.local");
  const anonymous = client(anonKey);
  const inactiveAdmin = await createUser(service, "below70-inactive-admin", "admin");
  await requireData(
    "deactivate batch-read admin",
    service.from("profiles").update({ active: false }).eq("id", inactiveAdmin.id).select("id")
  );
  const inactiveAdminClient = await signIn(inactiveAdmin.email);

  const effectiveDate = await requireData<string>("current effective date", adminA.rpc("current_effective_date"));
  const latestCompletedWeek = latestCompletedWeekFromEffectiveDate(effectiveDate);
  const latestCivilWeek = weekStartForDate(torontoCivilDateString());
  assert.ok(latestCompletedWeek <= latestCivilWeek, "completed boundary must not be after Toronto civil week");

  const masjidA = await requireData<{ id: string }>(
    "load masjid A",
    service.from("masajid").select("id").eq("slug", "rls-masjid-a").single()
  );
  const masjidB = await requireData<{ id: string }>(
    "load masjid B",
    service.from("masajid").select("id").eq("slug", "rls-masjid-b").single()
  );
  const cohortA = await requireData<{ id: string }>(
    "load cohort A",
    service.from("cohorts").select("id").eq("masjid_id", masjidA.id).eq("kind", "brothers").eq("active", true).single()
  );
  const cohortB = await requireData<{ id: string }>(
    "load cohort B",
    service.from("cohorts").select("id").eq("masjid_id", masjidB.id).eq("kind", "brothers").single()
  );
  const groupA = await requireData<{ id: string }>(
    "load group A",
    service.from("halaqa_groups").select("id").eq("cohort_id", cohortA.id).eq("name", "A Group").single()
  );
  const groupB = await requireData<{ id: string }>(
    "load group B",
    service.from("halaqa_groups").select("id").eq("cohort_id", cohortB.id).eq("name", "B Group").single()
  );
  const adminTeacherGroup = await requireData<{ id: string }>(
    "load admin-teacher group",
    service.from("halaqa_groups").select("id").eq("cohort_id", cohortA.id).eq("name", "A Admin Teacher Group").single()
  );

  const adminTeacher = await createUser(service, "below70-admin-teacher", "admin");
  await requireData(
    "insert admin-teacher staff memberships",
    service.from("masjid_staff_memberships").insert([
      {
        profile_id: adminTeacher.id,
        masjid_id: masjidA.id,
        staff_role: "admin",
        active: true,
        starts_on: "2020-01-01"
      },
      {
        profile_id: adminTeacher.id,
        masjid_id: masjidA.id,
        staff_role: "teacher",
        active: true,
        starts_on: "2020-01-01"
      }
    ]).select("id")
  );
  const adminTeacherClient = await signIn(adminTeacher.email);

  const week3 = latestCompletedWeek;
  const week2 = addDays(week3, -7);
  const week1 = addDays(week3, -14);
  const week0 = addDays(week3, -21);
  const membershipStart = addDays(week3, -35);
  const students = {
    exact3: await createUser(service, "below70-exact3", "student"),
    more4: await createUser(service, "below70-more4", "student"),
    zero: await createUser(service, "below70-zero", "student"),
    one: await createUser(service, "below70-one", "student"),
    two: await createUser(service, "below70-two", "student"),
    teacherTarget: await createUser(service, "below70-teacher-target", "student"),
    crossMasjidTarget: await createUser(service, "below70-cross-target", "student"),
    concurrency: await createUser(service, "below70-concurrency", "student"),
    rollback: await createUser(service, "below70-rollback", "student")
  };
  const exactStudentClient = await signIn(students.exact3.email);

  await requireData(
    "insert streak memberships",
    service.from("student_group_memberships").insert([
    ...Object.values(students).map((student) => ({
        student_id: student.id,
        group_id: student.id === students.crossMasjidTarget.id ? groupB.id : groupA.id,
        starts_on: membershipStart
      }))
    ]).select("id")
  );

  await requireData(
    "set score starts",
    Promise.all(([
      [students.exact3, week1],
      [students.more4, week0],
      [students.zero, addDays(week3, 7)],
      [students.one, week3],
      [students.two, week2],
      [students.teacherTarget, week1],
      [students.crossMasjidTarget, week1],
      [students.concurrency, week1],
      [students.rollback, week1]
    ] as Array<[{ id: string }, string]>).map(([student, scoreStartsOn]) =>
      service.from("profiles").update({ score_starts_on: scoreStartsOn }).eq("id", student.id).select("id")
    )).then((responses) => {
      const error = responses.find((response) => response.error)?.error;
      return { data: responses.map((response) => response.data).flat(), error: error ? { message: error.message } : null };
    })
  );

  await requireData(
    "insert dashboard week evidence",
    service.from("checkins").insert({
      student_id: students.exact3.id,
      date: week3,
      completed: true,
      earned_weight: 0,
      total_weight: 100,
      daily_score: 0
    }).select("id").single()
  );

  const sentinelRecitation = await requireData<{ id: string }>(
    "insert immutable historical activity",
    service.from("partner_recitations").insert({
      student_id: students.exact3.id,
      week_start: week1,
      round: "round_1",
      points: 75
    }).select("id").single()
  );
  const sentinelBefore = await requireData<{ id: string; points: number }>(
    "read historical activity before reset",
    service.from("partner_recitations").select("id,points").eq("id", sentinelRecitation.id).single()
  );

  const baseArgs = {
    input_student_id: students.exact3.id,
    input_note: "Passed test"
  };
  await expectDenied(adminA, { ...baseArgs, input_request_id: randomUUID(), input_passed_test: false }, "false passed-test confirmation");
  await expectDenied(adminA, { input_request_id: randomUUID(), input_student_id: students.exact3.id, input_note: "Passed test" }, "missing passed-test confirmation");
  await expectDenied(adminA, { ...baseArgs, input_request_id: randomUUID(), input_passed_test: true, input_note: "x".repeat(281) }, "overlong admin note");
  await expectDenied(adminA, { ...baseArgs, input_request_id: randomUUID(), input_passed_test: true, input_note: "bad\nlog" }, "control-character admin note");

  await expectDenied(adminA, {
    input_request_id: randomUUID(),
    input_student_id: students.zero.id,
    input_passed_test: true,
    input_note: "zero"
  }, "zero-week streak");
  await runLocalPsql(`
    do $$
    begin
      if exists (
        select 1
        from public.below70_streak_resets
        where student_id = '${students.zero.id}'::uuid
      ) then
        raise exception using message = 'zero streak created a reset row';
      end if;
    end;
    $$;
  `);
  assert.equal(await countResetAudits(service, students.zero.id), 0, "zero streak created an audit row");

  const oneReset = await requireData<ResetResult>(
    "reset one-week streak",
    adminA.rpc("reset_student_below70_streak", {
      input_request_id: randomUUID(),
      input_student_id: students.one.id,
      input_passed_test: true,
      input_note: "One week"
    })
  );
  assert.equal(oneReset.status, "reset");
  assert.equal(oneReset.previous_streak_length, 1);
  assert.equal(oneReset.effective_through_week_start, latestCompletedWeek);
  assert.equal(oneReset.passed_test_confirmation, true);
  assert.equal(oneReset.active_streak_length, 0);
  assertFullResetMetadata(await readStreak(adminA, students.one.id, latestCompletedWeek), oneReset, "one-week reset read");

  const twoReset = await requireData<ResetResult>(
    "reset two-week streak",
    adminA.rpc("reset_student_below70_streak", {
      input_request_id: randomUUID(),
      input_student_id: students.two.id,
      input_passed_test: true,
      input_note: "Two weeks"
    })
  );
  assert.equal(twoReset.status, "reset");
  assert.equal(twoReset.previous_streak_length, 2);
  assert.equal(twoReset.effective_through_week_start, latestCompletedWeek);
  assert.equal(twoReset.passed_test_confirmation, true);
  assert.equal(twoReset.active_streak_length, 0);
  assertFullResetMetadata(await readStreak(adminA, students.two.id, latestCompletedWeek), twoReset, "two-week reset read");

  const exactBeforeReset = await readStreak(adminA, students.exact3.id, latestCompletedWeek);
  assert.equal(exactBeforeReset.active_streak_length, 3, "canonical single read lost the pre-reset three-week streak");
  const exactBatchBeforeReset = await adminA.rpc("get_students_below70_streaks", {
    input_student_ids: [students.exact3.id],
    input_through_week_start: latestCompletedWeek
  });
  assert.equal(exactBatchBeforeReset.error, null, `batch read before reset: ${exactBatchBeforeReset.error?.message}`);
  assert.equal((exactBatchBeforeReset.data as ReadRow[])[0]?.active_streak_length, 3, "canonical batch read lost the pre-reset streak");
  const dashboardBeforeReset = await requireData<{ rows: Array<{ student_id: string; below70_streak: number }> }>(
    "dashboard streak before reset",
    adminA.rpc("admin_dashboard_leaderboard_for_week", {
      input_selected_week_start: latestCompletedWeek,
      input_below70_only: false
    })
  );
  const dashboardExactBeforeReset = dashboardBeforeReset.rows.find((row) => row.student_id === students.exact3.id);
  assert.equal(dashboardExactBeforeReset?.below70_streak, 3, "dashboard batch path lost the pre-reset streak");

  const exactRequestId = randomUUID();
  const exactReset = await requireData<ResetResult>(
    "reset exact three-week streak",
    adminA.rpc("reset_student_below70_streak", {
      ...baseArgs,
      input_request_id: exactRequestId,
      input_passed_test: true
    })
  );
  assert.equal(exactReset.status, "reset");
  assert.equal(exactReset.previous_streak_length, 3);
  assert.equal(exactReset.effective_through_week_start, latestCompletedWeek);
  assert.equal(exactReset.passed_test_confirmation, true);
  assert.equal(exactReset.admin_note, "Passed test");
  assert.equal(exactReset.active_streak_length, 0);

  const exactRead = await readStreak(adminA, students.exact3.id, latestCompletedWeek);
  assert.equal(exactRead.active_streak_length, 0);
  assert.equal(exactRead.latest_reset_id, exactReset.reset_id);
  assert.equal(exactRead.latest_reset_previous_streak_length, 3);
  assert.equal(exactRead.latest_reset_passed_test_confirmation, true);
  assert.equal(exactRead.latest_reset_admin_note, "Passed test");
  assertFullResetMetadata(exactRead, exactReset, "scoped admin single read");
  const exactBatchAfterReset = await adminA.rpc("get_students_below70_streaks", {
    input_student_ids: [students.exact3.id],
    input_through_week_start: latestCompletedWeek
  });
  assert.equal(exactBatchAfterReset.error, null, `batch read after reset: ${exactBatchAfterReset.error?.message}`);
  assert.equal((exactBatchAfterReset.data as ReadRow[])[0]?.active_streak_length, 0, "canonical batch read ignored the reset boundary");
  const dashboardAfterReset = await requireData<{ rows: Array<{ student_id: string; below70_streak: number }> }>(
    "dashboard streak after reset",
    adminA.rpc("admin_dashboard_leaderboard_for_week", {
      input_selected_week_start: latestCompletedWeek,
      input_below70_only: false
    })
  );
  const dashboardExactAfterReset = dashboardAfterReset.rows.find((row) => row.student_id === students.exact3.id);
  assert.equal(dashboardExactAfterReset?.below70_streak, 0, "dashboard batch path ignored the reset boundary");
  const ownRead = await readStreak(exactStudentClient, students.exact3.id, latestCompletedWeek);
  assert.equal(ownRead.active_streak_length, 0);
  assertStudentMinimalProjection(ownRead, students.exact3.id, latestCompletedWeek);
  await expectBatchDenied(exactStudentClient, students.exact3.id, latestCompletedWeek, "student batch read");
  await expectBatchDenied(ordinaryTeacher, students.exact3.id, latestCompletedWeek, "ordinary teacher batch read");
  await expectBatchDenied(inactiveAdminClient, students.exact3.id, latestCompletedWeek, "inactive admin batch read");
  await expectBatchDenied(anonymous, students.exact3.id, latestCompletedWeek, "anonymous batch read");
  const batchRead = await adminA.rpc("get_students_below70_streaks", {
    input_student_ids: [students.exact3.id, students.more4.id],
    input_through_week_start: latestCompletedWeek
  });
  assert.equal(batchRead.error, null, `batch read: ${batchRead.error?.message}`);
  assert.ok(Array.isArray(batchRead.data), "scoped batch read did not return rows");
  assert.equal((batchRead.data as ReadRow[]).length, 2, "scoped batch read omitted an authorized student");
  const adminBatchExactRead = (batchRead.data as ReadRow[]).find((row) => row.student_id === students.exact3.id);
  assert.ok(adminBatchExactRead, "scoped batch read omitted the reset target");
  assertFullResetMetadata(adminBatchExactRead, exactReset, "scoped admin batch read");
  const studentRead = await readStreak(existingStudent, students.exact3.id, latestCompletedWeek).catch((error: Error) => error);
  assert.ok(studentRead instanceof Error, "another student cannot read the reset target");
  const superSingleRead = await readStreak(superAdmin, students.exact3.id, latestCompletedWeek);
  assertFullResetMetadata(superSingleRead, exactReset, "super-admin single read");
  const superBatchRead = await superAdmin.rpc("get_students_below70_streaks", {
    input_student_ids: [students.exact3.id],
    input_through_week_start: latestCompletedWeek
  });
  assert.equal(superBatchRead.error, null, `super-admin batch read: ${superBatchRead.error?.message}`);
  assert.ok(Array.isArray(superBatchRead.data) && superBatchRead.data.length === 1, "super-admin batch read changed shape");
  assertFullResetMetadata(superBatchRead.data[0] as ReadRow, exactReset, "super-admin batch read");
  const crossMasjidBatchForAdminA = await adminA.rpc("get_students_below70_streaks", {
    input_student_ids: [students.crossMasjidTarget.id],
    input_through_week_start: latestCompletedWeek
  });
  assert.equal(crossMasjidBatchForAdminA.error, null, `cross-masjid batch filtering: ${crossMasjidBatchForAdminA.error?.message}`);
  assert.deepEqual(crossMasjidBatchForAdminA.data, [], "normal admin batch read crossed masjid scope");
  const crossMasjidBatchForAdminB = await adminB.rpc("get_students_below70_streaks", {
    input_student_ids: [students.crossMasjidTarget.id],
    input_through_week_start: latestCompletedWeek
  });
  assert.equal(crossMasjidBatchForAdminB.error, null, `in-scope batch read: ${crossMasjidBatchForAdminB.error?.message}`);
  assert.ok(Array.isArray(crossMasjidBatchForAdminB.data) && crossMasjidBatchForAdminB.data.length === 1, "in-scope admin batch read omitted its student");
  const historicalRead = await readStreak(adminA, students.exact3.id, week2);
  assert.equal(historicalRead.latest_reset_id, null, "a reset effective later must not rewrite older history");
  assert.equal(historicalRead.active_streak_length, 2, "older below-70 history remains intact");

  const sentinelAfter = await requireData<{ id: string; points: number }>(
    "read historical activity after reset",
    service.from("partner_recitations").select("id,points").eq("id", sentinelRecitation.id).single()
  );
  assert.deepEqual(sentinelAfter, sentinelBefore, "reset changed historical grade/activity data");
  assert.equal(await countResetAudits(service, students.exact3.id), 1);

  const exactReplay = await requireData<ResetResult>(
    "replay exact request",
    adminA.rpc("reset_student_below70_streak", {
      ...baseArgs,
      input_request_id: exactRequestId,
      input_passed_test: true
    })
  );
  assert.equal(exactReplay.status, "replayed");
  assert.equal(exactReplay.reset_id, exactReset.reset_id);
  assert.equal(await countResetAudits(service, students.exact3.id), 1);

  const moreReset = await requireData<ResetResult>(
    "reset four-week streak",
    adminA.rpc("reset_student_below70_streak", {
      input_request_id: randomUUID(),
      input_student_id: students.more4.id,
      input_passed_test: true,
      input_note: "Four weeks"
    })
  );
  assert.equal(moreReset.previous_streak_length, 4);

  await expectDenied(ordinaryTeacher, {
    input_request_id: randomUUID(),
    input_student_id: students.teacherTarget.id,
    input_passed_test: true
  }, "ordinary teacher");
  await expectDenied(superAdmin, {
    input_request_id: randomUUID(),
    input_student_id: students.teacherTarget.id,
    input_passed_test: true
  }, "super admin");
  await expectDenied(adminB, {
    input_request_id: randomUUID(),
    input_student_id: students.teacherTarget.id,
    input_passed_test: true
  }, "cross-masjid admin");
  await expectDenied(adminA, {
    input_request_id: randomUUID(),
    input_student_id: students.crossMasjidTarget.id,
    input_passed_test: true
  }, "student with conflicting future masjid scope");
  await expectDenied(anonymous, {
    input_request_id: randomUUID(),
    input_student_id: students.teacherTarget.id,
    input_passed_test: true
  }, "anonymous caller");

  const adminTeacherReset = await requireData<ResetResult>(
    "admin-teacher scoped reset",
    adminTeacherClient.rpc("reset_student_below70_streak", {
      input_request_id: randomUUID(),
      input_student_id: students.teacherTarget.id,
      input_passed_test: true
    })
  );
  assert.equal(adminTeacherReset.previous_streak_length, 3);

  const directInsert = await adminA.from("below70_streak_resets").insert({
    student_id: students.concurrency.id,
    masjid_id: masjidA.id,
    cohort_id: cohortA.id,
    halaqa_group_id: groupA.id,
    effective_through_week_start: latestCompletedWeek,
    previous_streak_length: 3,
    passed_test_confirmation: true,
    request_id: randomUUID(),
    actor_id: "00000000-0000-0000-0000-000000000000"
  });
  assert.ok(directInsert.error, "direct reset ledger insert unexpectedly succeeded");
  const directUpdate = await adminA
    .from("below70_streak_resets")
    .update({ admin_note: "forged" })
    .eq("id", exactReset.reset_id);
  assert.ok(directUpdate.error, "direct reset ledger update unexpectedly succeeded");
  const directDelete = await adminA
    .from("below70_streak_resets")
    .delete()
    .eq("id", exactReset.reset_id);
  assert.ok(directDelete.error, "direct reset ledger delete unexpectedly succeeded");

  const concurrentRequests = [randomUUID(), randomUUID()];
  const concurrentResults = await Promise.all(concurrentRequests.map((requestId) => adminA.rpc("reset_student_below70_streak", {
    input_request_id: requestId,
    input_student_id: students.concurrency.id,
    input_passed_test: true,
    input_note: "Concurrent pass"
  })));
  assert.equal(concurrentResults[0].error, null, concurrentResults[0].error?.message);
  assert.equal(concurrentResults[1].error, null, concurrentResults[1].error?.message);
  const concurrentResetIds = concurrentResults.map((result) => (result.data as ResetResult).reset_id);
  assert.equal(new Set(concurrentResetIds).size, 1, "concurrent retries created different reset rows");
  assert.equal(await countResetAudits(service, students.concurrency.id), 1, "concurrent retries created multiple audit rows");

  const rollbackBefore = await readStreak(adminA, students.rollback.id, latestCompletedWeek);
  assert.equal(rollbackBefore.latest_reset_id, null);
  await runLocalPsql(`
    create or replace function public.test_reject_below70_reset_audit()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    begin
      if new.action = 'below70_streak_reset' then
        raise exception using errcode = 'P0001', message = 'forced below-70 audit failure';
      end if;
      return new;
    end;
    $fn$;
    create trigger test_reject_below70_reset_audit_trigger
      before insert on public.super_admin_audit_events
      for each row execute function public.test_reject_below70_reset_audit();
  `);
  try {
    await expectDenied(adminA, {
      input_request_id: randomUUID(),
      input_student_id: students.rollback.id,
      input_passed_test: true
    }, "audit-failure rollback");
  } finally {
    await runLocalPsql(`
      drop trigger if exists test_reject_below70_reset_audit_trigger on public.super_admin_audit_events;
      drop function if exists public.test_reject_below70_reset_audit();
    `);
  }
  const rollbackAfter = await readStreak(adminA, students.rollback.id, latestCompletedWeek);
  assert.equal(rollbackAfter.latest_reset_id, null, "audit failure left a reset row behind");
  assert.equal(await countResetAudits(service, students.rollback.id), 0, "audit failure left an audit row behind");

  const updatedMembershipEnd = addDays(latestCompletedWeek, 6);
  await requireData(
    "close historical membership after reset",
    service.from("student_group_memberships").update({ ends_on: updatedMembershipEnd }).eq("student_id", students.exact3.id).eq("group_id", groupA.id).select("id")
  );
  await requireData(
    "insert post-reset membership",
    service.from("student_group_memberships").insert({
      student_id: students.exact3.id,
      group_id: adminTeacherGroup.id,
      starts_on: addDays(latestCompletedWeek, 7)
    }).select("id")
  );
  const scopePreservedRead = await readStreak(adminA, students.exact3.id, latestCompletedWeek);
  assert.equal(scopePreservedRead.latest_reset_masjid_id, masjidA.id);
  assert.equal(scopePreservedRead.latest_reset_cohort_id, cohortA.id);
  assert.equal(scopePreservedRead.latest_reset_group_id, groupA.id);

  console.log(JSON.stringify({
    below70StreakReset: {
      effective_through_week_start: latestCompletedWeek,
      exact_previous_streak: exactReset.previous_streak_length,
      more_than_three_previous_streak: moreReset.previous_streak_length,
      concurrent_reset_id: concurrentResetIds[0],
      audit_rows_exact_three: await countResetAudits(service, students.exact3.id)
    }
  }));
  console.log("Below-70 streak reset integration suite passed: transactional scope, history, replay, and audit invariants are enforced.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
