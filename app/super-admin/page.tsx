import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  await requireSuperAdmin();
  redirect("/super-admin/people");
}
