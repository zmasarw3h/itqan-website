import { StudentPage } from "@/app/student/student-ui";

export default function PartnerRecitationLoading() {
  return (
    <StudentPage width="standard">
      <div className="student-loading" role="status" aria-live="polite">
        <span className="sr-only">Loading partner recitation</span>
        <div className="student-skeleton student-skeleton-title" />
        <div className="student-skeleton student-skeleton-subtitle" />
        <div className="student-skeleton student-skeleton-panel is-short" />
        <div className="student-loading-columns">
          <div className="student-skeleton student-skeleton-panel is-short" />
          <div className="student-skeleton student-skeleton-panel is-short" />
        </div>
        <div className="student-skeleton student-skeleton-panel" />
      </div>
    </StudentPage>
  );
}
