import assert from "node:assert/strict";
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
  | "expiredTeacher"
  | "futureTeacher"
  | "inactiveTeacher"
  | "expiredAssignmentTeacher"
  | "futureAssignmentTeacher"
  | "studentA"
  | "studentA2"
  | "studentWriter"
  | "studentNoMembership"
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
  groupWriter: string;
  today: string;
  weekStart: string;
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

function torontoDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const calendarDate = `${values.year}-${values.month}-${values.day}`;
  return Number(values.hour) < 1 ? addDays(calendarDate, -1) : calendarDate;
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
    "expiredTeacher",
    "futureTeacher",
    "inactiveTeacher",
    "expiredAssignmentTeacher",
    "futureAssignmentTeacher",
    "studentA",
    "studentA2",
    "studentWriter",
    "studentNoMembership",
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
      { name: "RLS Masjid A", slug: "rls-masjid-a", active: true },
      { name: "RLS Masjid B", slug: "rls-masjid-b", active: true },
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
      { cohort_id: cohortWriter, name: "A Writer Group", active: true, sort_order: 10 },
      { cohort_id: cohortB, name: "B Group", active: true, sort_order: 10 },
      { cohort_id: inactiveMasjidCohort, name: "Inactive Masjid Group", active: true, sort_order: 10 },
      { cohort_id: inactiveCohort, name: "Inactive Cohort Group", active: true, sort_order: 10 },
      { cohort_id: cohortA, name: "Inactive Group", active: false, sort_order: 20 }
    ]).select("id,name")
  );
  const groupA = groups.find((row) => row.name === "A Group")!.id;
  const groupAdminTeacher = groups.find((row) => row.name === "A Admin Teacher Group")!.id;
  const groupWriter = groups.find((row) => row.name === "A Writer Group")!.id;
  const groupB = groups.find((row) => row.name === "B Group")!.id;
  const inactiveMasjidGroup = groups.find((row) => row.name === "Inactive Masjid Group")!.id;
  const inactiveCohortGroup = groups.find((row) => row.name === "Inactive Cohort Group")!.id;
  const inactiveGroup = groups.find((row) => row.name === "Inactive Group")!.id;

  const today = torontoDateString();
  const weekStart = weekStartForDate(today);
  const previousWeekStart = addDays(weekStart, -7);
  const unassignedWeekStart = addDays(weekStart, -14);
  const startsOn = addDays(weekStart, -28);
  const historicalStartsOn = addDays(startsOn, -28);
  const historicalEndsOn = addDays(startsOn, -1);
  const inactiveHistoricalStartsOn = addDays(historicalStartsOn, -28);
  const inactiveHistoricalEndsOn = addDays(historicalStartsOn, -1);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  const studentMemberships = await requireData<Array<{ id: string; student_id: string; group_id: string }>>(
    "insert student memberships",
    admin.from("student_group_memberships").insert([
      { student_id: users.studentA, group_id: groupA, starts_on: startsOn, assigned_by: users.superAdmin },
      { student_id: users.studentA2, group_id: groupA, starts_on: startsOn, assigned_by: users.superAdmin },
      { student_id: users.studentWriter, group_id: groupWriter, starts_on: startsOn, assigned_by: users.superAdmin },
      { student_id: users.studentB, group_id: groupB, starts_on: startsOn, assigned_by: users.superAdmin },
      {
        student_id: users.staffGrantTarget,
        group_id: inactiveMasjidGroup,
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

  const staffMemberships = await requireData<Array<{ id: string; profile_id: string }>>(
    "insert staff memberships",
    admin.from("masjid_staff_memberships").insert([
      { profile_id: users.adminA, masjid_id: masjidA, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.adminA, masjid_id: masjidA, staff_role: "teacher", active: true, starts_on: startsOn },
      { profile_id: users.adminA, masjid_id: inactiveMasjid, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.adminB, masjid_id: masjidB, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.teacherA, masjid_id: masjidA, staff_role: "teacher", active: true, starts_on: startsOn },
      { profile_id: users.teacherB, masjid_id: masjidB, staff_role: "teacher", active: true, starts_on: startsOn },
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
    ]).select("id,profile_id")
  );
  const staffMembershipA = staffMemberships.find((row) => row.profile_id === users.adminA)!.id;
  const staffMembershipB = staffMemberships.find((row) => row.profile_id === users.adminB)!.id;

  const assignments = await requireData<Array<{ id: string; group_id: string; teacher_id: string }>>(
    "insert teacher assignments",
    admin.from("group_teacher_assignments").insert([
      { group_id: groupA, teacher_id: users.teacherA, week_start: weekStart, active: true, assigned_by: users.adminA },
      { group_id: groupAdminTeacher, teacher_id: users.adminA, week_start: weekStart, active: true, assigned_by: users.superAdmin },
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
  const assignmentWriter = assignments.find((row) => row.group_id === groupWriter)!.id;
  const assignmentB = assignments.find((row) => row.group_id === groupB)!.id;
  const expiredTeacherAssignment = assignments.find(
    (row) => row.teacher_id === users.expiredAssignmentTeacher
  )!.id;
  const futureTeacherAssignment = assignments.find(
    (row) => row.teacher_id === users.futureAssignmentTeacher
  )!.id;

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
      { student_id: users.studentA, week_start: weekStart, weekly_percentage: 50, amount_cents: 1000 },
      { student_id: users.studentB, week_start: weekStart, weekly_percentage: 50, amount_cents: 1000 }
    ]).select("id,student_id")
  );
  const obligationA = obligations.find((row) => row.student_id === users.studentA)!.id;
  const obligationB = obligations.find((row) => row.student_id === users.studentB)!.id;

  const badges = await requireData<Array<{ id: string; student_id: string }>>(
    "insert badges",
    admin.from("badge_awards").insert([
      { student_id: users.studentA, week_start: weekStart, weekly_percentage: 95, badges_awarded: 1 },
      { student_id: users.studentB, week_start: weekStart, weekly_percentage: 95, badges_awarded: 1 }
    ]).select("id,student_id")
  );
  const badgeA = badges.find((row) => row.student_id === users.studentA)!.id;
  const badgeB = badges.find((row) => row.student_id === users.studentB)!.id;

  const availability = await requireData<Array<{ id: string; masjid_id: string }>>(
    "insert availability",
    admin.from("teacher_rotation_availability").insert([
      { teacher_id: users.teacherA, masjid_id: masjidA, cohort_id: cohortA, week_start: weekStart, available: true },
      { teacher_id: users.teacherB, masjid_id: masjidB, cohort_id: cohortB, week_start: weekStart, available: true }
    ]).select("id,masjid_id")
  );
  const availabilityA = availability.find((row) => row.masjid_id === masjidA)!.id;
  const availabilityB = availability.find((row) => row.masjid_id === masjidB)!.id;

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
    groupWriter,
    today,
    weekStart,
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
    superAdmin
  ] = await Promise.all([
    signIn("adminA"),
    signIn("adminB"),
    signIn("teacherA"),
    signIn("teacherB"),
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
    signIn("superAdmin")
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
    input_ends_on: ids.today,
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

  const setupStudentLookupArgs = {
    input_request_id: setupStudentRequestId,
    input_actor_id: ids.users.adminA,
    input_name: "Setup Student",
    input_email: "setupstudent@rls.local",
    input_phone: "+15550001001",
    input_role: "student",
    input_starts_on: ids.weekStart,
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
    input_starts_on: ids.weekStart,
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
    input_starts_on: ids.weekStart
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
  const staleGrant = await service.rpc("apply_super_admin_masjid_staff_grant", {
    ...adminGrantArgs,
    input_request_id: randomUUID(),
    input_expected_state: grantState.data
  });
  assert.equal(staleGrant.error?.code, "P0001", "stale staff grant was accepted");

  const setupTeacherArgs = {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.adminA,
    input_profile_id: ids.users.setupTeacher,
    input_name: "Setup Teacher",
    input_email: "setupteacher@rls.local",
    input_phone: "+15550001002",
    input_role: "teacher",
    input_starts_on: ids.weekStart,
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
    .update({ active: false })
    .eq("id", ids.users.teacherAccessTarget);
  assert.equal(staleSetupError, null, staleSetupError?.message);
  const staleAccessChange = await service.rpc("apply_super_admin_access_change", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.teacherAccessTarget,
    input_preset: "admin_teacher",
    input_starts_on: ids.weekStart,
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
    .update({ active: true })
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
    input_starts_on: ids.weekStart,
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
    input_starts_on: addDays(ids.weekStart, 2),
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
    input_ends_on: ids.today,
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
    input_ends_on: addDays(ids.today, 1)
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

  const soleAdminEndState = await service.rpc("get_person_access_state", {
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB
  });
  assert.equal(soleAdminEndState.error, null, soleAdminEndState.error?.message);
  const { count: soleAdminEndAuditBefore } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.staffMembershipB)
    .eq("action", "staff_membership_ended");
  const soleAdminEnd = await service.rpc("apply_super_admin_staff_membership_end", {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminB,
    input_membership_id: ids.staffMembershipB,
    input_ends_on: ids.today,
    input_expected_state: soleAdminEndState.data
  });
  assert.equal(soleAdminEnd.error?.code, "23514", "sole masjid admin close was not denied");
  const { data: soleAdminMembershipAfter } = await service
    .from("masjid_staff_memberships")
    .select("ends_on")
    .eq("id", ids.staffMembershipB)
    .single<{ ends_on: string | null }>();
  assert.equal(soleAdminMembershipAfter?.ends_on, null, "denied membership close was not rolled back");
  const { count: soleAdminEndAuditAfter } = await service
    .from("super_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("target_id", ids.staffMembershipB)
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
    input_starts_on: ids.weekStart,
    input_selected_masjid_id: ids.masjidB,
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
    .eq("masjid_id", ids.masjidB)
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
    input_starts_on: ids.weekStart,
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
    .update({ ends_on: ids.today })
    .eq("id", ids.studentMembershipA)
    .select("id,ends_on")
    .single();
  assert.equal(closeMembershipError, null, `deliberate membership closure failed: ${closeMembershipError?.message}`);
  assert.equal(closedMembership?.ends_on, ids.today);
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

  const { data: futureAdminTeacherContexts, error: futureAdminTeacherContextsError } =
    await futureAssignmentTeacher.rpc("teacher_assignment_contexts");
  assert.equal(futureAdminTeacherContextsError, null, futureAdminTeacherContextsError?.message);
  assert.deepEqual(
    (futureAdminTeacherContexts ?? []).map((row: { week_start: string }) => row.week_start),
    [addDays(ids.weekStart, 7)],
    "future admin-teacher assignment was not exposed for capability-aware navigation"
  );

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
  assert.ok(Array.isArray(leaderboard) && leaderboard.length === 3, "leaderboard should contain only cohort A");
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
  await assertRpcDenied(studentA, "student_weekly_teacher", {
    input_student_id: ids.users.studentA,
    input_week_start: ids.weekStart
  });
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
    // Students retain their own authorization history, but a non-current
    // relationship to an otherwise active group cannot expose its hierarchy.
    await assertVisible(client, "student_group_memberships", membershipId);
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
  const { data: finiteReplacement, error: finiteReplacementError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.adminA,
      masjid_id: ids.masjidB,
      staff_role: "admin",
      active: true,
      starts_on: addDays(ids.today, 1),
      ends_on: addDays(ids.today, 7),
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
    input_membership_id: ids.staffMembershipB,
    input_ends_on: ids.today,
    input_expected_state: adminBCoverageState.data
  });
  assert.equal(noTerminalCoverage.error?.code, "23514", "finite-only coverage was accepted");

  const { data: openReplacement, error: openReplacementError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.futureAdmin,
      masjid_id: ids.masjidB,
      staff_role: "admin",
      active: true,
      starts_on: addDays(ids.today, 9),
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
    input_membership_id: ids.staffMembershipB,
    input_ends_on: ids.today,
    input_expected_state: laterGapState.data
  });
  assert.equal(laterGap.error?.code, "23514", "later future coverage gap was accepted");
  const { error: closeGapError } = await service
    .from("masjid_staff_memberships")
    .update({ starts_on: addDays(ids.today, 8) })
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
    input_membership_id: ids.staffMembershipB,
    input_ends_on: ids.today,
    input_expected_state: validHandoffState.data
  });
  assert.equal(validFutureHandoff.error, null, validFutureHandoff.error?.message);

  const { data: concurrencyMasjid, error: concurrencyMasjidError } = await service
    .from("masajid")
    .insert({ name: "RLS Concurrency Masjid", slug: "rls-concurrency-masjid", active: true })
    .select("id")
    .single<{ id: string }>();
  assert.equal(concurrencyMasjidError, null, concurrencyMasjidError?.message);
  const { data: concurrencyAdminMembership, error: concurrencyAdminMembershipError } = await service
    .from("masjid_staff_memberships")
    .insert({
      profile_id: ids.users.adminB,
      masjid_id: concurrencyMasjid!.id,
      staff_role: "admin",
      active: true,
      starts_on: addDays(ids.today, -1),
      created_by: ids.users.superAdmin
    })
    .select("id")
    .single<{ id: string }>();
  assert.equal(concurrencyAdminMembershipError, null, concurrencyAdminMembershipError?.message);
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
    input_ends_on: ids.today,
    input_expected_state: concurrentEndState.data
  };
  const concurrentGrantArgs = {
    input_request_id: randomUUID(),
    input_actor_id: ids.users.superAdmin,
    input_target_profile_id: ids.users.adminA,
    input_masjid_id: concurrencyMasjid!.id,
    input_grant: "admin",
    input_starts_on: addDays(ids.today, 1),
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
    input_ends_on: ids.today,
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
  await requireData<{ id: string }>(
    "create valid reactivation coverage",
    service
      .from("masjid_staff_memberships")
      .insert({
        profile_id: ids.users.adminA,
        masjid_id: validCoverageMasjid.id,
        staff_role: "admin",
        active: true,
        starts_on: addDays(ids.today, -1),
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
  const concurrencyCoverageMembership = await requireData<{ id: string }>(
    "create reactivation concurrency coverage",
    service
      .from("masjid_staff_memberships")
      .insert({
        profile_id: ids.users.adminA,
        masjid_id: concurrencyMasjidClosure.id,
        staff_role: "admin",
        active: true,
        starts_on: addDays(ids.today, -1),
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
    input_ends_on: ids.today,
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
    ends_on: ids.today
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
    ends_on: ids.today
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

  for (const [table, id] of [
    ["halaqa_groups", ids.groupA],
    ["cohorts", ids.cohortA],
    ["masajid", ids.masjidA]
  ] as const) {
    const { error } = await service.from(table).update({ active: false }).eq("id", id);
    assert.equal(error, null, `deactivate ${table} historical fixture: ${error?.message}`);
  }

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

  const { data: inactiveHistoricalRoster, error: inactiveHistoricalRosterError } =
    await expiredAssignmentTeacher.rpc("teacher_group_roster_context", {
      input_group_id: ids.groupA,
      input_week_start: ids.previousWeekStart
    });
  assert.equal(inactiveHistoricalRosterError, null, inactiveHistoricalRosterError?.message);
  assert.ok(
    (inactiveHistoricalRoster ?? []).some(
      (row: { student_id: string }) => row.student_id === ids.users.studentA
    ),
    "completed assignment roster disappeared after hierarchy deactivation"
  );
  assert.ok(
    !(inactiveHistoricalRoster ?? []).some(
      (row: { student_id: string }) => row.student_id === ids.users.studentB
    ),
    "completed assignment roster leaked a student from another group"
  );
  await assertVisible(expiredAssignmentTeacher, "weekly_plans", ids.historicalPlanA);
  await assertVisible(expiredAssignmentTeacher, "halaqa_grades", ids.historicalGradeA);
  const { data: updatedHistoricalGrade, error: updatedHistoricalGradeError } =
    await expiredAssignmentTeacher
      .from("halaqa_grades")
      .update({
        notes: "historical teacher update",
        graded_by: ids.users.expiredAssignmentTeacher
      })
      .eq("id", ids.historicalGradeA)
      .select("id,notes,graded_by")
      .single();
  assert.equal(updatedHistoricalGradeError, null, updatedHistoricalGradeError?.message);
  assert.deepEqual(updatedHistoricalGrade, {
    id: ids.historicalGradeA,
    notes: "historical teacher update",
    graded_by: ids.users.expiredAssignmentTeacher
  });

  const { data: insertedHistoricalGrade, error: insertedHistoricalGradeError } =
    await expiredAssignmentTeacher
      .from("halaqa_grades")
      .insert({
        student_id: ids.users.studentA2,
        week_start: ids.previousWeekStart,
        attended: true,
        attendance_points: 100,
        recitation_points: 42,
        notes: "historical teacher insert",
        graded_by: ids.users.expiredAssignmentTeacher
      })
      .select("id,masjid_id,cohort_id,halaqa_group_id")
      .single();
  assert.equal(insertedHistoricalGradeError, null, insertedHistoricalGradeError?.message);
  assert.equal(insertedHistoricalGrade?.masjid_id, ids.masjidA);
  assert.equal(insertedHistoricalGrade?.cohort_id, ids.cohortA);
  assert.equal(insertedHistoricalGrade?.halaqa_group_id, ids.groupA);

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
  assert.equal(
    historicalPlanSigned.error,
    null,
    `completed assignment plan signing failed after hierarchy deactivation: ${historicalPlanSigned.error?.message}`
  );

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
  assert.deepEqual(inactiveCurrentContexts, [], "inactive hierarchy exposed a current assignment");
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

  const anon = localClient(anonKey);
  const authenticatedDefinerProbes: Array<[string, Record<string, unknown>?]> = [
    ["is_active_admin"],
    ["is_active_student"],
    ["is_active_teacher"],
    ["is_active_super_admin"],
    ["current_effective_date"],
    ["current_partner_recitation_round"],
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

async function main() {
  const ids = await seed();
  await runAssertions(ids);
  console.log("RLS integration suite passed: signed-session multi-masjid boundaries are enforced.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
