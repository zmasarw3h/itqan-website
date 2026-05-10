import Link from "next/link";
import { signOut } from "@/app/actions";
import type { Role } from "@/lib/types";

export default function AppNav({ role, name }: { role: Role; name: string }) {
  const links =
    role === "admin"
      ? [
          { href: "/admin", label: "Admin" },
          { href: "/account/change-password", label: "Password" }
        ]
      : [
          { href: "/student/check-in", label: "Check-In" },
          { href: "/student/history", label: "History" },
          { href: "/account/change-password", label: "Password" }
        ];

  return (
    <header className="border-b border-stone-200 bg-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-gold">ITQAN</p>
          <p className="text-sm text-stone-600">{name}</p>
        </div>
        <div className="flex items-center gap-2">
          {links.map((link) => (
            <Link
              className="rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-stone-100"
              href={link.href}
              key={link.href}
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
      </nav>
    </header>
  );
}
