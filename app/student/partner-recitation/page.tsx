import AppNav from "@/app/nav";
import { submitPartnerRecitation } from "@/app/student/actions";
import { friendlyDate, todayDateString, weekStartForDate } from "@/lib/dates";
import { buildPartnerRecitationView } from "@/lib/partner-recitations";
import { requireProfile } from "@/lib/supabase-server";
import type { PartnerRecitation } from "@/lib/types";

export const dynamic = "force-dynamic";

type PartnerSearchParams = {
  status?: string;
};

export default async function PartnerRecitationPage({
  searchParams
}: {
  searchParams: Promise<PartnerSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const weekStart = weekStartForDate(today);

  const { data: partnerRecitations } = await supabase
    .from("partner_recitations")
    .select("id,student_id,week_start,round,points,submitted_at")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .returns<PartnerRecitation[]>();
  const partnerView = buildPartnerRecitationView({
    today,
    recitations: partnerRecitations ?? []
  });

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Partner Recitation</h1>
            <p className="mt-1 text-stone-600">{friendlyDate(today)}</p>
          </div>

          {resolvedSearchParams.status === "submitted" ? (
            <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Partner recitation confirmed.
            </p>
          ) : null}
          {resolvedSearchParams.status === "duplicate" ? (
            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This partner recitation round is already completed.
            </p>
          ) : null}
          {resolvedSearchParams.status === "error" ? (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Unable to confirm partner recitation. Please try again.
            </p>
          ) : null}

          <div className="mt-6 rounded-lg border-2 border-moss bg-moss/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase text-moss">Current round</p>
                <h2 className="mt-1 text-2xl font-semibold text-ink">{partnerView.currentRoundName}</h2>
                <p className="mt-1 text-stone-600">{partnerView.currentRoundRange}</p>
              </div>
              <span
                className={
                  partnerView.currentRoundStatus === "completed"
                    ? "rounded-md bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700"
                    : "rounded-md bg-white px-3 py-1.5 text-sm font-medium text-moss"
                }
              >
                {partnerView.currentRoundStatusLabel}
              </span>
            </div>
            <p className="mt-4 text-lg font-semibold text-ink">{partnerView.currentRoundMessage}</p>
            {partnerView.canSubmitCurrentRound ? (
              <form action={submitPartnerRecitation} className="mt-4">
                <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
                  Confirm partner recitation
                </button>
              </form>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {partnerView.rounds.map((round) => (
              <div className="rounded-md border border-stone-200 p-4" key={round.round}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-ink">{round.name}</h2>
                    <p className="mt-1 text-sm text-stone-600">{round.range}</p>
                  </div>
                  <span
                    className={
                      round.status === "completed"
                        ? "font-medium text-green-700"
                        : round.status === "open"
                          ? "font-medium text-moss"
                          : round.status === "closed"
                            ? "font-medium text-stone-500"
                            : "font-medium text-amber-700"
                    }
                  >
                    {round.statusLabel}
                  </span>
                </div>
                {round.detail ? <p className="mt-3 text-sm text-stone-600">{round.detail}</p> : null}
                {round.submittedAt ? (
                  <p className="mt-3 text-sm text-stone-600">
                    Submitted {new Date(round.submittedAt).toLocaleString()} · {round.points} points
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
