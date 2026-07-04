import Link from "next/link";
import AppNav from "@/app/nav";
import { createUser } from "@/app/admin/actions";
import { requireProfile } from "@/lib/supabase-server";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

type NewStudentSearchParams = {
  status?: string;
  student?: string;
  role?: string;
};

function statusMessage(status: string | undefined, role: Role | undefined) {
  switch (status) {
    case "created": {
      const userLabel = role === "admin" ? "Admin" : role === "teacher" ? "Teacher" : "Student";
      return {
        tone: "success",
        text: `${userLabel} created. They can now log in with their phone number and password itqan2026.`
      };
    }
    case "exists":
      return { tone: "error", text: "A user with that phone number already exists." };
    case "invalid":
      return { tone: "error", text: "Enter a valid user name, phone number, and role." };
    case "profile-error":
      return { tone: "error", text: "The auth user was created, but the profile could not be saved. Check Supabase and try again." };
    case "assignment-error":
      return {
        tone: "error",
        text: "The user was created, but scoped access could not be assigned. Check the masjid, cohort, and group setup before they log in."
      };
    default:
      return null;
  }
}

export default async function NewStudentPage({
  searchParams
}: {
  searchParams: Promise<NewStudentSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { profile } = await requireProfile(["admin"]);
  const createdRole: Role | undefined =
    resolvedSearchParams.role === "admin" || resolvedSearchParams.role === "teacher" || resolvedSearchParams.role === "student"
      ? resolvedSearchParams.role
      : undefined;
  const message = statusMessage(resolvedSearchParams.status, createdRole);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Add User</h1>
          <p className="mt-1 text-stone-600">Create a student, teacher, or admin login from a name and phone number.</p>
        </div>

        {message ? (
          <p
            className={
              message.tone === "success"
                ? "mt-6 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
                : "mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            }
          >
            {message.text}
          </p>
        ) : null}

        {resolvedSearchParams.status === "created" && createdRole !== "admin" && resolvedSearchParams.student ? (
          <p className="mt-3 text-sm">
            <Link className="font-medium text-moss hover:text-ink" href={`/admin/students/${resolvedSearchParams.student}`}>
              Open the new student profile
            </Link>
          </p>
        ) : null}

        <form action={createUser} className="mt-6 grid gap-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
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
            <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue="student" name="role" required>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div>
            <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
              Create user
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
