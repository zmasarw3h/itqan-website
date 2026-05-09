import AppNav from "@/app/nav";
import { friendlyDate } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StudentHistoryPage() {
  const { supabase, profile } = await requireProfile(["student"]);
  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", profile.id)
    .order("date", { ascending: false })
    .returns<CheckIn[]>();

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-ink">My History</h1>
        <div className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-stone-50 text-ink">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
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
                  <td className="px-4 py-3 text-stone-600">{checkin.note ?? ""}</td>
                </tr>
              ))}
              {checkins?.length ? null : (
                <tr>
                  <td className="px-4 py-6 text-stone-600" colSpan={4}>
                    No check-ins yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
