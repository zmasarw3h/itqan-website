import { redirect } from "next/navigation";
import type { LeaderboardSearchParams } from "./data";

export const dynamic = "force-dynamic";

export default async function AdminLeaderboardPage({
  searchParams
}: {
  searchParams: Promise<LeaderboardSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();

  if (resolvedSearchParams.week) {
    params.set("week", resolvedSearchParams.week);
  }

  if (resolvedSearchParams.below70) {
    params.set("below70", resolvedSearchParams.below70);
  }

  redirect(params.size ? `/admin?${params.toString()}` : "/admin");
}
