import { NextResponse } from "next/server";
import { leaderboardRowsToCsv } from "@/lib/leaderboard";
import { getCurrentProfile } from "@/lib/supabase-server";
import { loadLeaderboardData } from "../data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { supabase, profile } = await getCurrentProfile();

  if (!profile || profile.role !== "admin") {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const data = await loadLeaderboardData(supabase, {
    week: url.searchParams.get("week") ?? undefined,
    below70: url.searchParams.get("below70") ?? undefined
  });
  const csv = leaderboardRowsToCsv(data.rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="itqan-leaderboard.csv"'
    }
  });
}
