"use client";

import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react";
import { StudentPage } from "@/app/student/student-ui";

export default function StudentRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
