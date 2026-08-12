"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppNavigationLink } from "@/lib/access";

function activeNavigationHref(pathname: string, links: AppNavigationLink[]) {
  return links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((first, second) => second.href.length - first.href.length)[0]?.href;
}

export default function NavLinks({
  links,
  mobile = false,
  student = false
}: {
  links: AppNavigationLink[];
  mobile?: boolean;
  student?: boolean;
}) {
  const pathname = usePathname();
  const activeHref = activeNavigationHref(pathname, links);

  return (
    <>
      {links.map((link) => {
        const active = link.href === activeHref;
        const className = mobile
          ? `flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition ${
              active
                ? student
                  ? "bg-forest text-white"
                  : "bg-stone-100 text-ink"
                : "text-ink hover:bg-stone-100"
            }`
          : `inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition ${
              active
                ? student
                  ? "bg-forest text-white shadow-sm"
                  : "bg-stone-100 text-ink"
                : student
                  ? "text-stone-700 hover:bg-stone-100 hover:text-ink"
                  : "text-ink hover:bg-stone-100"
            }`;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={className}
            href={link.href}
            key={`${link.href}-${link.label}`}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
