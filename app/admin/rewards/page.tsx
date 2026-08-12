import { redirect } from "next/navigation";

export default async function LegacyAdminRewardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = new URLSearchParams({ tab: "badges" });
  if (typeof params.month === "string") next.set("month", params.month);
  redirect(`/admin/reports?${next.toString()}`);
}
