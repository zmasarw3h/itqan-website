import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkInEffectiveDateString, weekStartForDate } from "../lib/dates";
import { partnerRoundForDate, PARTNER_RECITATION_POINTS_PER_ROUND } from "../lib/scoring";
import { WEEKLY_PLAN_BUCKET, weeklyPlanReplacementStoragePath } from "../lib/weekly-plans";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error("Student redesign fixtures require a disposable local Supabase URL and service key.");
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const suffix = Date.now().toString().slice(-8);
const password = "itqan2026";
const today = checkInEffectiveDateString();
const weekStart = weekStartForDate(today);

async function required<T>(label: string, promise: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await promise;
  if (error || data === null) throw new Error(`${label}: ${error?.message ?? "missing data"}`);
  return data;
}

async function createStudent(label: string, name: string, phone: string) {
  const email = `${phone.replace(/\D/g, "")}@itqan.local`;
  const auth = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error || !auth.data.user) throw new Error(`create ${label}: ${auth.error?.message ?? "missing user"}`);
  await required(`profile ${label}`, service.from("profiles").insert({ id: auth.data.user.id, name, email, phone, role: "student", active: true, score_starts_on: weekStart }).select("id").single());
  return { id: auth.data.user.id, phone };
}

async function uploadFixturePlan(studentId: string, fileName: string, fileType: "image/png" | "application/pdf") {
  const fixtureName = fileType === "application/pdf" ? "weekly-plan-fixture.pdf" : "weekly-plan-fixture.png";
  const bytes = readFileSync(resolve(process.cwd(), "e2e/fixtures", fixtureName));
  const filePath = weeklyPlanReplacementStoragePath(studentId, weekStart, fileName, randomUUID());
  const upload = await service.storage.from(WEEKLY_PLAN_BUCKET).upload(filePath, bytes, {
    cacheControl: "3600",
    contentType: fileType,
    upsert: false
  });
  if (upload.error) throw new Error(`upload fixture plan: ${upload.error.message}`);
  await required("weekly plan", service.from("weekly_plans").insert({
    student_id: studentId,
    week_start: weekStart,
    file_path: filePath,
    file_name: fileName,
    file_type: fileType,
    file_size: bytes.length
  }).select("id").single());
}

async function main() {
  const masjid = await required<{ id: string }>("masjid", service.from("masajid").insert({ name: "ITQAN E2E Masjid", slug: `student-redesign-${suffix}`, active: false }).select("id").single());
  const cohort = await required<{ id: string }>("cohort", service.from("cohorts").insert({ masjid_id: masjid.id, kind: "sisters", name: "Sisters", active: false }).select("id").single());
  const group = await required<{ id: string }>("group", service.from("halaqa_groups").insert({ cohort_id: cohort.id, name: "Group 1", active: false }).select("id").single());
  const longGroup = await required<{ id: string }>("long group", service.from("halaqa_groups").insert({ cohort_id: cohort.id, name: "A deliberately very long halaqa group name that must wrap without clipping or horizontal overflow", active: false }).select("id").single());
  await required("activate groups", service.from("halaqa_groups").update({ active: true }).in("id", [group.id, longGroup.id]).select("id"));
  await required("activate cohort", service.from("cohorts").update({ active: true }).eq("id", cohort.id).select("id"));
  const adminEmail = `student-redesign-admin-${suffix}@itqan.local`;
  const adminAuth = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true });
  if (adminAuth.error || !adminAuth.data.user) throw new Error(`create fixture admin: ${adminAuth.error?.message ?? "missing user"}`);
  await required("admin profile", service.from("profiles").insert({ id: adminAuth.data.user.id, name: "Fixture Admin", email: adminEmail, role: "admin", active: false }).select("id").single());
  await required("admin membership", service.from("masjid_staff_memberships").insert({ profile_id: adminAuth.data.user.id, masjid_id: masjid.id, staff_role: "admin", active: true, starts_on: weekStart }).select("id").single());
  await required("activate masjid", service.from("masajid").update({ active: true }).eq("id", masjid.id).select("id"));

  const teacherEmail = `student-redesign-teacher-${suffix}@itqan.local`;
  const teacherAuth = await service.auth.admin.createUser({ email: teacherEmail, password, email_confirm: true });
  if (teacherAuth.error || !teacherAuth.data.user) throw new Error(`create fixture teacher: ${teacherAuth.error?.message ?? "missing user"}`);
  await required("teacher profile", service.from("profiles").insert({ id: teacherAuth.data.user.id, name: "Mariam Hassan", email: teacherEmail, role: "teacher", active: true }).select("id").single());
  await required("teacher membership", service.from("masjid_staff_memberships").insert({ profile_id: teacherAuth.data.user.id, masjid_id: masjid.id, staff_role: "teacher", active: true, starts_on: weekStart }).select("id").single());
  await required("teacher availability", service.from("teacher_rotation_availability").insert({ teacher_id: teacherAuth.data.user.id, masjid_id: masjid.id, cohort_id: cohort.id, week_start: weekStart, available: true }).select("id").single());
  await required("teacher assignment", service.from("group_teacher_assignments").insert({ group_id: group.id, teacher_id: teacherAuth.data.user.id, week_start: weekStart, active: true, assigned_by: adminAuth.data.user.id }).select("id").single());

  const student = await createStudent("student", "Aaliyah Malik", `+1647555${suffix.slice(-4)}`);
  const pending = await createStudent("pending", "Pending Student", `+1647554${suffix.slice(-4)}`);
  const longText = await createStudent("long", "A student with an exceptionally long display name that must remain readable everywhere", `+1647553${suffix.slice(-4)}`);
  const missingPlan = await createStudent("missing plan", "Noor Rahman", `+1647552${suffix.slice(-4)}`);
  const completedPartner = await createStudent("completed partner", "Safiya Khan", `+1647551${suffix.slice(-4)}`);

  for (const row of [
    { studentId: student.id, groupId: group.id },
    { studentId: longText.id, groupId: longGroup.id },
    { studentId: missingPlan.id, groupId: group.id },
    { studentId: completedPartner.id, groupId: group.id }
  ]) {
    await required("membership", service.from("student_group_memberships").insert({ student_id: row.studentId, group_id: row.groupId, starts_on: weekStart }).select("id").single());
  }

  await uploadFixturePlan(student.id, "weekly-plan-fixture.png", "image/png");
  await uploadFixturePlan(longText.id, "a-very-long-weekly-plan-filename-that-must-wrap-without-covering-actions-or-leaving-the-viewport.pdf", "application/pdf");
  await uploadFixturePlan(completedPartner.id, "completed-partner-plan.png", "image/png");
  await required("completed partner rounds", service.from("partner_recitations").insert([
    { student_id: completedPartner.id, week_start: weekStart, round: "round_1", points: PARTNER_RECITATION_POINTS_PER_ROUND },
    { student_id: completedPartner.id, week_start: weekStart, round: "round_2", points: PARTNER_RECITATION_POINTS_PER_ROUND }
  ]).select("id").limit(2));

  process.stdout.write(JSON.stringify({
  password,
  studentPhone: student.phone,
  pendingPhone: pending.phone,
  longTextPhone: longText.phone,
  missingPlanPhone: missingPlan.phone,
  completedPartnerPhone: completedPartner.phone,
  studentId: student.id,
  pendingId: pending.id,
  longTextId: longText.id,
  missingPlanId: missingPlan.id,
  completedPartnerId: completedPartner.id,
  currentPartnerRound: partnerRoundForDate(today),
  weekStart,
  today,
  suffix
  }));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
