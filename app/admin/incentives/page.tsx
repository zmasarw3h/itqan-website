import { redirect } from "next/navigation";

export default async function LegacyAdminIncentivesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = new URLSearchParams({ tab: "weekly" });
  if (typeof params.week === "string") next.set("week", params.week);
  if (typeof params.view === "string" && ["below70", "pending", "three-plus"].includes(params.view)) next.set("view", params.view);
  redirect(`/admin/reports?${next.toString()}`);
}
