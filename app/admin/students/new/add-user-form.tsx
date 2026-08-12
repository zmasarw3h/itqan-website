"use client";

import { Buildings, CalendarBlank, GraduationCap, LockSimple, User, UsersThree } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, type FormHTMLAttributes, type ReactNode } from "react";
import { resolveStudentScope, resolveTeacherMasjidId, type AdminCreateUserScopeOptions, type StudentScopeSelection } from "@/lib/admin-user-scope";
import { addDays } from "@/lib/dates";

type CreateUserRole = "student" | "teacher";
type AddUserFormProps = {
  action: FormHTMLAttributes<HTMLFormElement>["action"];
  initialRole: CreateUserRole;
  requestId: string;
  scopeOptions: AdminCreateUserScopeOptions;
  initialStudentScope: StudentScopeSelection;
  initialTeacherMasjidId: string;
  initialScoreStartsOn: string;
  currentScoreWeekStart: string;
  returnTo?: "super_admin";
};

function cohortLabel(kind: "brothers" | "sisters", name: string) {
  const kindLabel = kind === "brothers" ? "Brothers" : "Sisters";
  return name.toLocaleLowerCase() === kind ? kindLabel : `${name} (${kindLabel})`;
}

function Step({ children, description, number, title }: { children: ReactNode; description?: string; number: number; title: string }) {
  return <section className="border-t border-stone-200 py-6 first:border-t-0 first:pt-0"><div className="flex gap-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-moss font-semibold text-white">{number}</span><div className="min-w-0 flex-1"><h2 className="text-xl font-semibold text-ink">{title}</h2>{description ? <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p> : null}<div className="mt-4">{children}</div></div></div></section>;
}

function ReviewRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex gap-3 border-t border-stone-200 py-3 first:border-t-0"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-green-50 text-moss">{icon}</span><div><p className="text-sm text-stone-500">{label}</p><p className="font-medium text-ink">{value}</p></div></div>;
}

export default function AddUserForm({ action, initialRole, requestId, scopeOptions, initialStudentScope, initialTeacherMasjidId, initialScoreStartsOn, currentScoreWeekStart, returnTo }: AddUserFormProps) {
  const [role, setRole] = useState<CreateUserRole>(initialRole);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [studentSelection, setStudentSelection] = useState<StudentScopeSelection>(initialStudentScope);
  const [teacherSelection, setTeacherSelection] = useState(initialTeacherMasjidId);
  const [scoreStartsOn, setScoreStartsOn] = useState(initialScoreStartsOn);
  const studentScope = resolveStudentScope(scopeOptions, studentSelection);
  const teacherMasjidId = resolveTeacherMasjidId(scopeOptions, teacherSelection);
  const scopeIsReady = role === "student" ? Boolean(studentScope.masjidId && studentScope.cohortId && studentScope.groupId) : Boolean(teacherMasjidId);
  const selectedMasjid = scopeOptions.masjids.find((item) => item.id === (role === "student" ? studentScope.masjidId : teacherMasjidId));
  const selectedCohort = scopeOptions.cohorts.find((item) => item.id === studentScope.cohortId);
  const selectedGroup = scopeOptions.groups.find((item) => item.id === studentScope.groupId);

  return <form action={action} className="mt-7 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,27rem)]">
    <input name="request_id" type="hidden" value={requestId} />{returnTo ? <input name="return_to" type="hidden" value={returnTo} /> : null}
    <input name="student_masjid_id" type="hidden" value={studentScope.masjidId} /><input name="student_cohort_id" type="hidden" value={studentScope.cohortId} /><input name="student_group_id" type="hidden" value={studentScope.groupId} /><input name="teacher_masjid_id" type="hidden" value={teacherMasjidId} />

    <div>
      <Step description="Enter the user’s full name and phone number." number={1} title="Identity"><div className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2 sm:p-5"><label><span className="text-sm font-medium">Name</span><input autoComplete="name" className="mt-2 min-h-12 w-full rounded-md border border-stone-300 px-3" name="name" onChange={(event) => setName(event.target.value)} required type="text" value={name} /></label><label><span className="text-sm font-medium">Phone number</span><input autoComplete="tel" className="mt-2 min-h-12 w-full rounded-md border border-stone-300 px-3" name="phone" onChange={(event) => setPhone(event.target.value)} required type="tel" value={phone} /></label></div></Step>

      <Step description="Choose the primary role for this account." number={2} title="Role"><input name="role" type="hidden" value={role} /><div className="grid grid-cols-2 overflow-hidden rounded-lg border border-stone-300"><button aria-pressed={role === "student"} className={`flex min-h-14 items-center justify-center gap-2 font-medium ${role === "student" ? "bg-green-50 text-moss" : "bg-white"}`} onClick={() => setRole("student")} type="button"><User className="size-5" />Student</button><button aria-pressed={role === "teacher"} className={`flex min-h-14 items-center justify-center gap-2 border-l border-stone-300 font-medium ${role === "teacher" ? "bg-green-50 text-moss" : "bg-white"}`} onClick={() => setRole("teacher")} type="button"><GraduationCap className="size-5" />Teacher</button></div></Step>

      {role === "student" ? <Step description="The student can use orientation features immediately. Scores, streaks, rewards, and accountability begin on the selected Sunday." number={3} title="Official scoring begins"><div className="grid gap-3 sm:grid-cols-2"><button aria-pressed={scoreStartsOn === currentScoreWeekStart} className={`min-h-12 rounded-md border px-4 font-medium ${scoreStartsOn === currentScoreWeekStart ? "border-moss bg-green-50 text-moss" : "border-stone-300 bg-white"}`} onClick={() => setScoreStartsOn(currentScoreWeekStart)} type="button">This Sunday</button><button aria-pressed={scoreStartsOn === addDays(currentScoreWeekStart, 7)} className={`min-h-12 rounded-md border px-4 font-medium ${scoreStartsOn === addDays(currentScoreWeekStart, 7) ? "border-moss bg-green-50 text-moss" : "border-stone-300 bg-white"}`} onClick={() => setScoreStartsOn(addDays(currentScoreWeekStart, 7))} type="button">Next Sunday (recommended)</button></div><label className="mt-4 block"><span className="text-sm text-stone-600">Selected Sunday</span><input className="mt-2 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" name="score_starts_on" onChange={(event) => setScoreStartsOn(event.target.value)} required type="date" value={scoreStartsOn} /></label></Step> : null}

      {role === "student" ? <Step description="Place the student into the correct cohort and group." number={4} title="Student placement"><div className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2 sm:p-5">{studentScope.masjids.length > 1 ? <label><span className="text-sm font-medium">Masjid</span><select className="mt-2 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" onChange={(event) => setStudentSelection({ masjidId: event.target.value, cohortId: "", groupId: "" })} value={studentScope.masjidId}><option value="">Select masjid</option>{studentScope.masjids.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}<label><span className="text-sm font-medium">Cohort</span><select className="mt-2 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" onChange={(event) => setStudentSelection((current) => ({ ...current, cohortId: event.target.value, groupId: "" }))} value={studentScope.cohortId}><option value="">Select cohort</option>{studentScope.cohorts.map((item) => <option key={item.id} value={item.id}>{cohortLabel(item.kind, item.name)}</option>)}</select></label><label><span className="text-sm font-medium">Group</span><select className="mt-2 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" onChange={(event) => setStudentSelection((current) => ({ ...current, groupId: event.target.value }))} value={studentScope.groupId}><option value="">Select group</option>{studentScope.groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></Step> : <Step description="Assign this teacher to an active masjid." number={3} title="Teacher access"><label className="block rounded-xl border border-stone-200 bg-white p-4 sm:p-5"><span className="text-sm font-medium">Masjid</span><select className="mt-2 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" onChange={(event) => setTeacherSelection(event.target.value)} value={teacherMasjidId}><option value="">Select masjid</option>{scopeOptions.masjids.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></Step>}
    </div>

    <aside className="rounded-xl border border-stone-200 bg-white p-5 lg:sticky lg:top-6"><h2 className="text-xl font-semibold">Review account</h2><p className="mt-1 text-sm leading-6 text-stone-600">Please confirm the details before creating this {role} account.</p><div className="mt-4"><ReviewRow icon={<User className="size-5" />} label="Role" value={role === "student" ? "Student" : "Teacher"} />{name ? <ReviewRow icon={<User className="size-5" />} label="Name" value={name} /> : null}{role === "student" ? <ReviewRow icon={<CalendarBlank className="size-5" />} label="Scoring begins" value={scoreStartsOn} /> : null}<ReviewRow icon={<Buildings className="size-5" />} label="Masjid" value={selectedMasjid?.name ?? "Select a masjid"} />{role === "student" ? <><ReviewRow icon={<UsersThree className="size-5" />} label="Cohort" value={selectedCohort?.name ?? "Select a cohort"} /><ReviewRow icon={<UsersThree className="size-5" />} label="Group" value={selectedGroup?.name ?? "Select a group"} /></> : null}</div><div className="mt-4 flex gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-moss"><LockSimple className="mt-0.5 size-5 shrink-0" /><p><strong>Default password: itqan2026</strong><br />The user can change their password after logging in.</p></div>{!scopeIsReady ? <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Choose an active {role === "student" ? "cohort and group" : "masjid"} before creating this account.</p> : null}<button className="mt-5 min-h-12 w-full rounded-md bg-moss px-4 font-semibold text-white hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50" disabled={!scopeIsReady} type="submit">Create {role}</button><Link className="mt-3 flex min-h-12 items-center justify-center rounded-md border border-stone-300 font-medium" href="/admin">Cancel</Link></aside>
  </form>;
}
