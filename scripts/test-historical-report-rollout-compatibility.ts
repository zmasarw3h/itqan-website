import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.RLS_SUPABASE_URL ?? "";
const anonKey = process.env.RLS_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.RLS_SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = "LocalRollout2026!";

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  throw new Error(`RLS_SUPABASE_URL must be local; received ${url || "missing"}.`);
}
if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing local Supabase anon or service-role credentials.");
}

const service = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekStartForDate(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  return addDays(date, -value.getUTCDay());
}

function torontoCivilDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function expectError(label: string, operation: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await operation;
  assert.ok(error, `${label}: write unexpectedly succeeded`);
}

async function main() {
const today = torontoCivilDate();
const currentWeek = weekStartForDate(today);
const legacyWeek = addDays(currentWeek, -42);
const rpcWeek = addDays(currentWeek, -35);
const legacyWaiveWeek = addDays(currentWeek, -28);
const rpcWaiveWeek = addDays(currentWeek, -21);
const forgedWeek = addDays(currentWeek, -14);

const fixtureSuffix = Date.now().toString();
const { data: masjid, error: masjidError } = await service
  .from("masajid")
  .insert({ name: "Rollout Compatibility Masjid", slug: `rollout-compat-${fixtureSuffix}`, active: false })
  .select("id")
  .single();
assert.equal(masjidError, null, `fixture masjid: ${masjidError?.message}`);
assert.ok(masjid);
const { data: cohort, error: cohortError } = await service
  .from("cohorts")
  .insert({ masjid_id: masjid.id, kind: "brothers", name: "Rollout Compatibility Cohort" })
  .select("id")
  .single();
assert.equal(cohortError, null, `fixture cohort: ${cohortError?.message}`);
assert.ok(cohort);
const { data: group, error: groupError } = await service
  .from("halaqa_groups")
  .insert({ cohort_id: cohort.id, name: "Rollout Compatibility Group" })
  .select("id")
  .single();
assert.equal(groupError, null, `fixture group: ${groupError?.message}`);
assert.ok(group);

const email = `rollout-compat-${Date.now()}@rls.local`;
const { data: authData, error: authError } = await service.auth.admin.createUser({
  email,
  password,
  email_confirm: true
});
assert.equal(authError, null, `create compatibility user: ${authError?.message}`);
assert.ok(authData.user);
const studentId = authData.user.id;

const { error: profileError } = await service.from("profiles").insert({
  id: studentId,
  name: "Rollout Compatibility Student",
  email,
  role: "student",
  active: true,
  score_starts_on: legacyWeek
});
assert.equal(profileError, null, `insert compatibility profile: ${profileError?.message}`);
const { error: membershipError } = await service.from("student_group_memberships").insert({
  student_id: studentId,
  group_id: group.id,
  starts_on: legacyWeek
});
assert.equal(membershipError, null, `insert compatibility membership: ${membershipError?.message}`);

const adminEmail = `rollout-admin-${Date.now()}@rls.local`;
const adminAuth = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true });
assert.equal(adminAuth.error, null, adminAuth.error?.message);
assert.ok(adminAuth.data.user);
const adminId = adminAuth.data.user.id;
const adminProfile = await service.from("profiles").insert({
  id: adminId,
  name: "Rollout Compatibility Admin",
  email: adminEmail,
  role: "admin",
  active: true
});
assert.equal(adminProfile.error, null, adminProfile.error?.message);
const adminMembership = await service.from("masjid_staff_memberships").insert({
  profile_id: adminId,
  masjid_id: masjid.id,
  staff_role: "admin",
  starts_on: today
});
assert.equal(adminMembership.error, null, adminMembership.error?.message);
const activateMasjid = await service.from("masajid").update({ active: true }).eq("id", masjid.id);
assert.equal(activateMasjid.error, null, activateMasjid.error?.message);

// Phase A: exercise the exact old application contract (service-role direct
// inserts and pending-row updates) against the new database migration.
const { data: legacyInserted, error: legacyInsertError } = await service
  .from("accountability_obligations")
  .insert({
    student_id: studentId,
    week_start: legacyWeek,
    weekly_percentage: 0,
    amount_cents: 3500,
    status: "pending",
    updated_at: new Date().toISOString()
  })
  .select("id,weekly_percentage,amount_cents,status,masjid_id,cohort_id,halaqa_group_id")
  .single();
assert.equal(legacyInsertError, null, `legacy direct insert: ${legacyInsertError?.message}`);
assert.equal(Number(legacyInserted?.weekly_percentage), 0);
assert.equal(legacyInserted?.amount_cents, 3500);
assert.equal(legacyInserted?.halaqa_group_id, group.id);

const rpcInserted = await service.rpc("reconcile_historical_accountability_obligation", {
  input_student_id: studentId,
  input_week_start: rpcWeek
});
assert.equal(rpcInserted.error, null, `new RPC insert: ${rpcInserted.error?.message}`);
assert.equal(Number(rpcInserted.data?.weekly_percentage), 0);
assert.equal(rpcInserted.data?.amount_cents, 3500);

const legacyWaiveInsert = await service.from("accountability_obligations").insert({
  student_id: studentId,
  week_start: legacyWaiveWeek,
  weekly_percentage: 0,
  amount_cents: 3500,
  status: "pending"
}).select("id").single();
assert.equal(legacyWaiveInsert.error, null, legacyWaiveInsert.error?.message);
assert.ok(legacyWaiveInsert.data);
const rpcWaiveInsert = await service.rpc("reconcile_historical_accountability_obligation", {
  input_student_id: studentId,
  input_week_start: rpcWaiveWeek
});
assert.equal(rpcWaiveInsert.error, null, rpcWaiveInsert.error?.message);

const gradeRows = [legacyWeek, rpcWeek].map((weekStart) => ({
  student_id: studentId,
  week_start: weekStart,
  attended: true,
  attendance_points: 100,
  recitation_points: 50
}));
const { error: gradeError } = await service.from("halaqa_grades").insert(gradeRows);
assert.equal(gradeError, null, `insert recalculation grades: ${gradeError?.message}`);

const passingCheckins = [legacyWaiveWeek, rpcWaiveWeek].flatMap((weekStart) =>
  Array.from({ length: 7 }, (_, offset) => ({
    student_id: studentId,
    date: addDays(weekStart, offset),
    completed: true,
    earned_weight: 100,
    total_weight: 100,
    daily_score: 100
  }))
);
const passingInsert = await service.from("checkins").insert(passingCheckins);
assert.equal(passingInsert.error, null, `insert passing recalculation checkins: ${passingInsert.error?.message}`);

const { data: legacyUpdated, error: legacyUpdateError } = await service
  .from("accountability_obligations")
  .update({ weekly_percentage: 15, amount_cents: 3000, updated_at: new Date().toISOString() })
  .eq("id", legacyInserted!.id)
  .eq("status", "pending")
  .select("weekly_percentage,amount_cents,status")
  .single();
assert.equal(legacyUpdateError, null, `legacy pending recalculation: ${legacyUpdateError?.message}`);

const rpcUpdated = await service.rpc("reconcile_historical_accountability_obligation", {
  input_student_id: studentId,
  input_week_start: rpcWeek
});
assert.equal(rpcUpdated.error, null, `new RPC recalculation: ${rpcUpdated.error?.message}`);
assert.deepEqual(
  {
    weekly_percentage: Number(legacyUpdated?.weekly_percentage),
    amount_cents: legacyUpdated?.amount_cents,
    status: legacyUpdated?.status
  },
  {
    weekly_percentage: Number(rpcUpdated.data?.weekly_percentage),
    amount_cents: rpcUpdated.data?.amount_cents,
    status: rpcUpdated.data?.status
  },
  "legacy and RPC accountability routes diverged"
);

const autoWaiveTimestamp = new Date().toISOString();
const legacyWaived = await service.from("accountability_obligations").update({
  weekly_percentage: 70,
  amount_cents: 0,
  status: "waived",
  waived_at: autoWaiveTimestamp,
  admin_note: "Auto-waived after automatic score recalculation >= 70",
  updated_at: autoWaiveTimestamp
}).eq("id", legacyWaiveInsert.data.id).select("weekly_percentage,amount_cents,status").single();
assert.equal(legacyWaived.error, null, `legacy auto-waive recalculation: ${legacyWaived.error?.message}`);
const rpcWaived = await service.rpc("reconcile_historical_accountability_obligation", {
  input_student_id: studentId,
  input_week_start: rpcWaiveWeek
});
assert.equal(rpcWaived.error, null, `RPC auto-waive recalculation: ${rpcWaived.error?.message}`);
assert.equal(rpcWaived.data, null, "passing reconciliation should return no blocking obligation");
const rpcWaivedRow = await service.from("accountability_obligations")
  .select("weekly_percentage,amount_cents,status")
  .eq("student_id", studentId).eq("week_start", rpcWaiveWeek).single();
assert.equal(rpcWaivedRow.error, null, rpcWaivedRow.error?.message);
assert.deepEqual(
  {
    weekly_percentage: Number(legacyWaived.data?.weekly_percentage),
    amount_cents: legacyWaived.data?.amount_cents,
    status: legacyWaived.data?.status
  },
  {
    weekly_percentage: Number(rpcWaivedRow.data?.weekly_percentage),
    amount_cents: rpcWaivedRow.data?.amount_cents,
    status: rpcWaivedRow.data?.status
  },
  "legacy and RPC auto-waive routes diverged"
);

await expectError("forged percentage update", service.from("accountability_obligations")
  .update({ weekly_percentage: 1 }).eq("id", legacyInserted!.id));
await expectError("forged amount update", service.from("accountability_obligations")
  .update({ amount_cents: 1 }).eq("id", legacyInserted!.id));
await expectError("forged scope update", service.from("accountability_obligations")
  .update({ masjid_id: "00000000-0000-0000-0000-000000000001" }).eq("id", legacyInserted!.id));
await expectError("forged week update", service.from("accountability_obligations")
  .update({ week_start: addDays(legacyWeek, 1) }).eq("id", legacyInserted!.id));

await expectError(
  "forged percentage",
  service.from("accountability_obligations").insert({
    student_id: studentId,
    week_start: forgedWeek,
    weekly_percentage: 1,
    amount_cents: 3500
  })
);
await expectError(
  "forged amount",
  service.from("accountability_obligations").insert({
    student_id: studentId,
    week_start: forgedWeek,
    weekly_percentage: 0,
    amount_cents: 500
  })
);
await expectError(
  "forged scope",
  service.from("accountability_obligations").insert({
    student_id: studentId,
    week_start: forgedWeek,
    weekly_percentage: 0,
    amount_cents: 3500,
    masjid_id: "00000000-0000-0000-0000-000000000001"
  })
);
await expectError(
  "forged non-Sunday week",
  service.from("accountability_obligations").insert({
    student_id: studentId,
    week_start: addDays(forgedWeek, 1),
    weekly_percentage: 0,
    amount_cents: 3500
  })
);

const noMembershipEmail = `rollout-no-membership-${Date.now()}@rls.local`;
const noMembershipAuth = await service.auth.admin.createUser({
  email: noMembershipEmail,
  password,
  email_confirm: true
});
assert.equal(noMembershipAuth.error, null, noMembershipAuth.error?.message);
assert.ok(noMembershipAuth.data.user);
const noMembershipId = noMembershipAuth.data.user.id;
const noMembershipProfile = await service.from("profiles").insert({
  id: noMembershipId,
  name: "Rollout No Membership",
  email: noMembershipEmail,
  role: "student",
  active: true,
  score_starts_on: legacyWeek
});
assert.equal(noMembershipProfile.error, null, noMembershipProfile.error?.message);
await expectError(
  "forged student",
  service.from("accountability_obligations").insert({
    student_id: noMembershipId,
    week_start: forgedWeek,
    weekly_percentage: 0,
    amount_cents: 3500
  })
);
await expectError(
  "RPC student outside historical population",
  service.rpc("reconcile_historical_accountability_obligation", {
    input_student_id: noMembershipId,
    input_week_start: forgedWeek
  })
);

const student = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const signIn = await student.auth.signInWithPassword({ email, password });
assert.equal(signIn.error, null, signIn.error?.message);
await expectError(
  "authenticated student direct insert",
  student.from("accountability_obligations").insert({
    student_id: studentId,
    week_start: forgedWeek,
    weekly_percentage: 0,
    amount_cents: 3500
  })
);

const admin = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const adminSignIn = await admin.auth.signInWithPassword({ email: adminEmail, password });
assert.equal(adminSignIn.error, null, adminSignIn.error?.message);
const adminScopeProof = await admin.rpc("historical_reporting_students_for_weeks", {
  input_week_starts: [legacyWeek]
});
assert.equal(adminScopeProof.error, null, adminScopeProof.error?.message);
assert.ok(
  (adminScopeProof.data ?? []).some((row: { student_id: string }) => row.student_id === studentId),
  "authenticated admin fixture is not currently authorized for its historical masjid"
);
await expectError("authenticated in-scope admin forged percentage", admin.from("accountability_obligations").insert({
  student_id: studentId,
  week_start: forgedWeek,
  weekly_percentage: 1,
  amount_cents: 3500,
  status: "pending"
}));
await expectError("authenticated in-scope admin forged amount", admin.from("accountability_obligations").insert({
  student_id: studentId,
  week_start: forgedWeek,
  weekly_percentage: 0,
  amount_cents: 1,
  status: "pending"
}));
await expectError("authenticated in-scope admin non-Sunday week", admin.from("accountability_obligations").insert({
  student_id: studentId,
  week_start: addDays(forgedWeek, 1),
  weekly_percentage: 0,
  amount_cents: 3500,
  status: "pending"
}));
await expectError("authenticated in-scope admin future week", admin.from("accountability_obligations").insert({
  student_id: studentId,
  week_start: currentWeek,
  weekly_percentage: 0,
  amount_cents: 3500,
  status: "pending"
}));
await expectError("authenticated in-scope admin forged percentage update", admin
  .from("accountability_obligations").update({ weekly_percentage: 1 }).eq("id", legacyInserted!.id));
await expectError("authenticated in-scope admin forged amount update", admin
  .from("accountability_obligations").update({ amount_cents: 1 }).eq("id", legacyInserted!.id));
await expectError("authenticated in-scope admin forged scope update", admin
  .from("accountability_obligations")
  .update({ halaqa_group_id: "00000000-0000-0000-0000-000000000001" })
  .eq("id", legacyInserted!.id));
await expectError(
  "authenticated student RPC",
  student.rpc("reconcile_historical_accountability_obligation", {
    input_student_id: studentId,
    input_week_start: forgedWeek
  })
);

console.log("Historical-report database-first rollout compatibility checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
