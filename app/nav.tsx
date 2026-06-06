import Link from "next/link";
import { signOut } from "@/app/actions";
import type { Role } from "@/lib/types";

export default function AppNav({ role, name }: { role: Role; name: string }) {
  const links =
    role === "admin"
      ? [
          { href: "/admin", label: "Admin" },
          { href: "/admin/incentives", label: "Incentives" },
          { href: "/admin/rewards", label: "Rewards" },
          { href: "/admin/students/new", label: "Add Student" },
          { href: "/account/change-password", label: "Password" }
        ]
      : [
          { href: "/student/check-in", label: "Check-In" },
          { href: "/student/partner-recitation", label: "Partner Recitation" },
          { href: "/student/grades", label: "Grades" },
          { href: "/student/weekly-plan", label: "Weekly Plan" },
          { href: "/student/rewards", label: "Rewards" },
          { href: "/student/history", label: "History" },
          { href: "/account/change-password", label: "Password" }
        ];

  return (
    <header className="border-b border-stone-200 bg-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gold">ITQAN</p>
          <p className="truncate text-sm text-stone-600">{name}</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {links.map((link) => (
            <Link
              className="rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"
              href={link.href}
              key={`${link.href}-${link.label}`}
            >
              {link.label}
            </Link>
          ))}
          <form action={signOut}>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100">
              Sign out
            </button>
          </form>
        </div>
        <details className="relative md:hidden">
          <summary className="list-none rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100">
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
