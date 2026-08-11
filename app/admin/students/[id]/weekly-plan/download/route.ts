import { handleAdminWeeklyPlanRoute } from "@/lib/admin-weekly-plan-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Parameters<typeof handleAdminWeeklyPlanRoute>[0],
  { params }: { params: Promise<{ id: string }> }
) {
  return handleAdminWeeklyPlanRoute(request, params, "attachment");
}
