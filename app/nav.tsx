import { signOut } from "@/app/actions";
import NavLinks from "@/app/nav-links";
import { navigationLinksForRole } from "@/lib/access";
import { loadActiveTeacherCapability } from "@/lib/teacher-scope";
import { getCurrentProfile } from "@/lib/supabase-server";
import type { Role } from "@/lib/types";

export default async function AppNav({ role, name }: { role: Role; name: string }) {
  let hasTeacherCapability = role === "teacher";

  if (role === "admin") {
    const { supabase, profile } = await getCurrentProfile();
    hasTeacherCapability = profile ? await loadActiveTeacherCapability(supabase, profile) : false;
  }

  const links = navigationLinksForRole(role, hasTeacherCapability);

  if (role === "student") {
    return (
      <>
        <a
          className="sr-only z-50 rounded-md bg-white px-4 py-3 font-medium text-ink shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
          href="#main-content"
        >
          Skip to main content
        </a>
        <header className="border-b border-stone-200 bg-white">
          <div className="bg-forest text-white">
            <div className="mx-auto flex min-h-[4.5rem] max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div className="min-w-0">
                <p className="text-lg font-semibold uppercase tracking-[0.14em] text-gold-on-dark">ITQAN</p>
                <p className="truncate text-sm text-stone-200">{name}</p>
              </div>

              <form action={signOut} className="hidden lg:block">
                <button className="focus-on-forest min-h-11 rounded-md border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:border-white/60 hover:bg-white/10">
                  Sign out
                </button>
              </form>

              <details className="relative lg:hidden">
                <summary className="focus-on-forest flex min-h-11 cursor-pointer list-none items-center rounded-md border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:border-white/60 hover:bg-white/10">
                  Menu
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
                  <NavLinks links={links} mobile student />
                  <form action={signOut} className="mt-1 border-t border-stone-200 pt-1">
                    <button className="flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-ink transition hover:bg-stone-100">
                      Sign out
                    </button>
                  </form>
                </div>
              </details>
            </div>
          </div>

          <nav aria-label="Student navigation" className="hidden lg:block">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-1 px-4 py-2 sm:px-6 lg:px-8">
              <NavLinks links={links} student />
            </div>
          </nav>
        </header>
      </>
    );
  }

  return (
    <header className="border-b border-stone-200 bg-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gold">ITQAN</p>
          <p className="truncate text-sm text-stone-600">{name}</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <NavLinks links={links} />
          <form action={signOut}>
            <button className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100">
              Sign out
            </button>
          </form>
        </div>
        <details className="relative md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100">
            Menu
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
            <NavLinks links={links} mobile />
            <form action={signOut} className="mt-1 border-t border-stone-200 pt-1">
              <button className="flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-ink hover:bg-stone-100">
                Sign out
              </button>
            </form>
          </div>
        </details>
      </nav>
    </header>
  );
}
