"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { resetStudentBelow70Streak, type Below70StreakResetActionResult } from "@/app/admin/actions";
import type { Below70StreakReadRow } from "@/lib/below70-streak";
import {
  BELOW70_RESET_NOTE_MAX_LENGTH
} from "@/lib/below70-streak";
import {
  below70ResetErrorMessage,
  below70ResetSuccessMessage,
  below70StreakAdminStatus,
  createBelow70ResetAttempt,
  validateBelow70ResetForm
} from "@/lib/below70-streak-admin-ui";
import { formatDateTimeInAppTimeZone, formatWeekRange } from "@/lib/dates";

type Notice = { tone: "success" | "error"; message: string } | null;

function activeStreakClass(streakLength: number) {
  return streakLength >= 3 ? "text-red-900" : streakLength > 0 ? "text-amber-900" : "text-ink";
}

export default function Below70StreakReset({
  initialStreak,
  initialLoadError,
  studentId,
  workspace = false
}: {
  initialStreak: Below70StreakReadRow | null;
  initialLoadError: boolean;
  studentId: string;
  workspace?: boolean;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const attemptRef = useRef<ReturnType<typeof createBelow70ResetAttempt> | null>(null);
  const [streak, setStreak] = useState(initialStreak);
  const [open, setOpen] = useState(false);
  const [passedTest, setPassedTest] = useState(false);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();

  const close = useCallback((newAction = false) => {
    if (isPending) return;
    setOpen(false);
    setPassedTest(false);
    setNote("");
    setFormError(null);
    if (newAction) attemptRef.current?.resetForNewAction();
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, [isPending]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"
    );
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [close, open]);

  function openDialog() {
    attemptRef.current?.resetForNewAction();
    setPassedTest(false);
    setNote("");
    setFormError(null);
    setOpen(true);
  }

  function applyResult(result: Below70StreakResetActionResult) {
    if (!result.ok) {
      if (result.streak) setStreak(result.streak);
      setFormError(below70ResetErrorMessage(result.status));
      return;
    }

    setStreak(result.streak);
    setNotice({ tone: "success", message: below70ResetSuccessMessage(result.status) });
    attemptRef.current?.complete();
    setOpen(false);
    setPassedTest(false);
    setNote("");
    setFormError(null);
    router.refresh();
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function submit() {
    const validation = validateBelow70ResetForm({ passedTest, note });
    if (!validation.valid) {
      setFormError(validation.message);
      return;
    }

    attemptRef.current ??= createBelow70ResetAttempt(() => crypto.randomUUID());
    const requestId = attemptRef.current.requestIdForSubmission();
    setFormError(null);
    startTransition(async () => {
      try {
        applyResult(await resetStudentBelow70Streak({
          requestId,
          studentId,
          passedTest: true,
          note: validation.note
        }));
      } catch {
        setFormError(below70ResetErrorMessage("error"));
      }
    });
  }

  if (initialLoadError && !streak) {
    return (
      <section className={workspace ? "border-b border-amber-200 bg-amber-50 py-6 md:mt-4 md:rounded-lg md:border md:p-6" : "mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm"} aria-live="polite">
        <h2 className="text-lg font-semibold text-ink">Below-70% streak</h2>
        <p className="mt-1 text-sm text-amber-900">The current streak status is unavailable right now. Refresh the page to try again.</p>
      </section>
    );
  }

  if (!streak) return null;

  const status = below70StreakAdminStatus(streak.active_streak_length);
  const latestReset = streak.latest_reset_created_at && streak.latest_reset_previous_streak_length
    ? streak
    : null;

  return (
    <section className={workspace ? "border-b border-stone-200 py-6 md:mt-4 md:min-h-[360px] md:rounded-lg md:border md:bg-white md:p-6" : "mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm"}>
      <div className={workspace ? "flex flex-col gap-4" : "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"}>
        <div>
          <h2 className="text-lg font-semibold text-ink">Below-70% streak</h2>
          <p className="mt-1 text-sm text-stone-600">Consecutive completed tracker weeks below 70%.</p>
          <p className={`mt-3 text-4xl font-semibold ${activeStreakClass(streak.active_streak_length)}`}>
            {streak.active_streak_length}
          </p>
          <p className="mt-1 text-sm text-stone-600">
            Active through {formatWeekRange(streak.streak_through_week_start)}
          </p>
        </div>
      </div>
      <p className="mt-4 rounded-md bg-stone-50 px-4 py-3 text-sm text-stone-700">{status.description}</p>
      {status.canReset ? (
        <button
          className={`mt-4 min-h-11 rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${workspace ? "w-full md:w-auto" : "w-full sm:w-auto"}`}
          onClick={openDialog}
          ref={triggerRef}
          type="button"
        >
          Reset streak
        </button>
      ) : null}
      {latestReset ? (
        <div className="mt-4 rounded-md border border-stone-200 px-4 py-3 text-sm text-stone-700">
          <p className="font-medium text-ink">Latest reset</p>
          <p className="mt-1">
            Reset a {latestReset.latest_reset_previous_streak_length}-week streak on {formatDateTimeInAppTimeZone(latestReset.latest_reset_created_at)} by an administrator.
          </p>
          {latestReset.latest_reset_admin_note ? <p className="mt-1 break-words">Note: {latestReset.latest_reset_admin_note}</p> : null}
        </div>
      ) : null}
      {notice ? (
        <p aria-live="polite" className={`mt-4 rounded-md px-4 py-3 text-sm ${notice.tone === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      ) : null}

      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <button
            aria-label="Close streak reset confirmation"
            className="absolute inset-0 cursor-default bg-black/45"
            disabled={isPending}
            onClick={() => close(true)}
            type="button"
          />
          <section
            aria-describedby="below70-reset-description"
            aria-labelledby="below70-reset-title"
            aria-modal="true"
            className="relative max-h-[calc(100dvh-0.5rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl sm:p-6"
            ref={dialogRef}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gold">Confirmation required</p>
                <h3 className="mt-1 text-xl font-semibold text-ink" id="below70-reset-title">Reset below-70% streak</h3>
              </div>
              <button
                aria-label="Close"
                className="min-h-11 shrink-0 rounded-md border border-stone-300 px-3 text-sm font-medium text-ink hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
                disabled={isPending}
                onClick={() => close(true)}
                type="button"
              >
                Close
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-stone-700" id="below70-reset-description">
              This resets the current {streak.active_streak_length}-week below-70% streak. Historical grades remain unchanged.
            </p>
            <label className="mt-5 flex min-h-11 items-start gap-3 rounded-md border border-stone-200 p-3 text-sm text-ink">
              <input
                checked={passedTest}
                className="mt-0.5 size-5 shrink-0 accent-moss"
                disabled={isPending}
                onChange={(event) => setPassedTest(event.target.checked)}
                type="checkbox"
              />
              <span>I confirm that the student passed the required test.</span>
            </label>
            <label className="mt-5 block">
              <span className="text-sm font-medium text-ink">Admin note <span className="font-normal text-stone-600">(optional)</span></span>
              <textarea
                aria-describedby="below70-note-count"
                className="mt-2 min-h-28 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
                disabled={isPending}
                maxLength={BELOW70_RESET_NOTE_MAX_LENGTH}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Brief context for this reset"
                value={note}
              />
              <p className="mt-1 text-right text-xs text-stone-600" id="below70-note-count">{note.length} / {BELOW70_RESET_NOTE_MAX_LENGTH}</p>
            </label>
            {formError ? <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{formError}</p> : null}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="min-h-11 w-full rounded-md border border-stone-300 px-4 py-2.5 text-sm font-medium text-ink hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss sm:w-auto"
                disabled={isPending}
                onClick={() => close(true)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 w-full rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-wait disabled:bg-stone-400 sm:w-auto"
                disabled={isPending}
                onClick={submit}
                type="button"
              >
                {isPending ? "Resetting…" : "Confirm reset"}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}
    </section>
  );
}
