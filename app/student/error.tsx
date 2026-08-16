"use client";

import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { StudentPage } from "@/app/student/student-ui";

export default function StudentRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const hasLogged = useRef(false);

  useEffect(() => {
    if (hasLogged.current) return;
    hasLogged.current = true;
    console.error({ route: "/student/*", ...(error.digest ? { digest: error.digest } : {}) });
  }, [error.digest]);

  return (
    <StudentPage width="narrow">
      <section className="student-route-error" role="alert">
        <WarningCircle aria-hidden="true" size={52} />
        <h1>We couldn’t load this page</h1>
        <p>Your account is still signed in. Try loading this page again.</p>
        <button type="button" onClick={reset}>Try again</button>
        <Link href="/student/check-in">Go to Today</Link>
      </section>
    </StudentPage>
  );
}
