import Link from "next/link";
import { signOut } from "@/app/actions";
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
  variant?: "default" | "rotation" | "teacher";
  activeHref?: string;
}) {
  let hasTeacherCapability = role === "teacher";

  if (role === "admin") {
    const { supabase, profile } = await getCurrentProfile();
    hasTeacherCapability = profile ? await loadActiveTeacherCapability(supabase, profile) : false;
  }

  const links = navigationLinksForRole(role, hasTeacherCapability);

  const isTeacher = variant === "teacher";
  const isDark = variant === "rotation" || variant === "teacher";

  return (
    <header className={isDark ? "border-b border-moss bg-ink" : "border-b border-stone-200 bg-white"}>
      <nav className={isTeacher
        ? "mx-auto flex min-h-[88px] max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-8"
        : "mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3"}
      >
        <div className="min-w-0">
          <p className={isTeacher ? "text-lg font-bold tracking-wide text-gold" : "text-sm font-semibold text-gold"}>ITQAN</p>
          <p className={`mt-0.5 truncate text-sm ${isDark ? "text-stone-100" : "text-stone-600"}`}>{name}</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {links.map((link) => {
            const label = variant === "teacher" && link.href === "/teacher" ? "Dashboard" : link.label;
            return (
              <Link
              className={isDark
                ? `border-b-2 text-sm font-medium ${isTeacher ? "px-4 py-5" : "px-3 py-2"} ${
                  link.href === activeHref
                    ? "border-gold text-white"
                    : "border-transparent text-stone-100 hover:border-stone-500 hover:text-white"
                }`
                : "rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
              href={link.href}
              key={`${link.href}-${link.label}`}
            >
              {label}
              </Link>
            );
          })}
          <form action={signOut}>
            <button className={isDark
              ? `${isTeacher ? "min-h-11 px-4 font-semibold" : "px-3 font-medium"} rounded-md border border-stone-500 py-2 text-sm text-white hover:bg-moss`
              : "rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
            >
              Sign out
            </button>
          </form>
        </div>
        <details className="relative md:hidden">
          <summary className={isDark
            ? "list-none rounded-md border border-stone-500 px-3 py-2 text-sm font-medium text-white hover:bg-moss"
            : "list-none rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
          >
            Menu
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
            {links.map((link) => (
              <Link
                className="block rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"
                href={link.href}
                key={`${link.href}-${link.label}`}
              >
                {variant === "teacher" && link.href === "/teacher" ? "Dashboard" : link.label}
              </Link>
            ))}
            <form action={signOut} className="mt-1 border-t border-stone-200 pt-1">
              <button className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-ink hover:bg-stone-100">
                Sign out
              </button>
            </form>
          </div>
        </details>
      </nav>
    </header>
  );
}
