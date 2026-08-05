import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { calculateDailySubmission, tasksForDate } from "../lib/scoring";

const url = process.env.RLS_SUPABASE_URL ?? "";
const anonKey = process.env.RLS_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.RLS_SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = "LocalRls2026!";

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  throw new Error(`RLS_SUPABASE_URL must be local; received ${url || "missing"}.`);
}

if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing local Supabase anon or service-role credentials.");
}

type UserName =
  | "superAdmin"
  | "adminA"
  | "adminB"
  | "teacherA"
  | "teacherB"
  | "saturdayStartTeacher"
  | "fridayOnlyTeacher"
  | "expiredTeacher"
  | "futureTeacher"
  | "inactiveTeacher"
  | "expiredAssignmentTeacher"
  | "futureAssignmentTeacher"
  | "studentA"
  | "studentA2"
  | "studentWriter"
  | "studentNoMembership"
  | "sentinelStudent"
  | "expiredMembershipStudent"
  | "futureMembershipStudent"
  | "studentB"
  | "setupStudent"
  | "setupTeacher"
  | "setupCrossMasjid"
  | "staffGrantTarget"
  | "teacherAccessTarget"
  | "expiredAdmin"
  | "futureAdmin"
  | "inactiveAdmin"
  | "profileTarget";

type SeedIds = {
  users: Record<UserName, string>;
  masjidA: string;
  masjidB: string;
  cohortA: string;
  cohortB: string;
  cohortWriter: string;
  inactiveMasjid: string;
  inactiveMasjidCohort: string;
  inactiveMasjidGroup: string;
  inactiveCohort: string;
  inactiveCohortGroup: string;
  inactiveGroup: string;
  groupA: string;
  groupB: string;
  groupAdminTeacher: string;
  groupFridayOnly: string;
  groupWriter: string;
  civilToday: string;
  today: string;
  weekStart: string;
  startsOn: string;
  previousWeekStart: string;
  checkinA: string;
  checkinA2: string;
  checkinB: string;
  itemA: string;
  itemA2: string;
  itemB: string;
  planA: string;
  planA2: string;
  planB: string;
  historicalPlanA: string;
  partnerA: string;
  partnerA2: string;
  partnerB: string;
  gradeA: string;
  gradeA2: string;
  gradeB: string;
  historicalGradeA: string;
  oldCheckinA: string;
  oldPlanA: string;
  oldPartnerA: string;
  oldGradeA: string;
  incentiveA: string;
  incentiveB: string;
  obligationA: string;
  obligationB: string;
  badgeA: string;
  badgeB: string;
  studentMembershipA: string;
  studentMembershipB: string;
  inactiveHistoricalMembershipA: string;
  expiredStudentMembership: string;
  futureStudentMembership: string;
  staffMembershipA: string;
  staffMembershipB: string;
  assignmentA: string;
  assignmentAdminTeacher: string;
  assignmentB: string;
  assignmentFridayOnly: string;
  assignmentWriter: string;
  expiredTeacherAssignment: string;
  futureTeacherAssignment: string;
  availabilityA: string;
  availabilityB: string;
  settingA: string;
  settingB: string;
  rotationRunA: string;
  rotationRunB: string;
  auditId: string;
};

function torontoCivilDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function checkInEffectiveDateString() {
  const civilDate = torontoCivilDateString();
  const hour = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(new Date())
    .find((part) => part.type === "hour")?.value;

  if (!hour) {
    throw new Error("Unable to determine the Toronto hour.");
  }

  return Number(hour) < 1 ? addDays(civilDate, -1) : civilDate;
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

function localClient(key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function startLocalPsqlTransaction(sql: string, readyMarker: string) {
  const dbContainer = process.env.RLS_DB_CONTAINER;
  if (!dbContainer) {
    throw new Error("Missing RLS_DB_CONTAINER for the rotation publication transaction race test.");
  }

  const writer = spawn(
    "docker",
    ["exec", "-i", dbContainer, "psql", "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", "postgres"],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let output = "";
  let stderr = "";
  let readySettled = false;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((reason: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const completion = new Promise<void>((resolve, reject) => {
    writer.on("error", reject);
    writer.on("close", (code) => {
      if (!readySettled) {
        readySettled = true;
        rejectReady?.(new Error(`transaction writer exited before ${readyMarker}: ${stderr || output}`));
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`transaction writer failed with exit code ${code}: ${stderr || output}`));
      }
    });
  });

  writer.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (!readySettled && output.includes(readyMarker)) {
      readySettled = true;
      resolveReady?.();
    }
  });
  writer.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  writer.stdin.end(sql);

  return { ready, completion };
}

async function requireData<T>(label: string, promise: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await promise;
  assert.equal(error, null, `${label}: ${error?.message ?? "missing data"}`);
  assert.notEqual(data, null, `${label}: missing data`);
  return data as T;
}

async function createAuthUser(admin: SupabaseClient, name: UserName) {
  const email = `${name.toLowerCase()}@rls.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  assert.equal(error, null, `create ${name}: ${error?.message}`);
  assert.ok(data.user, `create ${name}: missing user`);
  return { id: data.user.id, email };
}

async function signIn(name: UserName) {
  const client = localClient(anonKey);
  const { error } = await client.auth.signInWithPassword({
    email: `${name.toLowerCase()}@rls.local`,
    password
  });
  assert.equal(error, null, `sign in ${name}: ${error?.message}`);
  return client;
}

async function seed(): Promise<SeedIds> {
  const admin = localClient(serviceRoleKey);
  const names: UserName[] = [
    "superAdmin",
    "adminA",
    "adminB",
    "teacherA",
    "teacherB",
    "saturdayStartTeacher",
    "fridayOnlyTeacher",
    "expiredTeacher",
    "futureTeacher",
    "inactiveTeacher",
    "expiredAssignmentTeacher",
    "futureAssignmentTeacher",
    "studentA",
    "studentA2",
    "studentWriter",
    "studentNoMembership",
    "sentinelStudent",
    "expiredMembershipStudent",
    "futureMembershipStudent",
    "studentB",
    "setupStudent",
    "setupTeacher",
    "setupCrossMasjid",
    "staffGrantTarget",
    "teacherAccessTarget",
    "expiredAdmin",
    "futureAdmin",
    "inactiveAdmin",
    "profileTarget"
  ];
  const users = {} as Record<UserName, string>;
  const authRows = new Map<UserName, { id: string; email: string }>();

  for (const name of names) {
    const authRow = await createAuthUser(admin, name);
    authRows.set(name, authRow);
    users[name] = authRow.id;
  }

  const authOnlyNames = new Set<UserName>([
    "profileTarget",
    "setupStudent",
    "setupTeacher",
    "setupCrossMasjid"
  ]);
  const profileRows = names.filter((name) => !authOnlyNames.has(name)).map((name) => {
    const authRow = authRows.get(name)!;
    const role = name === "superAdmin"
      ? "super_admin"
      : name === "expiredAssignmentTeacher" || name === "futureAssignmentTeacher"
        ? "admin"
      : name.startsWith("admin") || name.endsWith("Admin")
        ? "admin"
        : name.startsWith("teacher") || name.endsWith("Teacher")
          ? "teacher"
          : "student";
    return {
      id: authRow.id,
      name,
      email: authRow.email,
      phone: null,
      role,
      active: name !== "inactiveAdmin"
    };
  });
  await requireData("insert profiles", admin.from("profiles").insert(profileRows).select("id"));

  const masajid = await requireData<Array<{ id: string; slug: string }>>(
    "insert masajid",
    admin.from("masajid").insert([
      { name: "RLS Masjid A", slug: "rls-masjid-a", active: false },
      { name: "RLS Masjid B", slug: "rls-masjid-b", active: false },
      { name: "RLS Inactive Masjid", slug: "rls-inactive-masjid", active: false }
    ]).select("id,slug")
  );
  const masjidA = masajid.find((row) => row.slug === "rls-masjid-a")!.id;
  const masjidB = masajid.find((row) => row.slug === "rls-masjid-b")!.id;
  const inactiveMasjid = masajid.find((row) => row.slug === "rls-inactive-masjid")!.id;

  const cohorts = await requireData<Array<{ id: string; name: string }>>(
    "insert cohorts",
    admin.from("cohorts").insert([
      { masjid_id: masjidA, kind: "brothers", name: "A Brothers", active: true, sort_order: 10 },
      { masjid_id: masjidA, kind: "sisters", name: "A Writer", active: true, sort_order: 20 },
      { masjid_id: masjidB, kind: "brothers", name: "B Brothers", active: true, sort_order: 10 },
      { masjid_id: inactiveMasjid, kind: "brothers", name: "Inactive Masjid Cohort", active: true, sort_order: 10 },
      { masjid_id: masjidA, kind: "brothers", name: "A Inactive Cohort", active: false, sort_order: 30 }
    ]).select("id,name")
  );
  const cohortA = cohorts.find((row) => row.name === "A Brothers")!.id;
  const cohortWriter = cohorts.find((row) => row.name === "A Writer")!.id;
  const cohortB = cohorts.find((row) => row.name === "B Brothers")!.id;
  const inactiveMasjidCohort = cohorts.find((row) => row.name === "Inactive Masjid Cohort")!.id;
  const inactiveCohort = cohorts.find((row) => row.name === "A Inactive Cohort")!.id;

  const groups = await requireData<Array<{ id: string; name: string }>>(
    "insert groups",
    admin.from("halaqa_groups").insert([
      { cohort_id: cohortA, name: "A Group", active: true, sort_order: 10 },
      { cohort_id: cohortA, name: "A Admin Teacher Group", active: true, sort_order: 15 },
      { cohort_id: cohortA, name: "A Friday Only Group", active: true, sort_order: 17 },
      { cohort_id: cohortWriter, name: "A Writer Group", active: true, sort_order: 10 },
      { cohort_id: cohortB, name: "B Group", active: true, sort_order: 10 },
      { cohort_id: inactiveMasjidCohort, name: "Inactive Masjid Group", active: true, sort_order: 10 },
      { cohort_id: inactiveCohort, name: "Inactive Cohort Group", active: true, sort_order: 10 },
      { cohort_id: cohortA, name: "Inactive Group", active: false, sort_order: 20 }
    ]).select("id,name")
  );
  const groupA = groups.find((row) => row.name === "A Group")!.id;
  const groupAdminTeacher = groups.find((row) => row.name === "A Admin Teacher Group")!.id;
  const groupFridayOnly = groups.find((row) => row.name === "A Friday Only Group")!.id;
  const groupWriter = groups.find((row) => row.name === "A Writer Group")!.id;
  const groupB = groups.find((row) => row.name === "B Group")!.id;
  const inactiveMasjidGroup = groups.find((row) => row.name === "Inactive Masjid Group")!.id;
  const inactiveCohortGroup = groups.find((row) => row.name === "Inactive Cohort Group")!.id;
  const inactiveGroup = groups.find((row) => row.name === "Inactive Group")!.id;

  const civilToday = torontoCivilDateString();
  const today = checkInEffectiveDateString();
  const weekStart = weekStartForDate(civilToday);
  const previousWeekStart = addDays(weekStart, -7);
  const unassignedWeekStart = addDays(weekStart, -14);
  const startsOn = addDays(weekStart, -28);
  const historicalStartsOn = addDays(startsOn, -28);
  const historicalEndsOn = addDays(startsOn, -1);
  const inactiveHistoricalStartsOn = addDays(historicalStartsOn, -28);
  const inactiveHistoricalEndsOn = addDays(historicalStartsOn, -1);
  const yesterday = addDays(civilToday, -1);
  const tomorrow = addDays(civilToday, 1);

  await requireData(
    "mark intentionally inactive profile",
    admin
      .from("profiles")
      .update({ access_deactivated_on: civilToday })
      .eq("id", users.inactiveAdmin)
      .select("id")
  );

  const studentMemberships = await requireData<Array<{ id: string; student_id: string; group_id: string }>>(
    "insert student memberships",
    admin.from("student_group_memberships").insert([
      { student_id: users.studentA, group_id: groupA, starts_on: startsOn, assigned_by: users.superAdmin },
      { student_id: users.studentA2, group_id: groupA, starts_on: startsOn, assigned_by: users.superAdmin },
      { student_id: users.studentWriter, group_id: groupWriter, starts_on: startsOn, assigned_by: users.superAdmin },
      { student_id: users.studentB, group_id: groupB, starts_on: startsOn, assigned_by: users.superAdmin },
      {
        student_id: users.staffGrantTarget,
        group_id: groupA,
        starts_on: startsOn,
        assigned_by: users.superAdmin
      },
      {
        student_id: users.expiredMembershipStudent,
        group_id: groupA,
        starts_on: startsOn,
        ends_on: addDays(weekStart, -1),
        assigned_by: users.superAdmin
      },
      {
        student_id: users.futureMembershipStudent,
        group_id: groupA,
        starts_on: addDays(weekStart, 7),
        assigned_by: users.superAdmin
      },
      {
        student_id: users.studentA,
        group_id: groupB,
        starts_on: historicalStartsOn,
        ends_on: historicalEndsOn,
        assigned_by: users.superAdmin
      },
      {
        student_id: users.studentA,
        group_id: inactiveGroup,
        starts_on: inactiveHistoricalStartsOn,
        ends_on: inactiveHistoricalEndsOn,
        assigned_by: users.superAdmin
      }
    ]).select("id,student_id,group_id")
  );
  const studentMembershipA = studentMemberships.find((row) => row.student_id === users.studentA && row.group_id === groupA)!.id;
  const studentMembershipB = studentMemberships.find((row) => row.student_id === users.studentB)!.id;
  const inactiveHistoricalMembershipA = studentMemberships.find((row) => row.group_id === inactiveGroup)!.id;
  const expiredStudentMembership = studentMemberships.find(
    (row) => row.student_id === users.expiredMembershipStudent
  )!.id;
  const futureStudentMembership = studentMemberships.find(
    (row) => row.student_id === users.futureMembershipStudent
  )!.id;
  const scoredStudentIds = profileRows
    .filter((row) => row.role === "student")
    .map((row) => row.id);
  const scoredStudentUpdate = await admin
    .from("profiles")
    .update({ score_starts_on: startsOn })
    .in("id", scoredStudentIds);
  assert.equal(scoredStudentUpdate.error, null, scoredStudentUpdate.error?.message);

  const staffMemberships = await requireData<Array<{
    id: string;
    profile_id: string;
    masjid_id: string;
    staff_role: "admin" | "teacher";
    active: boolean;
    starts_on: string;
    ends_on: string | null;
  }>>(
    "insert staff memberships",
    admin.from("masjid_staff_memberships").insert([
      { profile_id: users.adminA, masjid_id: masjidA, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.adminA, masjid_id: masjidA, staff_role: "teacher", active: true, starts_on: startsOn },
      { profile_id: users.adminA, masjid_id: inactiveMasjid, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.adminB, masjid_id: masjidB, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.teacherA, masjid_id: masjidA, staff_role: "teacher", active: true, starts_on: startsOn },
      { profile_id: users.teacherB, masjid_id: masjidB, staff_role: "teacher", active: true, starts_on: startsOn },
      {
        profile_id: users.saturdayStartTeacher,
        masjid_id: masjidA,
        staff_role: "teacher",
        active: true,
        starts_on: addDays(weekStart, 6)
      },
      {
        profile_id: users.fridayOnlyTeacher,
        masjid_id: masjidA,
        staff_role: "teacher",
        active: true,
        starts_on: weekStart
      },
      {
        profile_id: users.expiredAssignmentTeacher,
        masjid_id: masjidA,
        staff_role: "teacher",
        active: true,
        starts_on: startsOn,
        ends_on: addDays(weekStart, -1)
      },
      {
        profile_id: users.futureAssignmentTeacher,
        masjid_id: masjidA,
        staff_role: "teacher",
        active: true,
        starts_on: addDays(weekStart, 7)
      },
      {
        profile_id: users.expiredTeacher,
        masjid_id: masjidA,
        staff_role: "teacher",
        active: true,
        starts_on: addDays(startsOn, -14),
        ends_on: addDays(weekStart, -1)
      },
      { profile_id: users.futureTeacher, masjid_id: masjidA, staff_role: "teacher", active: true, starts_on: addDays(weekStart, 7) },
      { profile_id: users.inactiveTeacher, masjid_id: masjidA, staff_role: "teacher", active: false, starts_on: startsOn },
      { profile_id: users.expiredAdmin, masjid_id: masjidA, staff_role: "admin", active: true, starts_on: startsOn, ends_on: yesterday },
      { profile_id: users.futureAdmin, masjid_id: masjidA, staff_role: "admin", active: true, starts_on: tomorrow },
      { profile_id: users.inactiveAdmin, masjid_id: masjidA, staff_role: "admin", active: true, starts_on: startsOn },
      {
        profile_id: users.studentA2,
        masjid_id: masjidB,
        staff_role: "teacher",
        active: false,
        starts_on: historicalStartsOn,
        ends_on: historicalEndsOn
      }
    ]).select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on")
  );
  const staffMembershipA = staffMemberships.find(
    (row) => row.profile_id === users.adminA && row.masjid_id === masjidA && row.staff_role === "admin"
  )!.id;
  const staffMembershipB = staffMemberships.find(
    (row) => row.profile_id === users.adminB && row.masjid_id === masjidB && row.staff_role === "admin"
  )!.id;

  const adminABeforeMasjidActivation = await requireData<Array<{ role: string; active: boolean }>>(
    "read Admin A projection before masjid activation",
    admin.from("profiles").select("role,active").eq("id", users.adminA)
  );
  assert.deepEqual(adminABeforeMasjidActivation, [{ role: "admin", active: false }]);
  const adminAStaffMembershipBeforeMasjidActivation = staffMemberships.find((row) => row.id === staffMembershipA)!;
  assert.deepEqual(adminAStaffMembershipBeforeMasjidActivation, {
    id: staffMembershipA,
    profile_id: users.adminA,
    masjid_id: masjidA,
    staff_role: "admin",
    active: true,
    starts_on: startsOn,
    ends_on: null
  });

  await requireData(
    "activate seeded masajid after hierarchy and admin setup",
    admin.from("masajid").update({ active: true }).in("id", [masjidA, masjidB]).select("id")
  );

  const adminAAfterMasjidActivation = await requireData<Array<{ role: string; active: boolean }>>(
    "read Admin A projection after masjid activation",
    admin.from("profiles").select("role,active").eq("id", users.adminA)
  );
  assert.deepEqual(adminAAfterMasjidActivation, [{ role: "admin", active: true }]);
  console.log(
    JSON.stringify({
      rlsProjectionFixture: {
        membership_id: staffMembershipA,
        profile_id: users.adminA,
        masjid_id: masjidA,
        staff_role: "admin",
        starts_on: startsOn,
        ends_on: null,
        membership_active: true,
        profile_before_hierarchy_activation: adminABeforeMasjidActivation[0],
        profile_after_hierarchy_activation: adminAAfterMasjidActivation[0]
      }
    })
  );

  // Seed exact positive availability before writing active assignments.  The
  // Slice 5 direct-write trigger deliberately enforces this same invariant
  // even for service-role maintenance writes. Friday-only and historical
  // fixtures are valid at insertion time and are subsequently moved across
  // their intended Saturday-boundary cases below.
  const availability = await requireData<Array<{ id: string; masjid_id: string; cohort_id: string; teacher_id: string; week_start: string }>>(
    "insert availability",
    admin.from("teacher_rotation_availability").insert([
      { teacher_id: users.teacherA, masjid_id: masjidA, cohort_id: cohortA, week_start: weekStart, available: true },
      { teacher_id: users.adminA, masjid_id: masjidA, cohort_id: cohortA, week_start: weekStart, available: true },
      { teacher_id: users.fridayOnlyTeacher, masjid_id: masjidA, cohort_id: cohortA, week_start: weekStart, available: true },
      { teacher_id: users.teacherA, masjid_id: masjidA, cohort_id: cohortWriter, week_start: weekStart, available: true },
      { teacher_id: users.teacherA, masjid_id: masjidA, cohort_id: cohortWriter, week_start: previousWeekStart, available: true },
      { teacher_id: users.teacherB, masjid_id: masjidB, cohort_id: cohortB, week_start: weekStart, available: true },
      { teacher_id: users.expiredAssignmentTeacher, masjid_id: masjidA, cohort_id: cohortA, week_start: previousWeekStart, available: true },
      { teacher_id: users.futureAssignmentTeacher, masjid_id: masjidA, cohort_id: cohortA, week_start: addDays(weekStart, 7), available: true }
    ]).select("id,masjid_id,cohort_id,teacher_id,week_start")
  );
  const availabilityA = availability.find(
    (row) => row.teacher_id === users.teacherA && row.cohort_id === cohortA && row.week_start === weekStart
  )!.id;
  const availabilityB = availability.find(
    (row) => row.teacher_id === users.teacherB && row.cohort_id === cohortB && row.week_start === weekStart
  )!.id;

  const assignments = await requireData<Array<{ id: string; group_id: string; teacher_id: string }>>(
    "insert teacher assignments",
    admin.from("group_teacher_assignments").insert([
      { group_id: groupA, teacher_id: users.teacherA, week_start: weekStart, active: true, assigned_by: users.adminA },
      { group_id: groupAdminTeacher, teacher_id: users.adminA, week_start: weekStart, active: true, assigned_by: users.superAdmin },
      { group_id: groupFridayOnly, teacher_id: users.fridayOnlyTeacher, week_start: weekStart, active: true, assigned_by: users.superAdmin },
      { group_id: groupWriter, teacher_id: users.teacherA, week_start: weekStart, active: true, assigned_by: users.superAdmin },
      { group_id: groupB, teacher_id: users.teacherB, week_start: weekStart, active: true, assigned_by: users.adminB },
      {
        group_id: groupA,
        teacher_id: users.expiredAssignmentTeacher,
        week_start: previousWeekStart,
        active: true,
        assigned_by: users.superAdmin
      },
      {
        group_id: groupA,
        teacher_id: users.futureAssignmentTeacher,
        week_start: addDays(weekStart, 7),
        active: true,
        assigned_by: users.superAdmin
      }
    ]).select("id,group_id,teacher_id")
  );
  const assignmentA = assignments.find((row) => row.group_id === groupA)!.id;
  const assignmentAdminTeacher = assignments.find((row) => row.group_id === groupAdminTeacher)!.id;
  const assignmentFridayOnly = assignments.find((row) => row.group_id === groupFridayOnly)!.id;
  const assignmentWriter = assignments.find((row) => row.group_id === groupWriter)!.id;
  const assignmentB = assignments.find((row) => row.group_id === groupB)!.id;
  const expiredTeacherAssignment = assignments.find(
    (row) => row.teacher_id === users.expiredAssignmentTeacher
  )!.id;
  const futureTeacherAssignment = assignments.find(
    (row) => row.teacher_id === users.futureAssignmentTeacher
  )!.id;

  await requireData(
    "expire Friday-only teacher staff before the Saturday halaqa event",
    admin
      .from("masjid_staff_memberships")
      .update({ ends_on: addDays(weekStart, 5) })
      .eq("profile_id", users.fridayOnlyTeacher)
      .eq("masjid_id", masjidA)
      .eq("staff_role", "teacher")
      .select("id")
  );

  const submissionA = calculateDailySubmission(today, tasksForDate(today).map((task) => task.key));
  const submissionA2 = calculateDailySubmission(today, []);
  const submissionB = calculateDailySubmission(today, tasksForDate(today).slice(0, 1).map((task) => task.key));
  const checkins = await requireData<Array<{ id: string; student_id: string }>>(
    "insert checkins",
    admin.from("checkins").insert([
      { student_id: users.studentA, date: today, completed: true, earned_weight: submissionA.earnedWeight, total_weight: submissionA.totalWeight, daily_score: submissionA.dailyScore },
      { student_id: users.studentA2, date: today, completed: true, earned_weight: submissionA2.earnedWeight, total_weight: submissionA2.totalWeight, daily_score: submissionA2.dailyScore },
      { student_id: users.studentB, date: today, completed: true, earned_weight: submissionB.earnedWeight, total_weight: submissionB.totalWeight, daily_score: submissionB.dailyScore }
    ]).select("id,student_id")
  );
  const checkinA = checkins.find((row) => row.student_id === users.studentA)!.id;
  const checkinA2 = checkins.find((row) => row.student_id === users.studentA2)!.id;
  const checkinB = checkins.find((row) => row.student_id === users.studentB)!.id;
  const oldCheckinA = (
    await requireData<Array<{ id: string }>>(
      "insert unassigned-week checkin",
      admin.from("checkins").insert({
        student_id: users.studentA,
        date: unassignedWeekStart,
        completed: true,
        earned_weight: 50,
        total_weight: 100,
        daily_score: 50
      }).select("id")
    )
  )[0].id;

  const itemRows = [
    ...submissionA.items.map((item) => ({ checkin_id: checkinA, student_id: users.studentA, date: today, task_key: item.key, task_label: item.label, weight: item.weight, completed: item.completed })),
    ...submissionA2.items.map((item) => ({ checkin_id: checkinA2, student_id: users.studentA2, date: today, task_key: item.key, task_label: item.label, weight: item.weight, completed: item.completed })),
    ...submissionB.items.map((item) => ({ checkin_id: checkinB, student_id: users.studentB, date: today, task_key: item.key, task_label: item.label, weight: item.weight, completed: item.completed }))
  ];
  const items = await requireData<Array<{ id: string; student_id: string }>>(
    "insert checkin items",
    admin.from("checkin_items").insert(itemRows).select("id,student_id")
  );
  const itemA = items.find((row) => row.student_id === users.studentA)!.id;
  const itemA2 = items.find((row) => row.student_id === users.studentA2)!.id;
  const itemB = items.find((row) => row.student_id === users.studentB)!.id;

  const plans = await requireData<Array<{ id: string; student_id: string }>>(
    "insert weekly plans",
    admin.from("weekly_plans").insert([
      { student_id: users.studentA, week_start: weekStart, file_path: `${users.studentA}/${weekStart}/plan.pdf`, file_name: "plan.pdf", file_type: "application/pdf", file_size: 4 },
      { student_id: users.studentA2, week_start: weekStart, file_path: `${users.studentA2}/${weekStart}/plan.pdf`, file_name: "plan.pdf", file_type: "application/pdf", file_size: 4 },
      { student_id: users.studentB, week_start: weekStart, file_path: `${users.studentB}/${weekStart}/plan.pdf`, file_name: "plan.pdf", file_type: "application/pdf", file_size: 4 }
    ]).select("id,student_id")
  );
  const planA = plans.find((row) => row.student_id === users.studentA)!.id;
  const planA2 = plans.find((row) => row.student_id === users.studentA2)!.id;
  const planB = plans.find((row) => row.student_id === users.studentB)!.id;
  const oldPlanA = (
    await requireData<Array<{ id: string }>>(
      "insert unassigned-week plan",
      admin.from("weekly_plans").insert({
        student_id: users.studentA,
        week_start: unassignedWeekStart,
        file_path: `${users.studentA}/${unassignedWeekStart}/plan.pdf`,
        file_name: "plan.pdf",
        file_type: "application/pdf",
        file_size: 4
      }).select("id")
    )
  )[0].id;
  const historicalPlanA = (
    await requireData<Array<{ id: string }>>(
      "insert completed-assignment weekly plan",
      admin.from("weekly_plans").insert({
        student_id: users.studentA,
        week_start: previousWeekStart,
        file_path: `${users.studentA}/${previousWeekStart}/plan.pdf`,
        file_name: "historical-plan.pdf",
        file_type: "application/pdf",
        file_size: 15
      }).select("id")
    )
  )[0].id;

  const partners = await requireData<Array<{ id: string; student_id: string }>>(
    "insert partner recitations",
    admin.from("partner_recitations").insert([
      { student_id: users.studentA, week_start: weekStart, round: "round_1", points: 75 },
      { student_id: users.studentA2, week_start: weekStart, round: "round_1", points: 75 },
      { student_id: users.studentB, week_start: weekStart, round: "round_1", points: 75 }
    ]).select("id,student_id")
  );
  const partnerA = partners.find((row) => row.student_id === users.studentA)!.id;
  const partnerA2 = partners.find((row) => row.student_id === users.studentA2)!.id;
  const partnerB = partners.find((row) => row.student_id === users.studentB)!.id;
  const oldPartnerA = (
    await requireData<Array<{ id: string }>>(
      "insert unassigned-week partner recitation",
      admin.from("partner_recitations").insert({
        student_id: users.studentA,
        week_start: unassignedWeekStart,
        round: "round_1",
        points: 75
      }).select("id")
    )
  )[0].id;

  const grades = await requireData<Array<{ id: string; student_id: string }>>(
    "insert grades",
    admin.from("halaqa_grades").insert([
      { student_id: users.studentA, week_start: weekStart, attended: true, attendance_points: 100, recitation_points: 40, graded_by: users.adminA },
      { student_id: users.studentA2, week_start: weekStart, attended: true, attendance_points: 100, recitation_points: 30, graded_by: users.adminA },
      { student_id: users.studentB, week_start: weekStart, attended: true, attendance_points: 100, recitation_points: 45, graded_by: users.adminB }
    ]).select("id,student_id")
  );
  const gradeA = grades.find((row) => row.student_id === users.studentA)!.id;
  const gradeA2 = grades.find((row) => row.student_id === users.studentA2)!.id;
  const gradeB = grades.find((row) => row.student_id === users.studentB)!.id;
  const oldGradeA = (
    await requireData<Array<{ id: string }>>(
      "insert unassigned-week grade",
      admin.from("halaqa_grades").insert({
        student_id: users.studentA,
        week_start: unassignedWeekStart,
        attended: true,
        attendance_points: 100,
        recitation_points: 30,
        graded_by: users.adminA
      }).select("id")
    )
  )[0].id;
  const historicalGradeA = (
    await requireData<Array<{ id: string }>>(
      "insert completed-assignment grade",
      admin.from("halaqa_grades").insert({
        student_id: users.studentA,
        week_start: previousWeekStart,
        attended: true,
        attendance_points: 100,
        recitation_points: 35,
        graded_by: users.adminA
      }).select("id")
    )
  )[0].id;

  const incentives = await requireData<Array<{ id: string; masjid_id: string }>>(
    "insert incentive runs",
    admin.from("weekly_incentive_runs").insert([
      { masjid_id: masjidA, week_start: weekStart, processed_by: users.adminA },
      { masjid_id: masjidB, week_start: previousWeekStart, processed_by: users.adminB }
    ]).select("id,masjid_id")
  );
  const incentiveA = incentives.find((row) => row.masjid_id === masjidA)!.id;
  const incentiveB = incentives.find((row) => row.masjid_id === masjidB)!.id;

  const obligations = await requireData<Array<{ id: string; student_id: string }>>(
    "insert obligations",
    admin.from("accountability_obligations").insert([
      { student_id: users.studentA, week_start: previousWeekStart, weekly_percentage: 13.5, amount_cents: 3000 },
      { student_id: users.studentB, week_start: previousWeekStart, weekly_percentage: 0, amount_cents: 3500 }
    ]).select("id,student_id")
  );
  const obligationA = obligations.find((row) => row.student_id === users.studentA)!.id;
  const obligationB = obligations.find((row) => row.student_id === users.studentB)!.id;
  const { error: malformedObligationError } = await admin
    .from("accountability_obligations")
    .insert({
      student_id: users.futureMembershipStudent,
      week_start: previousWeekStart,
      weekly_percentage: 0,
      amount_cents: 3500
    });
  assert.ok(
    malformedObligationError,
    "service role created a pending obligation without a membership effective for its week"
  );

  const badges = await requireData<Array<{ id: string; student_id: string }>>(
    "insert badges",
    admin.from("badge_awards").insert([
      { student_id: users.studentA, week_start: weekStart, weekly_percentage: 95, badges_awarded: 1 },
      { student_id: users.studentB, week_start: weekStart, weekly_percentage: 95, badges_awarded: 1 }
    ]).select("id,student_id")
  );
  const badgeA = badges.find((row) => row.student_id === users.studentA)!.id;
  const badgeB = badges.find((row) => row.student_id === users.studentB)!.id;

  const settings = await requireData<Array<{ id: string; masjid_id: string }>>(
    "insert rotation settings",
    admin.from("cohort_rotation_settings").insert([
      { masjid_id: masjidA, cohort_id: cohortA, target_group_count: 1, active: true },
      { masjid_id: masjidB, cohort_id: cohortB, target_group_count: 1, active: true }
    ]).select("id,masjid_id")
  );
  const settingA = settings.find((row) => row.masjid_id === masjidA)!.id;
  const settingB = settings.find((row) => row.masjid_id === masjidB)!.id;

  const runs = await requireData<Array<{ id: string; cohort_id: string }>>(
    "insert rotation runs",
    admin.from("teacher_rotation_runs").insert([
      { cohort_id: cohortA, week_start: weekStart, generated_by: users.adminA, available_teacher_count: 1, group_count: 1, assigned_count: 1 },
      { cohort_id: cohortB, week_start: weekStart, generated_by: users.adminB, available_teacher_count: 1, group_count: 1, assigned_count: 1 }
    ]).select("id,cohort_id")
  );
  const rotationRunA = runs.find((row) => row.cohort_id === cohortA)!.id;
  const rotationRunB = runs.find((row) => row.cohort_id === cohortB)!.id;

  const auditId = (
    await requireData<Array<{ id: string }>>(
      "insert audit",
      admin.from("super_admin_audit_events").insert({
        actor_id: users.superAdmin,
        action: "rls.seed",
        target_masjid_id: masjidA
      }).select("id")
    )
  )[0].id;

  const bucketResult = await admin.storage.createBucket("weekly-plans", { public: false });
  assert.ok(!bucketResult.error || bucketResult.error.message.toLowerCase().includes("already"), bucketResult.error?.message);
  for (const studentId of [users.studentA, users.studentA2, users.studentB]) {
    const { error } = await admin.storage.from("weekly-plans").upload(
      `${studentId}/${weekStart}/plan.pdf`,
      new Blob(["plan"], { type: "application/pdf" }),
      { contentType: "application/pdf", upsert: true }
    );
    assert.equal(error, null, `upload weekly plan fixture: ${error?.message}`);
  }
  const { error: oldPlanUploadError } = await admin.storage.from("weekly-plans").upload(
    `${users.studentA}/${unassignedWeekStart}/plan.pdf`,
    new Blob(["old plan"], { type: "application/pdf" }),
    { contentType: "application/pdf", upsert: true }
  );
  assert.equal(oldPlanUploadError, null, `upload old weekly plan fixture: ${oldPlanUploadError?.message}`);
  const { error: historicalPlanUploadError } = await admin.storage.from("weekly-plans").upload(
    `${users.studentA}/${previousWeekStart}/plan.pdf`,
    new Blob(["historical plan"], { type: "application/pdf" }),
    { contentType: "application/pdf", upsert: true }
  );
  assert.equal(
    historicalPlanUploadError,
    null,
    `upload completed-assignment weekly plan fixture: ${historicalPlanUploadError?.message}`
  );

  return {
    users,
    masjidA,
    masjidB,
    inactiveMasjid,
    cohortA,
    cohortB,
    cohortWriter,
    inactiveMasjidCohort,
    inactiveMasjidGroup,
    inactiveCohort,
    inactiveCohortGroup,
    inactiveGroup,
    groupA,
    groupB,
    groupAdminTeacher,
    groupFridayOnly,
    groupWriter,
    civilToday,
    today,
    weekStart,
    startsOn,
    previousWeekStart,
    checkinA,
    checkinA2,
    checkinB,
    itemA,
    itemA2,
    itemB,
    planA,
    planA2,
    planB,
    historicalPlanA,
    partnerA,
    partnerA2,
    partnerB,
    gradeA,
    gradeA2,
    gradeB,
    historicalGradeA,
    oldCheckinA,
    oldPlanA,
    oldPartnerA,
    oldGradeA,
    incentiveA,
    incentiveB,
    obligationA,
    obligationB,
    badgeA,
    badgeB,
    studentMembershipA,
    studentMembershipB,
    inactiveHistoricalMembershipA,
    expiredStudentMembership,
    futureStudentMembership,
    staffMembershipA,
    staffMembershipB,
    assignmentA,
    assignmentAdminTeacher,
    assignmentB,
    assignmentFridayOnly,
    assignmentWriter,
    expiredTeacherAssignment,
    futureTeacherAssignment,
    availabilityA,
    availabilityB,
    settingA,
    settingB,
    rotationRunA,
    rotationRunB,
    auditId
  };
}

async function visibleById(client: SupabaseClient, table: string, id: string) {
  const { data, error } = await client.from(table).select("id").eq("id", id);
  assert.equal(error, null, `${table} select: ${error?.message}`);
  return data ?? [];
}

async function assertVisible(client: SupabaseClient, table: string, id: string) {
  assert.equal((await visibleById(client, table, id)).length, 1, `${table} ${id} should be visible`);
}

async function assertHidden(client: SupabaseClient, table: string, id: string) {
  assert.equal((await visibleById(client, table, id)).length, 0, `${table} ${id} should be hidden`);
}

async function assertUpdateBlocked(
  client: SupabaseClient,
  table: string,
  id: string,
  payload: Record<string, unknown>
) {
  const { data, error } = await client.from(table).update(payload).eq("id", id).select("id");
  assert.ok(error || !data || data.length === 0, `${table} ${id} update unexpectedly succeeded`);
}

async function assertInsertBlocked(client: SupabaseClient, table: string, row: Record<string, unknown>) {
  const { data, error } = await client.from(table).insert(row).select("id");
  assert.ok(error || !data || data.length === 0, `${table} cross-scope insert unexpectedly succeeded`);
}

async function assertDeleteBlocked(client: SupabaseClient, table: string, id: string) {
  const { data, error } = await client.from(table).delete().eq("id", id).select("id");
  assert.ok(error || !data || data.length === 0, `${table} ${id} cross-scope delete unexpectedly succeeded`);
}

async function assertRpcDenied(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const { error } = await client.rpc(name, args);
  assert.ok(error, `${name} should be denied`);
}

async function assertRpcAllowed(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const { error } = await client.rpc(name, args);
  assert.equal(error, null, `${name} should be executable by authenticated callers: ${error?.message}`);
}

async function runAssertions(ids: SeedIds) {
  const [
    adminA,
    adminB,
    teacherA,
    teacherB,
    fridayOnlyTeacher,
    studentA,
    studentA2,
    studentWriter,
    expiredAdmin,
    futureAdmin,
    inactiveAdmin,
    expiredTeacher,
    futureTeacher,
    inactiveTeacher,
    expiredAssignmentTeacher,
    futureAssignmentTeacher,
    expiredMembershipStudent,
    futureMembershipStudent,
    sentinelStudent,
    superAdmin,
    profileTarget
  ] = await Promise.all([
    signIn("adminA"),
    signIn("adminB"),
    signIn("teacherA"),
    signIn("teacherB"),
    signIn("fridayOnlyTeacher"),
    signIn("studentA"),
    signIn("studentA2"),
    signIn("studentWriter"),
    signIn("expiredAdmin"),
    signIn("futureAdmin"),
    signIn("inactiveAdmin"),
    signIn("expiredTeacher"),
    signIn("futureTeacher"),
    signIn("inactiveTeacher"),
    signIn("expiredAssignmentTeacher"),
    signIn("futureAssignmentTeacher"),
    signIn("expiredMembershipStudent"),
    signIn("futureMembershipStudent"),
    signIn("sentinelStudent"),
    signIn("superAdmin"),
    signIn("profileTarget")
  ]);

  const adminScopedTables: Array<[string, string, string]> = [
    ["checkins", ids.checkinA, ids.checkinB],
    ["checkin_items", ids.itemA, ids.itemB],
    ["weekly_plans", ids.planA, ids.planB],
    ["partner_recitations", ids.partnerA, ids.partnerB],
    ["halaqa_grades", ids.gradeA, ids.gradeB],
    ["weekly_incentive_runs", ids.incentiveA, ids.incentiveB],
    ["accountability_obligations", ids.obligationA, ids.obligationB],
    ["badge_awards", ids.badgeA, ids.badgeB],
    ["student_group_memberships", ids.studentMembershipA, ids.studentMembershipB],
    ["masjid_staff_memberships", ids.staffMembershipA, ids.staffMembershipB],
    ["group_teacher_assignments", ids.assignmentA, ids.assignmentB],
    ["teacher_rotation_availability", ids.availabilityA, ids.availabilityB],
    ["cohort_rotation_settings", ids.settingA, ids.settingB],
    ["teacher_rotation_runs", ids.rotationRunA, ids.rotationRunB]
  ];

  for (const [table, ownId, crossId] of adminScopedTables) {
    await assertVisible(adminA, table, ownId);
    await assertHidden(adminA, table, crossId);
  }

  await assertVisible(adminA, "masajid", ids.masjidA);
  await assertHidden(adminA, "masajid", ids.masjidB);
  await assertVisible(adminA, "cohorts", ids.cohortA);
  await assertHidden(adminA, "cohorts", ids.cohortB);
  await assertVisible(adminA, "halaqa_groups", ids.groupA);
  await assertHidden(adminA, "halaqa_groups", ids.groupB);
  await assertHidden(adminA, "masajid", ids.inactiveMasjid);
  await assertHidden(adminA, "cohorts", ids.inactiveMasjidCohort);
  await assertHidden(adminA, "halaqa_groups", ids.inactiveMasjidGroup);
  await assertHidden(adminA, "cohorts", ids.inactiveCohort);
  await assertHidden(adminA, "halaqa_groups", ids.inactiveCohortGroup);
  await assertHidden(adminA, "halaqa_groups", ids.inactiveGroup);
  await assertVisible(adminA, "profiles", ids.users.studentA);
  await assertHidden(adminA, "profiles", ids.users.studentB);
  await assertUpdateBlocked(adminA, "profiles", ids.users.studentB, { active: false });
  await assertUpdateBlocked(adminA, "masajid", ids.masjidB, { name: "cross-masjid" });
  await assertUpdateBlocked(adminA, "cohorts", ids.cohortB, { name: "cross-cohort" });
  await assertUpdateBlocked(adminA, "halaqa_groups", ids.groupB, { name: "cross-group" });
  await assertDeleteBlocked(adminA, "masajid", ids.masjidB);
  await assertDeleteBlocked(adminA, "cohorts", ids.cohortB);
  await assertDeleteBlocked(adminA, "halaqa_groups", ids.groupB);
  await assertInsertBlocked(adminA, "profiles", {
    id: ids.users.profileTarget,
    name: "forbidden profile",
    email: "profiletarget@rls.local",
    phone: null,
    role: "student",
    active: true
  });
  await assertInsertBlocked(adminA, "masajid", {
    name: "Forbidden Masjid",
    slug: "forbidden-masjid",
    active: true
  });
  await assertInsertBlocked(adminA, "cohorts", {
    masjid_id: ids.masjidA,
    kind: "brothers",
    name: "Forbidden Cohort",
    active: true
  });
  await assertInsertBlocked(adminA, "halaqa_groups", {
    cohort_id: ids.cohortA,
    name: "Forbidden Group",
    active: true
  });

  await assertUpdateBlocked(adminA, "checkins", ids.checkinB, { note: "cross-masjid" });
  await assertUpdateBlocked(adminA, "checkin_items", ids.itemB, { task_label: "cross-masjid" });
  await assertUpdateBlocked(adminA, "weekly_plans", ids.planB, { file_name: "cross.pdf" });
  await assertUpdateBlocked(adminA, "partner_recitations", ids.partnerB, { submitted_at: new Date().toISOString() });
  await assertUpdateBlocked(adminA, "halaqa_grades", ids.gradeB, { notes: "cross-masjid" });
  await assertUpdateBlocked(adminA, "weekly_incentive_runs", ids.incentiveB, { processed_at: new Date().toISOString() });
  await assertUpdateBlocked(adminA, "accountability_obligations", ids.obligationB, { admin_note: "cross-masjid" });
  await assertUpdateBlocked(adminA, "badge_awards", ids.badgeB, { badges_awarded: 2 });
  await assertUpdateBlocked(adminA, "student_group_memberships", ids.studentMembershipB, { updated_at: new Date().toISOString() });
  await assertUpdateBlocked(adminA, "masjid_staff_memberships", ids.staffMembershipB, { updated_at: new Date().toISOString() });
  await assertUpdateBlocked(adminA, "group_teacher_assignments", ids.assignmentB, { updated_at: new Date().toISOString() });
  await assertUpdateBlocked(adminA, "teacher_rotation_availability", ids.availabilityB, { available: false });
  await assertUpdateBlocked(adminA, "cohort_rotation_settings", ids.settingB, { target_group_count: 2 });
  await assertUpdateBlocked(adminA, "teacher_rotation_runs", ids.rotationRunB, { warning_count: 1 });

  for (const [table, id] of adminScopedTables.map(([table, , crossId]) => [table, crossId] as const)) {
    await assertDeleteBlocked(adminA, table, id);
  }

  const nextWeekStart = addDays(ids.weekStart, 7);
  await assertInsertBlocked(adminA, "checkins", {
    student_id: ids.users.studentB,
    date: addDays(ids.weekStart, 1),
    completed: false,
    earned_weight: 0,
    total_weight: 100,
    daily_score: 0
  });
  await assertInsertBlocked(adminA, "checkin_items", {
    checkin_id: ids.checkinB,
    student_id: ids.users.studentB,
    date: ids.today,
    task_key: "cross_admin_probe",
    task_label: "Cross admin probe",
    weight: 10,
    completed: false
  });
  await assertInsertBlocked(adminA, "weekly_plans", {
    student_id: ids.users.studentB,
    week_start: nextWeekStart,
    file_path: `${ids.users.studentB}/${nextWeekStart}/forged.pdf`,
    file_name: "forged.pdf",
    file_type: "application/pdf",
    file_size: 4
  });
  await assertInsertBlocked(adminA, "partner_recitations", {
    student_id: ids.users.studentB,
    week_start: nextWeekStart,
    round: "round_1",
    points: 75
  });
  await assertInsertBlocked(adminA, "halaqa_grades", {
    student_id: ids.users.studentB,
    week_start: nextWeekStart,
    attended: false,
    attendance_points: 0,
    recitation_points: 0,
    graded_by: ids.users.adminA
  });
  await assertInsertBlocked(adminA, "weekly_incentive_runs", {
    masjid_id: ids.masjidB,
    week_start: addDays(ids.previousWeekStart, -7),
    processed_by: ids.users.adminA
  });
  await assertInsertBlocked(adminA, "accountability_obligations", {
    student_id: ids.users.studentB,
    week_start: ids.previousWeekStart,
    weekly_percentage: 50,
    amount_cents: 1000
  });
  await assertInsertBlocked(adminA, "badge_awards", {
    student_id: ids.users.studentB,
    week_start: ids.previousWeekStart,
    weekly_percentage: 95,
    badges_awarded: 1
  });
  await assertInsertBlocked(adminA, "student_group_memberships", {
    student_id: ids.users.studentB,
    group_id: ids.groupA,
    starts_on: addDays(ids.weekStart, -70),
    ends_on: addDays(ids.weekStart, -64),
    assigned_by: ids.users.adminA
  });
  await assertInsertBlocked(adminA, "masjid_staff_memberships", {
    profile_id: ids.users.teacherB,
    masjid_id: ids.masjidA,
    staff_role: "teacher",
    active: true,
    starts_on: nextWeekStart,
    created_by: ids.users.adminA
  });
  await assertInsertBlocked(adminA, "masjid_staff_memberships", {
    profile_id: ids.users.adminB,
    masjid_id: ids.masjidA,
    staff_role: "teacher",
    active: true,
    starts_on: nextWeekStart,
    created_by: ids.users.adminA
  });
  await assertInsertBlocked(adminA, "group_teacher_assignments", {
    group_id: ids.groupB,
    teacher_id: ids.users.teacherB,
    week_start: nextWeekStart,
    active: true,
    assigned_by: ids.users.adminA
  });
  await assertInsertBlocked(adminA, "teacher_rotation_availability", {
    teacher_id: ids.users.teacherB,
    masjid_id: ids.masjidB,
    cohort_id: ids.cohortB,
    week_start: nextWeekStart,
    available: true
  });
  await assertInsertBlocked(adminA, "cohort_rotation_settings", {
    masjid_id: ids.masjidB,
    cohort_id: ids.cohortB,
    target_group_count: 2,
    active: false
  });
  await assertInsertBlocked(adminA, "teacher_rotation_runs", {
    cohort_id: ids.cohortB,
    week_start: nextWeekStart,
    generated_by: ids.users.adminA,
    available_teacher_count: 0,
    group_count: 0,
    assigned_count: 0
  });

  await assertUpdateBlocked(adminA, "checkins", ids.checkinA, { note: "direct admin correction" });
  await assertUpdateBlocked(adminA, "checkin_items", ids.itemA, { completed: false });
  await assertInsertBlocked(adminA, "checkins", {
    student_id: ids.users.studentA,
    date: addDays(nextWeekStart, 1),
    completed: true,
    earned_weight: 0,
    total_weight: 100,
    daily_score: 0,
    updated_by_admin: ids.users.adminA
  });

  const correctionTasks = tasksForDate(ids.today);
  const correctedKeys = correctionTasks.slice(0, 2).map((task) => task.key);
  const correctedSubmission = calculateDailySubmission(ids.today, correctedKeys);
  const { data: correctedId, error: correctionError } = await adminA.rpc(
    "apply_admin_checkin_correction",
    {
      input_student_id: ids.users.studentA,
      input_date: ids.today,
      input_status: "submitted",
      input_note: "transactional correction",
      input_completed_task_keys: correctedKeys
    }
  );
  assert.equal(correctionError, null, `transactional correction failed: ${correctionError?.message}`);
  assert.equal(correctedId, ids.checkinA, "correction replaced rather than updated the canonical check-in");
  const { data: correctedParent, error: correctedParentError } = await adminA
    .from("checkins")
    .select("id,note,earned_weight,total_weight,daily_score,updated_by_admin")
    .eq("id", ids.checkinA)
    .single();
  assert.equal(correctedParentError, null, correctedParentError?.message);
  assert.equal(correctedParent?.note, "transactional correction");
  assert.equal(correctedParent?.earned_weight, correctedSubmission.earnedWeight);
  assert.equal(correctedParent?.total_weight, correctedSubmission.totalWeight);
  assert.equal(Number(correctedParent?.daily_score), correctedSubmission.dailyScore);
  assert.equal(correctedParent?.updated_by_admin, ids.users.adminA);
  const { data: correctedItems, error: correctedItemsError } = await adminA
    .from("checkin_items")
    .select("id,task_key,task_label,weight,completed")
    .eq("checkin_id", ids.checkinA)
    .order("task_key");
  assert.equal(correctedItemsError, null, correctedItemsError?.message);
  assert.equal(correctedItems?.length, correctionTasks.length, "correction omitted canonical checklist items");
  assert.deepEqual(
    new Set((correctedItems ?? []).filter((row) => row.completed).map((row) => row.task_key)),
    new Set(correctedKeys),
    "correction stored the wrong completed tasks"
  );
  ids.itemA = correctedItems![0].id;

  const parentBeforeRollback = structuredClone(correctedParent);
  const itemsBeforeRollback = structuredClone(correctedItems);
  const { error: rollbackError } = await adminA.rpc("apply_admin_checkin_correction", {
    input_student_id: ids.users.studentA,
    input_date: ids.today,
    input_status: "submitted",
    input_note: "must roll back",
    input_completed_task_keys: [correctedKeys[0], "not_a_canonical_task"]
  });
  assert.ok(rollbackError, "invalid correction unexpectedly committed");
  const { data: parentAfterRollback } = await adminA
    .from("checkins")
    .select("id,note,earned_weight,total_weight,daily_score,updated_by_admin")
    .eq("id", ids.checkinA)
    .single();
  const { data: itemsAfterRollback } = await adminA
    .from("checkin_items")
    .select("id,task_key,task_label,weight,completed")
    .eq("checkin_id", ids.checkinA)
    .order("task_key");
  assert.deepEqual(parentAfterRollback, parentBeforeRollback, "failed correction changed its parent row");
  assert.deepEqual(itemsAfterRollback, itemsBeforeRollback, "failed correction changed its item rows");
  await assertRpcDenied(adminA, "apply_admin_checkin_correction", {
    input_student_id: ids.users.studentB,
    input_date: ids.today,
    input_status: "submitted",
    input_note: "cross-masjid",
    input_completed_task_keys: correctedKeys
  });
  const futureCorrectionDate = addDays(ids.today, 1);
  const { error: futureCorrectionError } = await adminA.rpc("apply_admin_checkin_correction", {
    input_student_id: ids.users.studentA,
    input_date: futureCorrectionDate,
    input_status: "submitted",
    input_note: "future correction",
    input_completed_task_keys: tasksForDate(futureCorrectionDate).slice(0, 1).map((task) => task.key)
  });
  assert.equal(futureCorrectionError?.code, "22023", "future correction should fail with invalid-parameter error");
  assert.match(
    futureCorrectionError?.message ?? "",
    /future/i,
    "future correction should explain the date is not allowed"
  );
  const { data: futureParents, error: futureParentsError } = await adminA
    .from("checkins")
    .select("id")
    .eq("student_id", ids.users.studentA)
    .eq("date", futureCorrectionDate);
  assert.equal(futureParentsError, null, futureParentsError?.message);
  assert.deepEqual(futureParents, [], "future correction wrote a parent check-in row");
  const { data: futureItems, error: futureItemsError } = await adminA
    .from("checkin_items")
    .select("id")
    .eq("student_id", ids.users.studentA)
    .eq("date", futureCorrectionDate);
  assert.equal(futureItemsError, null, futureItemsError?.message);
  assert.deepEqual(futureItems, [], "future correction wrote checklist items");

  await assertDeleteBlocked(adminA, "student_group_memberships", ids.studentMembershipA);
  await assertDeleteBlocked(adminA, "masjid_staff_memberships", ids.staffMembershipA);
  await assertDeleteBlocked(adminA, "group_teacher_assignments", ids.assignmentA);

  const { data: adminStudents, error: adminStudentsError } = await adminA.rpc("admin_students_for_week", {
    input_week_start: ids.weekStart
  });
  assert.equal(adminStudentsError, null, adminStudentsError?.message);
  assert.ok(Array.isArray(adminStudents));
  assert.deepEqual(
    new Set((adminStudents ?? []).map((row) => row.masjid_id)),
    new Set([ids.masjidA]),
    "admin_students_for_week leaked another masjid"
  );
  await assertRpcDenied(adminA, "apply_teacher_rotation_generation", {
    input_cohort_id: ids.cohortB,
    input_week_start: ids.weekStart,
    input_generated_by: ids.users.adminA
  });
  await assertRpcDenied(adminA, "apply_cohort_group_rebalance", {
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_rebalanced_by: ids.users.adminA,
    input_target_group_count: 1
  });

  // Signed admins can read rotation runs but cannot write them directly.
  await assertInsertBlocked(adminA, "teacher_rotation_runs", {
    cohort_id: ids.cohortA,
    week_start: nextWeekStart,
    generated_by: ids.users.adminA,
    available_teacher_count: 0,
    group_count: 0,
    assigned_count: 0
  });
  await assertUpdateBlocked(adminA, "teacher_rotation_runs", ids.rotationRunA, { warning_count: 2 });
  await assertDeleteBlocked(adminA, "teacher_rotation_runs", ids.rotationRunA);

  // The guarded server-only RPC remains the sole positive mutation route.
  const service = localClient(serviceRoleKey);

  await requireData(
    "create access-transition target profile",
    service
      .from("profiles")
      .insert({
        id: ids.users.profileTarget,
        name: "profileTarget",
        email: "profiletarget@rls.local",
        phone: null,
        role: "student",
        active: true
      })
      .select("id")
  );

  const inactiveProfileRefresh = await inactiveAdmin.rpc("refresh_current_profile_role");
  assert.equal(inactiveProfileRefresh.error, null, inactiveProfileRefresh.error?.message);
  assert.equal((inactiveProfileRefresh.data as { active?: boolean } | null)?.active, false);
  const inactiveProfileAfterRefresh = await requireData<{ role: string; active: boolean }>(
    "read intentionally inactive profile after repair RPC",
    service.from("profiles").select("role,active").eq("id", ids.users.inactiveAdmin).single()
  );
  assert.deepEqual(inactiveProfileAfterRefresh, { role: "admin", active: false });

  const rolloutDiagnostic = await service.rpc("access_transition_rollout_diagnostic");
  assert.equal(rolloutDiagnostic.error, null, rolloutDiagnostic.error?.message);
  const rolloutDiagnosticData = rolloutDiagnostic.data as Record<string, unknown> | null;
  assert.ok(rolloutDiagnosticData, "rollout diagnostic returned no report");
  for (const key of [
    "projection_changes",
    "future_memberships_rejected",
    "assignments_affected_by_immediate_deactivation",
    "last_admin_coverage_risks"
  ]) {
    assert.ok(Array.isArray(rolloutDiagnosticData?.[key]), `rollout diagnostic omitted ${key}`);
  }

  const setupStudentRequestId = randomUUID();
  const setupStudentArgs = {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.adminA,
    input_profile_id: ids.users.setupStudent,
    input_name: "Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidA,
    input_group_id: ids.groupA
  };
  const setupStudentMetadata = {
    setup_request_id: setupStudentRequestId,
    setup_actor_id: ids.users.adminA,
    setup_payload: {
      actor_id: ids.users.adminA,
      name: "Setup Student",
      email: "setupstudent@rls.local",
      phone: "+15550001001",
      role: "student",
      starts_on: ids.weekStart,
      masjid_id: ids.masjidA,
      group_id: ids.groupA
    }
  };
  const setupStudentAuthUpdate = await service.auth.admin.updateUserById(ids.users.setupStudent, {
    app_metadata: setupStudentMetadata
  });
  assert.equal(setupStudentAuthUpdate.error, null, setupStudentAuthUpdate.error?.message);

  await assertRpcDenied(adminA, "apply_scoped_user_setup", setupStudentArgs);
  await assertRpcDenied(superAdmin, "get_scoped_user_setup_request_result", {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.adminA,
    input_name: "Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidA,
    input_group_id: ids.groupA
  });
  await assertRpcDenied(superAdmin, "get_scoped_user_setup_auth_recovery", {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.adminA,
    input_name: "Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidA,
    input_group_id: ids.groupA
  });
  await assertRpcDenied(superAdmin, "get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget
  });
  await assertRpcDenied(superAdmin, "apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget,
    input_preset: "teacher",
    input_starts_on: ids.weekStart,
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: {}
  });
  await assertRpcDenied(superAdmin, "apply_super_admin_score_start_correction", {
    input_actor_id: ids.users.superAdmin,
    input_student_id: ids.users.studentA,
    input_score_starts_on: ids.weekStart,
    input_expected_score_starts_on: ids.startsOn
  });
  await assertRpcDenied(adminA, "preview_official_scoring_start_change", {
    input_actor_id: ids.users.adminA,
    input_student_id: ids.users.studentA,
    input_score_starts_on: ids.weekStart
  });
  await assertRpcDenied(adminA, "apply_official_scoring_start_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_student_id: ids.users.studentA,
    input_score_starts_on: ids.weekStart,
    input_expected_score_starts_on: ids.startsOn,
    input_reason: "Signed clients may not call this service workflow."
  });
  await assertRpcDenied(superAdmin, "apply_super_admin_masjid_update", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_masjid_id: ids.inactiveMasjid,
    input_name: "RLS Inactive Masjid",
    input_slug: "rls-inactive-masjid",
    input_active: true,
    input_expected_state: {}
  });
  await assertRpcDenied(superAdmin, "prepare_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.studentA,
    input_masjid_id: ids.masjidA,
    input_grant: "admin",
    input_starts_on: ids.weekStart
  });
  await assertRpcDenied(superAdmin, "access_transition_rollout_diagnostic");
  await assertRpcDenied(superAdmin, "apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.studentA,
    input_masjid_id: ids.masjidA,
    input_grant: "admin",
    input_starts_on: ids.weekStart,
    input_expected_state: {}
  });
  await assertRpcDenied(superAdmin, "apply_super_admin_staff_membership_end", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_membership_id: ids.staffMembershipB,
    input_ends_on: ids.civilToday,
    input_expected_state: {}
  });

  const authRecovery = await service.rpc("get_scoped_user_setup_auth_recovery", {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.adminA,
    input_name: "Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidA,
    input_group_id: ids.groupA
  });
  assert.equal(authRecovery.error, null, authRecovery.error?.message);
  assert.equal(authRecovery.data, ids.users.setupStudent, "exact Auth-only setup was not recoverable");
  const changedAuthRecovery = await service.rpc("get_scoped_user_setup_auth_recovery", {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.adminA,
    input_name: "Changed Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidA,
    input_group_id: ids.groupA
  });
  assert.equal(changedAuthRecovery.error, null, changedAuthRecovery.error?.message);
  assert.equal(changedAuthRecovery.data, null, "changed Auth-only setup payload was recoverable");
  const crossActorAuthRecovery = await service.rpc("get_scoped_user_setup_auth_recovery", {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.superAdmin,
    input_name: "Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidA,
    input_group_id: ids.groupA
  });
  assert.equal(crossActorAuthRecovery.error, null, crossActorAuthRecovery.error?.message);
  assert.equal(crossActorAuthRecovery.data, null, "cross-actor Auth-only setup was recoverable");

  const setupStudentFirst = await service.rpc("apply_scoped_user_setup", setupStudentArgs);
  assert.equal(setupStudentFirst.error, null, setupStudentFirst.error?.message);
  const setupStudentRetry = await service.rpc("apply_scoped_user_setup", setupStudentArgs);
  assert.equal(setupStudentRetry.error, null, setupStudentRetry.error?.message);
  assert.deepEqual(setupStudentRetry.data, setupStudentFirst.data, "setup retry changed the result");

  const { data: setupStudentProfiles, error: setupStudentProfileError } = await service
    .from("profiles")
    .select("id,role,active")
    .eq("id", ids.users.setupStudent);
  assert.equal(setupStudentProfileError, null, setupStudentProfileError?.message);
  assert.equal(setupStudentProfiles?.length, 1, "setup retry created the wrong profile count");
  const { data: setupStudentMemberships, error: setupStudentMembershipError } = await service
    .from("student_group_memberships")
    .select("id,group_id")
    .eq("student_id", ids.users.setupStudent);
  assert.equal(setupStudentMembershipError, null, setupStudentMembershipError?.message);
  assert.equal(setupStudentMemberships?.length, 1, "setup retry duplicated student membership");
  assert.equal(setupStudentMemberships?.[0]?.group_id, ids.groupA);
  const { count: setupStudentAuditCount, error: setupStudentAuditError } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.setupStudent)
    .eq("action", "scoped_user_created");
  assert.equal(setupStudentAuditError, null, setupStudentAuditError?.message);
  assert.equal(setupStudentAuditCount, 1, "setup retry duplicated audit semantics");

  const scoreCorrectionRequestId = randomUUID();
  const scoreCorrectionArgs = {
    input_request_id: scoreCorrectionRequestId,
    input_actor_id: ids.users.superAdmin,
    input_student_id: ids.users.studentA,
    input_score_starts_on: ids.weekStart,
    input_expected_score_starts_on: ids.startsOn,
    input_reason: "Align fixture with the first current scored week."
  };
  const scoreCorrection = await service.rpc("apply_official_scoring_start_change", scoreCorrectionArgs);
  assert.equal(scoreCorrection.error, null, scoreCorrection.error?.message);
  const scoreCorrectionRetry = await service.rpc("apply_official_scoring_start_change", scoreCorrectionArgs);
  assert.equal(scoreCorrectionRetry.error, null, scoreCorrectionRetry.error?.message);
  assert.deepEqual(scoreCorrectionRetry.data, scoreCorrection.data, "score-start retry changed the result");
  const staleScoreCorrection = await service.rpc("apply_official_scoring_start_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_student_id: ids.users.studentA,
    input_score_starts_on: ids.weekStart,
    input_expected_score_starts_on: ids.startsOn,
    input_reason: "This stale request must be rejected."
  });
  assert.equal(staleScoreCorrection.error?.code, "P0001", "stale score-start correction was accepted");
  const { count: scoreCorrectionAuditCount, error: scoreCorrectionAuditError } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.studentA)
    .eq("action", "official_scoring_start_changed");
  assert.equal(scoreCorrectionAuditError, null, scoreCorrectionAuditError?.message);
  assert.equal(scoreCorrectionAuditCount, 1, "score-start workflow retry duplicated audit semantics");
  const retiredScoreCorrection = await service.rpc("apply_super_admin_score_start_correction", {
    input_actor_id: ids.users.superAdmin,
    input_student_id: ids.users.studentA,
    input_score_starts_on: ids.weekStart,
    input_expected_score_starts_on: ids.weekStart
  });
  assert.equal(retiredScoreCorrection.error?.code, "42501", "retired score-start RPC remained service-callable");

  const setupStudentLookupArgs = {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.adminA,
    input_name: "Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidA,
    input_group_id: ids.groupA
  };
  const setupStudentLookup = await service.rpc(
    "get_scoped_user_setup_request_result",
    setupStudentLookupArgs
  );
  assert.equal(setupStudentLookup.error, null, setupStudentLookup.error?.message);
  assert.deepEqual(setupStudentLookup.data, setupStudentFirst.data, "setup lookup changed the result");
  const crossActorSetupLookup = await service.rpc("get_scoped_user_setup_request_result", {
    ...setupStudentLookupArgs,
    input_actor_id: ids.users.superAdmin
  });
  assert.equal(crossActorSetupLookup.error?.code, "42501", "cross-actor setup lookup was not denied");
  const changedSetupLookup = await service.rpc("get_scoped_user_setup_request_result", {
    ...setupStudentLookupArgs,
    input_name: "Changed Setup Student"
  });
  assert.equal(changedSetupLookup.error?.code, "22023", "changed setup lookup payload was accepted");

  const grantStateBeforeFutureMembership = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.staffGrantTarget
  });
  assert.equal(grantStateBeforeFutureMembership.error, null, grantStateBeforeFutureMembership.error?.message);
  const { data: futureGrantMembership, error: futureGrantMembershipError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.staffGrantTarget,
      masjid_id: ids.masjidA,
      staff_role: "teacher",
      active: true,
      starts_on: addDays(ids.weekStart, 7),
      created_by: ids.users.superAdmin
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(futureGrantMembershipError, null, futureGrantMembershipError?.message);
  const grantStateWithFutureMembership = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.staffGrantTarget
  });
  assert.equal(grantStateWithFutureMembership.error, null, grantStateWithFutureMembership.error?.message);
  const { count: failedGrantAuditBefore } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.staffGrantTarget);
  const partialAdminTeacherGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.staffGrantTarget,
    input_masjid_id: ids.masjidA,
    input_grant: "admin_teacher",
    input_starts_on: ids.civilToday,
    input_expected_state: grantStateWithFutureMembership.data
  });
  assert.equal(partialAdminTeacherGrant.error?.code, "22023", "partial admin-teacher grant unexpectedly succeeded");
  const { data: failedGrantProfile } = await service
    .from("profiles")
    .select("role")
    .eq("id", ids.users.staffGrantTarget)
    .single<{ role: string }>();
  assert.equal(failedGrantProfile?.role, "student", "failed grant changed the profile role");
  const { count: failedGrantAdminMemberships } = await service
    .from("masjid_staff_memberships")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", ids.users.staffGrantTarget)
    .eq("staff_role", "admin");
  assert.equal(failedGrantAdminMemberships, 0, "failed grant left an admin membership");
  const { data: studentMembershipAfterFailedGrant } = await service
    .from("student_group_memberships")
    .select("ends_on")
    .eq("student_id", ids.users.staffGrantTarget)
    .single<{ ends_on: string | null }>();
  assert.equal(studentMembershipAfterFailedGrant?.ends_on, null, "failed grant closed student access");
  const { count: failedGrantAuditAfter } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.staffGrantTarget);
  assert.equal(failedGrantAuditAfter, failedGrantAuditBefore, "failed grant left audit events");
  const { error: removeFutureGrantMembershipError } = await service
    .from("masjid_staff_memberships")
    .delete()
    .eq("id", futureGrantMembership!.id);
  assert.equal(removeFutureGrantMembershipError, null, removeFutureGrantMembershipError?.message);

  const grantState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.staffGrantTarget
  });
  assert.equal(grantState.error, null, grantState.error?.message);
  const grantRequestId = randomUUID();
  const grantPreparationArgs = {
    input_request_id: grantRequestId,
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.staffGrantTarget,
    input_masjid_id: ids.masjidA,
    input_grant: "admin",
    input_starts_on: ids.civilToday
  };
  const preparedGrantState = await service.rpc(
    "prepare_super_admin_masjid_staff_grant",
    grantPreparationArgs
  );
  assert.equal(preparedGrantState.error, null, preparedGrantState.error?.message);
  assert.deepEqual(preparedGrantState.data, grantState.data);
  const adminGrantArgs = {
    ...grantPreparationArgs,
    input_expected_state: preparedGrantState.data
  };
  const concurrentAdminGrants = await Promise.all([
    service.rpc("apply_super_admin_masjid_staff_grant", adminGrantArgs),
    service.rpc("apply_super_admin_masjid_staff_grant", adminGrantArgs)
  ]);
  for (const result of concurrentAdminGrants) {
    assert.equal(result.error, null, `concurrent staff grant failed: ${result.error?.message}`);
  }
  assert.deepEqual(concurrentAdminGrants[0].data, concurrentAdminGrants[1].data);
  const replayedPreparedGrantState = await service.rpc(
    "prepare_super_admin_masjid_staff_grant",
    grantPreparationArgs
  );
  assert.equal(replayedPreparedGrantState.error, null, replayedPreparedGrantState.error?.message);
  assert.deepEqual(
    replayedPreparedGrantState.data,
    preparedGrantState.data,
    "staff grant preparation reloaded post-grant access state"
  );
  const crossActorGrantPreparation = await service.rpc("prepare_super_admin_masjid_staff_grant", {
    ...grantPreparationArgs,
    input_actor_id: ids.users.adminA
  });
  assert.equal(crossActorGrantPreparation.error?.code, "42501", "cross-actor grant preparation was accepted");
  const changedGrantPreparation = await service.rpc("prepare_super_admin_masjid_staff_grant", {
    ...grantPreparationArgs,
    input_grant: "admin_teacher"
  });
  assert.equal(changedGrantPreparation.error?.code, "22023", "changed grant preparation payload was accepted");
  const changedGrantReplay = await service.rpc("apply_super_admin_masjid_staff_grant", {
    ...adminGrantArgs,
    input_grant: "admin_teacher"
  });
  assert.equal(changedGrantReplay.error?.code, "22023", "changed staff grant replay was accepted");
  const changedExpectedStateReplay = await service.rpc("apply_super_admin_masjid_staff_grant", {
    ...adminGrantArgs,
    input_expected_state: (concurrentAdminGrants[0].data as { access_state?: unknown } | null)?.access_state
  });
  assert.equal(changedExpectedStateReplay.error, null, changedExpectedStateReplay.error?.message);
  assert.deepEqual(
    changedExpectedStateReplay.data,
    concurrentAdminGrants[0].data,
    "committed staff grant did not replay after its expected-state token changed"
  );

  const adminGrantState = (concurrentAdminGrants[0].data as { access_state?: unknown } | null)?.access_state;
  assert.ok(adminGrantState, "admin grant omitted access state");
  const adminTeacherGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    ...adminGrantArgs,
    input_request_id: randomUUID(),
    input_grant: "admin_teacher",
    input_expected_state: adminGrantState
  });
  assert.equal(adminTeacherGrant.error, null, adminTeacherGrant.error?.message);
  const { data: grantedRoles } = await service
    .from("masjid_staff_memberships")
    .select("staff_role")
    .eq("profile_id", ids.users.staffGrantTarget)
    .eq("masjid_id", ids.masjidA)
    .eq("active", true)
    .is("ends_on", null)
    .order("staff_role");
  assert.deepEqual(grantedRoles, [{ staff_role: "admin" }, { staff_role: "teacher" }]);
  const noOpGrantState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.staffGrantTarget
  });
  assert.equal(noOpGrantState.error, null, noOpGrantState.error?.message);
  const { count: noOpMembershipCountBefore } = await service
    .from("masjid_staff_memberships")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", ids.users.staffGrantTarget)
    .eq("masjid_id", ids.masjidA);
  const { count: noOpAuditCountBefore } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.staffGrantTarget);
  const noOpGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    ...adminGrantArgs,
    input_request_id: randomUUID(),
    input_grant: "admin_teacher",
    input_expected_state: noOpGrantState.data
  });
  assert.equal(noOpGrant.error, null, noOpGrant.error?.message);
  const { count: noOpMembershipCountAfter } = await service
    .from("masjid_staff_memberships")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", ids.users.staffGrantTarget)
    .eq("masjid_id", ids.masjidA);
  const { count: noOpAuditCountAfter } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.staffGrantTarget);
  assert.equal(noOpMembershipCountAfter, noOpMembershipCountBefore, "additive no-op changed staff memberships");
  assert.equal(noOpAuditCountAfter, noOpAuditCountBefore, "additive no-op wrote an audit mutation");

  const staleGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    ...adminGrantArgs,
    input_request_id: randomUUID(),
    input_expected_state: grantState.data
  });
  assert.equal(staleGrant.error?.code, "P0001", "stale staff grant was accepted");

  const replacementState = async () => {
    const result = await service.rpc("get_person_access_state", {
      input_actor_id: ids.users.superAdmin,
      input_target_profile_id: ids.users.profileTarget
    });
    assert.equal(result.error, null, result.error?.message);
    assert.ok(result.data, "replacement target access state was missing");
    return result.data;
  };
  const soleAdminGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_masjid_id: ids.masjidA,
    input_grant: "admin",
    input_starts_on: ids.civilToday,
    input_expected_state: await replacementState()
  });
  assert.equal(soleAdminGrant.error, null, soleAdminGrant.error?.message);
  const futureSoleAdminTeacherOnly = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_preset: "teacher",
    input_starts_on: addDays(ids.civilToday, 1),
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: await replacementState()
  });
  assert.equal(futureSoleAdminTeacherOnly.error?.code, "23514", "future sole-admin replacement was accepted");
  const futureDeactivation = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_preset: "inactive",
    input_starts_on: addDays(ids.civilToday, 1),
    input_selected_masjid_id: null,
    input_selected_group_id: null,
    input_expected_state: await replacementState()
  });
  assert.equal(futureDeactivation.error?.code, "23514", "future account deactivation was accepted");
  const futureSameRoleTeacherGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_masjid_id: ids.masjidB,
    input_grant: "teacher",
    input_starts_on: addDays(ids.civilToday, 2),
    input_expected_state: await replacementState()
  });
  assert.equal(futureSameRoleTeacherGrant.error, null, futureSameRoleTeacherGrant.error?.message);
  const futureSameRoleTeacherMembership = await requireData<{ id: string }>(
    "read future same-role teacher grant",
    service
      .from("masjid_staff_memberships")
      .select("id")
      .eq("profile_id", ids.users.profileTarget)
      .eq("masjid_id", ids.masjidB)
      .eq("staff_role", "teacher")
      .eq("active", true)
      .eq("starts_on", addDays(ids.civilToday, 2))
      .single()
  );
  const futureSameRoleTeacherPreview = await service.rpc("prepare_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_masjid_id: ids.masjidB,
    input_grant: "teacher",
    input_starts_on: addDays(ids.civilToday, 2)
  });
  assert.equal(futureSameRoleTeacherPreview.error, null, futureSameRoleTeacherPreview.error?.message);
  const currentStudentState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.studentA
  });
  assert.equal(currentStudentState.error, null, currentStudentState.error?.message);
  const futureStudentTeacherPreview = await service.rpc("prepare_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.studentA,
    input_masjid_id: ids.masjidA,
    input_grant: "teacher",
    input_starts_on: addDays(ids.civilToday, 2)
  });
  assert.equal(
    futureStudentTeacherPreview.error?.code,
    "23514",
    "future student-to-teacher grant preview was accepted"
  );
  const futureStudentTeacherGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.studentA,
    input_masjid_id: ids.masjidA,
    input_grant: "teacher",
    input_starts_on: addDays(ids.civilToday, 2),
    input_expected_state: currentStudentState.data
  });
  assert.equal(futureStudentTeacherGrant.error?.code, "23514", "future student-to-teacher conversion was accepted");
  const teacherState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherA
  });
  assert.equal(teacherState.error, null, teacherState.error?.message);
  const futureTeacherAdminGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherA,
    input_masjid_id: ids.masjidB,
    input_grant: "admin",
    input_starts_on: addDays(ids.civilToday, 2),
    input_expected_state: teacherState.data
  });
  assert.equal(futureTeacherAdminGrant.error?.code, "23514", "future teacher-to-admin conversion was accepted");
  const futureStaffStudent = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.teacherA,
    input_target_profile_id: ids.users.teacherA,
    input_preset: "student",
    input_starts_on: addDays(ids.civilToday, 2),
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: ids.groupA,
    input_expected_state: teacherState.data
  });
  assert.equal(futureStaffStudent.error?.code, "42501", "non-super-admin future staff-to-student RPC was not denied");
  const futureStaffStudentBySuperAdmin = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherA,
    input_preset: "student",
    input_starts_on: addDays(ids.civilToday, 2),
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: ids.groupA,
    input_expected_state: teacherState.data
  });
  assert.equal(futureStaffStudentBySuperAdmin.error?.code, "23514", "future staff-to-student conversion was accepted");
  const soleAdminTeacherOnly = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_preset: "teacher",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: await replacementState()
  });
  assert.equal(soleAdminTeacherOnly.error, null, soleAdminTeacherOnly.error?.message);
  const soleAdminTeacherOnlyProfile = await requireData<{ role: string; active: boolean }>(
    "read sole-admin teacher-only projection",
    service.from("profiles").select("role,active").eq("id", ids.users.profileTarget).single()
  );
  assert.deepEqual(soleAdminTeacherOnlyProfile, { role: "teacher", active: true });
  const soleAdminTeacherOnlyMemberships = await requireData<Array<{ masjid_id: string; staff_role: string; ends_on: string | null }>>(
    "read sole-admin teacher-only memberships",
    service
      .from("masjid_staff_memberships")
      .select("masjid_id,staff_role,ends_on")
      .eq("profile_id", ids.users.profileTarget)
      .eq("active", true)
      .eq("masjid_id", ids.masjidA)
      .gte("starts_on", ids.civilToday)
      .order("staff_role")
  );
  assert.deepEqual(soleAdminTeacherOnlyMemberships, [{ masjid_id: ids.masjidA, staff_role: "teacher", ends_on: null }]);

  const secondMasjidAdminGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_masjid_id: ids.masjidB,
    input_grant: "admin",
    input_starts_on: ids.civilToday,
    input_expected_state: await replacementState()
  });
  assert.equal(secondMasjidAdminGrant.error, null, secondMasjidAdminGrant.error?.message);
  const restoreAdminAtA = await service.rpc("apply_super_admin_masjid_staff_grant", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_masjid_id: ids.masjidA,
    input_grant: "admin",
    input_starts_on: ids.civilToday,
    input_expected_state: await replacementState()
  });
  assert.equal(restoreAdminAtA.error, null, restoreAdminAtA.error?.message);
  const crossMasjidTeacherOnly = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_preset: "teacher",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: await replacementState()
  });
  assert.equal(crossMasjidTeacherOnly.error, null, crossMasjidTeacherOnly.error?.message);
  const crossMasjidTeacherOnlyRows = await requireData<Array<{ masjid_id: string; staff_role: string; ends_on: string | null }>>(
    "read cross-masjid replacement memberships",
    service
      .from("masjid_staff_memberships")
      .select("masjid_id,staff_role,ends_on")
      .eq("profile_id", ids.users.profileTarget)
      .eq("active", true)
      .lte("starts_on", ids.civilToday)
      .gte("starts_on", ids.civilToday)
      .order("masjid_id,staff_role")
  );
  assert.deepEqual(
    crossMasjidTeacherOnlyRows,
    [
      { masjid_id: ids.masjidA, staff_role: "teacher", ends_on: null },
      { masjid_id: ids.masjidB, staff_role: "admin", ends_on: null }
    ].sort((a, b) => a.masjid_id.localeCompare(b.masjid_id)),
    "selected-masjid replacement removed access at another masjid"
  );
  const crossMasjidAdminOnly = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_preset: "admin",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: await replacementState()
  });
  assert.equal(crossMasjidAdminOnly.error, null, crossMasjidAdminOnly.error?.message);
  const crossMasjidAdminTeacher = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_preset: "admin_teacher",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: await replacementState()
  });
  assert.equal(crossMasjidAdminTeacher.error, null, crossMasjidAdminTeacher.error?.message);
  const replacementProfile = await requireData<{ role: string; active: boolean }>(
    "read final selected-masjid replacement projection",
    service.from("profiles").select("role,active").eq("id", ids.users.profileTarget).single()
  );
  assert.deepEqual(replacementProfile, { role: "admin", active: true });

  const setupTeacherArgs = {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_profile_id: ids.users.setupTeacher,
    input_name: "Setup Teacher",
    input_email: "setupteacher@rls.local",
    input_phone: "+15550001002",
    input_role: "teacher",
    input_starts_on: ids.weekStart,
    input_score_starts_on: null,
    input_masjid_id: ids.masjidA,
    input_group_id: null
  };
  const setupTeacherAuthUpdate = await service.auth.admin.updateUserById(ids.users.setupTeacher, {
    app_metadata: {
      setup_request_id: setupTeacherArgs.input_request_id,
      setup_actor_id: ids.users.adminA,
      setup_payload: {
        actor_id: ids.users.adminA,
        name: "Setup Teacher",
        email: "setupteacher@rls.local",
        phone: "+15550001002",
        role: "teacher",
        starts_on: ids.weekStart,
        masjid_id: ids.masjidA,
        group_id: null
      }
    }
  });
  assert.equal(setupTeacherAuthUpdate.error, null, setupTeacherAuthUpdate.error?.message);
  const concurrentSetupResults = await Promise.all([
    service.rpc("apply_scoped_user_setup", setupTeacherArgs),
    service.rpc("apply_scoped_user_setup", setupTeacherArgs)
  ]);
  for (const result of concurrentSetupResults) {
    assert.equal(result.error, null, `concurrent setup retry failed: ${result.error?.message}`);
  }
  assert.deepEqual(
    concurrentSetupResults[0].data,
    concurrentSetupResults[1].data,
    "concurrent setup retries returned different results"
  );
  const { count: setupTeacherMembershipCount } = await service
    .from("masjid_staff_memberships")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", ids.users.setupTeacher)
    .eq("staff_role", "teacher");
  assert.equal(setupTeacherMembershipCount, 1, "concurrent setup duplicated teacher membership");

  const crossMasjidSetup = await service.rpc("apply_scoped_user_setup", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_profile_id: ids.users.setupCrossMasjid,
    input_name: "Cross Masjid Setup",
    input_email: "setupcrossmasjid@rls.local",
    input_phone: "+15550001003",
    input_role: "student",
    input_starts_on: ids.weekStart,
    input_score_starts_on: ids.weekStart,
    input_masjid_id: ids.masjidB,
    input_group_id: ids.groupB
  });
  assert.ok(crossMasjidSetup.error, "cross-masjid setup unexpectedly succeeded");
  assert.equal(crossMasjidSetup.error?.code, "42501");
  const { count: crossMasjidProfileCount } = await service
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("id", ids.users.setupCrossMasjid);
  assert.equal(crossMasjidProfileCount, 0, "denied setup left a profile behind");

  const accessStateResult = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget
  });
  assert.equal(accessStateResult.error, null, accessStateResult.error?.message);
  assert.ok(accessStateResult.data, "access state RPC returned no state");

  const staleExpectedState = accessStateResult.data;
  const { error: staleSetupError } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", ids.users.teacherAccessTarget);
  assert.equal(staleSetupError, null, staleSetupError?.message);
  const staleAccessChange = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget,
    input_preset: "admin_teacher",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: staleExpectedState
  });
  assert.ok(staleAccessChange.error, "stale access state unexpectedly succeeded");
  assert.equal(staleAccessChange.error?.code, "P0001");
  assert.match(
    staleAccessChange.error?.message ?? "",
    /access state changed/i,
    `unexpected stale-state error: ${JSON.stringify(staleAccessChange.error)}`
  );
  const { error: restoreAccessTargetError } = await service
    .from("profiles")
    .update({ role: "teacher" })
    .eq("id", ids.users.teacherAccessTarget);
  assert.equal(restoreAccessTargetError, null, restoreAccessTargetError?.message);

  const refreshedAccessState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget
  });
  assert.equal(refreshedAccessState.error, null, refreshedAccessState.error?.message);
  const accessRequestId = randomUUID();
  const accessChangeArgs = {
    input_request_id: accessRequestId,
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget,
    input_preset: "admin_teacher",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: ids.masjidA,
    input_selected_group_id: null,
    input_expected_state: refreshedAccessState.data
  };
  const accessChangeFirst = await service.rpc("apply_super_admin_access_change", accessChangeArgs);
  assert.equal(accessChangeFirst.error, null, accessChangeFirst.error?.message);
  const { count: accessAuditCountBeforeRetry } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.teacherAccessTarget);
  const accessChangeRetry = await service.rpc("apply_super_admin_access_change", accessChangeArgs);
  assert.equal(accessChangeRetry.error, null, accessChangeRetry.error?.message);
  assert.deepEqual(accessChangeRetry.data, accessChangeFirst.data, "access retry changed the result");
  const { count: accessAuditCountAfterRetry } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.teacherAccessTarget);
  assert.equal(accessAuditCountAfterRetry, accessAuditCountBeforeRetry, "access retry duplicated audit events");
  const accessStateAfterChange = (
    accessChangeFirst.data as { access_state?: unknown } | null
  )?.access_state;
  assert.ok(accessStateAfterChange, "access change result omitted the next access state");
  const nonSundayAccessChange = await service.rpc("apply_super_admin_access_change", {
    ...accessChangeArgs,
    input_request_id: randomUUID(),
    input_starts_on: addDays(ids.civilToday, 2),
    input_expected_state: accessStateAfterChange
  });
  assert.equal(
    nonSundayAccessChange.error,
    null,
    `existing date-granular access behavior regressed: ${nonSundayAccessChange.error?.message}`
  );
  const reusedRequest = await service.rpc("apply_super_admin_access_change", {
    ...accessChangeArgs,
    input_preset: "admin"
  });
  assert.ok(reusedRequest.error, "request id reuse with changed input unexpectedly succeeded");

  const membershipEndState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget
  });
  assert.equal(membershipEndState.error, null, membershipEndState.error?.message);
  const { data: targetTeacherMembership, error: targetTeacherMembershipError } = await service
    .from("masjid_staff_memberships")
    .select("id")
    .eq("profile_id", ids.users.teacherAccessTarget)
    .eq("masjid_id", ids.masjidA)
    .eq("staff_role", "teacher")
    .eq("active", true)
    .is("ends_on", null)
    .single<{ id: string }>();
  assert.equal(targetTeacherMembershipError, null, targetTeacherMembershipError?.message);
  assert.ok(targetTeacherMembership, "access target teacher membership was not created");

  const membershipEndRequestId = randomUUID();
  const membershipEndArgs = {
    input_request_id: membershipEndRequestId,
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget,
    input_membership_id: targetTeacherMembership!.id,
    input_ends_on: ids.civilToday,
    input_expected_state: membershipEndState.data
  };
  const concurrentMembershipEnds = await Promise.all([
    service.rpc("apply_super_admin_staff_membership_end", membershipEndArgs),
    service.rpc("apply_super_admin_staff_membership_end", membershipEndArgs)
  ]);
  for (const result of concurrentMembershipEnds) {
    assert.equal(result.error, null, `concurrent membership end failed: ${result.error?.message}`);
  }
  assert.deepEqual(
    concurrentMembershipEnds[0].data,
    concurrentMembershipEnds[1].data,
    "concurrent membership end retries returned different results"
  );
  const { count: membershipEndAuditCount, error: membershipEndAuditError } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", targetTeacherMembership!.id)
    .eq("action", "staff_membership_ended");
  assert.equal(membershipEndAuditError, null, membershipEndAuditError?.message);
  assert.equal(membershipEndAuditCount, 1, "membership end retry duplicated its audit event");

  const changedMembershipEndRequest = await service.rpc("apply_super_admin_staff_membership_end", {
    ...membershipEndArgs,
    input_ends_on: addDays(ids.civilToday, 1)
  });
  assert.equal(
    changedMembershipEndRequest.error?.code,
    "22023",
    "membership end request UUID accepted changed input"
  );
  const staleMembershipEnd = await service.rpc("apply_super_admin_staff_membership_end", {
    ...membershipEndArgs,
    input_request_id: randomUUID()
  });
  assert.equal(staleMembershipEnd.error?.code, "P0001", "stale membership close was not rejected");
  assert.match(staleMembershipEnd.error?.message ?? "", /access state changed/i);

  const isolatedLastAdminMasjid = await requireData<{ id: string }>(
    "create isolated last-admin masjid",
    service
      .from("masajid")
      .insert({ name: "RLS Isolated Last Admin", slug: "rls-isolated-last-admin", active: false })
      .select("id")
      .single()
  );
  const isolatedLastAdminCohort = await requireData<{ id: string }>(
    "create isolated last-admin cohort",
    service
      .from("cohorts")
      .insert({
        masjid_id: isolatedLastAdminMasjid.id,
        kind: "brothers",
        name: "Isolated Last Admin Cohort",
        active: true,
        sort_order: 10
      })
      .select("id")
      .single()
  );
  await requireData(
    "create isolated last-admin group",
    service
      .from("halaqa_groups")
      .insert({
        cohort_id: isolatedLastAdminCohort.id,
        name: "Isolated Last Admin Group",
        active: true,
        sort_order: 10
      })
      .select("id")
  );
  const isolatedLastAdminMembership = await requireData<{ id: string }>(
    "create isolated last-admin membership",
    service
      .from("masjid_staff_memberships")
      .insert({
        profile_id: ids.users.adminB,
        masjid_id: isolatedLastAdminMasjid.id,
        staff_role: "admin",
        active: true,
        starts_on: ids.startsOn,
        created_by: ids.users.superAdmin
      })
      .select("id")
      .single()
  );
  const isolatedLastAdminActivation = await service
    .from("masajid")
    .update({ active: true })
    .eq("id", isolatedLastAdminMasjid.id);
  assert.equal(isolatedLastAdminActivation.error, null, isolatedLastAdminActivation.error?.message);

  const soleAdminEndState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB
  });
  assert.equal(soleAdminEndState.error, null, soleAdminEndState.error?.message);
  const { count: soleAdminEndAuditBefore } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", isolatedLastAdminMembership.id)
    .eq("action", "staff_membership_ended");
  const soleAdminEnd = await service.rpc("apply_super_admin_staff_membership_end", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_membership_id: isolatedLastAdminMembership.id,
    input_ends_on: ids.civilToday,
    input_expected_state: soleAdminEndState.data
  });
  assert.equal(soleAdminEnd.error?.code, "23514", "sole masjid admin close was not denied");
  const { data: soleAdminMembershipAfter } = await service
    .from("masjid_staff_memberships")
    .select("ends_on")
    .eq("id", isolatedLastAdminMembership.id)
    .single<{ ends_on: string | null }>();
  assert.equal(soleAdminMembershipAfter?.ends_on, null, "denied membership close was not rolled back");
  const { count: soleAdminEndAuditAfter } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", isolatedLastAdminMembership.id)
    .eq("action", "staff_membership_ended");
  assert.equal(soleAdminEndAuditAfter, soleAdminEndAuditBefore, "denied membership close left an audit row");

  const lastAdminState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB
  });
  assert.equal(lastAdminState.error, null, lastAdminState.error?.message);
  const { count: adminBAuditCountBefore } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.adminB);
  const removeLastMasjidAdmin = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_preset: "teacher",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: isolatedLastAdminMasjid.id,
    input_selected_group_id: null,
    input_expected_state: lastAdminState.data
  });
  assert.ok(removeLastMasjidAdmin.error, "last active masjid admin removal unexpectedly succeeded");
  assert.equal(removeLastMasjidAdmin.error?.code, "23514");
  const { data: adminBAfterRollback } = await service
    .from("profiles")
    .select("role,active")
    .eq("id", ids.users.adminB)
    .single();
  assert.deepEqual(adminBAfterRollback, { role: "admin", active: true }, "failed access change mutated profile");
  const { data: adminBStaffAfterRollback } = await service
    .from("masjid_staff_memberships")
    .select("staff_role,ends_on")
    .eq("profile_id", ids.users.adminB)
    .eq("masjid_id", isolatedLastAdminMasjid.id)
    .order("staff_role");
  assert.deepEqual(
    adminBStaffAfterRollback,
    [{ staff_role: "admin", ends_on: null }],
    "failed access change did not roll back staff mutations"
  );
  const { count: adminBAuditCountAfter } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.adminB);
  assert.equal(adminBAuditCountAfter, adminBAuditCountBefore, "failed access change left audit rows");

  const superAdminState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.superAdmin
  });
  assert.equal(superAdminState.error, null, superAdminState.error?.message);
  const selfDeactivate = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.superAdmin,
    input_preset: "inactive",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: null,
    input_selected_group_id: null,
    input_expected_state: superAdminState.data
  });
  assert.ok(selfDeactivate.error, "super admin self-deactivation unexpectedly succeeded");
  assert.equal(selfDeactivate.error?.code, "42501");

  const deniedCrossMasjidRebalance = await service.rpc("apply_cohort_group_rebalance", {
    input_cohort_id: ids.cohortWriter,
    input_week_start: ids.weekStart,
    input_rebalanced_by: ids.users.adminB,
    input_target_group_count: 2
  });
  assert.equal(deniedCrossMasjidRebalance.error?.code, "42501");

  const { data: rebalanceResult, error: rebalanceError } = await service.rpc(
    "apply_cohort_group_rebalance",
    {
      input_cohort_id: ids.cohortWriter,
      input_week_start: ids.weekStart,
      input_rebalanced_by: ids.users.adminA,
      input_target_group_count: 2
    }
  );
  assert.equal(rebalanceError, null, `guarded cohort rebalance failed: ${rebalanceError?.message}`);
  assert.deepEqual(rebalanceResult, {
    group_count: 2,
    student_count: 1,
    moved_student_count: 0
  });
  const { count: writerGroupCount, error: writerGroupCountError } = await service
    .from("halaqa_groups")
    .select("id", { count: "exact", head: true })
    .eq("cohort_id", ids.cohortWriter)
    .eq("active", true);
  assert.equal(writerGroupCountError, null, writerGroupCountError?.message);
  assert.equal(writerGroupCount, 2, "cohort rebalance did not create the missing target group");
  const { data: writerMembershipAfterRebalance } = await service
    .from("student_group_memberships")
    .select("group_id")
    .eq("student_id", ids.users.studentWriter)
    .lte("starts_on", ids.weekStart)
    .or(`ends_on.is.null,ends_on.gte.${ids.weekStart}`)
    .single();
  assert.equal(
    writerMembershipAfterRebalance?.group_id,
    ids.groupWriter,
    "balanced student moved away from the deterministic first group"
  );

  const fridayOnlyAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.fridayOnlyTeacher,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortWriter,
    week_start: ids.weekStart,
    available: true
  });
  assert.ok(fridayOnlyAvailability.error, "Friday-only teacher was accepted for the Saturday rotation event");

  const fridayOnlyAssignment = await service.from("group_teacher_assignments").upsert(
    {
      group_id: ids.groupWriter,
      teacher_id: ids.users.fridayOnlyTeacher,
      week_start: ids.weekStart,
      active: true,
      assigned_by: ids.users.adminA
    },
    { onConflict: "group_id,week_start" }
  );
  assert.ok(fridayOnlyAssignment.error, "assignment trigger accepted a teacher whose staff access ends Friday");

  const fridayOnlyAssignmentUpdate = await service
    .from("group_teacher_assignments")
    .update({ teacher_id: ids.users.fridayOnlyTeacher })
    .eq("id", ids.assignmentWriter);
  assert.ok(
    fridayOnlyAssignmentUpdate.error,
    "assignment trigger accepted an ineligible teacher through a direct service-role update"
  );

  const deactivateFridayOnlyAssignment = await service
    .from("group_teacher_assignments")
    .update({ active: false })
    .eq("id", ids.assignmentFridayOnly);
  assert.equal(
    deactivateFridayOnlyAssignment.error,
    null,
    `service-role assignment deactivation failed: ${deactivateFridayOnlyAssignment.error?.message}`
  );
  const reactivateFridayOnlyAssignment = await service
    .from("group_teacher_assignments")
    .update({ active: true })
    .eq("id", ids.assignmentFridayOnly);
  assert.ok(
    reactivateFridayOnlyAssignment.error,
    "active-only service-role reactivation bypassed Saturday eligibility"
  );

  const fridayOnlyGeneration = await service.rpc("apply_teacher_rotation_generation", {
    input_cohort_id: ids.cohortWriter,
    input_week_start: ids.weekStart,
    input_generated_by: ids.users.adminA,
    membership_closes: [],
    membership_inserts: [],
    membership_replaces: [],
    assignment_upserts: [{
      group_id: ids.groupWriter,
      teacher_id: ids.users.fridayOnlyTeacher,
      week_start: ids.weekStart
    }],
    assignment_deactivations: [],
    available_teacher_count: 1,
    group_count: 2,
    assigned_count: 1,
    warning_count: 0
  });
  assert.ok(fridayOnlyGeneration.error, "rotation RPC accepted a teacher whose staff access ends Friday");

  const { data: generatedRunId, error: generatedRunError } = await service.rpc(
    "apply_teacher_rotation_generation",
    {
      input_cohort_id: ids.cohortWriter,
      input_week_start: ids.weekStart,
      input_generated_by: ids.users.adminA,
      membership_closes: [],
      membership_inserts: [],
      membership_replaces: [],
      assignment_upserts: [{
        group_id: ids.groupWriter,
        teacher_id: ids.users.teacherA,
        week_start: ids.weekStart
      }],
      assignment_deactivations: [],
      available_teacher_count: 1,
      group_count: 2,
      assigned_count: 1,
      warning_count: 0
    }
  );
  assert.equal(generatedRunError, null, `guarded rotation generation failed: ${generatedRunError?.message}`);
  assert.ok(generatedRunId, "guarded rotation generation returned no run id");
  await assertVisible(adminA, "teacher_rotation_runs", String(generatedRunId));
  const { data: rotationAssignment, error: rotationAssignmentError } = await adminA
    .from("group_teacher_assignments")
    .select("teacher_id,group_id,week_start,assigned_by,active")
    .eq("id", ids.assignmentWriter)
    .single();
  assert.equal(rotationAssignmentError, null, rotationAssignmentError?.message);
  assert.equal(rotationAssignment?.assigned_by, ids.users.adminA, "service RPC did not update assignment attribution");

  // A signed admin may deliberately close/deactivate authorization, but may
  // never rewrite who, where, when, or by whom the history was established.
  await assertUpdateBlocked(adminA, "student_group_memberships", ids.studentMembershipA, {
    student_id: ids.users.studentNoMembership,
    group_id: ids.groupWriter,
    starts_on: addDays(ids.weekStart, -21),
    assigned_by: ids.users.adminA,
    created_at: new Date(0).toISOString()
  });
  const { data: membershipIdentity } = await adminA
    .from("student_group_memberships")
    .select("student_id,group_id,starts_on,assigned_by")
    .eq("id", ids.studentMembershipA)
    .single();
  assert.equal(membershipIdentity?.student_id, ids.users.studentA);
  assert.equal(membershipIdentity?.group_id, ids.groupA);
  const { data: closedMembership, error: closeMembershipError } = await adminA
    .from("student_group_memberships")
    .update({ ends_on: ids.civilToday })
    .eq("id", ids.studentMembershipA)
    .select("id,ends_on")
    .single();
  assert.equal(closeMembershipError, null, `deliberate membership closure failed: ${closeMembershipError?.message}`);
  assert.equal(closedMembership?.ends_on, ids.civilToday);
  await assertUpdateBlocked(adminA, "student_group_memberships", ids.studentMembershipA, { ends_on: null });

  for (const payload of [
    { teacher_id: ids.users.teacherB },
    { group_id: ids.groupA },
    { week_start: nextWeekStart },
    { assigned_by: ids.users.superAdmin },
    { created_at: new Date(0).toISOString() }
  ]) {
    await assertUpdateBlocked(adminA, "group_teacher_assignments", ids.assignmentWriter, payload);
  }
  const { data: deactivatedAssignment, error: deactivateAssignmentError } = await adminA
    .from("group_teacher_assignments")
    .update({ active: false })
    .eq("id", ids.assignmentWriter)
    .select("id,active")
    .single();
  assert.equal(deactivateAssignmentError, null, `deliberate assignment deactivation failed: ${deactivateAssignmentError?.message}`);
  assert.equal(deactivatedAssignment?.active, false);
  await assertUpdateBlocked(adminA, "group_teacher_assignments", ids.assignmentWriter, { active: true });

  for (const [table, ownId, crossId] of [
    ["checkins", ids.checkinA, ids.checkinB],
    ["checkin_items", ids.itemA, ids.itemB],
    ["weekly_plans", ids.planA, ids.planB],
    ["partner_recitations", ids.partnerA, ids.partnerB],
    ["halaqa_grades", ids.gradeA, ids.gradeB],
    ["student_group_memberships", ids.studentMembershipA, ids.studentMembershipB],
    ["group_teacher_assignments", ids.assignmentA, ids.assignmentB],
    ["teacher_rotation_availability", ids.availabilityA, ids.availabilityB]
  ] as Array<[string, string, string]>) {
    await assertVisible(teacherA, table, ownId);
    await assertHidden(teacherA, table, crossId);
  }
  await assertHidden(fridayOnlyTeacher, "group_teacher_assignments", ids.assignmentFridayOnly);
  const { data: fridayOnlyTeacherAssignmentContexts, error: fridayOnlyTeacherAssignmentContextsError } =
    await fridayOnlyTeacher.rpc("teacher_assignment_contexts");
  assert.equal(
    fridayOnlyTeacherAssignmentContextsError,
    null,
    fridayOnlyTeacherAssignmentContextsError?.message
  );
  assert.deepEqual(
    fridayOnlyTeacherAssignmentContexts,
    [],
    "Friday-only teacher received an assignment context for a Saturday halaqa week"
  );
  const { data: fridayOnlyTeacherScope } = await fridayOnlyTeacher.rpc("is_teacher_for_group_week", {
    input_group_id: ids.groupFridayOnly,
    input_week_start: ids.weekStart
  });
  assert.equal(fridayOnlyTeacherScope, false, "Friday-only teacher retained group-week authorization");
  await assertRpcDenied(fridayOnlyTeacher, "teacher_group_roster_context", {
    input_group_id: ids.groupFridayOnly,
    input_week_start: ids.weekStart
  });
  const { data: leakedTeacherProfile, error: leakedTeacherProfileError } = await teacherA
    .from("profiles")
    .select("id,name,email,phone")
    .eq("id", ids.users.studentA);
  assert.equal(leakedTeacherProfileError, null, leakedTeacherProfileError?.message);
  assert.deepEqual(leakedTeacherProfile, [], "teacher read assigned student contact columns through profiles");
  const { data: teacherCanReadProfile, error: teacherCanReadProfileError } = await teacherA.rpc(
    "can_read_profile",
    { input_profile_id: ids.users.studentA }
  );
  assert.equal(teacherCanReadProfileError, null, teacherCanReadProfileError?.message);
  assert.equal(teacherCanReadProfile, false, "can_read_profile retained teacher profile-row access");
  await assertHidden(teacherA, "profiles", ids.users.studentB);
  await assertHidden(teacherA, "checkins", ids.oldCheckinA);
  await assertHidden(teacherA, "weekly_plans", ids.oldPlanA);
  await assertHidden(teacherA, "partner_recitations", ids.oldPartnerA);
  await assertHidden(teacherA, "halaqa_grades", ids.oldGradeA);
  const { data: teacherGrade, error: teacherGradeError } = await teacherA
    .from("halaqa_grades")
    .update({ notes: "teacher scoped", graded_by: ids.users.teacherA })
    .eq("id", ids.gradeA)
    .select("id");
  assert.equal(teacherGradeError, null, teacherGradeError?.message);
  assert.equal(teacherGrade?.length, 1, "teacher should update assigned group/week grade");
  await assertUpdateBlocked(teacherA, "halaqa_grades", ids.gradeB, {
    notes: "cross-masjid",
    graded_by: ids.users.teacherA
  });

  const { data: teacherContexts, error: teacherContextsError } = await teacherA.rpc(
    "teacher_assignment_contexts"
  );
  assert.equal(teacherContextsError, null, teacherContextsError?.message);
  assert.deepEqual(
    (teacherContexts ?? []).map((row: { group_id: string }) => row.group_id),
    [ids.groupA],
    "teacher assignment projection returned an unassigned group"
  );
  assert.equal(
    (teacherContexts?.[0] as { roster_count?: number } | undefined)?.roster_count,
    3,
    "teacher assignment projection returned the wrong effective roster count"
  );

  const { data: teacherRoster, error: teacherRosterError } = await teacherA.rpc(
    "teacher_group_roster_context",
    { input_group_id: ids.groupA, input_week_start: ids.weekStart }
  );
  assert.equal(teacherRosterError, null, teacherRosterError?.message);
  assert.deepEqual(
    (teacherRoster ?? []).map((row: { student_id: string }) => row.student_id).sort(),
    [ids.users.setupStudent, ids.users.studentA, ids.users.studentA2].sort(),
    "teacher roster projection returned students outside the effective assigned group"
  );
  const expectedTeacherRosterFields = [
    "daily_checkin_days",
    "daily_points",
    "partner_points",
    "partner_rounds",
    "student_id",
    "student_name"
  ];
  const { data: assignedWeekCheckins, error: assignedWeekCheckinsError } = await teacherA
    .from("checkins")
    .select("student_id,daily_score")
    .gte("date", ids.weekStart)
    .lte("date", addDays(ids.weekStart, 6));
  assert.equal(assignedWeekCheckinsError, null, assignedWeekCheckinsError?.message);
  const expectedDailyPointsByStudent = new Map<string, number>([
    [ids.users.studentA, 0],
    [ids.users.studentA2, 0],
    [ids.users.setupStudent, 0]
  ]);
  for (const checkin of assignedWeekCheckins ?? []) {
    expectedDailyPointsByStudent.set(
      checkin.student_id,
      Math.min(700, (expectedDailyPointsByStudent.get(checkin.student_id) ?? 0) + Number(checkin.daily_score ?? 0))
    );
  }
  for (const row of teacherRoster ?? []) {
    assert.deepEqual(Object.keys(row).sort(), expectedTeacherRosterFields, "teacher roster exposed unapproved fields");
    assert.ok(!Object.values(row).includes(ids.users.studentB), "teacher roster leaked another group student");
    const hasWeeklyActivity = row.student_id !== ids.users.setupStudent;
    assert.equal(row.daily_checkin_days, hasWeeklyActivity ? 1 : 0, "teacher roster used the wrong check-in week");
    assert.equal(
      Number(row.daily_points),
      expectedDailyPointsByStudent.get(row.student_id),
      "teacher roster returned the wrong weekly daily score"
    );
    assert.equal(row.partner_rounds, hasWeeklyActivity ? 1 : 0, "teacher roster used the wrong partner-recitation week");
    assert.equal(row.partner_points, hasWeeklyActivity ? 75 : 0, "teacher roster returned the wrong partner points");
  }
  await assertRpcDenied(teacherA, "teacher_group_roster_context", {
    input_group_id: ids.groupB,
    input_week_start: ids.weekStart
  });
  await assertRpcDenied(teacherA, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: addDays(ids.weekStart, -14)
  });
  await assertRpcDenied(studentA, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: ids.weekStart
  });

  const { error: deactivateGradeTargetError } = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", ids.users.studentA2);
  assert.equal(deactivateGradeTargetError, null, deactivateGradeTargetError?.message);
  await assertUpdateBlocked(teacherA, "halaqa_grades", ids.gradeA2, {
    notes: "inactive target",
    graded_by: ids.users.teacherA
  });
  const { data: canGradeInactive } = await teacherA.rpc("can_grade_student_for_week", {
    input_student_id: ids.users.studentA2,
    input_week_start: ids.weekStart
  });
  assert.equal(canGradeInactive, false, "teacher could grade a deactivated student");
  const { error: reactivateGradeTargetError } = await service
    .from("profiles")
    .update({ active: true })
    .eq("id", ids.users.studentA2);
  assert.equal(reactivateGradeTargetError, null, reactivateGradeTargetError?.message);

  const { error: changeGradeTargetRoleError } = await service
    .from("profiles")
    .update({ role: "teacher" })
    .eq("id", ids.users.studentA2);
  assert.equal(changeGradeTargetRoleError, null, changeGradeTargetRoleError?.message);
  await assertUpdateBlocked(teacherA, "halaqa_grades", ids.gradeA2, {
    notes: "non-student target",
    graded_by: ids.users.teacherA
  });
  const { data: canGradeNonStudent } = await teacherA.rpc("can_grade_student_for_week", {
    input_student_id: ids.users.studentA2,
    input_week_start: ids.weekStart
  });
  assert.equal(canGradeNonStudent, false, "teacher could grade a non-student profile");
  const { error: restoreGradeTargetRoleError } = await service
    .from("profiles")
    .update({ role: "student" })
    .eq("id", ids.users.studentA2);
  assert.equal(restoreGradeTargetRoleError, null, restoreGradeTargetRoleError?.message);

  const { data: adminTeacherContexts, error: adminTeacherContextsError } = await adminA.rpc(
    "teacher_assignment_contexts"
  );
  assert.equal(adminTeacherContextsError, null, adminTeacherContextsError?.message);
  assert.deepEqual(
    (adminTeacherContexts ?? []).map((row: { group_id: string }) => row.group_id),
    [ids.groupAdminTeacher],
    "admin-teacher assignment projection did not use teacher capability"
  );

  const { data: pureAdminContexts, error: pureAdminContextsError } = await adminB.rpc(
    "teacher_assignment_contexts"
  );
  assert.equal(pureAdminContextsError, null, pureAdminContextsError?.message);
  assert.deepEqual(pureAdminContexts, [], "pure admin received teacher assignment context");

  const { data: historicalAdminTeacherContexts, error: historicalAdminTeacherContextsError } =
    await expiredAssignmentTeacher.rpc("teacher_assignment_contexts");
  assert.equal(historicalAdminTeacherContextsError, null, historicalAdminTeacherContextsError?.message);
  assert.deepEqual(
    (historicalAdminTeacherContexts ?? []).map((row: { week_start: string }) => row.week_start),
    [ids.previousWeekStart],
    "historical admin-teacher assignment was evaluated using today's membership instead of its week"
  );
  assert.equal(
    (historicalAdminTeacherContexts?.[0] as { roster_count?: number | null } | undefined)?.roster_count,
    null,
    "historical assignment navigation exposed a roster after operational staff access ended"
  );

  const { data: futureAdminTeacherContexts, error: futureAdminTeacherContextsError } =
    await futureAssignmentTeacher.rpc("teacher_assignment_contexts");
  assert.equal(futureAdminTeacherContextsError, null, futureAdminTeacherContextsError?.message);
  assert.deepEqual(
    (futureAdminTeacherContexts ?? []).map((row: { week_start: string }) => row.week_start),
    [addDays(ids.weekStart, 7)],
    "future admin-teacher assignment was not exposed for capability-aware navigation"
  );
  assert.equal(
    (futureAdminTeacherContexts?.[0] as { roster_count?: number | null } | undefined)?.roster_count,
    null,
    "future assignment navigation exposed a roster before its Sunday week start"
  );

  // An open-ended current teacher retains historical operational access; a
  // teacher whose staff membership ended on the prior Saturday does not.
  const historicalOpenAssignment = await service
    .from("group_teacher_assignments")
    .insert({
      group_id: ids.groupWriter,
      teacher_id: ids.users.teacherA,
      week_start: ids.previousWeekStart,
      active: true,
      assigned_by: ids.users.adminA
    });
  assert.equal(historicalOpenAssignment.error, null, historicalOpenAssignment.error?.message);
  const { data: currentTeacherHistoricalScope } = await teacherA.rpc("is_teacher_for_group_week", {
    input_group_id: ids.groupWriter,
    input_week_start: ids.previousWeekStart
  });
  assert.equal(currentTeacherHistoricalScope, true, "current teacher lost historical assigned-week access");
  const { data: saturdayEndScope } = await expiredAssignmentTeacher.rpc("is_teacher_for_group_week", {
    input_group_id: ids.groupA,
    input_week_start: ids.previousWeekStart
  });
  assert.equal(saturdayEndScope, false, "teacher ending on Saturday retained access after the event week");

  // Upcoming assignment metadata may be listed, but no roster, plan, signed
  // file, or grade authorization exists until its Sunday week_start.
  const futureWeekStart = addDays(ids.weekStart, 7);
  const { data: futureScope } = await futureAssignmentTeacher.rpc("is_teacher_for_group_week", {
    input_group_id: ids.groupA,
    input_week_start: futureWeekStart
  });
  assert.equal(futureScope, false, "future assignment granted teacher scope before its Sunday week_start");
  await assertRpcDenied(futureAssignmentTeacher, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: futureWeekStart
  });
  const futurePlan = await requireData<Array<{ id: string }>>(
    "insert future weekly plan",
    service.from("weekly_plans").insert({
      student_id: ids.users.studentA,
      week_start: futureWeekStart,
      file_path: `${ids.users.studentA}/${futureWeekStart}/plan.pdf`,
      file_name: "future-plan.pdf",
      file_type: "application/pdf",
      file_size: 4
    }).select("id")
  );
  const futurePlanPath = `${ids.users.studentA}/${futureWeekStart}/plan.pdf`;
  const futurePlanUpload = await service.storage.from("weekly-plans").upload(
    futurePlanPath,
    new Blob(["future plan"], { type: "application/pdf" }),
    { contentType: "application/pdf", upsert: true }
  );
  assert.equal(futurePlanUpload.error, null, futurePlanUpload.error?.message);
  await assertHidden(futureAssignmentTeacher, "weekly_plans", futurePlan[0].id);
  const futurePlanSigned = await futureAssignmentTeacher.storage
    .from("weekly-plans")
    .createSignedUrl(futurePlanPath, 60);
  assert.ok(futurePlanSigned.error, "future assignment signed a weekly plan before Sunday");
  const { data: futureGradeScope } = await futureAssignmentTeacher.rpc("can_grade_student_for_week", {
    input_student_id: ids.users.studentA,
    input_week_start: futureWeekStart
  });
  assert.equal(futureGradeScope, false, "future assignment granted grade access before Sunday");
  await assertInsertBlocked(futureAssignmentTeacher, "halaqa_grades", {
    student_id: ids.users.studentA,
    week_start: futureWeekStart,
    attended: true,
    attendance_points: 100,
    recitation_points: 40,
    graded_by: ids.users.futureAssignmentTeacher
  });
  const { data: noExactAssignmentScope } = await teacherB.rpc("is_teacher_for_group_week", {
    input_group_id: ids.groupA,
    input_week_start: ids.weekStart
  });
  assert.equal(noExactAssignmentScope, false, "teacher without an exact assignment received scope");

  const { data: studentTeacherContexts, error: studentTeacherContextsError } = await studentA.rpc(
    "teacher_assignment_contexts"
  );
  assert.equal(studentTeacherContextsError, null, studentTeacherContextsError?.message);
  assert.deepEqual(studentTeacherContexts, [], "student received teacher assignment context");

  const studentOwnedTables: Array<[string, string, string, string]> = [
    ["checkins", ids.checkinA, ids.checkinA2, ids.checkinB],
    ["checkin_items", ids.itemA, ids.itemA2, ids.itemB],
    ["weekly_plans", ids.planA, ids.planA2, ids.planB],
    ["partner_recitations", ids.partnerA, ids.partnerA2, ids.partnerB],
    ["halaqa_grades", ids.gradeA, ids.gradeA2, ids.gradeB]
  ];
  for (const [table, ownId, sameCohortId, crossMasjidId] of studentOwnedTables) {
    await assertVisible(studentA, table, ownId);
    await assertHidden(studentA, table, sameCohortId);
    await assertHidden(studentA, table, crossMasjidId);
  }
  await assertVisible(studentA, "accountability_obligations", ids.obligationA);
  await assertHidden(studentA, "accountability_obligations", ids.obligationB);
  await assertInsertBlocked(studentA2, "accountability_obligations", {
    student_id: ids.users.studentA2,
    week_start: ids.previousWeekStart,
    weekly_percentage: 0,
    amount_cents: 500
  });
  await assertInsertBlocked(studentA2, "accountability_obligations", {
    student_id: ids.users.studentA2,
    week_start: ids.previousWeekStart,
    weekly_percentage: 0,
    amount_cents: 3500
  });
  await assertInsertBlocked(futureMembershipStudent, "accountability_obligations", {
    student_id: ids.users.futureMembershipStudent,
    week_start: ids.previousWeekStart,
    weekly_percentage: 0,
    amount_cents: 3500
  });
  await assertRpcDenied(studentA2, "reconcile_historical_accountability_obligation", {
    input_student_id: ids.users.studentA2,
    input_week_start: ids.previousWeekStart
  });
  const { data: reconciledObligation, error: reconciledObligationError } = await service.rpc(
    "reconcile_historical_accountability_obligation",
    {
      input_student_id: ids.users.studentA2,
      input_week_start: ids.previousWeekStart
    }
  );
  assert.equal(reconciledObligationError, null, reconciledObligationError?.message);
  assert.equal(reconciledObligation?.student_id, ids.users.studentA2);
  assert.equal(reconciledObligation?.week_start, ids.previousWeekStart);
  assert.equal(Number(reconciledObligation?.weekly_percentage), 0);
  assert.equal(reconciledObligation?.amount_cents, 3500);
  assert.equal(reconciledObligation?.status, "pending");
  const { data: obligationBeforeAttestation, error: obligationBeforeAttestationError } = await studentA2
    .from("accountability_obligations")
    .select("student_id,week_start,status,masjid_id,cohort_id,halaqa_group_id")
    .eq("id", reconciledObligation.id)
    .single();
  assert.equal(obligationBeforeAttestationError, null, obligationBeforeAttestationError?.message);
  assert.deepEqual(
    obligationBeforeAttestation,
    {
      student_id: ids.users.studentA2,
      week_start: ids.previousWeekStart,
      status: "pending",
      masjid_id: ids.masjidA,
      cohort_id: ids.cohortA,
      halaqa_group_id: ids.groupA
    },
    "student obligation did not retain its authoritative historical snapshot"
  );
  const obligationScopeMatch = await studentA2.rpc("student_scope_snapshot_matches", {
    input_student_id: ids.users.studentA2,
    input_week_start: ids.previousWeekStart,
    input_masjid_id: ids.masjidA,
    input_cohort_id: ids.cohortA,
    input_group_id: ids.groupA
  });
  assert.equal(obligationScopeMatch.error, null, obligationScopeMatch.error?.message);
  assert.equal(obligationScopeMatch.data, true, "student obligation scope failed its RLS projection");
  const { data: attestedObligation, error: attestedObligationError } = await studentA2
    .from("accountability_obligations")
    .update({
      status: "attested_paid",
      attested_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", reconciledObligation.id)
    .eq("status", "pending")
    .select("id,status");
  assert.equal(attestedObligationError, null, attestedObligationError?.message);
  assert.equal(attestedObligation?.length, 1, "student self-attestation did not update its valid obligation");
  assert.equal(attestedObligation?.[0]?.status, "attested_paid");
  const settledBeforeReconcile = await requireData<Record<string, unknown>>(
    "read settled obligation before reconciliation",
    service.from("accountability_obligations")
      .select("*")
      .eq("id", reconciledObligation.id)
      .single()
  );
  const settledReconcile = await service.rpc("reconcile_historical_accountability_obligation", {
    input_student_id: ids.users.studentA2,
    input_week_start: ids.previousWeekStart
  });
  assert.equal(settledReconcile.error, null, settledReconcile.error?.message);
  assert.equal(settledReconcile.data, null, "settled reconciliation returned a mutable obligation");
  const settledAfterReconcile = await requireData<typeof settledBeforeReconcile>(
    "read settled obligation after reconciliation",
    service.from("accountability_obligations")
      .select("*")
      .eq("id", reconciledObligation.id)
      .single()
  );
  assert.deepEqual(settledAfterReconcile, settledBeforeReconcile, "settled reconciliation changed stored bytes");
  await assertVisible(studentA, "badge_awards", ids.badgeA);
  await assertHidden(studentA, "badge_awards", ids.badgeB);
  await assertHidden(studentA, "profiles", ids.users.studentA2);
  await assertHidden(studentA, "profiles", ids.users.studentB);
  await assertVisible(studentA, "student_group_memberships", ids.inactiveHistoricalMembershipA);
  await assertHidden(studentA, "halaqa_groups", ids.inactiveGroup);

  // All positive student writes below use a signed anon-key client. The
  // service role created fixtures only and does not perform these writes.
  const writerSubmission = calculateDailySubmission(
    ids.today,
    tasksForDate(ids.today).map((task) => task.key)
  );
  const { data: writerCheckin, error: writerCheckinError } = await studentWriter
    .from("checkins")
    .insert({
      student_id: ids.users.studentWriter,
      date: ids.today,
      completed: true,
      earned_weight: 0,
      total_weight: writerSubmission.totalWeight,
      daily_score: 0
    })
    .select("id,masjid_id,cohort_id,halaqa_group_id")
    .single();
  assert.equal(writerCheckinError, null, `signed student check-in insert failed: ${writerCheckinError?.message}`);
  assert.equal(writerCheckin?.masjid_id, ids.masjidA);
  assert.equal(writerCheckin?.cohort_id, ids.cohortWriter);
  assert.equal(writerCheckin?.halaqa_group_id, ids.groupWriter);
  const { error: writerItemsError } = await studentWriter.from("checkin_items").insert(
    writerSubmission.items.map((item) => ({
      checkin_id: writerCheckin!.id,
      student_id: ids.users.studentWriter,
      date: ids.today,
      task_key: item.key,
      task_label: item.label,
      weight: item.weight,
      completed: item.completed
    }))
  );
  assert.equal(writerItemsError, null, `signed student canonical item insert failed: ${writerItemsError?.message}`);
  const { data: writerParent } = await studentWriter
    .from("checkins")
    .select("earned_weight,total_weight,daily_score")
    .eq("id", writerCheckin!.id)
    .single();
  assert.equal(writerParent?.earned_weight, writerSubmission.earnedWeight);
  assert.equal(writerParent?.total_weight, writerSubmission.totalWeight);
  assert.equal(Number(writerParent?.daily_score), writerSubmission.dailyScore);

  const writerPlanPath = `${ids.users.studentWriter}/${ids.weekStart}/plan.pdf`;
  const { data: writerPlan, error: writerPlanError } = await studentWriter
    .from("weekly_plans")
    .insert({
      student_id: ids.users.studentWriter,
      week_start: ids.weekStart,
      file_path: writerPlanPath,
      file_name: "plan.pdf",
      file_type: "application/pdf",
      file_size: 4
    })
    .select("id,masjid_id,cohort_id,halaqa_group_id")
    .single();
  assert.equal(writerPlanError, null, `signed student weekly-plan metadata insert failed: ${writerPlanError?.message}`);
  assert.equal(writerPlan?.masjid_id, ids.masjidA);
  assert.equal(writerPlan?.cohort_id, ids.cohortWriter);
  assert.equal(writerPlan?.halaqa_group_id, ids.groupWriter);

  const { data: currentRound, error: currentRoundError } = await studentWriter.rpc(
    "current_partner_recitation_round"
  );
  assert.equal(currentRoundError, null, currentRoundError?.message);
  const { data: writerPartner, error: writerPartnerError } = await studentWriter
    .from("partner_recitations")
    .insert({
      student_id: ids.users.studentWriter,
      week_start: ids.weekStart,
      round: currentRound,
      points: 75
    })
    .select("id,masjid_id,cohort_id,halaqa_group_id")
    .single();
  assert.equal(writerPartnerError, null, `signed student partner confirmation failed: ${writerPartnerError?.message}`);
  assert.equal(writerPartner?.masjid_id, ids.masjidA);
  assert.equal(writerPartner?.cohort_id, ids.cohortWriter);
  assert.equal(writerPartner?.halaqa_group_id, ids.groupWriter);

  await assertInsertBlocked(service, "halaqa_grades", {
    student_id: ids.users.studentWriter,
    week_start: ids.weekStart,
    attended: true,
    attendance_points: 100,
    recitation_points: 50,
    graded_by: ids.users.adminA,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    halaqa_group_id: ids.groupA
  });

  const { data: ownAutosave, error: ownAutosaveError } = await studentA
    .from("checkins")
    .update({ note: "own autosave" })
    .eq("id", ids.checkinA)
    .select("id");
  assert.equal(ownAutosaveError, null, ownAutosaveError?.message);
  assert.equal(ownAutosave?.length, 1, "student own autosave should remain supported");
  await assertUpdateBlocked(studentA, "checkins", ids.checkinA, {
    earned_weight: 1000,
    total_weight: 1000,
    daily_score: 1000,
    date: addDays(ids.today, 1),
    updated_by_admin: ids.users.adminA
  });
  await assertUpdateBlocked(studentA, "checkin_items", ids.itemA, { weight: 1000, task_label: "Forged" });
  await assertInsertBlocked(studentA, "checkin_items", {
    checkin_id: ids.checkinA,
    student_id: ids.users.studentA,
    date: ids.today,
    task_key: "forged_task",
    task_label: "Forged",
    weight: 1000,
    completed: true
  });
  const { error: completionError } = await studentA
    .from("checkin_items")
    .update({ completed: false })
    .eq("id", ids.itemA);
  assert.equal(completionError, null, `canonical completion toggle failed: ${completionError?.message}`);
  const { data: recalculatedCheckin, error: recalculatedError } = await studentA
    .from("checkins")
    .select("daily_score,earned_weight,total_weight")
    .eq("id", ids.checkinA)
    .single<{ daily_score: number; earned_weight: number; total_weight: number }>();
  assert.equal(recalculatedError, null, recalculatedError?.message);
  assert.equal(recalculatedCheckin?.total_weight, 100);
  assert.ok(Number(recalculatedCheckin?.daily_score) < 100, "task toggle did not recalculate the score");
  await assertUpdateBlocked(studentA, "checkins", ids.checkinA2, { note: "peer" });

  const forgedPath = `${ids.users.studentB}/${ids.weekStart}/plan.pdf`;
  await assertUpdateBlocked(studentA, "weekly_plans", ids.planA, { file_path: forgedPath });
  const { data: planAfterForgery } = await studentA.from("weekly_plans").select("file_path").eq("id", ids.planA).single();
  assert.equal(planAfterForgery?.file_path, `${ids.users.studentA}/${ids.weekStart}/plan.pdf`);

  const { data: leaderboard, error: leaderboardError } = await studentA.rpc(
    "student_cohort_leaderboard_for_week",
    { input_week_start: ids.weekStart }
  );
  assert.equal(leaderboardError, null, leaderboardError?.message);
  const currentHistoricalScope = await studentA.rpc("student_historical_reporting_scope_for_week", {
    input_week_start: ids.weekStart
  });
  assert.equal(currentHistoricalScope.error, null, currentHistoricalScope.error?.message);
  assert.equal(currentHistoricalScope.data?.[0]?.group_id, ids.groupA);
  assert.ok(Array.isArray(leaderboard) && leaderboard.length === 4, "leaderboard should contain the historical cohort A population");
  assert.ok(
    leaderboard?.some((row: { student_name?: string }) => row.student_name === "staffGrantTarget"),
    "later role change removed a historically eligible peer"
  );
  const expectedLeaderboardFields = [
    "is_current_student",
    "previous_rank",
    "rank",
    "rank_change",
    "score_percentage",
    "status_label",
    "student_name",
    "total_points"
  ];
  for (const row of leaderboard ?? []) {
    assert.deepEqual(Object.keys(row).sort(), expectedLeaderboardFields, "leaderboard exposed undocumented fields");
    assert.ok(!Object.values(row).includes(ids.users.studentA2), "leaderboard exposed a peer UUID");
    assert.ok(!Object.values(row).includes(ids.users.studentB), "leaderboard exposed another masjid UUID");
  }
  assert.ok((leaderboard ?? []).some((row) => row.student_name === "studentA2"));
  assert.ok((leaderboard ?? []).some((row) => row.student_name === "Setup Student"));
  assert.ok(!(leaderboard ?? []).some((row) => row.student_name === "studentB"));
  const currentLeaderboardRow = (leaderboard ?? []).find((row) => row.is_current_student);
  assert.ok(Number(currentLeaderboardRow?.score_percentage) <= 100, "leaderboard score exceeded 100%");
  assert.equal(currentLeaderboardRow?.previous_rank, null, "inactive prior week fabricated a previous rank");
  assert.equal(
    (leaderboard ?? []).find((row) => row.student_name === "studentA2")?.previous_rank,
    null,
    "an activity-empty previous leaderboard fabricated ranks for eligible students"
  );
  const previousPeerGrade = await requireData<Array<{ id: string }>>(
    "insert prior-week peer activity",
    service.from("halaqa_grades").insert({
      student_id: ids.users.expiredMembershipStudent,
      week_start: addDays(ids.previousWeekStart, -7),
      attended: true,
      attendance_points: 100,
      recitation_points: 50,
      graded_by: ids.users.adminA
    }).select("id")
  );
  const leaderboardWithPeerActivity = await studentA2.rpc("student_cohort_leaderboard_for_week", {
    input_week_start: ids.previousWeekStart
  });
  assert.equal(leaderboardWithPeerActivity.error, null, leaderboardWithPeerActivity.error?.message);
  const zeroActivityPreviousRow = (leaderboardWithPeerActivity.data ?? []).find(
    (row: { is_current_student?: boolean }) => row.is_current_student
  );
  assert.notEqual(
    zeroActivityPreviousRow?.previous_rank,
    null,
    "an individually inactive student lost its zero-score rank in an otherwise active prior leaderboard"
  );
  const selectedWeekEntrant = (leaderboard ?? []).find(
    (row: { student_name?: string }) => row.student_name === "Setup Student"
  );
  assert.equal(selectedWeekEntrant?.previous_rank, null, "a student who joined in the selected week received a previous rank");
  const selectedWeekScoringStart = await service
    .from("profiles")
    .update({ score_starts_on: ids.weekStart })
    .eq("id", ids.users.studentA2);
  assert.equal(selectedWeekScoringStart.error, null, selectedWeekScoringStart.error?.message);
  const leaderboardAfterScoringStart = await studentA2.rpc("student_cohort_leaderboard_for_week", {
    input_week_start: ids.weekStart
  });
  assert.equal(leaderboardAfterScoringStart.error, null, leaderboardAfterScoringStart.error?.message);
  assert.equal(
    (leaderboardAfterScoringStart.data ?? []).find(
      (row: { student_name?: string }) => row.student_name === "studentA2"
    )?.previous_rank,
    null,
    "a student whose scoring began in the selected week received a previous rank"
  );
  const restoreStudentA2ScoreStart = await service
    .from("profiles")
    .update({ score_starts_on: ids.startsOn })
    .eq("id", ids.users.studentA2);
  assert.equal(restoreStudentA2ScoreStart.error, null, restoreStudentA2ScoreStart.error?.message);
  const deletePreviousPeerGrade = await service
    .from("halaqa_grades")
    .delete()
    .eq("id", previousPeerGrade[0].id);
  assert.equal(deletePreviousPeerGrade.error, null, deletePreviousPeerGrade.error?.message);

  const previousCohortWeek = addDays(ids.startsOn, -7);
  const previousCohortScoreStart = await service
    .from("profiles")
    .update({ score_starts_on: previousCohortWeek })
    .eq("id", ids.users.studentA);
  assert.equal(previousCohortScoreStart.error, null, previousCohortScoreStart.error?.message);
  const previousCohortGrade = await requireData<Array<{ id: string }>>(
    "insert previous-cohort activity",
    service.from("halaqa_grades").insert({
      student_id: ids.users.studentA,
      week_start: previousCohortWeek,
      attended: true,
      attendance_points: 100,
      recitation_points: 50,
      graded_by: ids.users.adminB
    }).select("id")
  );
  const transferBoundarySelectedGrade = await requireData<Array<{ id: string }>>(
    "insert transfer-boundary selected-week activity",
    service.from("halaqa_grades").insert({
      student_id: ids.users.studentA,
      week_start: ids.startsOn,
      attended: true,
      attendance_points: 100,
      recitation_points: 50,
      graded_by: ids.users.adminA
    }).select("id")
  );
  const transferBoundaryLeaderboard = await studentA.rpc("student_cohort_leaderboard_for_week", {
    input_week_start: ids.startsOn
  });
  assert.equal(transferBoundaryLeaderboard.error, null, transferBoundaryLeaderboard.error?.message);
  assert.equal(
    (transferBoundaryLeaderboard.data ?? []).find(
      (row: { is_current_student?: boolean }) => row.is_current_student
    )?.previous_rank,
    1,
    "previous rank did not follow the caller's previous historical cohort"
  );
  const deletePreviousCohortGrade = await service.from("halaqa_grades").delete().eq("id", previousCohortGrade[0].id);
  assert.equal(deletePreviousCohortGrade.error, null, deletePreviousCohortGrade.error?.message);
  const deleteTransferBoundarySelectedGrade = await service
    .from("halaqa_grades")
    .delete()
    .eq("id", transferBoundarySelectedGrade[0].id);
  assert.equal(
    deleteTransferBoundarySelectedGrade.error,
    null,
    deleteTransferBoundarySelectedGrade.error?.message
  );
  const restoreStudentAScoreStart = await service
    .from("profiles")
    .update({ score_starts_on: ids.startsOn })
    .eq("id", ids.users.studentA);
  assert.equal(restoreStudentAScoreStart.error, null, restoreStudentAScoreStart.error?.message);
  const setupMembershipBackdate = await service
    .from("student_group_memberships")
    .update({ starts_on: ids.previousWeekStart })
    .eq("student_id", ids.users.setupStudent);
  assert.equal(setupMembershipBackdate.error, null, setupMembershipBackdate.error?.message);
  const setupProfileBackdate = await service
    .from("profiles")
    .update({ score_starts_on: ids.previousWeekStart })
    .eq("id", ids.users.setupStudent);
  assert.equal(setupProfileBackdate.error, null, setupProfileBackdate.error?.message);
  const setupObligation = await requireData<Array<{ id: string }>>(
    "insert setup-student pending obligation",
    service.from("accountability_obligations").insert({
      student_id: ids.users.setupStudent,
      week_start: ids.previousWeekStart,
      weekly_percentage: 0,
      amount_cents: 3500
    }).select("id")
  );
  const setupObligationId = setupObligation[0].id;
  const setupNextWeek = ids.weekStart;
  const setupPreview = await service.rpc("preview_official_scoring_start_change", {
    input_actor_id: ids.users.adminA,
    input_student_id: ids.users.setupStudent,
    input_score_starts_on: setupNextWeek
  });
  assert.equal(setupPreview.error, null, setupPreview.error?.message);
  assert.equal(setupPreview.data?.direction, "forward");
  assert.equal(setupPreview.data?.pending_obligation_count, 1);
  assert.equal(setupPreview.data?.pending_amount_cents, 3500);
  const setupScoringRequestId = randomUUID();
  const setupScoringArgs = {
    input_request_id: setupScoringRequestId,
    input_actor_id: ids.users.adminA,
    input_student_id: ids.users.setupStudent,
    input_score_starts_on: setupNextWeek,
    input_expected_score_starts_on: ids.previousWeekStart,
    input_reason: "Stakeholder confirmed orientation should last one week."
  };
  const setupScoringChange = await service.rpc("apply_official_scoring_start_change", setupScoringArgs);
  assert.equal(setupScoringChange.error, null, setupScoringChange.error?.message);
  assert.equal(setupScoringChange.data?.waived_obligation_count, 1);
  const setupScoringRetry = await service.rpc("apply_official_scoring_start_change", setupScoringArgs);
  assert.equal(setupScoringRetry.error, null, setupScoringRetry.error?.message);
  assert.deepEqual(setupScoringRetry.data, setupScoringChange.data, "official scoring retry changed the result");
  const { data: setupStudentAfterScoring, error: setupStudentAfterScoringError } = await service
    .from("profiles")
    .select("score_starts_on")
    .eq("id", ids.users.setupStudent)
    .single<{ score_starts_on: string | null }>();
  assert.equal(setupStudentAfterScoringError, null, setupStudentAfterScoringError?.message);
  assert.equal(setupStudentAfterScoring?.score_starts_on, setupNextWeek);
  const { data: waivedSetupObligation, error: waivedSetupObligationError } = await service
    .from("accountability_obligations")
    .select("status,attested_paid_at,waived_by,admin_note")
    .eq("id", setupObligationId)
    .single<{
      status: string;
      attested_paid_at: string | null;
      waived_by: string | null;
      admin_note: string | null;
    }>();
  assert.equal(waivedSetupObligationError, null, waivedSetupObligationError?.message);
  assert.equal(waivedSetupObligation?.status, "waived");
  assert.equal(waivedSetupObligation?.attested_paid_at, null, "workflow marked a waived obligation paid");
  assert.equal(waivedSetupObligation?.waived_by, ids.users.adminA);
  assert.match(waivedSetupObligation?.admin_note ?? "", /not paid/i);
  const { count: setupScoringAuditCount, error: setupScoringAuditError } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.users.setupStudent)
    .eq("action", "official_scoring_start_changed");
  assert.equal(setupScoringAuditError, null, setupScoringAuditError?.message);
  assert.equal(setupScoringAuditCount, 1, "official scoring retry duplicated the profile audit");
  const { count: setupWaiverAuditCount, error: setupWaiverAuditError } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", setupObligationId)
    .eq("action", "pre_score_start_obligation_waived");
  assert.equal(setupWaiverAuditError, null, setupWaiverAuditError?.message);
  assert.equal(setupWaiverAuditCount, 1, "official scoring retry duplicated the obligation audit");
  const adminBackward = await service.rpc("apply_official_scoring_start_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_student_id: ids.users.setupStudent,
    input_score_starts_on: ids.previousWeekStart,
    input_expected_score_starts_on: setupNextWeek,
    input_reason: "Scoped admins must not backdate official scoring."
  });
  assert.equal(adminBackward.error?.code, "42501", "scoped admin backdated official scoring");
  const adminCrossMasjidPreview = await service.rpc("preview_official_scoring_start_change", {
    input_actor_id: ids.users.adminA,
    input_student_id: ids.users.studentB,
    input_score_starts_on: addDays(ids.weekStart, 7)
  });
  assert.equal(adminCrossMasjidPreview.error?.code, "42501", "scoped admin previewed another masjid");
  const superAdminBackward = await service.rpc("apply_official_scoring_start_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_student_id: ids.users.setupStudent,
    input_score_starts_on: ids.previousWeekStart,
    input_expected_score_starts_on: setupNextWeek,
    input_reason: "Super admin correction restores the confirmed original week."
  });
  assert.equal(superAdminBackward.error, null, superAdminBackward.error?.message);
  const { data: stillWaivedSetupObligation } = await service
    .from("accountability_obligations")
    .select("status")
    .eq("id", setupObligationId)
    .single<{ status: string }>();
  assert.equal(stillWaivedSetupObligation?.status, "waived", "backdating reopened a waived obligation");
  const orientationBoundaryUpdate = await service
    .from("profiles")
    .update({ score_starts_on: addDays(ids.weekStart, 7) })
    .eq("id", ids.users.studentA2);
  assert.equal(orientationBoundaryUpdate.error, null, orientationBoundaryUpdate.error?.message);
  const orientationLeaderboard = await studentA.rpc("student_cohort_leaderboard_for_week", {
    input_week_start: ids.weekStart
  });
  assert.equal(orientationLeaderboard.error, null, orientationLeaderboard.error?.message);
  assert.ok(
    !(orientationLeaderboard.data ?? []).some((row: { student_name?: string }) => row.student_name === "studentA2"),
    "orientation student appeared in a pre-start leaderboard"
  );
  const orientationWeeks = await studentA2.rpc("student_leaderboard_available_weeks");
  assert.equal(orientationWeeks.error, null, orientationWeeks.error?.message);
  assert.ok(
    !(orientationWeeks.data ?? []).some((row: { week_start?: string }) => row.week_start === ids.weekStart),
    "orientation student discovered a pre-scoring report week"
  );

  const currentReporting = await adminA.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: [ids.weekStart, ids.weekStart]
  });
  assert.equal(currentReporting.error, null, currentReporting.error?.message);
  assert.equal(
    (currentReporting.data ?? []).filter((row: { student_id: string }) => row.student_id === ids.users.studentA).length,
    1,
    "duplicate week input duplicated the historical population"
  );
  const currentStudentARow = (currentReporting.data ?? []).find(
    (row: { student_id: string }) => row.student_id === ids.users.studentA
  ) as { group_id: string; student_email: string | null; can_open_current_profile: boolean } | undefined;
  assert.deepEqual(
    currentStudentARow ? {
      group_id: currentStudentARow.group_id,
      student_email: currentStudentARow.student_email,
      can_open_current_profile: currentStudentARow.can_open_current_profile
    } : null,
    { group_id: ids.groupA, student_email: "studenta@rls.local", can_open_current_profile: true },
    "current operational profile visibility was not retained"
  );

  const transferredWeek = addDays(ids.startsOn, -28);
  const transferredScoreStart = await service
    .from("profiles")
    .update({ score_starts_on: transferredWeek })
    .eq("id", ids.users.studentA);
  assert.equal(transferredScoreStart.error, null, transferredScoreStart.error?.message);
  const transferredWeekEvidence = await requireData<Array<{ id: string }>>(
    "insert transferred-week report evidence",
    service.from("checkins").insert({
      student_id: ids.users.studentA,
      date: transferredWeek,
      completed: true,
      earned_weight: 0,
      total_weight: 100,
      daily_score: 0
    }).select("id")
  );
  const adminBHistorical = await adminB.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: [transferredWeek]
  });
  assert.equal(adminBHistorical.error, null, adminBHistorical.error?.message);
  const historicalStudentA = (adminBHistorical.data ?? []).find(
    (row: { student_id: string }) => row.student_id === ids.users.studentA
  ) as {
    group_id: string;
    masjid_id: string;
    student_email: string | null;
    student_phone: string | null;
    can_view_current_contact: boolean;
    can_open_current_profile: boolean;
  } | undefined;
  assert.deepEqual(
    historicalStudentA ? {
      group_id: historicalStudentA.group_id,
      masjid_id: historicalStudentA.masjid_id,
      student_email: historicalStudentA.student_email,
      student_phone: historicalStudentA.student_phone,
      can_view_current_contact: historicalStudentA.can_view_current_contact,
      can_open_current_profile: historicalStudentA.can_open_current_profile
    } : null,
    {
      group_id: ids.groupB,
      masjid_id: ids.masjidB,
      student_email: null,
      student_phone: null,
      can_view_current_contact: false,
      can_open_current_profile: false
    },
    "historical-only cross-masjid visibility leaked current contact/profile access"
  );

  const adminACrossMasjidHistory = await adminA.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: [transferredWeek]
  });
  assert.equal(adminACrossMasjidHistory.error, null, adminACrossMasjidHistory.error?.message);
  assert.ok(
    !(adminACrossMasjidHistory.data ?? []).some((row: { student_id: string }) => row.student_id === ids.users.studentA),
    "Admin A received a week historically scoped to Masjid B"
  );

  const superAdminHistory = await superAdmin.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: [transferredWeek, ids.weekStart]
  });
  assert.equal(superAdminHistory.error, null, superAdminHistory.error?.message);
  assert.ok(
    (superAdminHistory.data ?? []).some(
      (row: { student_id: string; masjid_id: string }) =>
        row.student_id === ids.users.studentA && row.masjid_id === ids.masjidB
    ),
    "super admin did not receive global historical scope"
  );

  const ownHistoricalPopulation = await studentA.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: [transferredWeek]
  });
  assert.equal(ownHistoricalPopulation.error, null, ownHistoricalPopulation.error?.message);
  assert.deepEqual(
    (ownHistoricalPopulation.data ?? []).map((row: { student_id: string }) => row.student_id),
    [ids.users.studentA],
    "student reporting population exposed a peer"
  );

  const historicalScope = await studentA.rpc("student_historical_reporting_scope_for_week", {
    input_week_start: transferredWeek
  });
  assert.equal(historicalScope.error, null, historicalScope.error?.message);
  assert.deepEqual(
    (historicalScope.data ?? []).map((row: { group_id: string; masjid_id: string }) => ({
      group_id: row.group_id,
      masjid_id: row.masjid_id
    })),
    [{ group_id: ids.groupB, masjid_id: ids.masjidB }],
    "student historical scope used current placement"
  );
  const historicalLeaderboard = await studentA.rpc("student_cohort_leaderboard_for_week", {
    input_week_start: transferredWeek
  });
  assert.equal(historicalLeaderboard.error, null, historicalLeaderboard.error?.message);
  assert.ok(
    (historicalLeaderboard.data ?? []).some(
      (row: { is_current_student?: boolean }) => row.is_current_student
    ),
    "evidence-backed historical leaderboard omitted the current student"
  );
  const deleteTransferredWeekEvidence = await service
    .from("checkins")
    .delete()
    .eq("id", transferredWeekEvidence[0].id);
  assert.equal(deleteTransferredWeekEvidence.error, null, deleteTransferredWeekEvidence.error?.message);
  await assertRpcDenied(studentA, "student_historical_reporting_scope_for_week", {
    input_week_start: transferredWeek
  });
  await assertRpcDenied(studentA, "student_cohort_leaderboard_for_week", {
    input_week_start: transferredWeek
  });
  const restoreTransferredScoreStart = await service
    .from("profiles")
    .update({ score_starts_on: ids.startsOn })
    .eq("id", ids.users.studentA);
  assert.equal(restoreTransferredScoreStart.error, null, restoreTransferredScoreStart.error?.message);

  const historicalScoreStart = addDays(ids.startsOn, -56);
  const historicalScoreUpdate = await service
    .from("profiles")
    .update({ score_starts_on: historicalScoreStart })
    .eq("id", ids.users.studentA);
  assert.equal(historicalScoreUpdate.error, null, historicalScoreUpdate.error?.message);
  const preAppointmentEvidence = await requireData<Array<{ id: string }>>(
    "insert pre-appointment historical evidence",
    service.from("checkins").insert({
      student_id: ids.users.studentA,
      date: historicalScoreStart,
      completed: true,
      earned_weight: 0,
      total_weight: 100,
      daily_score: 0
    }).select("id")
  );
  const adminAvailableWeeks = await adminA.rpc("historical_reporting_available_weeks");
  assert.equal(adminAvailableWeeks.error, null, adminAvailableWeeks.error?.message);
  assert.ok(
    (adminAvailableWeeks.data ?? []).some(
      (row: { week_start: string }) => row.week_start === historicalScoreStart
    ),
    "newly appointed administrator could not view earlier Masjid A reporting weeks"
  );
  const sentinelProfile = await service
    .from("profiles")
    .update({ score_starts_on: "1900-01-07" })
    .eq("id", ids.users.sentinelStudent);
  assert.equal(sentinelProfile.error, null, sentinelProfile.error?.message);
  const sentinelMembership = await requireData<Array<{ id: string }>>(
    "insert production-shaped sentinel membership",
    service.from("student_group_memberships").insert({
      student_id: ids.users.sentinelStudent,
      group_id: ids.groupA,
      starts_on: "1900-01-01",
      assigned_by: ids.users.superAdmin
    }).select("id")
  );
  assert.ok(sentinelMembership[0].id);
  const boundedWeeks = await adminA.rpc("historical_reporting_available_weeks");
  assert.equal(boundedWeeks.error, null, boundedWeeks.error?.message);
  assert.ok((boundedWeeks.data ?? []).length <= 32, "sentinel membership produced an unbounded available-week result");
  assert.ok(
    !(boundedWeeks.data ?? []).some((row: { week_start: string }) => row.week_start.startsWith("1900-")),
    "sentinel membership exposed a 1900-era empty report week"
  );
  const sentinelOnlyWeek = await adminA.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: ["1900-01-07"]
  });
  assert.equal(sentinelOnlyWeek.error, null, sentinelOnlyWeek.error?.message);
  assert.deepEqual(sentinelOnlyWeek.data, [], "a sentinel-only empty week expanded the reporting population");
  const sentinelAvailableWeeks = await sentinelStudent.rpc("student_leaderboard_available_weeks");
  assert.equal(sentinelAvailableWeeks.error, null, sentinelAvailableWeeks.error?.message);
  assert.ok(
    !(sentinelAvailableWeeks.data ?? []).some(
      (row: { week_start?: string }) => row.week_start === "1900-01-07"
    ),
    "student available weeks exposed a sentinel-only 1900 Sunday"
  );
  await assertRpcDenied(sentinelStudent, "student_historical_reporting_scope_for_week", {
    input_week_start: "1900-01-07"
  });
  await assertRpcDenied(sentinelStudent, "student_cohort_leaderboard_for_week", {
    input_week_start: "1900-01-07"
  });
  const nextTrackerWeek = addDays(ids.weekStart, 7);
  const distantFutureWeek = addDays(ids.weekStart, 364);
  for (const futureWeek of [nextTrackerWeek, distantFutureWeek]) {
    await assertRpcDenied(studentA, "student_historical_reporting_scope_for_week", {
      input_week_start: futureWeek
    });
    await assertRpcDenied(studentA, "student_cohort_leaderboard_for_week", {
      input_week_start: futureWeek
    });
  }
  const deletePreAppointmentEvidence = await service
    .from("checkins")
    .delete()
    .eq("id", preAppointmentEvidence[0].id);
  assert.equal(deletePreAppointmentEvidence.error, null, deletePreAppointmentEvidence.error?.message);
  const restoreScoreStart = await service
    .from("profiles")
    .update({ score_starts_on: ids.startsOn })
    .eq("id", ids.users.studentA);
  assert.equal(restoreScoreStart.error, null, restoreScoreStart.error?.message);

  await assertRpcDenied(adminA, "historical_reporting_students_for_weeks", {
    input_week_starts: [addDays(ids.weekStart, 2)]
  });
  await assertRpcDenied(adminA, "historical_reporting_students_for_weeks", {
    input_week_starts: []
  });
  await assertRpcDenied(teacherA, "historical_reporting_students_for_weeks", {
    input_week_starts: [ids.weekStart]
  });
  await assertRpcDenied(expiredAdmin, "historical_reporting_students_for_weeks", {
    input_week_starts: [ids.weekStart]
  });
  await assertRpcDenied(inactiveAdmin, "historical_reporting_students_for_weeks", {
    input_week_starts: [ids.weekStart]
  });
  const midweek = addDays(ids.weekStart, 2);
  await assertRpcDenied(studentA, "student_cohort_leaderboard_for_week", { input_week_start: midweek });
  await assertRpcDenied(studentA, "student_weekly_teacher_name", { input_week_start: midweek });
  await assertRpcDenied(adminA, "admin_students_for_week", { input_week_start: midweek });
  await assertRpcDenied(studentA, "student_group_for_week", {
    input_student_id: ids.users.studentA,
    input_week_start: midweek
  });
  await assertRpcDenied(studentA, "student_cohort_for_week", {
    input_student_id: ids.users.studentA,
    input_week_start: midweek
  });
  await assertRpcDenied(studentA, "student_masjid_for_week", {
    input_student_id: ids.users.studentA,
    input_week_start: midweek
  });
  await assertRpcDenied(studentA, "student_cohort_students_for_week", {
    input_student_id: ids.users.studentA,
    input_week_start: ids.weekStart
  });
  const { data: ownTeacherProjection, error: ownTeacherProjectionError } = await studentA.rpc(
    "student_weekly_teacher",
    {
      input_student_id: ids.users.studentA,
      input_week_start: ids.weekStart
    }
  );
  assert.equal(ownTeacherProjectionError, null, ownTeacherProjectionError?.message);
  assert.deepEqual(
    ownTeacherProjection,
    [{ teacher_id: ids.users.teacherA, teacher_name: "teacherA" }],
    "student historical teacher projection did not remain limited to the caller's own identity"
  );
  const { data: crossStudentTeacherProjection, error: crossStudentTeacherProjectionError } = await studentA2.rpc(
    "student_weekly_teacher",
    {
      input_student_id: ids.users.studentA,
      input_week_start: ids.weekStart
    }
  );
  assert.equal(crossStudentTeacherProjectionError, null, crossStudentTeacherProjectionError?.message);
  assert.deepEqual(crossStudentTeacherProjection, [], "student historical teacher projection leaked another student");
  await assertRpcDenied(studentA, "set_student_scope_snapshot");
  await assertRpcDenied(studentA, "set_halaqa_grade_scope_snapshot");
  await assertRpcDenied(studentA, "enforce_student_accountability_attestation");
  await assertRpcDenied(studentA, "teacher_rotation_row_scope_matches");
  const { data: crossGroup } = await studentA.rpc("student_group_for_week", {
    input_student_id: ids.users.studentB,
    input_week_start: ids.weekStart
  });
  assert.equal(crossGroup, null, "student_group_for_week leaked another student's group");
  const { data: teacherProbe } = await studentA.rpc("is_rotation_teacher_for_masjid_week", {
    input_profile_id: ids.users.teacherB,
    input_masjid_id: ids.masjidB,
    input_week_start: ids.weekStart
  });
  assert.equal(teacherProbe, false, "teacher membership probe leaked cross-scope state");

  const ownSigned = await studentA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentA}/${ids.weekStart}/plan.pdf`, 60);
  assert.equal(ownSigned.error, null, `student own weekly-plan signing failed: ${ownSigned.error?.message}`);
  const directUpload = await studentA.storage
    .from("weekly-plans")
    .upload(`${ids.users.studentA}/${ids.weekStart}/direct.pdf`, new Blob(["forbidden"]));
  assert.ok(directUpload.error, "student directly uploaded a weekly-plan object");
  const directUpdate = await studentA.storage
    .from("weekly-plans")
    .update(`${ids.users.studentA}/${ids.weekStart}/plan.pdf`, new Blob(["forbidden"]));
  assert.ok(directUpdate.error, "student directly replaced a weekly-plan object");
  const directDelete = await studentA.storage
    .from("weekly-plans")
    .remove([`${ids.users.studentA}/${ids.weekStart}/plan.pdf`]);
  assert.equal(directDelete.data?.length ?? 0, 0, "student directly deleted a weekly-plan object");
  const afterDirectDelete = await studentA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentA}/${ids.weekStart}/plan.pdf`, 60);
  assert.equal(afterDirectDelete.error, null, "blocked direct delete removed the weekly-plan object");
  const crossSigned = await studentA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentB}/${ids.weekStart}/plan.pdf`, 60);
  assert.ok(crossSigned.error, "cross-student weekly-plan signing should be denied");
  const adminOwnSigned = await adminA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentA}/${ids.weekStart}/plan.pdf`, 60);
  assert.equal(adminOwnSigned.error, null, `scoped admin weekly-plan signing failed: ${adminOwnSigned.error?.message}`);
  const adminCrossSigned = await adminA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentB}/${ids.weekStart}/plan.pdf`, 60);
  assert.ok(adminCrossSigned.error, "admin signed a cross-masjid weekly-plan path");
  const teacherAssignedSigned = await teacherA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentA}/${ids.weekStart}/plan.pdf`, 60);
  assert.equal(
    teacherAssignedSigned.error,
    null,
    `assigned teacher weekly-plan signing failed: ${teacherAssignedSigned.error?.message}`
  );
  const teacherCrossSigned = await teacherA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentB}/${ids.weekStart}/plan.pdf`, 60);
  assert.ok(teacherCrossSigned.error, "teacher signed an unassigned student's weekly plan");
  const teacherWrongWeekSigned = await teacherA.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentA}/${addDays(ids.weekStart, -14)}/plan.pdf`, 60);
  assert.ok(teacherWrongWeekSigned.error, "teacher signed a weekly plan outside the assigned week");

  const { data: canDeleteMovedStudent, error: canDeleteMovedStudentError } = await adminA.rpc(
    "can_admin_delete_student",
    { input_student_id: ids.users.studentA }
  );
  assert.equal(canDeleteMovedStudentError, null, canDeleteMovedStudentError?.message);
  assert.equal(canDeleteMovedStudent, false, "admin could globally delete a student with cross-masjid history");
  const { data: canDeleteFormerStaff, error: canDeleteFormerStaffError } = await adminA.rpc(
    "can_admin_delete_student",
    { input_student_id: ids.users.studentA2 }
  );
  assert.equal(canDeleteFormerStaffError, null, canDeleteFormerStaffError?.message);
  assert.equal(canDeleteFormerStaff, false, "admin could delete a student with historical staff access");

  for (const [name, client] of [
    ["expired", expiredAdmin],
    ["future", futureAdmin],
    ["inactive", inactiveAdmin]
  ] as const) {
    const { data: canAdmin, error } = await client.rpc("is_admin_for_masjid", {
      input_masjid_id: ids.masjidA
    });
    assert.equal(error, null, `${name} helper error: ${error?.message}`);
    assert.equal(canAdmin, false, `${name} membership granted current admin access`);
    await assertHidden(client, "checkins", ids.checkinA);
    const { data: rows, error: rowsError } = await client.rpc("admin_students_for_week", {
      input_week_start: ids.weekStart
    });
    assert.equal(rowsError, null, `${name} admin RPC error: ${rowsError?.message}`);
    assert.deepEqual(rows, [], `${name} membership leaked admin RPC rows`);
  }

  for (const [name, client] of [
    ["expired teacher", expiredTeacher],
    ["future teacher", futureTeacher],
    ["inactive teacher", inactiveTeacher]
  ] as const) {
    const { data: isStaff, error } = await client.rpc("is_staff_for_masjid", {
      input_masjid_id: ids.masjidA
    });
    assert.equal(error, null, `${name} helper error: ${error?.message}`);
    assert.equal(isStaff, false, `${name} membership granted current staff access`);
    await assertHidden(client, "checkins", ids.checkinA);
  }

  for (const [name, client, studentId, membershipId] of [
    ["expired student", expiredMembershipStudent, ids.users.expiredMembershipStudent, ids.expiredStudentMembership],
    ["future student", futureMembershipStudent, ids.users.futureMembershipStudent, ids.futureStudentMembership]
  ] as const) {
    // A profile with no currently effective placement is projected inactive,
    // so it cannot authenticate to read even its historical membership row.
    // Super-admin/service-role history reads remain available for operations.
    await assertHidden(client, "student_group_memberships", membershipId);
    await assertHidden(client, "masajid", ids.masjidA);
    await assertHidden(client, "cohorts", ids.cohortA);
    await assertHidden(client, "halaqa_groups", ids.groupA);
    const { data: currentGroup, error: currentGroupError } = await client.rpc(
      "student_group_for_week",
      {
        input_student_id: studentId,
        input_week_start: ids.weekStart
      }
    );
    assert.equal(currentGroupError, null, `${name} current group helper error: ${currentGroupError?.message}`);
    assert.equal(currentGroup, null, `${name} relationship resolved a current group`);
  }

  for (const [name, client, assignmentId] of [
    ["expired assignment", expiredAssignmentTeacher, ids.expiredTeacherAssignment],
    ["future assignment", futureAssignmentTeacher, ids.futureTeacherAssignment]
  ] as const) {
    await assertHidden(client, "group_teacher_assignments", assignmentId);
    await assertHidden(client, "masajid", ids.masjidA);
    await assertHidden(client, "cohorts", ids.cohortA);
    await assertHidden(client, "halaqa_groups", ids.groupA);
    const { data: currentTeacher, error: currentTeacherError } = await client.rpc(
      "is_teacher_for_group_week",
      { input_group_id: ids.groupA, input_week_start: ids.weekStart }
    );
    assert.equal(currentTeacherError, null, `${name} current assignment helper error: ${currentTeacherError?.message}`);
    assert.equal(currentTeacher, false, `${name} granted current teacher scope`);
  }

  // Future admin coverage must be gap-free and eventually open-ended.
  const { data: coverageMasjid, error: coverageMasjidError } = await service
    .from("masajid")
    .insert({ name: "RLS Coverage Masjid", slug: "rls-coverage-masjid", active: false })
    .select("id")
    .single<{ id: string }>();
  assert.equal(coverageMasjidError, null, coverageMasjidError?.message);
  assert.ok(coverageMasjid);
  const { data: coverageCohort, error: coverageCohortError } = await service
    .from("cohorts")
    .insert({
      masjid_id: coverageMasjid!.id,
      kind: "brothers",
      name: "RLS Coverage Cohort",
      active: true,
      sort_order: 10
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(coverageCohortError, null, coverageCohortError?.message);
  assert.ok(coverageCohort);
  const { error: coverageGroupError } = await service
    .from("halaqa_groups")
    .insert({
      cohort_id: coverageCohort!.id,
      name: "RLS Coverage Group",
      active: true,
      sort_order: 10
    });
  assert.equal(coverageGroupError, null, coverageGroupError?.message);
  const { data: coverageMembership, error: coverageMembershipError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.adminB,
      masjid_id: coverageMasjid!.id,
      staff_role: "admin",
      active: true,
      starts_on: ids.civilToday,
      created_by: ids.users.superAdmin
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(coverageMembershipError, null, coverageMembershipError?.message);
  assert.ok(coverageMembership);
  const { error: coverageActivationError } = await service
    .from("masajid")
    .update({ active: true })
    .eq("id", coverageMasjid!.id);
  assert.equal(coverageActivationError, null, coverageActivationError?.message);
  const { data: finiteReplacement, error: finiteReplacementError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.adminA,
      masjid_id: coverageMasjid!.id,
      staff_role: "admin",
      active: true,
      starts_on: addDays(ids.civilToday, 1),
      ends_on: addDays(ids.civilToday, 7),
      created_by: ids.users.superAdmin
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(finiteReplacementError, null, finiteReplacementError?.message);
  assert.ok(finiteReplacement);
  const adminBCoverageState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB
  });
  const noTerminalCoverage = await service.rpc("apply_super_admin_staff_membership_end", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_membership_id: coverageMembership!.id,
    input_ends_on: ids.civilToday,
    input_expected_state: adminBCoverageState.data
  });
  assert.equal(noTerminalCoverage.error?.code, "23514", "finite-only coverage was accepted");

  const { data: openReplacement, error: openReplacementError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.futureAdmin,
      masjid_id: coverageMasjid!.id,
      staff_role: "admin",
      active: true,
      starts_on: addDays(ids.civilToday, 9),
      created_by: ids.users.superAdmin
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(openReplacementError, null, openReplacementError?.message);
  const laterGapState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB
  });
  const laterGap = await service.rpc("apply_super_admin_staff_membership_end", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_membership_id: coverageMembership!.id,
    input_ends_on: ids.civilToday,
    input_expected_state: laterGapState.data
  });
  assert.equal(laterGap.error?.code, "23514", "later future coverage gap was accepted");
  const { error: closeGapError } = await service
    .from("masjid_staff_memberships")
    .update({ starts_on: addDays(ids.civilToday, 8) })
    .eq("id", openReplacement!.id);
  assert.equal(closeGapError, null, closeGapError?.message);
  const validHandoffState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB
  });
  const validFutureHandoff = await service.rpc("apply_super_admin_staff_membership_end", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_membership_id: coverageMembership!.id,
    input_ends_on: ids.civilToday,
    input_expected_state: validHandoffState.data
  });
  assert.equal(validFutureHandoff.error, null, validFutureHandoff.error?.message);

  const { data: concurrencyMasjid, error: concurrencyMasjidError } = await service
    .from("masajid")
    .insert({ name: "RLS Concurrency Masjid", slug: "rls-concurrency-masjid", active: false })
    .select("id")
    .single<{ id: string }>();
  assert.equal(concurrencyMasjidError, null, concurrencyMasjidError?.message);
  const { data: concurrencyCohort, error: concurrencyCohortError } = await service
    .from("cohorts")
    .insert({
      masjid_id: concurrencyMasjid!.id,
      kind: "brothers",
      name: "Concurrency Brothers",
      active: true,
      sort_order: 10
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(concurrencyCohortError, null, concurrencyCohortError?.message);
  const { error: concurrencyGroupError } = await service
    .from("halaqa_groups")
    .insert({
      cohort_id: concurrencyCohort!.id,
      name: "Concurrency Group",
      active: true,
      sort_order: 10
    });
  assert.equal(concurrencyGroupError, null, concurrencyGroupError?.message);
  const { data: concurrencyAdminMembership, error: concurrencyAdminMembershipError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.adminB,
      masjid_id: concurrencyMasjid!.id,
      staff_role: "admin",
      active: true,
      starts_on: addDays(ids.civilToday, -1),
      created_by: ids.users.superAdmin
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(concurrencyAdminMembershipError, null, concurrencyAdminMembershipError?.message);
  const { error: concurrencyActivationError } = await service
    .from("masajid")
    .update({ active: true })
    .eq("id", concurrencyMasjid!.id);
  assert.equal(concurrencyActivationError, null, concurrencyActivationError?.message);
  const concurrentEndState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB
  });
  const concurrentGrantState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminA
  });
  const concurrentEndRequestId = randomUUID();
  const concurrentEndArgs = {
    input_request_id: concurrentEndRequestId,
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_membership_id: concurrencyAdminMembership!.id,
    input_ends_on: ids.civilToday,
    input_expected_state: concurrentEndState.data
  };
  const concurrentGrantArgs = {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminA,
    input_masjid_id: concurrencyMasjid!.id,
    input_grant: "admin",
    input_starts_on: addDays(ids.civilToday, 1),
    input_expected_state: concurrentGrantState.data
  };
  const [concurrentEnd, concurrentGrant] = await Promise.all([
    service.rpc("apply_super_admin_staff_membership_end", concurrentEndArgs),
    service.rpc("apply_super_admin_masjid_staff_grant", concurrentGrantArgs)
  ]);
  assert.equal(concurrentGrant.error, null, concurrentGrant.error?.message);
  if (concurrentEnd.error) {
    assert.equal(concurrentEnd.error.code, "23514");
    const retryConcurrentEnd = await service.rpc("apply_super_admin_staff_membership_end", concurrentEndArgs);
    assert.equal(retryConcurrentEnd.error, null, retryConcurrentEnd.error?.message);
  }

  const { data: inactiveMasjidAdminMembership, error: inactiveMasjidAdminMembershipError } = await service
    .from("masjid_staff_memberships")
    .select("id")
    .eq("profile_id", ids.users.adminA)
    .eq("masjid_id", ids.inactiveMasjid)
    .eq("staff_role", "admin")
    .eq("active", true)
    .is("ends_on", null)
    .single<{ id: string }>();
  assert.equal(inactiveMasjidAdminMembershipError, null, inactiveMasjidAdminMembershipError?.message);
  const inactiveMasjidAdminState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminA
  });
  assert.equal(inactiveMasjidAdminState.error, null, inactiveMasjidAdminState.error?.message);
  const inactiveMasjidEnd = await service.rpc("apply_super_admin_staff_membership_end", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminA,
    input_membership_id: inactiveMasjidAdminMembership!.id,
    input_ends_on: ids.civilToday,
    input_expected_state: inactiveMasjidAdminState.data
  });
  assert.equal(inactiveMasjidEnd.error, null, "inactive masjid incorrectly required future admin coverage");

  const inactiveMasjidRow = await requireData<{
    id: string;
    name: string;
    slug: string;
    active: boolean;
    updated_at: string;
  }>(
    "load inactive masjid for guarded reactivation",
    service
      .from("masajid")
      .select("id,name,slug,active,updated_at")
      .eq("id", ids.inactiveMasjid)
      .single()
  );
  let inactiveMasjidExpectedState = {
    ...inactiveMasjidRow,
    updated_at: new Date(inactiveMasjidRow.updated_at).toISOString()
  };
  const guardedReactivation = await service.rpc("apply_super_admin_masjid_update", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_masjid_id: ids.inactiveMasjid,
    input_name: inactiveMasjidRow.name,
    input_slug: inactiveMasjidRow.slug,
    input_active: true,
    input_expected_state: inactiveMasjidExpectedState
  });
  assert.equal(guardedReactivation.error?.code, "23514", "guarded reactivation accepted incomplete admin coverage");

  const directServiceReactivation = await service
    .from("masajid")
    .update({ active: true })
    .eq("id", ids.inactiveMasjid);
  assert.equal(directServiceReactivation.error?.code, "23514", "service Data API bypassed reactivation coverage");
  const directBrowserReactivation = await superAdmin
    .from("masajid")
    .update({ active: true })
    .eq("id", ids.inactiveMasjid)
    .select("id")
    .single();
  assert.ok(directBrowserReactivation.error, "browser Data API bypassed service-only masjid updates");

  const inactiveEditRequestId = randomUUID();
  const inactiveEditArgs = {
    input_request_id: inactiveEditRequestId,
    input_actor_id: ids.users.superAdmin,
    input_masjid_id: ids.inactiveMasjid,
    input_name: `${inactiveMasjidRow.name} Edited`,
    input_slug: inactiveMasjidRow.slug,
    input_active: false,
    input_expected_state: inactiveMasjidExpectedState
  };
  const inactiveEdit = await service.rpc("apply_super_admin_masjid_update", inactiveEditArgs);
  assert.equal(inactiveEdit.error, null, inactiveEdit.error?.message);
  const inactiveEditResult = inactiveEdit.data as {
    masjid_state?: typeof inactiveMasjidExpectedState;
  } | null;
  assert.ok(inactiveEditResult?.masjid_state, "inactive masjid edit omitted canonical state");
  assert.equal(inactiveEditResult!.masjid_state!.active, false);
  assert.equal(inactiveEditResult!.masjid_state!.name, inactiveEditArgs.input_name);

  const replayedInactiveEdit = await service.rpc("apply_super_admin_masjid_update", {
    ...inactiveEditArgs,
    input_expected_state: inactiveEditResult!.masjid_state
  });
  assert.equal(replayedInactiveEdit.error, null, replayedInactiveEdit.error?.message);
  assert.deepEqual(replayedInactiveEdit.data, inactiveEdit.data, "committed masjid update did not replay");

  const changedInactiveEditReplay = await service.rpc("apply_super_admin_masjid_update", {
    ...inactiveEditArgs,
    input_name: `${inactiveEditArgs.input_name} Changed`,
    input_expected_state: inactiveEditResult!.masjid_state
  });
  assert.equal(changedInactiveEditReplay.error?.code, "22023", "changed masjid update reused a request ID");

  const staleInactiveEdit = await service.rpc("apply_super_admin_masjid_update", {
    ...inactiveEditArgs,
    input_request_id: randomUUID()
  });
  assert.equal(staleInactiveEdit.error?.code, "P0001", "stale masjid update unexpectedly committed");
  inactiveMasjidExpectedState = inactiveEditResult!.masjid_state!;

  const auditFailureRequestId = randomUUID();
  const auditFailureUpdate = await service.rpc("apply_super_admin_masjid_update", {
    input_request_id: auditFailureRequestId,
    input_actor_id: ids.users.superAdmin,
    input_masjid_id: ids.inactiveMasjid,
    input_name: inactiveMasjidExpectedState.name,
    input_slug: "force-audit-failure",
    input_active: false,
    input_expected_state: inactiveMasjidExpectedState
  });
  assert.equal(auditFailureUpdate.error?.code, "P0001", "forced audit failure unexpectedly committed");
  const rolledBackMasjid = await requireData<{ slug: string; active: boolean }>(
    "load masjid after forced audit failure",
    service.from("masajid").select("slug,active").eq("id", ids.inactiveMasjid).single()
  );
  assert.deepEqual(
    rolledBackMasjid,
    { slug: inactiveMasjidExpectedState.slug, active: false },
    "failed audit did not roll back the masjid update"
  );

  const validCoverageMasjid = await requireData<{
    id: string;
    name: string;
    slug: string;
    active: boolean;
    updated_at: string;
  }>(
    "create valid-coverage reactivation masjid",
    service
      .from("masajid")
      .insert({ name: "RLS Valid Reactivation", slug: "rls-valid-reactivation", active: false })
      .select("id,name,slug,active,updated_at")
      .single()
  );
  const validCoverageCohort = await requireData<{ id: string }>(
    "create valid reactivation cohort",
    service
      .from("cohorts")
      .insert({
        masjid_id: validCoverageMasjid.id,
        kind: "brothers",
        name: "Valid Reactivation Brothers",
        active: true,
        sort_order: 10
      })
      .select("id")
      .single()
  );
  await requireData<{ id: string }>(
    "create valid reactivation group",
    service
      .from("halaqa_groups")
      .insert({
        cohort_id: validCoverageCohort.id,
        name: "Valid Reactivation Group",
        active: true,
        sort_order: 10
      })
      .select("id")
      .single()
  );
  await requireData<{ id: string }>(
    "create valid reactivation coverage",
    service
      .from("masjid_staff_memberships")
      .insert({
        profile_id: ids.users.adminA,
        masjid_id: validCoverageMasjid.id,
        staff_role: "admin",
        active: true,
        starts_on: addDays(ids.civilToday, -1),
        created_by: ids.users.superAdmin
      })
      .select("id")
      .single()
  );
  const validReactivation = await service.rpc("apply_super_admin_masjid_update", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_masjid_id: validCoverageMasjid.id,
    input_name: validCoverageMasjid.name,
    input_slug: validCoverageMasjid.slug,
    input_active: true,
    input_expected_state: {
      ...validCoverageMasjid,
      updated_at: new Date(validCoverageMasjid.updated_at).toISOString()
    }
  });
  assert.equal(validReactivation.error, null, validReactivation.error?.message);

  const concurrencyMasjidClosure = await requireData<{
    id: string;
    name: string;
    slug: string;
    active: boolean;
    updated_at: string;
  }>(
    "create reactivation concurrency masjid",
    service
      .from("masajid")
      .insert({ name: "RLS Reactivation Concurrency", slug: "rls-reactivation-concurrency", active: false })
      .select("id,name,slug,active,updated_at")
      .single()
  );
  const concurrencyClosureCohort = await requireData<{ id: string }>(
    "create reactivation concurrency cohort",
    service
      .from("cohorts")
      .insert({
        masjid_id: concurrencyMasjidClosure.id,
        kind: "brothers",
        name: "Reactivation Concurrency Brothers",
        active: true,
        sort_order: 10
      })
      .select("id")
      .single()
  );
  await requireData<{ id: string }>(
    "create reactivation concurrency group",
    service
      .from("halaqa_groups")
      .insert({
        cohort_id: concurrencyClosureCohort.id,
        name: "Reactivation Concurrency Group",
        active: true,
        sort_order: 10
      })
      .select("id")
      .single()
  );
  const concurrencyCoverageMembership = await requireData<{ id: string }>(
    "create reactivation concurrency coverage",
    service
      .from("masjid_staff_memberships")
      .insert({
        profile_id: ids.users.adminA,
        masjid_id: concurrencyMasjidClosure.id,
        staff_role: "admin",
        active: true,
        starts_on: addDays(ids.civilToday, -1),
        created_by: ids.users.superAdmin
      })
      .select("id")
      .single()
  );
  const concurrencyCoverageState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminA
  });
  assert.equal(concurrencyCoverageState.error, null, concurrencyCoverageState.error?.message);
  const concurrentReactivationArgs = {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_masjid_id: concurrencyMasjidClosure.id,
    input_name: concurrencyMasjidClosure.name,
    input_slug: concurrencyMasjidClosure.slug,
    input_active: true,
    input_expected_state: {
      ...concurrencyMasjidClosure,
      updated_at: new Date(concurrencyMasjidClosure.updated_at).toISOString()
    }
  };
  const concurrentCoverageEndArgs = {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminA,
    input_membership_id: concurrencyCoverageMembership.id,
    input_ends_on: ids.civilToday,
    input_expected_state: concurrencyCoverageState.data
  };
  const [concurrentReactivationResult, concurrentCoverageEndResult] = await Promise.all([
    service.rpc("apply_super_admin_masjid_update", concurrentReactivationArgs),
    service.rpc("apply_super_admin_staff_membership_end", concurrentCoverageEndArgs)
  ]);
  assert.notEqual(
    concurrentReactivationResult.error === null,
    concurrentCoverageEndResult.error === null,
    "concurrent reactivation and last-admin end did not serialize to one safe winner"
  );
  if (concurrentReactivationResult.error) assert.equal(concurrentReactivationResult.error.code, "23514");
  if (concurrentCoverageEndResult.error) assert.equal(concurrentCoverageEndResult.error.code, "23514");
  const finalConcurrencyMasjid = await requireData<{ active: boolean }>(
    "load final reactivation concurrency masjid",
    service.from("masajid").select("active").eq("id", concurrencyMasjidClosure.id).single()
  );
  const { count: finalOpenConcurrencyAdmins, error: finalOpenConcurrencyAdminsError } = await service
    .from("masjid_staff_memberships")
    .select("id", { count: "exact", head: true })
    .eq("masjid_id", concurrencyMasjidClosure.id)
    .eq("staff_role", "admin")
    .eq("active", true)
    .is("ends_on", null);
  assert.equal(finalOpenConcurrencyAdminsError, null, finalOpenConcurrencyAdminsError?.message);
  assert.ok(!finalConcurrencyMasjid.active || (finalOpenConcurrencyAdmins ?? 0) > 0);

  await assertVisible(superAdmin, "checkins", ids.checkinA);
  await assertVisible(superAdmin, "checkins", ids.checkinB);
  await assertVisible(superAdmin, "masajid", ids.inactiveMasjid);
  await assertVisible(superAdmin, "cohorts", ids.inactiveMasjidCohort);
  await assertVisible(superAdmin, "halaqa_groups", ids.inactiveMasjidGroup);
  await assertVisible(superAdmin, "cohorts", ids.inactiveCohort);
  await assertVisible(superAdmin, "halaqa_groups", ids.inactiveCohortGroup);
  await assertVisible(superAdmin, "halaqa_groups", ids.inactiveGroup);
  // A signed super admin may read globally but cannot bypass guarded service RPCs
  // for profile or access-membership mutations through the Data API.
  await assertInsertBlocked(superAdmin, "profiles", {
    id: ids.users.profileTarget,
    name: "Direct Super Admin Profile",
    email: "profiletarget@rls.local",
    phone: null,
    role: "student",
    active: true
  });
  await assertUpdateBlocked(superAdmin, "profiles", ids.users.studentB, { active: false });
  await assertDeleteBlocked(superAdmin, "profiles", ids.users.studentB);
  await assertInsertBlocked(superAdmin, "student_group_memberships", {
    student_id: ids.users.studentB,
    group_id: ids.groupA,
    starts_on: addDays(ids.weekStart, -42),
    ends_on: addDays(ids.weekStart, -36),
    assigned_by: ids.users.superAdmin
  });
  await assertUpdateBlocked(superAdmin, "student_group_memberships", ids.studentMembershipB, {
    ends_on: ids.civilToday
  });
  await assertDeleteBlocked(superAdmin, "student_group_memberships", ids.studentMembershipB);
  await assertInsertBlocked(superAdmin, "masjid_staff_memberships", {
    profile_id: ids.users.teacherB,
    masjid_id: ids.masjidA,
    staff_role: "teacher",
    active: true,
    starts_on: addDays(ids.weekStart, -42),
    ends_on: addDays(ids.weekStart, -36),
    created_by: ids.users.superAdmin
  });
  await assertUpdateBlocked(superAdmin, "masjid_staff_memberships", ids.staffMembershipB, {
    ends_on: ids.civilToday
  });
  await assertDeleteBlocked(superAdmin, "masjid_staff_memberships", ids.staffMembershipB);
  const { data: superAccountabilityUpdate, error: superAccountabilityError } = await superAdmin
    .from("accountability_obligations")
    .update({ admin_note: "super-admin operational update" })
    .eq("id", ids.obligationA)
    .select("id");
  assert.equal(superAccountabilityError, null, superAccountabilityError?.message);
  assert.equal(superAccountabilityUpdate?.length, 1, "super admin operational update was rejected");
  const { data: auditRows, error: auditError } = await superAdmin
    .from("super_admin_audit_events")
    .select("id")
    .eq("id", ids.auditId);
  assert.equal(auditError, null, auditError?.message);
  assert.equal(auditRows?.length, 1);
  const ordinaryAudit = await adminA.from("super_admin_audit_events").select("id");
  assert.equal(ordinaryAudit.data?.length ?? 0, 0, "ordinary admin read audit rows");
  const adminAuditInsert = await adminA.from("super_admin_audit_events").insert({
    actor_id: ids.users.adminA,
    action: "forbidden"
  });
  assert.ok(adminAuditInsert.error, "ordinary admin inserted an audit row");
  await assertUpdateBlocked(adminA, "super_admin_audit_events", ids.auditId, { action: "forbidden-update" });
  await assertDeleteBlocked(adminA, "super_admin_audit_events", ids.auditId);
  const superAuditInsert = await superAdmin.from("super_admin_audit_events").insert({
    actor_id: ids.users.superAdmin,
    action: "also-forbidden"
  });
  assert.ok(superAuditInsert.error, "signed super-admin inserted an audit row directly");

  const deactivationCurrentGroup = await requireData<{ id: string }>(
    "create immediate-deactivation current group",
    service
      .from("halaqa_groups")
      .insert({
        cohort_id: ids.cohortA,
        name: "Immediate Deactivation Current Group",
        active: true,
        sort_order: 90
      })
      .select("id")
      .single()
  );
  const deactivationFutureGroup = await requireData<{ id: string }>(
    "create immediate-deactivation future group",
    service
      .from("halaqa_groups")
      .insert({
        cohort_id: ids.cohortB,
        name: "Immediate Deactivation Future Group",
        active: true,
        sort_order: 90
      })
      .select("id")
      .single()
  );
  const deactivationCurrentStudentMembership = await requireData<{ id: string }>(
    "create current membership for immediate deactivation",
    service
      .from("student_group_memberships")
      .insert({
        student_id: ids.users.profileTarget,
        group_id: deactivationCurrentGroup.id,
        starts_on: ids.startsOn,
        ends_on: addDays(ids.civilToday, 1),
        assigned_by: ids.users.superAdmin
      })
      .select("id")
      .single()
  );
  const deactivationFutureStudentMembership = await requireData<{ id: string }>(
    "create future membership for immediate deactivation",
    service
      .from("student_group_memberships")
      .insert({
        student_id: ids.users.profileTarget,
        group_id: deactivationFutureGroup.id,
        starts_on: addDays(ids.civilToday, 2),
        assigned_by: ids.users.superAdmin
      })
      .select("id")
      .single()
  );
  await requireData<{ id: string }>(
    "create historical student display membership for immediate deactivation",
    service
      .from("student_group_memberships")
      .insert({
        student_id: ids.users.studentNoMembership,
        group_id: deactivationCurrentGroup.id,
        starts_on: ids.previousWeekStart,
        ends_on: ids.previousWeekStart,
        assigned_by: ids.users.superAdmin
      })
      .select("id")
      .single()
  );
  const deactivationCurrentStaffMembership = await requireData<{ id: string }>(
    "backdate current staff membership for immediate deactivation",
    service
      .from("masjid_staff_memberships")
      .update({ starts_on: ids.startsOn })
      .eq("profile_id", ids.users.profileTarget)
      .eq("masjid_id", ids.masjidA)
      .eq("staff_role", "teacher")
      .eq("active", true)
      .is("ends_on", null)
      .select("id")
      .single()
  );
  const deactivationSameDayStaffMemberships = await requireData<Array<{ id: string; masjid_id: string }>>(
    "read same-day staff memberships for immediate deactivation",
    service
      .from("masjid_staff_memberships")
      .select("id,masjid_id")
      .eq("profile_id", ids.users.profileTarget)
      .eq("active", true)
      .eq("starts_on", ids.civilToday)
  );
  const deactivationFutureStaffMembership = futureSameRoleTeacherMembership;
  await requireData<Array<{ id: string }>>(
    "create exact availability for immediate-deactivation assignments",
    service
      .from("teacher_rotation_availability")
      .insert([
        {
          teacher_id: ids.users.profileTarget,
          masjid_id: ids.masjidA,
          cohort_id: ids.cohortA,
          week_start: ids.previousWeekStart,
          available: true
        },
        {
          teacher_id: ids.users.profileTarget,
          masjid_id: ids.masjidA,
          cohort_id: ids.cohortA,
          week_start: ids.weekStart,
          available: true
        },
        {
          teacher_id: ids.users.profileTarget,
          masjid_id: ids.masjidB,
          cohort_id: ids.cohortB,
          week_start: addDays(ids.weekStart, 7),
          available: true
        }
      ])
      .select("id")
  );
  const deactivationAssignments = await requireData<Array<{ id: string; week_start: string }>>(
    "create immediate-deactivation assignments",
    service
      .from("group_teacher_assignments")
      .insert([
        {
          group_id: deactivationCurrentGroup.id,
          teacher_id: ids.users.profileTarget,
          week_start: ids.previousWeekStart,
          active: true,
          assigned_by: ids.users.superAdmin
        },
        {
          group_id: deactivationCurrentGroup.id,
          teacher_id: ids.users.profileTarget,
          week_start: ids.weekStart,
          active: true,
          assigned_by: ids.users.superAdmin
        },
        {
          group_id: deactivationFutureGroup.id,
          teacher_id: ids.users.profileTarget,
          week_start: addDays(ids.weekStart, 7),
          active: true,
          assigned_by: ids.users.superAdmin
        }
      ])
      .select("id,week_start")
  );
  const deactivationState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget
  });
  assert.equal(deactivationState.error, null, deactivationState.error?.message);
  const immediateDeactivation = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.profileTarget,
    input_preset: "inactive",
    input_starts_on: ids.civilToday,
    input_selected_masjid_id: null,
    input_selected_group_id: null,
    input_expected_state: deactivationState.data
  });
  assert.equal(immediateDeactivation.error, null, immediateDeactivation.error?.message);
  const deactivationResult = immediateDeactivation.data as {
    deactivation?: { affected_assignment_count?: number; affected_assignment_ids?: string[] };
  } | null;
  const expectedDeactivatedAssignmentIds = deactivationAssignments
    .filter(({ week_start }) => week_start >= ids.weekStart)
    .map(({ id }) => id)
    .sort();
  assert.deepEqual(
    {
      count: deactivationResult?.deactivation?.affected_assignment_count,
      ids: [...(deactivationResult?.deactivation?.affected_assignment_ids ?? [])].sort()
    },
    { count: expectedDeactivatedAssignmentIds.length, ids: expectedDeactivatedAssignmentIds },
    "immediate deactivation did not return affected assignment identifiers"
  );
  const deactivatedProfile = await requireData<{ role: string; active: boolean }>(
    "read profile after immediate deactivation",
    service.from("profiles").select("role,active").eq("id", ids.users.profileTarget).single()
  );
  assert.deepEqual(deactivatedProfile, { role: "admin", active: false });
  const deactivatedCurrentStudent = await requireData<{ ends_on: string | null }>(
    "read closed current student membership after deactivation",
    service.from("student_group_memberships").select("ends_on").eq("id", deactivationCurrentStudentMembership.id).single()
  );
  assert.equal(deactivatedCurrentStudent.ends_on, addDays(ids.civilToday, -1));
  const { data: cancelledFutureStudent, error: cancelledFutureStudentError } = await service
    .from("student_group_memberships")
    .select("id")
    .eq("id", deactivationFutureStudentMembership.id);
  assert.equal(cancelledFutureStudentError, null, cancelledFutureStudentError?.message);
  assert.deepEqual(cancelledFutureStudent, [], "future student membership survived deactivation");
  const deactivatedCurrentStaff = await requireData<{ active: boolean; ends_on: string | null }>(
    "read closed current staff membership after deactivation",
    service.from("masjid_staff_memberships").select("active,ends_on").eq("id", deactivationCurrentStaffMembership.id).single()
  );
  assert.deepEqual(deactivatedCurrentStaff, { active: true, ends_on: addDays(ids.civilToday, -1) });
  const deactivatedFutureStaff = await requireData<{ active: boolean; ends_on: string | null }>(
    "read cancelled future staff membership after deactivation",
    service.from("masjid_staff_memberships").select("active,ends_on").eq("id", deactivationFutureStaffMembership.id).single()
  );
  assert.deepEqual(deactivatedFutureStaff, { active: false, ends_on: addDays(ids.civilToday, 2) });
  const deactivationAssignmentStates = await requireData<Array<{ id: string; active: boolean }>>(
    "read assignment states after immediate deactivation",
    service
      .from("group_teacher_assignments")
      .select("id,active")
      .in("id", deactivationAssignments.map(({ id }) => id))
      .order("id")
  );
  assert.deepEqual(
    deactivationAssignmentStates,
    deactivationAssignments.map(({ id, week_start }) => ({ id, active: week_start < ids.weekStart })).sort((a, b) => a.id.localeCompare(b.id)),
    "deactivation did not preserve past or disable current/future assignments"
  );
  const historicalDeactivationTeacher = await adminA.rpc("student_weekly_teacher", {
    input_student_id: ids.users.studentNoMembership,
    input_week_start: ids.previousWeekStart
  });
  assert.equal(historicalDeactivationTeacher.error, null, historicalDeactivationTeacher.error?.message);
  assert.deepEqual(
    historicalDeactivationTeacher.data,
    [{ teacher_id: ids.users.profileTarget, teacher_name: "profileTarget" }],
    "immediate deactivation removed historical teacher identity"
  );
  const deactivationAuditRows = await requireData<Array<{ action: string; target_id: string }>>(
    "read immediate deactivation audit rows",
    service
      .from("super_admin_audit_events")
      .select("action,target_id")
      .in("target_id", [
        deactivationCurrentStudentMembership.id,
        deactivationFutureStudentMembership.id,
        deactivationCurrentStaffMembership.id,
        deactivationFutureStaffMembership.id,
        ...deactivationSameDayStaffMemberships.map(({ id }) => id),
        ...deactivationAssignments.map(({ id }) => id)
      ])
      .in("action", [
        "student_membership_cancelled",
        "student_membership_closed",
        "staff_membership_cancelled",
        "staff_membership_closed",
        "teacher_assignment_deactivated"
      ])
  );
  assert.equal(
    deactivationAuditRows.length,
    8,
    "immediate deactivation did not audit every affected membership and assignment"
  );
  const preservedAuthUser = await service.auth.admin.getUserById(ids.users.profileTarget);
  assert.equal(preservedAuthUser.error, null, preservedAuthUser.error?.message);
  assert.equal(preservedAuthUser.data.user?.id, ids.users.profileTarget);
  const deactivatedProfileRefresh = await profileTarget.rpc("refresh_current_profile_role");
  assert.equal(deactivatedProfileRefresh.error, null, deactivatedProfileRefresh.error?.message);
  assert.equal((deactivatedProfileRefresh.data as { active?: boolean } | null)?.active, false);
  await assertHidden(profileTarget, "masjid_staff_memberships", deactivationCurrentStaffMembership.id);
  await assertHidden(profileTarget, "student_group_memberships", deactivationCurrentStudentMembership.id);

  const temporaryGroupCleanup = await service
    .from("halaqa_groups")
    .update({ active: false })
    .in("id", [deactivationCurrentGroup.id, deactivationFutureGroup.id]);
  assert.equal(temporaryGroupCleanup.error, null, temporaryGroupCleanup.error?.message);

  // The current week's Saturday is the authorization event. A teacher who
  // starts on that Saturday (and whose membership ends that day) is eligible
  // for this Sunday-Saturday tracker week, even before their first civil day
  // of staff access arrives.
  const currentSaturday = addDays(ids.weekStart, 6);
  const saturdayStartStaff = await service
    .from("masjid_staff_memberships")
    .update({ starts_on: currentSaturday, ends_on: currentSaturday })
    .eq("profile_id", ids.users.futureTeacher)
    .eq("masjid_id", ids.masjidA)
    .eq("staff_role", "teacher");
  assert.equal(saturdayStartStaff.error, null, saturdayStartStaff.error?.message);
  const saturdayStartAvailability = await service.from("teacher_rotation_availability").upsert({
    teacher_id: ids.users.futureTeacher,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  }, { onConflict: "teacher_id,cohort_id,week_start" });
  assert.equal(saturdayStartAvailability.error, null, saturdayStartAvailability.error?.message);
  const saturdayStartAssignment = await service
    .from("group_teacher_assignments")
    .update({ teacher_id: ids.users.futureTeacher })
    .eq("id", ids.assignmentAdminTeacher);
  assert.equal(saturdayStartAssignment.error, null, saturdayStartAssignment.error?.message);
  const { data: saturdayStartScope, error: saturdayStartScopeError } = await futureTeacher.rpc(
    "is_teacher_for_group_week",
    { input_group_id: ids.groupAdminTeacher, input_week_start: ids.weekStart }
  );
  assert.equal(saturdayStartScopeError, null, saturdayStartScopeError?.message);
  assert.equal(saturdayStartScope, true, "Saturday-starting teacher was denied during the tracker week");
  const saturdayStartRoster = await futureTeacher.rpc("teacher_group_roster_context", {
    input_group_id: ids.groupAdminTeacher,
    input_week_start: ids.weekStart
  });
  assert.equal(saturdayStartRoster.error, null, saturdayStartRoster.error?.message);

  const { data: historicalTeacherName, error: historicalTeacherNameError } = await studentA.rpc(
    "student_weekly_teacher_name",
    { input_week_start: ids.previousWeekStart }
  );
  assert.equal(historicalTeacherNameError, null, historicalTeacherNameError?.message);
  assert.deepEqual(
    historicalTeacherName,
    [{ teacher_name: "expiredAssignmentTeacher" }],
    "student lost the historical teacher name after hierarchy deactivation"
  );
  const { data: historicalTeacherProjection, error: historicalTeacherProjectionError } = await studentA.rpc(
    "student_weekly_teacher",
    { input_student_id: ids.users.studentA, input_week_start: ids.previousWeekStart }
  );
  assert.equal(historicalTeacherProjectionError, null, historicalTeacherProjectionError?.message);
  assert.deepEqual(
    historicalTeacherProjection,
    [{ teacher_id: ids.users.expiredAssignmentTeacher, teacher_name: "expiredAssignmentTeacher" }],
    "server-side historical teacher projection lost assignment identity"
  );
  const { data: adminHistoricalTeacherProjection, error: adminHistoricalTeacherProjectionError } = await adminA.rpc(
    "student_weekly_teacher",
    { input_student_id: ids.users.studentA, input_week_start: ids.previousWeekStart }
  );
  assert.equal(adminHistoricalTeacherProjectionError, null, adminHistoricalTeacherProjectionError?.message);
  assert.deepEqual(
    adminHistoricalTeacherProjection,
    [{ teacher_id: ids.users.expiredAssignmentTeacher, teacher_name: "expiredAssignmentTeacher" }],
    "scoped admin lost the historical teacher name after hierarchy deactivation"
  );

  const deactivateHistoricalTeacherProfile = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", ids.users.expiredAssignmentTeacher);
  assert.equal(
    deactivateHistoricalTeacherProfile.error,
    null,
    `deactivate historical teacher profile: ${deactivateHistoricalTeacherProfile.error?.message}`
  );
  const { data: inactiveProfileHistoricalTeacherName, error: inactiveProfileHistoricalTeacherNameError } =
    await studentA.rpc("student_weekly_teacher_name", { input_week_start: ids.previousWeekStart });
  assert.equal(
    inactiveProfileHistoricalTeacherNameError,
    null,
    inactiveProfileHistoricalTeacherNameError?.message
  );
  assert.deepEqual(
    inactiveProfileHistoricalTeacherName,
    [{ teacher_name: "expiredAssignmentTeacher" }],
    "student lost the historical teacher name after the teacher profile was deactivated"
  );

  for (const [table, id] of [
    ["halaqa_groups", ids.groupA],
    ["cohorts", ids.cohortA],
    ["masajid", ids.masjidA]
  ] as const) {
    const { error } = await service.from(table).update({ active: false }).eq("id", id);
    assert.equal(error, null, `deactivate ${table} historical fixture: ${error?.message}`);
  }
  const inactiveHierarchyHistory = await superAdmin.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: [ids.weekStart]
  });
  assert.equal(inactiveHierarchyHistory.error, null, inactiveHierarchyHistory.error?.message);
  assert.ok(
    (inactiveHierarchyHistory.data ?? []).some(
      (row: { student_id: string; group_id: string }) =>
        row.student_id === ids.users.studentA && row.group_id === ids.groupA
    ),
    "later hierarchy/profile deactivation erased the historical reporting population"
  );
  const studentAfterHierarchyDeactivation = await requireData<{ role: string; active: boolean }>(
    "read student projection after hierarchy deactivation",
    service.from("profiles").select("role,active").eq("id", ids.users.studentA).single()
  );
  assert.deepEqual(studentAfterHierarchyDeactivation, { role: "student", active: false });
  await assertHidden(studentA, "profiles", ids.users.studentA);
  await assertHidden(studentA, "student_group_memberships", ids.studentMembershipA);

  const { data: inactiveHistoricalContexts, error: inactiveHistoricalContextsError } =
    await expiredAssignmentTeacher.rpc("teacher_assignment_contexts");
  assert.equal(inactiveHistoricalContextsError, null, inactiveHistoricalContextsError?.message);
  assert.deepEqual(
    (inactiveHistoricalContexts ?? []).map((row: { group_id: string; week_start: string }) => ({
      group_id: row.group_id,
      week_start: row.week_start
    })),
    [{ group_id: ids.groupA, week_start: ids.previousWeekStart }],
    "completed assignment labels disappeared after hierarchy deactivation"
  );

  // A Saturday-ended staff membership is historical display evidence only
  // after that event. It must not leave roster, plan, signed-file, or grade
  // authorization on the next Sunday (or any later request date).
  await assertRpcDenied(expiredAssignmentTeacher, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: ids.previousWeekStart
  });
  await assertHidden(expiredAssignmentTeacher, "weekly_plans", ids.historicalPlanA);
  await assertHidden(expiredAssignmentTeacher, "halaqa_grades", ids.historicalGradeA);
  await assertUpdateBlocked(expiredAssignmentTeacher, "halaqa_grades", ids.historicalGradeA, {
    notes: "offboarded historical teacher update",
    graded_by: ids.users.expiredAssignmentTeacher
  });
  await assertInsertBlocked(expiredAssignmentTeacher, "halaqa_grades", {
    student_id: ids.users.studentA2,
    week_start: ids.previousWeekStart,
    attended: true,
    attendance_points: 100,
    recitation_points: 42,
    notes: "offboarded historical teacher insert",
    graded_by: ids.users.expiredAssignmentTeacher
  });

  await assertUpdateBlocked(teacherB, "halaqa_grades", ids.historicalGradeA, {
    notes: "wrong historical teacher",
    graded_by: ids.users.teacherB
  });
  await assertUpdateBlocked(expiredAssignmentTeacher, "halaqa_grades", ids.gradeA, {
    notes: "wrong assignment week",
    graded_by: ids.users.expiredAssignmentTeacher
  });
  await assertInsertBlocked(expiredAssignmentTeacher, "halaqa_grades", {
    student_id: ids.users.studentA2,
    week_start: addDays(ids.previousWeekStart, -7),
    attended: true,
    attendance_points: 100,
    recitation_points: 40,
    graded_by: ids.users.expiredAssignmentTeacher
  });
  const historicalPlanSigned = await expiredAssignmentTeacher.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentA}/${ids.previousWeekStart}/plan.pdf`, 60);
  assert.ok(historicalPlanSigned.error, "offboarded teacher signed a completed assignment plan");

  await assertRpcDenied(teacherB, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: ids.previousWeekStart
  });
  await assertHidden(teacherB, "weekly_plans", ids.historicalPlanA);
  await assertHidden(teacherB, "halaqa_grades", ids.historicalGradeA);
  const wrongTeacherHistoricalPlan = await teacherB.storage
    .from("weekly-plans")
    .createSignedUrl(`${ids.users.studentA}/${ids.previousWeekStart}/plan.pdf`, 60);
  assert.ok(wrongTeacherHistoricalPlan.error, "wrong teacher signed a completed assignment plan");
  await assertRpcDenied(expiredAssignmentTeacher, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: ids.weekStart
  });
  await assertRpcDenied(teacherA, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: ids.weekStart
  });
  await assertRpcDenied(futureAssignmentTeacher, "teacher_group_roster_context", {
    input_group_id: ids.groupA,
    input_week_start: addDays(ids.weekStart, 7)
  });
  const { data: inactiveCurrentContexts } = await teacherA.rpc("teacher_assignment_contexts");
  assert.deepEqual(
    (inactiveCurrentContexts ?? []).map((row: { group_id: string; week_start: string; roster_count: number | null }) => ({
      group_id: row.group_id,
      week_start: row.week_start,
      roster_count: row.roster_count
    })),
    [{ group_id: ids.groupWriter, week_start: ids.previousWeekStart, roster_count: null }],
    "inactive hierarchy exposed a current assignment or roster instead of only the completed historical label"
  );
  const { data: inactiveFutureContexts } = await futureAssignmentTeacher.rpc("teacher_assignment_contexts");
  assert.deepEqual(inactiveFutureContexts, [], "inactive hierarchy exposed a future assignment");
  await assertHidden(expiredAssignmentTeacher, "masajid", ids.masjidA);
  await assertHidden(expiredAssignmentTeacher, "cohorts", ids.cohortA);
  await assertHidden(expiredAssignmentTeacher, "halaqa_groups", ids.groupA);

  for (const [table, id] of [
    ["masajid", ids.masjidA],
    ["cohorts", ids.cohortA],
    ["halaqa_groups", ids.groupA]
  ] as const) {
    const { error } = await service.from(table).update({ active: true }).eq("id", id);
    assert.equal(error, null, `restore ${table} historical fixture: ${error?.message}`);
  }
  const studentAfterHierarchyReactivation = await requireData<{ role: string; active: boolean }>(
    "read student projection after hierarchy reactivation",
    service.from("profiles").select("role,active").eq("id", ids.users.studentA).single()
  );
  assert.deepEqual(studentAfterHierarchyReactivation, { role: "student", active: true });

  const laterRoleChange = await service
    .from("profiles")
    .update({ role: "teacher", active: true })
    .eq("id", ids.users.studentA);
  assert.equal(laterRoleChange.error, null, laterRoleChange.error?.message);
  const roleChangedHistory = await adminA.rpc("historical_reporting_students_for_weeks", {
    input_week_starts: [ids.weekStart]
  });
  assert.equal(roleChangedHistory.error, null, roleChangedHistory.error?.message);
  const roleChangedStudent = (roleChangedHistory.data ?? []).find(
    (row: { student_id: string }) => row.student_id === ids.users.studentA
  ) as { student_email: string | null; can_open_current_profile: boolean } | undefined;
  assert.deepEqual(
    roleChangedStudent ? {
      student_email: roleChangedStudent.student_email,
      can_open_current_profile: roleChangedStudent.can_open_current_profile
    } : null,
    { student_email: null, can_open_current_profile: false },
    "later role change erased history or retained operational contact access"
  );
  const restoreStudentRole = await service
    .from("profiles")
    .update({ role: "student", active: true })
    .eq("id", ids.users.studentA);
  assert.equal(restoreStudentRole.error, null, restoreStudentRole.error?.message);

  // Even report evidence in a scheduled future transfer scope must not reveal
  // the future masjid/cohort/group or future peers through either student RPC.
  const futureMasjid = await requireData<Array<{ id: string }>>(
    "insert future-transfer masjid",
    service.from("masajid").insert({
      name: "Future Transfer Masjid",
      slug: `future-transfer-${Date.now()}`,
      active: false
    }).select("id")
  );
  const futureCohort = await requireData<Array<{ id: string }>>(
    "insert future-transfer cohort",
    service.from("cohorts").insert({
      masjid_id: futureMasjid[0].id,
      kind: "brothers",
      name: "Future Transfer Cohort",
      active: true,
      sort_order: 10
    }).select("id")
  );
  const futureGroup = await requireData<Array<{ id: string }>>(
    "insert future-transfer group",
    service.from("halaqa_groups").insert({
      cohort_id: futureCohort[0].id,
      name: "Future Transfer Group",
      active: true,
      sort_order: 10
    }).select("id")
  );
  const closeCurrentMembership = await service
    .from("student_group_memberships")
    .update({ ends_on: addDays(nextTrackerWeek, -1) })
    .eq("id", ids.studentMembershipA);
  assert.equal(closeCurrentMembership.error, null, closeCurrentMembership.error?.message);
  const futureMemberships = await requireData<Array<{ id: string }>>(
    "insert scheduled future transfer and peer",
    service.from("student_group_memberships").insert([
      {
        student_id: ids.users.studentA,
        group_id: futureGroup[0].id,
        starts_on: nextTrackerWeek,
        assigned_by: ids.users.superAdmin
      },
      {
        student_id: ids.users.profileTarget,
        group_id: futureGroup[0].id,
        starts_on: nextTrackerWeek,
        assigned_by: ids.users.superAdmin
      }
    ]).select("id")
  );
  const futureBadges = await requireData<Array<{ id: string }>>(
    "insert future report evidence",
    service.from("badge_awards").insert([
      {
        student_id: ids.users.studentA,
        week_start: nextTrackerWeek,
        weekly_percentage: 95,
        badges_awarded: 1
      },
      {
        student_id: ids.users.profileTarget,
        week_start: nextTrackerWeek,
        weekly_percentage: 95,
        badges_awarded: 1
      }
    ]).select("id")
  );
  await assertRpcDenied(studentA, "student_historical_reporting_scope_for_week", {
    input_week_start: nextTrackerWeek
  });
  await assertRpcDenied(studentA, "student_cohort_leaderboard_for_week", {
    input_week_start: nextTrackerWeek
  });
  const futureTransferWeeks = await studentA.rpc("student_leaderboard_available_weeks");
  assert.equal(futureTransferWeeks.error, null, futureTransferWeeks.error?.message);
  assert.ok(
    !(futureTransferWeeks.data ?? []).some(
      (row: { week_start?: string }) => row.week_start === nextTrackerWeek
    ),
    "future evidence exposed a scheduled transfer week"
  );
  await service.from("badge_awards").delete().in("id", futureBadges.map((row) => row.id));
  await service.from("student_group_memberships").delete().in("id", futureMemberships.map((row) => row.id));
  const reopenCurrentMembership = await service
    .from("student_group_memberships")
    .update({ ends_on: null })
    .eq("id", ids.studentMembershipA);
  assert.equal(reopenCurrentMembership.error, null, reopenCurrentMembership.error?.message);
  await service.from("halaqa_groups").delete().eq("id", futureGroup[0].id);
  await service.from("cohorts").delete().eq("id", futureCohort[0].id);
  await service.from("masajid").delete().eq("id", futureMasjid[0].id);

  const anon = localClient(anonKey);
  const authenticatedDefinerProbes: Array<[string, Record<string, unknown>?]> = [
    ["is_active_admin"],
    ["is_active_student"],
    ["is_active_teacher"],
    ["is_active_super_admin"],
    ["current_effective_date"],
    ["current_partner_recitation_round"],
    ["current_toronto_civil_date"],
    ["is_admin_for_masjid", { input_masjid_id: ids.masjidA }],
    ["is_staff_for_masjid", { input_masjid_id: ids.masjidA }],
    ["is_teacher_for_group_week", { input_group_id: ids.groupA, input_week_start: ids.weekStart }],
    ["can_read_student_for_week", { input_student_id: ids.users.studentA, input_week_start: ids.weekStart }],
    ["can_grade_student_for_week", { input_student_id: ids.users.studentA, input_week_start: ids.weekStart }],
    ["can_admin_manage_student_for_week", { input_student_id: ids.users.studentA, input_week_start: ids.weekStart }],
    ["can_admin_delete_student", { input_student_id: ids.users.studentA }],
    ["student_group_for_week", { input_student_id: ids.users.studentA, input_week_start: ids.weekStart }],
    ["student_current_group_id", { input_student_id: ids.users.studentA }],
    ["student_cohort_for_week", { input_student_id: ids.users.studentA, input_week_start: ids.weekStart }],
    ["student_masjid_for_week", { input_student_id: ids.users.studentA, input_week_start: ids.weekStart }],
    ["group_masjid_id", { input_group_id: ids.groupA }],
    ["cohort_masjid_id", { input_cohort_id: ids.cohortA }],
    ["can_read_profile", { input_profile_id: ids.users.studentA }],
    ["can_read_masjid", { input_masjid_id: ids.masjidA }],
    ["can_read_cohort", { input_cohort_id: ids.cohortA }],
    ["can_read_group", { input_group_id: ids.groupA }],
    ["can_read_operational_student_row", {
      input_masjid_id: ids.masjidA,
      input_group_id: ids.groupA,
      input_week_start: ids.weekStart
    }],
    ["student_scope_snapshot_matches", {
      input_student_id: ids.users.studentA,
      input_week_start: ids.weekStart,
      input_masjid_id: ids.masjidA,
      input_cohort_id: ids.cohortA,
      input_group_id: ids.groupA
    }],
    ["teacher_grade_scope_snapshot_matches", {
      input_student_id: ids.users.studentA,
      input_week_start: ids.weekStart,
      input_masjid_id: ids.masjidA,
      input_cohort_id: ids.cohortA,
      input_group_id: ids.groupA
    }],
    ["teacher_can_read_membership", {
      input_group_id: ids.groupA,
      input_starts_on: ids.previousWeekStart,
      input_ends_on: null
    }],
    ["is_rotation_teacher_for_masjid_week", {
      input_profile_id: ids.users.studentA,
      input_masjid_id: ids.masjidA,
      input_week_start: ids.weekStart
    }],
    ["can_admin_read_weekly_plan_path", {
      input_file_path: `${ids.users.studentA}/${ids.weekStart}/plan.pdf`
    }],
    ["can_teacher_read_weekly_plan_path", {
      input_file_path: `${ids.users.studentA}/${ids.weekStart}/plan.pdf`
    }],
    ["student_weekly_teacher_name", { input_week_start: ids.weekStart }],
    ["student_cohort_leaderboard_for_week", { input_week_start: ids.weekStart }],
    ["student_leaderboard_available_weeks"],
    ["historical_reporting_available_weeks"],
    ["historical_reporting_activity_for_weeks", { input_week_starts: [ids.weekStart] }],
    ["historical_reporting_students_for_weeks", { input_week_starts: [ids.weekStart] }],
    ["student_historical_reporting_scope_for_week", { input_week_start: ids.weekStart }],
    ["admin_students_for_week", { input_week_start: ids.weekStart }],
    ["teacher_assignment_contexts"]
  ];

  for (const [name, args = {}] of authenticatedDefinerProbes) {
    await assertRpcAllowed(studentA, name, args);
    await assertRpcDenied(anon, name, args);
  }

  const { data: peerOwn } = await studentA2.from("checkins").select("id").eq("id", ids.checkinA2);
  assert.equal(peerOwn?.length, 1, "second same-cohort student should retain own data");
}

async function testRotationPublicationIntegrity(ids: SeedIds) {
  const service = localClient(serviceRoleKey);
  const adminA = await signIn("adminA");
  const groups = (await requireData<Array<{ id: string }>>(
    "read canonical active groups for rotation publication",
    service
      .from("halaqa_groups")
      .select("id")
      .eq("cohort_id", ids.cohortA)
      .eq("active", true)
      .order("sort_order")
      .order("name")
      .order("created_at")
      .order("id")
  )).map(({ id }) => id);
  const desiredAssignments = [
    { group_id: ids.groupA, teacher_id: ids.users.teacherA, week_start: ids.weekStart },
    { group_id: ids.groupAdminTeacher, teacher_id: ids.users.adminA, week_start: ids.weekStart }
  ];

  const { error: browserPrepareError } = await adminA.rpc("prepare_teacher_rotation_publication", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart
  });
  assert.ok(browserPrepareError, "authenticated users can execute the service-only publication prepare RPC");

  const unavailableDirectAvailability = await service
    .from("teacher_rotation_availability")
    .update({ available: false })
    .eq("teacher_id", ids.users.teacherA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(unavailableDirectAvailability.error, null, unavailableDirectAvailability.error?.message);
  const directUnavailableAssignment = await adminA
    .from("group_teacher_assignments")
    .upsert({
      group_id: ids.groupFridayOnly,
      teacher_id: ids.users.teacherA,
      week_start: ids.weekStart,
      active: true,
      assigned_by: ids.users.adminA
    }, { onConflict: "group_id,week_start" });
  assert.ok(
    directUnavailableAssignment.error?.message.includes(
      "teacher_assignment_requires_exact_available_teacher_rotation_availability"
    ),
    "a scoped signed-in admin bypassed exact availability through a direct assignment write"
  );
  const restoreDirectAvailability = await service
    .from("teacher_rotation_availability")
    .update({ available: true })
    .eq("teacher_id", ids.users.teacherA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(restoreDirectAvailability.error, null, restoreDirectAvailability.error?.message);

  const directDuplicateTeacherAssignment = await adminA
    .from("group_teacher_assignments")
    .upsert({
      group_id: ids.groupFridayOnly,
      teacher_id: ids.users.teacherA,
      week_start: ids.weekStart,
      active: true,
      assigned_by: ids.users.adminA
    }, { onConflict: "group_id,week_start" });
  assert.ok(
    directDuplicateTeacherAssignment.error?.message.includes(
      "teacher_assignment_duplicate_active_teacher_for_cohort_week"
    ),
    "a scoped signed-in admin assigned one available teacher to two cohort groups in the same week"
  );

  const unrelatedAssignmentBefore = await requireData<{ teacher_id: string; active: boolean }>(
    "read unrelated cohort assignment before publication",
    service
      .from("group_teacher_assignments")
      .select("teacher_id,active")
      .eq("id", ids.assignmentWriter)
      .single()
  );
  const obsoleteAssignment = await service.from("group_teacher_assignments").upsert({
    group_id: ids.groupFridayOnly,
    teacher_id: ids.users.futureTeacher,
    week_start: ids.weekStart,
    active: true,
    assigned_by: ids.users.adminA
  }, { onConflict: "group_id,week_start" });
  assert.equal(obsoleteAssignment.error, null, obsoleteAssignment.error?.message);

  const settingsUpdate = await service
    .from("cohort_rotation_settings")
    .update({ target_group_count: groups.length })
    .eq("id", ids.settingA);
  assert.equal(settingsUpdate.error, null, settingsUpdate.error?.message);

  const availabilityUpsert = await service.from("teacher_rotation_availability").upsert({
    teacher_id: ids.users.adminA,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  }, { onConflict: "teacher_id,cohort_id,week_start" });
  assert.equal(availabilityUpsert.error, null, availabilityUpsert.error?.message);

  const requestId = randomUUID();
  const prepared = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: requestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart
  });
  assert.equal(prepared.error, null, `rotation prepare failed: ${prepared.error?.message}`);
  assert.ok(prepared.data, "rotation prepare returned no expected state");
  const expectedState = prepared.data;
  assert.equal(expectedState?.week_start, ids.weekStart, "prepared snapshot has the wrong tracker week");
  assert.equal(
    expectedState?.halaqa_saturday,
    addDays(ids.weekStart, 6),
    "prepared snapshot did not expose the Saturday halaqa date"
  );
  const preparedAvailableTeacherIds = ((expectedState?.planner?.eligible_teachers ?? []) as Array<{
    id: string;
    available: boolean;
  }>)
    .filter(({ available }) => available)
    .map(({ id }) => id);
  const expectedWarningCodes = [
    "UNASSIGNED_GROUPS",
    ...(preparedAvailableTeacherIds.some((teacherId) => !desiredAssignments.some(({ teacher_id }) => teacher_id === teacherId))
      ? ["EXTRA_TEACHERS"]
      : [])
  ];

  const applied = await service.rpc("apply_teacher_rotation_publication", {
    input_request_id: requestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_expected_state: expectedState,
    input_desired_assignments: desiredAssignments
  });
  assert.equal(applied.error, null, `rotation apply failed: ${applied.error?.message}`);
  assert.equal(applied.data?.assigned_count, 2, "publication did not derive assigned count");
  assert.deepEqual(
    applied.data?.unassigned_group_ids,
    groups.filter((groupId) => !desiredAssignments.some(({ group_id }) => group_id === groupId))
  );
  assert.deepEqual(applied.data?.warning_codes, expectedWarningCodes);
  const obsoleteAssignmentAfter = await requireData<{ active: boolean }>(
    "read deactivated obsolete assignment",
    service
      .from("group_teacher_assignments")
      .select("active")
      .eq("group_id", ids.groupFridayOnly)
      .eq("week_start", ids.weekStart)
      .single()
  );
  assert.equal(obsoleteAssignmentAfter.active, false, "publication did not deactivate an obsolete active group assignment");
  const unrelatedAssignmentAfter = await requireData<{ teacher_id: string; active: boolean }>(
    "read unrelated cohort assignment after publication",
    service
      .from("group_teacher_assignments")
      .select("teacher_id,active")
      .eq("id", ids.assignmentWriter)
      .single()
  );
  assert.deepEqual(unrelatedAssignmentAfter, unrelatedAssignmentBefore, "publication changed an unrelated cohort/week assignment");

  const replay = await service.rpc("apply_teacher_rotation_publication", {
    input_request_id: requestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_expected_state: expectedState,
    input_desired_assignments: desiredAssignments
  });
  assert.equal(replay.error, null, `exact publication replay failed: ${replay.error?.message}`);
  assert.deepEqual(replay.data, applied.data, "exact publication replay did not return the original result");

  const { data: idempotentRuns, error: idempotentRunsError } = await service
    .from("teacher_rotation_runs")
    .select("id,available_teacher_count,group_count,assigned_count,warning_count,warning_codes")
    .eq("request_id", requestId);
  assert.equal(idempotentRunsError, null, idempotentRunsError?.message);
  assert.equal(idempotentRuns?.length, 1, "exact replay created another rotation run");
  assert.deepEqual(idempotentRuns?.[0]?.warning_codes, expectedWarningCodes);

  const changedReplay = await service.rpc("apply_teacher_rotation_publication", {
    input_request_id: requestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_expected_state: expectedState,
    input_desired_assignments: desiredAssignments.slice(0, 1)
  });
  assert.ok(changedReplay.error, "request ID reuse with changed assignments was accepted");

  async function expectPreparedPublicationToBecomeStale(
    label: string,
    mutate: () => Promise<void>
  ) {
    const staleRequestId = randomUUID();
    const stalePrepared = await service.rpc("prepare_teacher_rotation_publication", {
      input_request_id: staleRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart
    });
    assert.equal(stalePrepared.error, null, `${label} prepare failed: ${stalePrepared.error?.message}`);
    await mutate();
    const staleApply = await service.rpc("apply_teacher_rotation_publication", {
      input_request_id: staleRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart,
      input_expected_state: stalePrepared.data,
      input_desired_assignments: desiredAssignments
    });
    assert.deepEqual(
      { code: staleApply.error?.code, message: staleApply.error?.message },
      { code: "PT412", message: "rotation_publication_stale_state" },
      `${label} did not invalidate the prepared publication: ${staleApply.error?.message}`
    );
  }

  async function expectPublicationToRejectUnavailableTeacher(label: string) {
    const unavailableRequestId = randomUUID();
    const unavailablePrepared = await service.rpc("prepare_teacher_rotation_publication", {
      input_request_id: unavailableRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart
    });
    assert.equal(unavailablePrepared.error, null, `${label} prepare failed: ${unavailablePrepared.error?.message}`);
    const unavailableApply = await service.rpc("apply_teacher_rotation_publication", {
      input_request_id: unavailableRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart,
      input_expected_state: unavailablePrepared.data,
      input_desired_assignments: desiredAssignments
    });
    assert.ok(
      unavailableApply.error?.message.includes("rotation_publication_teacher_unavailable_or_ineligible"),
      `${label} publication accepted a teacher without its exact positive availability row`
    );
  }

  await expectPreparedPublicationToBecomeStale("group activity", async () => {
    const result = await service.from("halaqa_groups").update({ active: false }).eq("id", ids.groupFridayOnly);
    assert.equal(result.error, null, result.error?.message);
  });
  const restoreGroupActivity = await service.from("halaqa_groups").update({ active: true }).eq("id", ids.groupFridayOnly);
  assert.equal(restoreGroupActivity.error, null, restoreGroupActivity.error?.message);

  await expectPreparedPublicationToBecomeStale("group ordering", async () => {
    const result = await service.from("halaqa_groups").update({ sort_order: 999 }).eq("id", ids.groupFridayOnly);
    assert.equal(result.error, null, result.error?.message);
  });
  const restoreGroupOrdering = await service.from("halaqa_groups").update({ sort_order: 17 }).eq("id", ids.groupFridayOnly);
  assert.equal(restoreGroupOrdering.error, null, restoreGroupOrdering.error?.message);

  await expectPreparedPublicationToBecomeStale("rotation settings", async () => {
    const result = await service.from("cohort_rotation_settings").update({ target_group_count: 2 }).eq("id", ids.settingA);
    assert.equal(result.error, null, result.error?.message);
  });
  const restoreRotationSettings = await service
    .from("cohort_rotation_settings")
    .update({ target_group_count: groups.length })
    .eq("id", ids.settingA);
  assert.equal(restoreRotationSettings.error, null, restoreRotationSettings.error?.message);

  const teacherAMembership = await requireData<{ id: string }>(
    "read Teacher A staff membership for publication staleness",
    service
      .from("masjid_staff_memberships")
      .select("id")
      .eq("profile_id", ids.users.teacherA)
      .eq("masjid_id", ids.masjidA)
      .eq("staff_role", "teacher")
      .single()
  );
  await expectPreparedPublicationToBecomeStale("teacher membership", async () => {
    const result = await service.from("masjid_staff_memberships").update({ active: false }).eq("id", teacherAMembership.id);
    assert.equal(result.error, null, result.error?.message);
  });
  const restoreTeacherMembership = await service
    .from("masjid_staff_memberships")
    .update({ active: true })
    .eq("id", teacherAMembership.id);
  assert.equal(restoreTeacherMembership.error, null, restoreTeacherMembership.error?.message);

  await expectPreparedPublicationToBecomeStale("teacher profile activity", async () => {
    const result = await service.from("profiles").update({ active: false }).eq("id", ids.users.teacherA);
    assert.equal(result.error, null, result.error?.message);
  });
  const restoreTeacherProfile = await service.from("profiles").update({ active: true }).eq("id", ids.users.teacherA);
  assert.equal(restoreTeacherProfile.error, null, restoreTeacherProfile.error?.message);

  await expectPreparedPublicationToBecomeStale("current assignment", async () => {
    const result = await service
      .from("group_teacher_assignments")
      .update({ assigned_by: ids.users.superAdmin })
      .eq("id", ids.assignmentA);
    assert.equal(result.error, null, result.error?.message);
  });

  await expectPreparedPublicationToBecomeStale("masjid activity", async () => {
    const result = await service.from("masajid").update({ active: false }).eq("id", ids.masjidA);
    assert.equal(result.error, null, result.error?.message);
  });
  const restoreMasjidActivity = await service.from("masajid").update({ active: true }).eq("id", ids.masjidA);
  assert.equal(restoreMasjidActivity.error, null, restoreMasjidActivity.error?.message);

  await expectPreparedPublicationToBecomeStale("cohort activity", async () => {
    const result = await service.from("cohorts").update({ active: false }).eq("id", ids.cohortA);
    assert.equal(result.error, null, result.error?.message);
  });
  const restoreCohortActivity = await service.from("cohorts").update({ active: true }).eq("id", ids.cohortA);
  assert.equal(restoreCohortActivity.error, null, restoreCohortActivity.error?.message);

  const staleRequestId = randomUUID();
  const stalePrepared = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: staleRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart
  });
  assert.equal(stalePrepared.error, null, stalePrepared.error?.message);
  const staleAvailability = await service
    .from("teacher_rotation_availability")
    .update({ available: false })
    .eq("teacher_id", ids.users.adminA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(staleAvailability.error, null, staleAvailability.error?.message);
  const staleApply = await service.rpc("apply_teacher_rotation_publication", {
    input_request_id: staleRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_expected_state: stalePrepared.data,
    input_desired_assignments: desiredAssignments
  });
  assert.deepEqual(
    { code: staleApply.error?.code, message: staleApply.error?.message },
    { code: "PT412", message: "rotation_publication_stale_state" },
    "availability change did not stale the prepared publication"
  );

  await expectPublicationToRejectUnavailableTeacher("false availability");

  const restoreAvailability = await service
    .from("teacher_rotation_availability")
    .update({ available: true })
    .eq("teacher_id", ids.users.adminA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(restoreAvailability.error, null, restoreAvailability.error?.message);

  const missingAvailability = await service
    .from("teacher_rotation_availability")
    .delete()
    .eq("teacher_id", ids.users.adminA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(missingAvailability.error, null, missingAvailability.error?.message);
  await expectPublicationToRejectUnavailableTeacher("missing availability");

  const legacyUnavailable = await service.rpc("apply_teacher_rotation_generation", {
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_generated_by: ids.users.adminA,
    membership_closes: [],
    membership_inserts: [],
    membership_replaces: [],
    assignment_upserts: desiredAssignments,
    assignment_deactivations: [],
    available_teacher_count: 99,
    group_count: 99,
    assigned_count: 99,
    warning_count: 99
  });
  assert.ok(
    legacyUnavailable.error?.message.includes("rotation_publication_teacher_unavailable_or_ineligible"),
    "legacy publication accepted a teacher without an exact available row"
  );

  const reinsertAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.adminA,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  });
  assert.equal(reinsertAvailability.error, null, reinsertAvailability.error?.message);

  const legacyValid = await service.rpc("apply_teacher_rotation_generation", {
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_generated_by: ids.users.adminA,
    membership_closes: [],
    membership_inserts: [],
    membership_replaces: [],
    assignment_upserts: desiredAssignments,
    assignment_deactivations: [{ group_id: ids.groupWriter, week_start: ids.weekStart }],
    available_teacher_count: 999,
    group_count: 999,
    assigned_count: 999,
    warning_count: 999
  });
  assert.equal(legacyValid.error, null, `legacy valid publication failed: ${legacyValid.error?.message}`);
  assert.ok(legacyValid.data, "legacy valid publication returned no run ID");
  const legacyRun = await requireData<{
    available_teacher_count: number;
    group_count: number;
    assigned_count: number;
    warning_count: number;
    warning_codes: string[];
  }>(
    "read canonical legacy rotation outcome",
    service
      .from("teacher_rotation_runs")
      .select("available_teacher_count,group_count,assigned_count,warning_count,warning_codes")
      .eq("id", legacyValid.data)
      .single()
  );
  assert.deepEqual(
    legacyRun,
    {
      available_teacher_count: preparedAvailableTeacherIds.length,
      group_count: groups.length,
      assigned_count: desiredAssignments.length,
      warning_count: expectedWarningCodes.length,
      warning_codes: expectedWarningCodes
    },
    "legacy compatibility path trusted caller-provided rotation outcome counts"
  );

  const removeTeacherAExactAvailability = await service
    .from("teacher_rotation_availability")
    .delete()
    .eq("teacher_id", ids.users.teacherA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(removeTeacherAExactAvailability.error, null, removeTeacherAExactAvailability.error?.message);
  await expectPublicationToRejectUnavailableTeacher("availability from another cohort");
  const restoreTeacherAExactAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.teacherA,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  });
  assert.equal(restoreTeacherAExactAvailability.error, null, restoreTeacherAExactAvailability.error?.message);

  const otherWeekAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.adminA,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: addDays(ids.weekStart, 7),
    available: true
  });
  assert.equal(otherWeekAvailability.error, null, otherWeekAvailability.error?.message);
  const removeAdminAExactAvailability = await service
    .from("teacher_rotation_availability")
    .delete()
    .eq("teacher_id", ids.users.adminA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(removeAdminAExactAvailability.error, null, removeAdminAExactAvailability.error?.message);
  await expectPublicationToRejectUnavailableTeacher("availability from another tracker week");
  const restoreAdminAExactAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.adminA,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  });
  assert.equal(restoreAdminAExactAvailability.error, null, restoreAdminAExactAvailability.error?.message);

  // Row locks cannot see an absent availability row. Hold the version update
  // lock in a real INSERT transaction while apply reaches its final shared
  // version lock: it must wait, then observe the committed insert and return
  // the deterministic stale result rather than publishing the old snapshot.
  const removeSaturdayStartAvailabilityForRace = await service
    .from("teacher_rotation_availability")
    .delete()
    .eq("teacher_id", ids.users.saturdayStartTeacher)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(
    removeSaturdayStartAvailabilityForRace.error,
    null,
    removeSaturdayStartAvailabilityForRace.error?.message
  );
  const absentAvailabilityRaceRequestId = randomUUID();
  const absentAvailabilityRacePrepared = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: absentAvailabilityRaceRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart
  });
  assert.equal(
    absentAvailabilityRacePrepared.error,
    null,
    absentAvailabilityRacePrepared.error?.message
  );
  const absentAvailabilityRaceMarker = "rotation_publication_absent_availability_ready";
  const absentAvailabilityWriter = startLocalPsqlTransaction(
    `begin;
insert into public.teacher_rotation_availability (teacher_id, masjid_id, cohort_id, week_start, available)
values ('${ids.users.saturdayStartTeacher}'::uuid, '${ids.masjidA}'::uuid, '${ids.cohortA}'::uuid, '${ids.weekStart}'::date, true);
\\echo ${absentAvailabilityRaceMarker}
select pg_sleep(0.75);
commit;
`,
    absentAvailabilityRaceMarker
  );
  await absentAvailabilityWriter.ready;
  const absentAvailabilityRaceApply = await service.rpc("apply_teacher_rotation_publication", {
    input_request_id: absentAvailabilityRaceRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_expected_state: absentAvailabilityRacePrepared.data,
    input_desired_assignments: desiredAssignments
  });
  await absentAvailabilityWriter.completion;
  assert.deepEqual(
    { code: absentAvailabilityRaceApply.error?.code, message: absentAvailabilityRaceApply.error?.message },
    { code: "PT412", message: "rotation_publication_stale_state" },
    "an inserted availability row raced past the final publication state comparison"
  );
  const removeSaturdayStartAvailabilityAfterRace = await service
    .from("teacher_rotation_availability")
    .delete()
    .eq("teacher_id", ids.users.saturdayStartTeacher)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(
    removeSaturdayStartAvailabilityAfterRace.error,
    null,
    removeSaturdayStartAvailabilityAfterRace.error?.message
  );

  // The corresponding existing-row interleaving verifies the lock order: the
  // writer holds its availability row before the trigger holds the version;
  // apply must wait for that writer and return stale, never deadlock.
  const existingAvailabilityRaceRequestId = randomUUID();
  const existingAvailabilityRacePrepared = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: existingAvailabilityRaceRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart
  });
  assert.equal(
    existingAvailabilityRacePrepared.error,
    null,
    existingAvailabilityRacePrepared.error?.message
  );
  const existingAvailabilityRaceMarker = "rotation_publication_existing_availability_ready";
  const existingAvailabilityWriter = startLocalPsqlTransaction(
    `begin;
update public.teacher_rotation_availability
set available = false
where teacher_id = '${ids.users.adminA}'::uuid
  and cohort_id = '${ids.cohortA}'::uuid
  and week_start = '${ids.weekStart}'::date;
\\echo ${existingAvailabilityRaceMarker}
select pg_sleep(0.75);
commit;
`,
    existingAvailabilityRaceMarker
  );
  await existingAvailabilityWriter.ready;
  const existingAvailabilityRaceApply = await service.rpc("apply_teacher_rotation_publication", {
    input_request_id: existingAvailabilityRaceRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_expected_state: existingAvailabilityRacePrepared.data,
    input_desired_assignments: desiredAssignments
  });
  await existingAvailabilityWriter.completion;
  assert.deepEqual(
    { code: existingAvailabilityRaceApply.error?.code, message: existingAvailabilityRaceApply.error?.message },
    { code: "PT412", message: "rotation_publication_stale_state" },
    "an existing availability writer deadlocked with publication instead of producing stale state"
  );
  const restoreExistingAvailabilityAfterRace = await service
    .from("teacher_rotation_availability")
    .update({ available: true })
    .eq("teacher_id", ids.users.adminA)
    .eq("cohort_id", ids.cohortA)
    .eq("week_start", ids.weekStart);
  assert.equal(
    restoreExistingAvailabilityAfterRace.error,
    null,
    restoreExistingAvailabilityAfterRace.error?.message
  );

  const [concurrentA, concurrentB] = await Promise.all(
    [randomUUID(), randomUUID()].map((concurrentRequestId) => service.rpc("prepare_teacher_rotation_publication", {
      input_request_id: concurrentRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart
    }).then((preparedResult) => ({ concurrentRequestId, preparedResult })))
  );
  assert.equal(concurrentA.preparedResult.error, null, concurrentA.preparedResult.error?.message);
  assert.equal(concurrentB.preparedResult.error, null, concurrentB.preparedResult.error?.message);

  const concurrentResults = await Promise.all([
    service.rpc("apply_teacher_rotation_publication", {
      input_request_id: concurrentA.concurrentRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart,
      input_expected_state: concurrentA.preparedResult.data,
      input_desired_assignments: desiredAssignments
    }),
    service.rpc("apply_teacher_rotation_publication", {
      input_request_id: concurrentB.concurrentRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart,
      input_expected_state: concurrentB.preparedResult.data,
      input_desired_assignments: desiredAssignments
    })
  ]);
  assert.equal(concurrentResults.filter((result) => !result.error).length, 1, "simultaneous publications both succeeded");
  assert.equal(
    concurrentResults.filter((result) => result.error?.code === "PT412" && result.error.message === "rotation_publication_stale_state").length,
    1,
    "losing concurrent publication did not return stale state"
  );
  const { count: concurrentRunCount, error: concurrentRunCountError } = await service
    .from("teacher_rotation_runs")
    .select("id", { count: "exact", head: true })
    .in("request_id", [concurrentA.concurrentRequestId, concurrentB.concurrentRequestId]);
  assert.equal(concurrentRunCountError, null, concurrentRunCountError?.message);
  assert.equal(concurrentRunCount, 1, "simultaneous publications recorded more than one successful run");

  async function expectAssignmentPayloadRejected(
    label: string,
    assignments: Array<{ group_id: string; teacher_id: string; week_start: string }>,
    errorCode: string
  ) {
    const payloadRequestId = randomUUID();
    const payloadPrepared = await service.rpc("prepare_teacher_rotation_publication", {
      input_request_id: payloadRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart
    });
    assert.equal(payloadPrepared.error, null, `${label} prepare failed: ${payloadPrepared.error?.message}`);
    const payloadApply = await service.rpc("apply_teacher_rotation_publication", {
      input_request_id: payloadRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart,
      input_expected_state: payloadPrepared.data,
      input_desired_assignments: assignments
    });
    assert.ok(payloadApply.error?.message.includes(errorCode), `${label} was accepted: ${payloadApply.error?.message}`);
  }

  await expectAssignmentPayloadRejected(
    "duplicate group",
    [...desiredAssignments, { group_id: ids.groupA, teacher_id: ids.users.adminA, week_start: ids.weekStart }],
    "rotation_publication_duplicate_group"
  );
  await expectAssignmentPayloadRejected(
    "duplicate teacher",
    [...desiredAssignments, { group_id: ids.groupFridayOnly, teacher_id: ids.users.teacherA, week_start: ids.weekStart }],
    "rotation_publication_duplicate_teacher"
  );
  await expectAssignmentPayloadRejected(
    "foreign-cohort group",
    [{ group_id: ids.groupWriter, teacher_id: ids.users.teacherA, week_start: ids.weekStart }],
    "rotation_publication_invalid_group"
  );
  await expectAssignmentPayloadRejected(
    "teacher outside the canonical eligible set",
    [{ group_id: ids.groupFridayOnly, teacher_id: ids.users.adminB, week_start: ids.weekStart }],
    "rotation_publication_teacher_unavailable_or_ineligible"
  );

  const saturdayStartAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.saturdayStartTeacher,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  });
  assert.equal(saturdayStartAvailability.error, null, saturdayStartAvailability.error?.message);
  const saturdayEndAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.expiredAssignmentTeacher,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortWriter,
    week_start: ids.previousWeekStart,
    available: true
  });
  assert.equal(saturdayEndAvailability.error, null, saturdayEndAvailability.error?.message);
  const afterSaturdayAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.futureTeacher,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  });
  assert.ok(afterSaturdayAvailability.error, "teacher whose membership starts after Saturday was marked available");
  const adminWithoutTeacherAvailability = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.adminB,
    masjid_id: ids.masjidA,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  });
  assert.ok(adminWithoutTeacherAvailability.error, "admin without a teacher capability was marked available");
  const forgedAvailabilityScope = await service.from("teacher_rotation_availability").insert({
    teacher_id: ids.users.teacherA,
    masjid_id: ids.masjidB,
    cohort_id: ids.cohortA,
    week_start: ids.weekStart,
    available: true
  });
  assert.ok(forgedAvailabilityScope.error, "forged cohort/masjid availability relationship was accepted");

  const saturdayStartRequestId = randomUUID();
  const saturdayStartPrepared = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: saturdayStartRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart
  });
  assert.equal(saturdayStartPrepared.error, null, saturdayStartPrepared.error?.message);
  const saturdayStartApply = await service.rpc("apply_teacher_rotation_publication", {
    input_request_id: saturdayStartRequestId,
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: ids.weekStart,
    input_expected_state: saturdayStartPrepared.data,
    input_desired_assignments: [
      ...desiredAssignments,
      { group_id: ids.groupFridayOnly, teacher_id: ids.users.saturdayStartTeacher, week_start: ids.weekStart }
    ]
  });
  assert.equal(saturdayStartApply.error, null, `Saturday-start teacher was rejected: ${saturdayStartApply.error?.message}`);
  assert.equal(saturdayStartApply.data?.assigned_count, desiredAssignments.length + 1, "Saturday-start assignment was not counted");

  const independentCohortRequestId = randomUUID();
  const independentWeekRequestId = randomUUID();
  const [independentCohortPrepared, independentWeekPrepared] = await Promise.all([
    service.rpc("prepare_teacher_rotation_publication", {
      input_request_id: independentCohortRequestId,
      input_actor_id: ids.users.superAdmin,
      input_cohort_id: ids.cohortB,
      input_week_start: ids.weekStart
    }),
    service.rpc("prepare_teacher_rotation_publication", {
      input_request_id: independentWeekRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: addDays(ids.weekStart, 7)
    })
  ]);
  assert.equal(independentCohortPrepared.error, null, independentCohortPrepared.error?.message);
  assert.equal(independentWeekPrepared.error, null, independentWeekPrepared.error?.message);
  const independentPublications = await Promise.all([
    service.rpc("apply_teacher_rotation_publication", {
      input_request_id: independentCohortRequestId,
      input_actor_id: ids.users.superAdmin,
      input_cohort_id: ids.cohortB,
      input_week_start: ids.weekStart,
      input_expected_state: independentCohortPrepared.data,
      input_desired_assignments: []
    }),
    service.rpc("apply_teacher_rotation_publication", {
      input_request_id: independentWeekRequestId,
      input_actor_id: ids.users.adminA,
      input_cohort_id: ids.cohortA,
      input_week_start: addDays(ids.weekStart, 7),
      input_expected_state: independentWeekPrepared.data,
      input_desired_assignments: []
    })
  ]);
  assert.ok(
    independentPublications.every((publication) => !publication.error),
    `independent cohort/week publications blocked one another: ${independentPublications.map((publication) => publication.error?.message).join(", ")}`
  );

  const nonSundayPrepare = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortA,
    input_week_start: addDays(ids.weekStart, 1)
  });
  assert.ok(nonSundayPrepare.error?.message.includes("rotation_publication_invalid_prepare_input"), "non-Sunday tracker week was accepted");

  const unauthorizedPrepare = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_cohort_id: ids.cohortB,
    input_week_start: ids.weekStart
  });
  assert.ok(unauthorizedPrepare.error?.message.includes("rotation_publication_unauthorized_actor"), "admin published another masjid");

  for (const [label, actorId] of [
    ["expired admin", ids.users.expiredAdmin],
    ["inactive admin", ids.users.inactiveAdmin]
  ] as const) {
    const rejectedPrepare = await service.rpc("prepare_teacher_rotation_publication", {
      input_request_id: randomUUID(),
      input_actor_id: actorId,
      input_cohort_id: ids.cohortA,
      input_week_start: ids.weekStart
    });
    assert.ok(rejectedPrepare.error?.message.includes("rotation_publication_unauthorized_actor"), `${label} was authorized`);
  }

  const superAdminPrepare = await service.rpc("prepare_teacher_rotation_publication", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_cohort_id: ids.cohortB,
    input_week_start: ids.weekStart
  });
  assert.equal(superAdminPrepare.error, null, `super admin prepare failed: ${superAdminPrepare.error?.message}`);

  const deletedCohort = await requireData<{ id: string }>(
    "create disposable cohort for rotation state-version delete trigger",
    service
      .from("cohorts")
      .insert({
        masjid_id: ids.masjidA,
        kind: "brothers",
        name: "Rotation Version Delete Fixture",
        active: false,
        sort_order: 99
      })
      .select("id")
      .single()
  );
  const deleteCohort = await service.from("cohorts").delete().eq("id", deletedCohort.id);
  assert.equal(
    deleteCohort.error,
    null,
    "cohort deletion attempted to create a state-version row after the cohort foreign-key target was gone"
  );
}

async function main() {
  const ids = await seed();
  await runAssertions(ids);
  await testRotationPublicationIntegrity(ids);
  console.log("RLS integration suite passed: signed-session multi-masjid boundaries are enforced.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
