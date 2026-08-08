"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Check, LockKey, WarningCircle } from "@phosphor-icons/react";
import { loadTeacherChecklistDetails, type TeacherChecklistLoadResult } from "@/app/teacher/actions";
import { addDays, friendlyDate, weekDatesFromStart } from "@/lib/dates";
import { teacherChecklistItemStatus } from "@/lib/teacher-session";

type ChecklistDrawerProps = {
  studentId: string;
  studentName: string;
  groupId: string;
  versionId: string;
  weekStart: string;
  currentDate: string;
};

function initialChecklistDate(weekStart: string, currentDate: string) {
  const weekEnd = addDays(weekStart, 6);
  if (currentDate >= weekStart && currentDate <= weekEnd) return currentDate;
  return currentDate < weekStart ? weekStart : weekEnd;
}

export default function ChecklistDrawer(props: ChecklistDrawerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => initialChecklistDate(props.weekStart, props.currentDate));
  const [result, setResult] = useState<TeacherChecklistLoadResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const requestDetails = useCallback((checklistDate: string) => {
    setResult(null);
    startTransition(async () => {
      setResult(await loadTeacherChecklistDetails({
        studentId: props.studentId,
        groupId: props.groupId,
        versionId: props.versionId,
        weekStart: props.weekStart,
        checklistDate
      }));
    });
  }, [props.groupId, props.studentId, props.versionId, props.weekStart]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])"
    );
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), select:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])"
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

  const details = result?.ok ? result.details : null;
  const dailyTotals = details?.stored_daily_totals;
  const earned = dailyTotals?.earned_weight ?? 0;
  const total = dailyTotals?.total_weight ?? 100;
  const score = dailyTotals?.daily_score ?? 0;

  return (
    <>
      <button
        className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50"
        onClick={() => {
          setOpen(true);
          requestDetails(selectedDate);
        }}
        ref={triggerRef}
        type="button"
      >
        Checklist
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[88px] z-40">
          <button aria-label="Close checklist details" className="absolute inset-0 cursor-default bg-black/45" onClick={close} type="button" />
          <section
            aria-labelledby={`checklist-title-${props.studentId}`}
            aria-modal="true"
            className="absolute inset-x-0 bottom-0 max-h-[92%] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:left-auto sm:top-0 sm:h-full sm:max-h-none sm:w-[560px] sm:rounded-none sm:p-6"
            ref={dialogRef}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gold">Read-only checklist</p>
                <h2 className="mt-1 text-2xl font-bold text-ink" id={`checklist-title-${props.studentId}`}>{props.studentName}</h2>
                <p className="mt-1 text-sm text-stone-600">Saved checklist items and scores only.<br />Private notes are never shown.</p>
              </div>
              <button className="min-h-11 rounded-md border border-moss px-4 text-sm font-semibold text-ink hover:bg-stone-50" onClick={close} type="button">Close</button>
            </div>

            <label className="mt-8 block text-sm font-medium text-ink">
              Checklist date
              <select
                className="mt-2 min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  requestDetails(event.target.value);
                }}
                value={selectedDate}
              >
                {weekDatesFromStart(props.weekStart).map((date) => (
                  <option key={date} value={date}>{friendlyDate(date)}{date === props.currentDate ? " · Today" : ""}</option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-sm text-stone-600">{friendlyDate(props.weekStart)} – {friendlyDate(addDays(props.weekStart, 6))}</p>

            {isPending ? (
              <div aria-live="polite" className="mt-6 space-y-3" role="status">
                <div className="h-28 animate-pulse rounded-lg bg-stone-200" />
                <div className="h-64 animate-pulse rounded-lg bg-stone-100" />
                <span className="sr-only">Loading checklist details</span>
              </div>
            ) : result && !result.ok ? (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                <p className="flex items-start gap-2"><WarningCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />{result.message}</p>
                {result.status === "error" ? <button className="mt-4 min-h-11 rounded-md bg-moss px-4 font-semibold text-white" onClick={() => requestDetails(selectedDate)} type="button">Try again</button> : null}
              </div>
            ) : details ? (
              <>
                <div className="mt-6 rounded-lg bg-moss p-5 text-white">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#dfb653]">Daily total</p>
                  <p className="mt-2 text-2xl font-bold">{earned} / {total} points · {score}%</p>
                  <p className="mt-1 text-sm capitalize">{details.record_state.replace("_", " ")}</p>
                </div>
                {details.items.length ? (
                  <ul className="mt-5 overflow-hidden rounded-lg border border-stone-200">
                    {details.items.map((item, index) => {
                      const label = teacherChecklistItemStatus({ completed: item.completed, checklistDate: details.checklist_date, currentDate: props.currentDate });
                      return (
                        <li className="flex items-center gap-4 border-b border-stone-200 px-4 py-4 last:border-b-0" key={`${item.saved_item_label}-${index}`}>
                          <span className={`grid size-7 shrink-0 place-items-center rounded-full ${item.completed ? "bg-moss text-white" : "bg-[#c99525] text-white"}`}>
                            {item.completed ? <Check aria-hidden="true" className="size-4" weight="bold" /> : null}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-ink">{item.saved_item_label}</p>
                            <p className="mt-1 text-sm text-stone-600">{label}</p>
                          </div>
                          <p className="shrink-0 text-sm text-stone-600">{item.earned_points} / {item.weight} points</p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-5 rounded-lg border border-stone-200 px-5 py-10 text-center">
                    <p className="font-semibold text-ink">No saved checklist record</p>
                    <p className="mt-1 text-sm text-stone-600">This student has no stored checklist items for {friendlyDate(details.checklist_date)}.</p>
                  </div>
                )}
                <p className="mt-8 flex items-start gap-3 text-sm text-stone-600"><LockKey aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-gold" />Saved items and scores only. Private notes are never shown.</p>
              </>
            ) : null}
          </section>
        </div>, document.body
      ) : null}
    </>
  );
}
