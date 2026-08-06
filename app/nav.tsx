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
  variant?: "default" | "rotation";
  activeHref?: string;
}) {
  let hasTeacherCapability = role === "teacher";

  if (role === "admin") {
    const { supabase, profile } = await getCurrentProfile();
    hasTeacherCapability = profile ? await loadActiveTeacherCapability(supabase, profile) : false;
  }

  const links = navigationLinksForRole(role, hasTeacherCapability);

  const isRotation = variant === "rotation";

  return (
    <header className={isRotation ? "border-b border-moss bg-ink" : "border-b border-stone-200 bg-white"}>
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gold">ITQAN</p>
          <p className={`truncate text-sm ${isRotation ? "text-stone-200" : "text-stone-600"}`}>{name}</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {links.map((link) => (
            <Link
              className={isRotation
                ? `border-b-2 px-3 py-2 text-sm font-medium ${
                  link.href === activeHref
                    ? "border-gold text-white"
                    : "border-transparent text-stone-100 hover:border-stone-500 hover:text-white"
                }`
                : "rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
              href={link.href}
              key={`${link.href}-${link.label}`}
            >
              {link.label}
            </Link>
          ))}
          <form action={signOut}>
            <button className={isRotation
              ? "rounded-md border border-stone-500 px-3 py-2 text-sm font-medium text-white hover:bg-moss"
              : "rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"}
            >
              Sign out
            </button>
          </form>
        </div>
        <details className="relative md:hidden">
          <summary className={isRotation
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
                {link.label}
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
