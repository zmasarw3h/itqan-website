import AppNav from "@/app/nav";
import { currentWeeklyPlanContext } from "@/lib/weekly-plans";
import { loadStudentScopeForWeek } from "@/lib/student-scope";
import { requireProfile } from "@/lib/supabase-server";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireProfile(["student"]);
  const { weekStart } = currentWeeklyPlanContext();
  const scope = await loadStudentScopeForWeek(supabase, profile.id, weekStart);

  return (
    <>
      <AppNav
        role="student"
        name={profile.name}
        studentPlacement={scope ? `${scope.cohortName} · ${scope.groupName}` : null}
        studentAssignmentPending={!scope}
      />
      {children}
    </>
  );
}
