import LoginForm from "@/app/login/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-gold">ITQAN</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Daily Check-In</h1>
          <p className="mt-2 text-sm text-stone-600">
            Sign in with your phone number and assigned password.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
