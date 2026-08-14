import { handleStudentWeeklyPlanRoute } from "@/lib/student-weekly-plan-route";

export const dynamic = "force-dynamic";

export async function GET(request: Parameters<typeof handleStudentWeeklyPlanRoute>[0]) {
  return handleStudentWeeklyPlanRoute(request, "inline");
}
