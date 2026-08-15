"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CalendarCheck,
  CaretDown,
  ChartLineUp,
  SignOut,
  User,
  X
} from "@phosphor-icons/react";
import { signOut } from "@/app/actions";

type ShellIdentity = {
  name: string;
  placement: string | null;
  assignmentPending: boolean;
};

const primaryLinks = [
  { href: "/student/check-in", label: "Today", Icon: CalendarCheck },
  { href: "/student/partner-recitation", label: "My Progress", Icon: ChartLineUp },
  { href: "/student/weekly-plan", label: "Weekly Plan", Icon: BookOpen }
];

const progressPaths = new Set([
  "/student/partner-recitation",
  "/student/grades",
  "/student/history",
  "/student/leaderboard",
  "/student/rewards"
]);

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "IT";
}

function VerseCard() {
  return (
    <section className="student-shell-verse" aria-labelledby="student-shell-verse-title">
      <h2 id="student-shell-verse-title">Surah Aal-Imran 3:8</h2>
      <p className="student-shell-verse-arabic" dir="rtl" lang="ar">
        رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِن لَّدُنكَ رَحْمَةً ۚ إِنَّكَ أَنتَ الْوَهَّابُ
      </p>
      <p>Our Lord, do not let our hearts deviate after You have guided us, and grant us mercy from Yourself. Indeed, You are the Ever-Giving.</p>
    </section>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/student/partner-recitation" ? progressPaths.has(pathname) : pathname === href;
}

export default function StudentShell({ identity }: { identity: ShellIdentity }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const studentInitials = initials(identity.name);

  useEffect(() => {
    if (!sheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSheetOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const sheet = document.getElementById("student-account-sheet");
      const focusable = sheet?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [sheetOpen]);

  return (
    <>
      <a className="student-skip-link" href="#main-content">Skip to main content</a>

      <aside className="student-sidebar" aria-label="Student navigation">
        <Link className="student-wordmark focus-on-forest" href="/student/check-in">ITQAN</Link>
        <div className="student-sidebar-identity">
          <span className="student-avatar" aria-hidden="true">{studentInitials}</span>
          <div className="min-w-0">
            <p>{identity.name}</p>
            <p>{identity.placement ?? "Assignment pending"}</p>
          </div>
        </div>
        <nav aria-label="Primary">
          {primaryLinks.map(({ href, label, Icon }) => {
            const disabled = identity.assignmentPending;
            return disabled ? (
              <span className="student-sidebar-link is-disabled" aria-disabled="true" key={href}>
                <Icon aria-hidden="true" size={22} />{label}
              </span>
            ) : (
              <Link className={`student-sidebar-link ${isActive(pathname, href) ? "is-active" : ""}`} href={href} aria-current={isActive(pathname, href) ? "page" : undefined} key={href}>
                <Icon aria-hidden="true" size={22} />{label}
              </Link>
            );
          })}
          <Link className={`student-sidebar-link ${pathname === "/account/change-password" ? "is-active" : ""}`} href="/account/change-password" aria-current={pathname === "/account/change-password" ? "page" : undefined}>
            <User aria-hidden="true" size={22} />Account
          </Link>
        </nav>
        <VerseCard />
      </aside>

      <header className="student-mobile-header">
        <Link className="student-wordmark focus-on-forest" href="/student/check-in">ITQAN</Link>
        <button ref={triggerRef} className="student-account-trigger focus-on-forest" type="button" aria-expanded={sheetOpen} aria-haspopup="dialog" aria-label="Open account menu" onClick={() => setSheetOpen(true)}>
          <span aria-hidden="true">{studentInitials}</span><CaretDown aria-hidden="true" size={16} />
        </button>
      </header>

      <nav className="student-bottom-nav" aria-label="Student navigation">
        {primaryLinks.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          const disabled = identity.assignmentPending;
          return disabled ? (
            <span className="student-bottom-link is-disabled" aria-disabled="true" key={href}>
              <Icon aria-hidden="true" size={23} /><span>{label}</span>
            </span>
          ) : (
            <Link className={`student-bottom-link ${active ? "is-active" : ""}`} href={href} aria-current={active ? "page" : undefined} key={href}>
              <Icon aria-hidden="true" size={23} /><span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {sheetOpen ? (
        <div className="student-sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSheetOpen(false)}>
          <section id="student-account-sheet" className="student-account-sheet" role="dialog" aria-modal="true" aria-labelledby="student-account-sheet-title">
            <span className="student-sheet-handle" aria-hidden="true" />
            <div className="student-sheet-heading">
              <span className="student-avatar student-avatar-large" aria-hidden="true">{studentInitials}</span>
              <div className="min-w-0">
                <h2 id="student-account-sheet-title">{identity.name}</h2>
                <p>{identity.placement ?? "Assignment pending"}</p>
              </div>
              <button ref={closeRef} className="student-sheet-close" type="button" aria-label="Close account menu" onClick={() => setSheetOpen(false)}><X aria-hidden="true" size={28} /></button>
            </div>
            <Link className="student-sheet-action" href="/account/change-password" onClick={() => setSheetOpen(false)}>
              <User aria-hidden="true" size={30} />
              <span><strong>Account &amp; security</strong><small>Change your password</small></span>
            </Link>
            <form action={signOut} className="student-sheet-signout">
              <button className="student-sheet-action" type="submit"><SignOut aria-hidden="true" size={30} /><strong>Sign out</strong></button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
