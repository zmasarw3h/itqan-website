import assert from "node:assert/strict";
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
  partnerA: string;
  partnerA2: string;
  partnerB: string;
  gradeA: string;
  gradeA2: string;
  gradeB: string;
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

  const profileRows = names.filter((name) => name !== "profileTarget").map((name) => {
    const authRow = authRows.get(name)!;
    const role = name === "superAdmin"
      ? "super_admin"
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
      { cohort_id: cohortWriter, name: "A Writer Group", active: true, sort_order: 10 },
      { cohort_id: cohortB, name: "B Group", active: true, sort_order: 10 },
      { cohort_id: inactiveMasjidCohort, name: "Inactive Masjid Group", active: true, sort_order: 10 },
      { cohort_id: inactiveCohort, name: "Inactive Cohort Group", active: true, sort_order: 10 },
      { cohort_id: cohortA, name: "Inactive Group", active: false, sort_order: 20 }
    ]).select("id,name")
  );
  const groupA = groups.find((row) => row.name === "A Group")!.id;
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
      { profile_id: users.adminA, masjid_id: inactiveMasjid, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.adminB, masjid_id: masjidB, staff_role: "admin", active: true, starts_on: startsOn },
      { profile_id: users.teacherA, masjid_id: masjidA, staff_role: "teacher", active: true, starts_on: startsOn },
      { profile_id: users.teacherB, masjid_id: masjidB, staff_role: "teacher", active: true, starts_on: startsOn },
      {
        profile_id: users.expiredAssignmentTeacher,
        masjid_id: masjidA,
        staff_role: "teacher",
        active: true,
        starts_on: startsOn
      },
      {
        profile_id: users.futureAssignmentTeacher,
        masjid_id: masjidA,
        staff_role: "teacher",
        active: true,
        starts_on: startsOn
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
    partnerA,
    partnerA2,
    partnerB,
    gradeA,
    gradeA2,
    gradeB,
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
    teacherA,
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
    signIn("teacherA"),
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
      group_count: 1,
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
  await assertVisible(teacherA, "profiles", ids.users.studentA);
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
  assert.ok(Array.isArray(leaderboard) && leaderboard.length === 2, "leaderboard should contain only cohort A");
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

  await assertVisible(superAdmin, "checkins", ids.checkinA);
  await assertVisible(superAdmin, "checkins", ids.checkinB);
  await assertVisible(superAdmin, "masajid", ids.inactiveMasjid);
  await assertVisible(superAdmin, "cohorts", ids.inactiveMasjidCohort);
  await assertVisible(superAdmin, "halaqa_groups", ids.inactiveMasjidGroup);
  await assertVisible(superAdmin, "cohorts", ids.inactiveCohort);
  await assertVisible(superAdmin, "halaqa_groups", ids.inactiveCohortGroup);
  await assertVisible(superAdmin, "halaqa_groups", ids.inactiveGroup);
  const { data: superProfileUpdate, error: superProfileError } = await superAdmin
    .from("profiles")
    .update({ phone: null })
    .eq("id", ids.users.studentB)
    .select("id");
  assert.equal(superProfileError, null, superProfileError?.message);
  assert.equal(superProfileUpdate?.length, 1, "super admin profile update was rejected");
  const { data: superAccountabilityUpdate, error: superAccountabilityError } = await superAdmin
    .from("accountability_obligations")
    .update({ admin_note: "super-admin operational update" })
    .eq("id", ids.obligationA)
    .select("id");
  assert.equal(superAccountabilityError, null, superAccountabilityError?.message);
  assert.equal(superAccountabilityUpdate?.length, 1, "super admin operational update was rejected");
  const { data: auditRows, error: auditError } = await superAdmin.from("super_admin_audit_events").select("id");
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
    ["student_weekly_teacher_name", { input_week_start: ids.weekStart }],
    ["student_cohort_leaderboard_for_week", { input_week_start: ids.weekStart }],
    ["student_leaderboard_available_weeks"],
    ["admin_students_for_week", { input_week_start: ids.weekStart }]
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
