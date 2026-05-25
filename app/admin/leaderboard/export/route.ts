import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();

  if (url.searchParams.get("week")) {
    params.set("week", String(url.searchParams.get("week")));
  }

  if (url.searchParams.get("below70")) {
    params.set("below70", String(url.searchParams.get("below70")));
  }

  redirect(params.size ? `/admin/export?${params.toString()}` : "/admin/export");
}
