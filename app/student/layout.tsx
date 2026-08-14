import { signOut } from "@/app/actions";
import { StudentShellFrame } from "@/app/student/student-shell";
import { currentWeeklyPlanContext } from "@/lib/weekly-plans";
import { loadStudentScopeForWeek } from "@/lib/student-scope";
import { requireProfile } from "@/lib/supabase-server";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireProfile(["student"]);
  const { weekStart } = currentWeeklyPlanContext();
  const scope = await loadStudentScopeForWeek(supabase, profile.id, weekStart).catch(() => null);
  const placement = scope
    ? {
        cohortName: scope.cohortName,
        groupName: scope.groupName,
        masjidName: scope.masjidName
      }
    : null;

  return (
    <StudentShellFrame name={profile.name} placement={placement} signOutAction={signOut}>
      {children}
    </StudentShellFrame>
  );
}
