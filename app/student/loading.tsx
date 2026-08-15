import { StudentPage } from "@/app/student/student-ui";

export default function StudentLoading() {
  return (
    <StudentPage width="standard">
      <div className="student-loading" role="status" aria-live="polite">
        <span className="sr-only">Loading this page</span>
        <div className="student-skeleton student-skeleton-title" />
        <div className="student-skeleton student-skeleton-subtitle" />
        <div className="student-skeleton student-skeleton-panel" />
        <div className="student-skeleton student-skeleton-panel is-short" />
      </div>
    </StudentPage>
  );
}
