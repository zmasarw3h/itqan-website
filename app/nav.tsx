import { signOut } from "@/app/actions";
import NavLinks from "@/app/nav-links";
import Link from "next/link";
import { navigationLinksForRole } from "@/lib/access";
import { loadActiveTeacherCapability } from "@/lib/teacher-scope";
import { getCurrentProfile } from "@/lib/supabase-server";
import type { Role } from "@/lib/types";

export default async function AppNav({
  role,
  name,
  variant = "default",
  activeHref
}: {
  role: Role;
  name: string;
  variant?: "default" | "rotation" | "teacher" | "workspace";
  activeHref?: string;
}) {
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

  const isTeacher = variant === "teacher";
  const isWorkspace = variant === "workspace";
  const isDark = variant === "rotation" || isTeacher || isWorkspace;

  return (
    <header className={isDark ? "border-b border-moss bg-ink" : "border-b border-stone-200 bg-white"}>
      <nav className={isTeacher || isWorkspace
        ? "mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-3 px-4 py-2 sm:min-h-[88px] sm:px-8 sm:py-3"
        : "mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3"}
      >
        <div className="min-w-0">
          <p className={isTeacher || isWorkspace ? "text-base font-bold tracking-wide text-gold sm:text-lg" : "text-sm font-semibold text-gold"}>ITQAN</p>
          <p className={`mt-0.5 truncate text-sm ${isTeacher ? "hidden sm:block" : ""} ${isDark ? "text-stone-100" : "text-stone-600"}`}>{name}</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {links.map((link) => {
            const label = variant === "teacher" && link.href === "/teacher" ? "Dashboard" : link.label;
            return (
              <Link
                className={isDark
                  ? `border-b-2 text-sm font-medium ${isTeacher || isWorkspace ? "px-4 py-5" : "px-3 py-2"} ${
                    link.href === activeHref
                      ? "border-gold text-white"
                      : "border-transparent text-stone-100 hover:border-stone-500 hover:text-white"
                  }`
                  : "rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
                href={link.href}
                key={`${link.href}-${link.label}`}
                prefetch={link.prefetch}
              >
                {label}
              </Link>
            );
          })}
          <form action={signOut}>
            <button className={isDark
              ? `${isTeacher || isWorkspace ? "min-h-11 px-4 font-semibold" : "px-3 font-medium"} rounded-md border border-stone-500 py-2 text-sm text-white hover:bg-moss`
              : "rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
            >
              Sign out
            </button>
          </form>
        </div>
        <details className="relative md:hidden">
          <summary className={isDark
            ? "inline-flex min-h-11 list-none items-center rounded-md border border-stone-500 px-3 py-2 text-sm font-medium text-white hover:bg-moss"
            : "inline-flex min-h-11 list-none items-center rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
          >
            Menu
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
            {links.map((link) => (
              <Link
                className="flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"
                href={link.href}
                key={`${link.href}-${link.label}`}
                prefetch={link.prefetch}
              >
                {variant === "teacher" && link.href === "/teacher" ? "Dashboard" : link.label}
              </Link>
            ))}
            <form action={signOut} className="mt-1 border-t border-stone-200 pt-1">
              <button className="block min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-medium text-ink hover:bg-stone-100">
                Sign out
              </button>
            </form>
          </div>
        </details>
      </nav>
    </header>
  );
}
