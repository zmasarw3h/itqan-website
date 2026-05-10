import AppNav from "@/app/nav";
import ChangePasswordForm from "@/app/account/change-password/change-password-form";
import { requireProfile } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const { profile } = await requireProfile();

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-ink">Change Password</h1>
            <p className="mt-1 text-stone-600">Update the password for your current account.</p>
          </div>
          <ChangePasswordForm />
        </section>
      </main>
    </>
  );
}
