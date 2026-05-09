import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import { correctCheckIn } from "@/app/admin/actions";
import { friendlyDate, todayDateString } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminStudentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const { data: student } = await supabase
    .from("profiles")
    .select("id,name,email,role,active,created_at")
    .eq("id", resolvedParams.id)
    .eq("role", "student")
    .single<Profile>();

  if (!student) {
    notFound();
  }

  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", student.id)
    .order("date", { ascending: false })
    .returns<CheckIn[]>();

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">{student.name}</h1>
          <p className="text-stone-600">{student.email}</p>
        </div>

        {resolvedSearchParams.status === "corrected" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Correction saved.
          </p>
        ) : null}
        {resolvedSearchParams.status === "correction-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to save correction.
          </p>
        ) : null}

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Manual Correction</h2>
          <form action={correctCheckIn} className="mt-4 grid gap-4 md:grid-cols-4">
            <input name="student_id" type="hidden" value={student.id} />
            <label className="block">
              <span className="text-sm font-medium text-ink">Date</span>
              <input
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                defaultValue={todayDateString()}
                name="date"
                required
                type="date"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Status</span>
              <select className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="completed">
                <option value="true">Completed</option>
                <option value="false">Missing</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-ink">Note</span>
              <input
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                name="note"
                placeholder="Optional correction note"
              />
            </label>
            <div className="md:col-span-4">
              <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
                Save correction
              </button>
            </div>
          </form>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">History</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-stone-50 text-ink">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {(checkins ?? []).map((checkin) => (
                  <tr key={checkin.id}>
                    <td className="px-4 py-3">{friendlyDate(checkin.date)}</td>
                    <td className="px-4 py-3">
                      <span className={checkin.completed ? "text-green-700" : "text-amber-700"}>
                        {checkin.completed ? "Completed" : "Missing"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {new Date(checkin.submitted_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {checkin.updated_at ? new Date(checkin.updated_at).toLocaleString() : ""}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{checkin.note ?? ""}</td>
                  </tr>
                ))}
                {checkins?.length ? null : (
                  <tr>
                    <td className="px-4 py-6 text-stone-600" colSpan={5}>
                      No check-ins yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
