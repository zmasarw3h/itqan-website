"use client";

import { useState, type FormHTMLAttributes } from "react";
import {
  resolveStudentScope,
  resolveTeacherMasjidId,
  type AdminCreateUserScopeOptions,
  type StudentScopeSelection
} from "@/lib/admin-user-scope";

type CreateUserRole = "student" | "teacher";

type AddUserFormProps = {
  action: FormHTMLAttributes<HTMLFormElement>["action"];
  initialRole: CreateUserRole;
  requestId: string;
  scopeOptions: AdminCreateUserScopeOptions;
  initialStudentScope: StudentScopeSelection;
  initialTeacherMasjidId: string;
  returnTo?: "super_admin";
};

function cohortLabel(kind: "brothers" | "sisters", name: string) {
  const kindLabel = kind === "brothers" ? "Brothers" : "Sisters";

  return name.toLocaleLowerCase() === kind ? kindLabel : `${name} (${kindLabel})`;
}

export default function AddUserForm({
  action,
  initialRole,
  requestId,
  scopeOptions,
  initialStudentScope,
  initialTeacherMasjidId,
  returnTo
}: AddUserFormProps) {
  const [role, setRole] = useState<CreateUserRole>(initialRole);
  const [studentSelection, setStudentSelection] = useState<StudentScopeSelection>(initialStudentScope);
  const [teacherSelection, setTeacherSelection] = useState(initialTeacherMasjidId);
  const studentScope = resolveStudentScope(scopeOptions, studentSelection);
  const teacherMasjidId = resolveTeacherMasjidId(scopeOptions, teacherSelection);
  const hasStudentScope = Boolean(studentScope.masjidId && studentScope.cohortId && studentScope.groupId);
  const hasTeacherScope = Boolean(teacherMasjidId);
  const scopeIsReady = role === "student" ? hasStudentScope : hasTeacherScope;
  const showStudentScope =
    role === "student" &&
    (studentScope.masjids.length > 1 || studentScope.cohorts.length > 1 || studentScope.groups.length > 1);

  return (
    <form action={action} className="mt-6 grid gap-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <input name="request_id" type="hidden" value={requestId} />
      {returnTo ? <input name="return_to" type="hidden" value={returnTo} /> : null}
      <input name="student_masjid_id" type="hidden" value={studentScope.masjidId} />
      <input name="student_cohort_id" type="hidden" value={studentScope.cohortId} />
      <input name="student_group_id" type="hidden" value={studentScope.groupId} />
      <input name="teacher_masjid_id" type="hidden" value={teacherMasjidId} />

      <label className="block">
        <span className="text-sm font-medium text-ink">Name</span>
        <input
          autoComplete="name"
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          name="name"
          required
          type="text"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink">Phone number</span>
        <input
          autoComplete="tel"
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          name="phone"
          required
          type="tel"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink">Role</span>
        <select
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
          name="role"
          onChange={(event) => setRole(event.target.value as CreateUserRole)}
          value={role}
        >
          <option value="student">Student</option>
          <option value="teacher">Teacher</option>
        </select>
      </label>

      {showStudentScope ? (
        <fieldset className="grid gap-3 rounded-md border border-stone-200 p-4">
          <legend className="px-1 text-sm font-medium text-ink">Student placement</legend>

          {studentScope.masjids.length > 1 ? (
            <label className="block">
              <span className="text-sm font-medium text-ink">Masjid</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                onChange={(event) =>
                  setStudentSelection({ masjidId: event.target.value, cohortId: "", groupId: "" })
                }
                value={studentScope.masjidId}
              >
                <option value="">Select masjid</option>
                {studentScope.masjids.map((masjid) => (
                  <option key={masjid.id} value={masjid.id}>
                    {masjid.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {studentScope.cohorts.length > 1 ? (
            <label className="block">
              <span className="text-sm font-medium text-ink">Cohort</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                onChange={(event) =>
                  setStudentSelection((current) => ({ ...current, cohortId: event.target.value, groupId: "" }))
                }
                value={studentScope.cohortId}
              >
                <option value="">Select cohort</option>
                {studentScope.cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohortLabel(cohort.kind, cohort.name)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {studentScope.groups.length > 1 ? (
            <label className="block">
              <span className="text-sm font-medium text-ink">Group</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                onChange={(event) =>
                  setStudentSelection((current) => ({ ...current, groupId: event.target.value }))
                }
                value={studentScope.groupId}
              >
                <option value="">Select group</option>
                {studentScope.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {role === "teacher" && scopeOptions.masjids.length > 1 ? (
        <label className="block">
          <span className="text-sm font-medium text-ink">Masjid</span>
          <select
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
            onChange={(event) => setTeacherSelection(event.target.value)}
            value={teacherMasjidId}
          >
            <option value="">Select masjid</option>
            {scopeOptions.masjids.map((masjid) => (
              <option key={masjid.id} value={masjid.id}>
                {masjid.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!scopeIsReady ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {role === "student"
            ? "Choose an active group before creating this student."
            : "Choose an active masjid before creating this teacher."}
        </p>
      ) : null}

      <div>
        <button
          className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!scopeIsReady}
          type="submit"
        >
          Create user
        </button>
      </div>
    </form>
  );
}
