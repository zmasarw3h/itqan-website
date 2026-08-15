"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

const views = [
  { href: "/student/partner-recitation", label: "Partner Recitation" },
  { href: "/student/grades", label: "Grades" },
  { href: "/student/history", label: "Check-In History" },
  { href: "/student/leaderboard", label: "Leaderboard" },
  { href: "/student/rewards", label: "Badge Awards" }
];

export const progressPaths = new Set(views.map((view) => view.href));

export default function ProgressNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  if (!progressPaths.has(pathname)) return null;

  return (
    <section className="student-progress-nav" aria-label="My Progress views">
      <h1>My Progress</h1>
      <nav className="student-progress-tabs" aria-label="Progress views">
        {views.map((view) => (
          <Link href={view.href} prefetch={false} aria-current={pathname === view.href ? "page" : undefined} className={pathname === view.href ? "is-active" : ""} key={view.href}>{view.label}</Link>
        ))}
      </nav>
      <label className="student-progress-select">
        <span>Progress view</span>
        <select value={pathname} onChange={(event) => router.push(event.target.value)}>
          {views.map((view) => <option key={view.href} value={view.href}>{view.label}</option>)}
        </select>
      </label>
    </section>
  );
}
