"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const studentProgressLinks = [
  { href: "/student/partner-recitation", label: "Partner Recitation" },
  { href: "/student/grades", label: "Grades" },
  { href: "/student/history", label: "Check-In History" },
  { href: "/student/leaderboard", label: "Leaderboard" },
  { href: "/student/rewards", label: "Badge Awards" }
] as const;

function routeWithQuery(href: string, query: string) {
  return query ? `${href}?${query}` : href;
}

export function isStudentProgressRoute(pathname: string) {
  return studentProgressLinks.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
}

export default function StudentProgressNav() {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams().toString();
  const activeHref = studentProgressLinks.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href
    ?? studentProgressLinks[0].href;

  if (!isStudentProgressRoute(pathname)) return null;

  return (
    <section aria-label="My Progress navigation" className="mb-7">
      <p className="mb-3 text-lg font-medium text-ink">My Progress</p>
      <nav aria-label="Progress views" className="hidden border-b border-stone-300 md:flex">
        {studentProgressLinks.map((link) => {
          const active = link.href === activeHref;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition ${
                active ? "border-gold text-forest" : "border-transparent text-stone-700 hover:border-stone-400 hover:text-ink"
              }`}
              href={routeWithQuery(link.href, query)}
              key={link.href}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <label className="block md:hidden">
        <span className="mb-1.5 block text-sm font-medium text-ink">Progress view</span>
        <select
          aria-label="Progress view"
          className="min-h-12 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base text-ink"
          onChange={(event) => router.push(routeWithQuery(event.target.value, query))}
          value={activeHref}
        >
          {studentProgressLinks.map((link) => (
            <option key={link.href} value={link.href}>{link.label}</option>
          ))}
        </select>
      </label>
    </section>
  );
}
