import AppNav from "@/app/nav";
import { submitTodayCheckIn } from "@/app/student/actions";
import { APP_TIME_ZONE } from "@/lib/config";
import { friendlyDate, todayDateString } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StudentCheckInPage({
  searchParams
}: {
  searchParams: { status?: string };
}) {
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const { data: checkin } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", profile.id)
    .eq("date", today)
    .maybeSingle<CheckIn>();

  const alreadySubmitted = Boolean(checkin);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <p className="text-sm font-medium uppercase tracking-wide text-gold">{APP_TIME_ZONE}</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">Today&apos;s Check-In</h1>
            <p className="mt-1 text-stone-600">
              {profile.name} · {friendlyDate(today)}
            </p>
          </div>

          {searchParams.status === "submitted" ? (
            <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Check-in submitted.
            </p>
          ) : null}
          {searchParams.status === "duplicate" ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You already have a check-in for today.
            </p>
          ) : null}
          {searchParams.status === "error" ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Unable to submit. Please try again.
            </p>
          ) : null}

          {alreadySubmitted ? (
            <div className="rounded-md bg-stone-50 p-4">
              <p className="font-medium text-ink">
                {checkin?.completed ? "Completed" : "Marked missing by admin"}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Recorded at {checkin ? new Date(checkin.submitted_at).toLocaleString() : ""}
              </p>
              {checkin?.note ? <p className="mt-3 text-sm text-stone-700">Note: {checkin.note}</p> : null}
            </div>
          ) : (
            <form action={submitTodayCheckIn} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-ink">Optional note</span>
                <textarea
                  className="mt-1 min-h-28 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
                  name="note"
                  placeholder="Anything admin should know?"
                />
              </label>
              <button className="rounded-md bg-moss px-4 py-2.5 font-medium text-white hover:bg-ink">
                I completed today&apos;s work
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}
