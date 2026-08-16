import { CheckCircle, Clock, User, UsersThree, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import PartnerConfirmForm from "@/app/student/partner-recitation/partner-confirm-form";
import { StudentNotice, StudentPage } from "@/app/student/student-ui";
import { StudentSetupIncomplete } from "@/app/student/student-week-context";
import { checkInEffectiveDateString, formatDateTimeInAppTimeZone, friendlyDate, weekStartForDate } from "@/lib/dates";
import { buildPartnerRecitationView } from "@/lib/partner-recitations";
import { loadStudentWeekContext } from "@/lib/student-scope";
import { requireProfile } from "@/lib/supabase-server";
import type { PartnerRecitation } from "@/lib/types";

export const dynamic = "force-dynamic";

type PartnerSearchParams = { status?: string };

const statusNotices = {
  submitted: { tone: "success" as const, text: "Partner recitation confirmed." },
  duplicate: { tone: "warning" as const, text: "This partner recitation round is already completed." },
  error: { tone: "error" as const, text: "Unable to confirm partner recitation. Please try again." },
  "setup-incomplete": { tone: "warning" as const, text: "Your halaqa assignment is not ready yet." }
};

export default async function PartnerRecitationPage({
  searchParams
}: {
  searchParams: Promise<PartnerSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const today = checkInEffectiveDateString();
  const weekStart = weekStartForDate(today);
  const studentContext = await loadStudentWeekContext(supabase, profile.id, weekStart);

  if (!studentContext.scope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={weekStart} teacher={studentContext.teacher} />;
  }

  const { data: partnerRecitations, error: partnerError } = await supabase
    .from("partner_recitations")
    .select("id,student_id,week_start,round,points,submitted_at")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .returns<PartnerRecitation[]>();
  const partnerView = buildPartnerRecitationView({ today, recitations: partnerRecitations ?? [] });
  const notice = resolvedSearchParams.status && resolvedSearchParams.status in statusNotices
    ? statusNotices[resolvedSearchParams.status as keyof typeof statusNotices]
    : null;

  return (
    <StudentPage width="standard">
      <section className="partner-page">
        <header className="partner-header">
          <h1>Partner Recitation</h1>
          <p>{friendlyDate(today)}</p>
          <div className="student-context-inline">
            <span><UsersThree aria-hidden="true" size={20} />{studentContext.scope.cohortName} · {studentContext.scope.groupName}</span>
            <span><User aria-hidden="true" size={20} />This week&apos;s teacher: {studentContext.teacher?.teacher_name ?? "Not assigned yet"}</span>
          </div>
          <p className="partner-intro">Complete two partner recitation rounds each week.</p>
        </header>

        {notice ? <StudentNotice className="partner-notice" tone={notice.tone}>{notice.text}</StudentNotice> : null}
        {partnerError ? (
          <StudentNotice className="partner-notice" tone="error">
            We couldn&apos;t load your saved partner recitations. Refresh this page to try again.
          </StudentNotice>
        ) : null}

        <div className="partner-rounds" aria-label="Weekly partner recitation rounds">
          {partnerView.rounds.map((round, index) => {
            const actionable = round.status === "open";
            return (
              <article className={`partner-round ${actionable ? "is-actionable" : ""}`} key={round.round}>
                <span className="partner-round-number" aria-hidden="true">{index + 1}</span>
                <div>
                  <h2>{round.name}</h2>
                  <p>{round.range}</p>
                  {round.submittedAt ? <small>Confirmed {formatDateTimeInAppTimeZone(round.submittedAt)}</small> : round.detail ? <small>{round.detail}</small> : null}
                </div>
                <span className={`partner-round-status is-${round.status}`}>
                  {round.status === "completed" ? <CheckCircle aria-hidden="true" size={17} weight="fill" /> : null}
                  {round.status === "upcoming" ? <Clock aria-hidden="true" size={17} /> : null}
                  {round.statusLabel}
                </span>
              </article>
            );
          })}
        </div>

        <section className={`partner-current ${partnerView.canSubmitCurrentRound ? "is-actionable" : ""}`} aria-labelledby="partner-current-title">
          <div className="partner-current-heading">
            <p>Current round</p>
            <span>{partnerView.currentRoundPoints} points</span>
          </div>
          <h2 id="partner-current-title">{partnerView.currentRoundMessage}</h2>
          <p className="partner-current-window">{partnerView.currentRoundName} · {partnerView.currentRoundRange}</p>
          <div className="partner-current-action">
            {partnerView.canSubmitCurrentRound ? (
              <>
                <p>Confirm after you have completed this round with your partner.</p>
                <PartnerConfirmForm />
              </>
            ) : (
              <p><WarningCircle aria-hidden="true" size={20} />{partnerView.currentRoundGuidance}</p>
            )}
          </div>
        </section>
      </section>
    </StudentPage>
  );
}
