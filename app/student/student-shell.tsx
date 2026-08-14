"use client";

import {
  BookOpen,
  CalendarBlank,
  CaretDown,
  CaretRight,
  ChartLineUp,
  SignOut,
  User,
  X
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

export type StudentShellPlacement = {
  cohortName: string;
  groupName: string;
  masjidName: string;
};

type StudentShellScopeContextValue = {
  initialScopeAvailable: boolean;
  scopeAvailable: boolean;
  setScopeAvailable: (available: boolean) => void;
};

const StudentShellScopeContext = createContext<StudentShellScopeContextValue | null>(null);

const primaryLinks = [
  { href: "/student/check-in", label: "Today", icon: CalendarBlank },
  { href: "/student/partner-recitation", label: "My Progress", icon: ChartLineUp },
  { href: "/student/weekly-plan", label: "Weekly Plan", icon: BookOpen },
  { href: "/account/change-password", label: "Account", icon: User }
] as const;

const progressRoutes = [
  "/student/partner-recitation",
  "/student/grades",
  "/student/history",
  "/student/leaderboard",
  "/student/rewards"
];

function initialsForName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "S";
  return `${words[0]?.[0] ?? ""}${words.length > 1 ? words[words.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

function isActiveRoute(pathname: string, href: string) {
  if (href === "/student/partner-recitation") {
    return progressRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function Placement({ placement, light = false }: { placement: StudentShellPlacement | null; light?: boolean }) {
  if (!placement) return <p className={`mt-1 text-xs ${light ? "text-stone-500" : "text-stone-300"}`}>Assignment pending</p>;

  return (
    <p className={`mt-1 truncate text-xs ${light ? "text-stone-600" : "text-stone-200"}`}>
      {placement.cohortName} · {placement.groupName}
    </p>
  );
}

function VerseCard() {
  return (
    <aside className="rounded-lg border border-gold/80 bg-forest/55 px-4 py-5 text-center text-white" aria-label="Quran verse">
      <p className="text-xs font-semibold text-gold-on-dark">Surah Aal-Imran 3:8</p>
      <p className="mt-4 text-lg leading-9" dir="rtl" lang="ar">
        رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِن لَّدُنكَ رَحْمَةً ۚ إِنَّكَ أَنتَ الْوَهَّابُ
      </p>
      <p className="mt-4 text-xs leading-5 text-stone-100">
        Our Lord, do not let our hearts deviate after You have guided us, and grant us mercy from Yourself. Indeed,
        You are the Ever-Giving.
      </p>
    </aside>
  );
}

function StudentPrimaryLink({
  disabled,
  href,
  label,
  mobile = false,
  pathname,
  Icon
}: {
  disabled: boolean;
  href: string;
  label: string;
  mobile?: boolean;
  pathname: string;
  Icon: typeof CalendarBlank;
}) {
  const active = isActiveRoute(pathname, href);
  const unavailable = disabled && href !== "/account/change-password";

  if (mobile) {
    const content = (
      <>
        <Icon aria-hidden size={24} weight={active ? "fill" : "regular"} />
        <span className="mt-1 text-[0.7rem] font-medium leading-none">{label}</span>
      </>
    );
    const className = `student-primary-scope-link flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center px-1 py-2 ${
      active ? "text-forest" : "text-stone-500"
    } ${unavailable ? "cursor-not-allowed opacity-35" : ""}`;

    return unavailable ? (
      <span aria-disabled="true" className={className} title="Available after your halaqa assignment is complete">
        {content}
      </span>
    ) : (
      <Link aria-current={active ? "page" : undefined} className={className} href={href}>
        {content}
      </Link>
    );
  }

  const content = (
    <>
      <Icon aria-hidden className="shrink-0" size={23} weight="regular" />
      <span>{label}</span>
    </>
  );
  const className = `student-primary-scope-link focus-on-forest relative flex min-h-12 items-center gap-4 rounded-md border-l-4 px-4 py-2.5 text-sm font-medium transition ${
    active ? "border-gold bg-white/10 text-white" : "border-transparent text-stone-100 hover:bg-white/5 hover:text-white"
  } ${unavailable ? "cursor-not-allowed opacity-35" : ""}`;

  return unavailable ? (
    <span aria-disabled="true" className={className} title="Available after your halaqa assignment is complete">
      {content}
    </span>
  ) : (
    <Link aria-current={active ? "page" : undefined} className={className} href={href}>
      {content}
    </Link>
  );
}

function AccountSheet({
  initials,
  name,
  placement,
  signOutAction
}: {
  initials: string;
  name: string;
  placement: StudentShellPlacement | null;
  signOutAction: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function openSheet() {
    dialogRef.current?.showModal();
  }

  function closeSheet() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        aria-label={`Open account menu for ${name}`}
        aria-haspopup="dialog"
        className="focus-on-forest inline-flex min-h-11 items-center gap-2 rounded-full px-1.5 text-white"
        onClick={openSheet}
        ref={triggerRef}
        type="button"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-white/10 font-semibold text-gold-on-dark">
          {initials}
        </span>
        <CaretDown aria-hidden size={18} />
      </button>

      <dialog
        aria-labelledby="student-account-sheet-title"
        className="student-account-sheet m-0 max-h-[calc(100dvh-5rem)] w-full max-w-none overflow-y-auto bg-white p-0 text-ink backdrop:bg-ink/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeSheet();
        }}
        onClose={() => triggerRef.current?.focus()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeSheet();
          }
        }}
        ref={dialogRef}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-400" aria-hidden />
        <div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
          <div className="flex items-center gap-4 border-b border-stone-200 pb-6">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-forest text-xl font-semibold text-gold-on-dark">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-semibold" id="student-account-sheet-title">{name}</h2>
              <Placement light placement={placement} />
            </div>
            <button
              aria-label="Close account menu"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-stone-100 hover:bg-stone-200"
              onClick={closeSheet}
              type="button"
            >
              <X aria-hidden size={25} />
            </button>
          </div>

          <Link
            className="flex min-h-[5rem] items-center gap-4 border-b border-stone-200 py-4 text-left hover:text-moss"
            href="/account/change-password"
            onClick={closeSheet}
          >
            <User aria-hidden className="shrink-0" size={28} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Account &amp; security</span>
              <span className="mt-1 block text-sm text-stone-500">Change your password</span>
            </span>
            <CaretRight aria-hidden className="shrink-0" size={22} />
          </Link>

          <form action={signOutAction}>
            <button className="flex min-h-[4.5rem] w-full items-center gap-4 py-4 text-left font-medium hover:text-moss">
              <SignOut aria-hidden size={28} />
              Sign out
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}

function StudentShellNavigation({
  name,
  placement,
  scopeAvailable,
  signOutAction
}: {
  name: string;
  placement: StudentShellPlacement | null;
  scopeAvailable: boolean;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const initials = useMemo(() => initialsForName(name), [name]);

  return (
    <div className="student-shell-root">
      <a
        className="sr-only z-[70] rounded-md bg-white px-4 py-3 font-medium text-ink shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main-content"
      >
        Skip to main content
      </a>

      <aside className="student-sidebar hidden h-[100dvh] flex-col bg-ink px-7 py-8 text-white lg:flex">
        <p className="text-2xl font-semibold uppercase tracking-[0.12em] text-gold-on-dark">ITQAN</p>
        <div className="mt-8 flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 font-semibold text-gold-on-dark">
            {initials}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="truncate text-sm font-semibold text-white">{name}</p>
            <p className="mt-0.5 text-xs text-stone-200">Student</p>
            <Placement placement={placement} />
          </div>
        </div>

        <nav aria-label="Student navigation" className="mt-9 space-y-2">
          {primaryLinks.map((link) => (
            <StudentPrimaryLink
              disabled={!scopeAvailable}
              href={link.href}
              Icon={link.icon}
              key={link.href}
              label={link.label}
              pathname={pathname}
            />
          ))}
        </nav>

        <div className="mt-auto pt-8">
          <VerseCard />
          <form action={signOutAction} className="mt-3">
            <button className="focus-on-forest flex min-h-11 w-full items-center justify-center gap-2 rounded-md text-xs font-medium text-stone-300 hover:bg-white/5 hover:text-white">
              <SignOut aria-hidden size={18} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <header className="student-mobile-header sticky top-0 z-40 flex min-h-16 items-center justify-between bg-ink px-4 text-white lg:hidden">
        <p className="text-xl font-semibold uppercase tracking-[0.12em] text-gold-on-dark">ITQAN</p>
        <AccountSheet initials={initials} name={name} placement={placement} signOutAction={signOutAction} />
      </header>

      <nav
        aria-label="Student navigation"
        className="student-bottom-nav fixed inset-x-0 bottom-0 z-50 flex border-t border-stone-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(23,33,29,0.06)] backdrop-blur lg:hidden"
      >
        {primaryLinks.slice(0, 3).map((link) => (
          <StudentPrimaryLink
            disabled={!scopeAvailable}
            href={link.href}
            Icon={link.icon}
            key={link.href}
            label={link.label}
            mobile
            pathname={pathname}
          />
        ))}
      </nav>
    </div>
  );
}

export function StudentShellFrame({
  children,
  name,
  placement,
  signOutAction
}: {
  children: ReactNode;
  name: string;
  placement: StudentShellPlacement | null;
  signOutAction: () => Promise<void>;
}) {
  const initialScopeAvailable = placement !== null;
  const [scopeAvailable, setScopeAvailable] = useState(initialScopeAvailable);

  return (
    <StudentShellScopeContext.Provider value={{ initialScopeAvailable, scopeAvailable, setScopeAvailable }}>
      <StudentShellNavigation
        name={name}
        placement={placement}
        scopeAvailable={scopeAvailable}
        signOutAction={signOutAction}
      />
      {children}
    </StudentShellScopeContext.Provider>
  );
}

export function StandaloneStudentShell({
  name,
  placement,
  signOutAction
}: {
  name: string;
  placement: StudentShellPlacement | null;
  signOutAction: () => Promise<void>;
}) {
  return (
    <StudentShellNavigation
      name={name}
      placement={placement}
      scopeAvailable={placement !== null}
      signOutAction={signOutAction}
    />
  );
}

export function StudentAssignmentPendingMarker() {
  const context = useContext(StudentShellScopeContext);
  const initialScopeAvailable = context?.initialScopeAvailable;
  const setScopeAvailable = context?.setScopeAvailable;

  useEffect(() => {
    if (!setScopeAvailable) return;
    setScopeAvailable(false);
    return () => setScopeAvailable(initialScopeAvailable ?? false);
  }, [initialScopeAvailable, setScopeAvailable]);

  return <span className="sr-only" data-student-assignment-pending>Student assignment pending</span>;
}
