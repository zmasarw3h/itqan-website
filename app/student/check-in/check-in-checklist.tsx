"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle, WarningCircle, WifiSlash } from "@phosphor-icons/react";
import { saveTodayCheckInNote, saveTodayChecklistItem } from "@/app/student/actions";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";
import { type CheckInTask } from "@/lib/scoring";

type ChecklistScore = { earnedWeight: number; totalWeight: number; dailyScore: number };
type RowState = { status: "saving" | "error"; intendedValue: boolean };

type Props = {
  tasks: CheckInTask[];
  initialCompletedTaskKeys: string[];
  initialEarnedWeight: number;
  initialTotalWeight: number;
  initialDailyScore: number;
  initialNote: string;
  initialNotice?: { tone: "success" | "error"; message: string } | null;
  initialSavedAt: string | null;
  initialWeeklyDailyPoints: number;
  partnerPoints: number;
  halaqaPoints: number;
  halaqaLabel: string;
  below70Streak: number;
};

function scoreForTasks(tasks: CheckInTask[], completedTaskKeys: Set<string>): ChecklistScore {
  const totalWeight = tasks.reduce((sum, task) => sum + task.weight, 0);
  const earnedWeight = tasks.reduce((sum, task) => sum + (completedTaskKeys.has(task.key) ? task.weight : 0), 0);
  return { earnedWeight, totalWeight, dailyScore: totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 10000) / 100 };
}

function ProgressBar({ label, value, maximum }: { label: string; value: number; maximum: number }) {
  const percentage = maximum ? Math.round((value / maximum) * 100) : 0;
  return (
    <div className="today-progress-row">
      <div><span>{label}</span><small>{value} / {maximum} pts ({percentage}%)</small></div>
      <div className="today-progress-track" aria-label={`${label}: ${percentage}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><i style={{ width: `${percentage}%` }} /></div>
    </div>
  );
}

function subscribeToConnectivity(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function connectivitySnapshot() { return navigator.onLine; }
function serverConnectivitySnapshot() { return true; }

export default function CheckInChecklist(props: Props) {
  const [completedTaskKeys, setCompletedTaskKeys] = useState(() => new Set(props.initialCompletedTaskKeys));
  const [, setPersistedTaskKeys] = useState(() => new Set(props.initialCompletedTaskKeys));
  const [score, setScore] = useState<ChecklistScore>({ earnedWeight: props.initialEarnedWeight, totalWeight: props.initialTotalWeight, dailyScore: props.initialDailyScore });
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [note, setNote] = useState(props.initialNote);
  const [savedAt, setSavedAt] = useState(props.initialSavedAt);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const online = useSyncExternalStore(subscribeToConnectivity, connectivitySnapshot, serverConnectivitySnapshot);
  const [reconnecting, setReconnecting] = useState(false);
  const latestRequest = useRef<Record<string, number>>({});
  const requestCounter = useRef(0);

  useEffect(() => {
    function goOnline() { setReconnecting(true); window.location.reload(); }
    window.addEventListener("online", goOnline);
    return () => { window.removeEventListener("online", goOnline); };
  }, []);

  const weeklyDailyPoints = props.initialWeeklyDailyPoints - props.initialDailyScore + score.dailyScore;
  const weeklyTotal = weeklyDailyPoints + props.partnerPoints + props.halaqaPoints;
  const weeklyPercentage = Math.round((weeklyTotal / 1000) * 100);
  const anySaving = Object.values(rowStates).some((row) => row.status === "saving");
  const statusText = useMemo(() => {
    if (anySaving) return "Saving…";
    if (Object.values(rowStates).some((row) => row.status === "error")) return "Some changes need attention";
    if (savedAt) return "Saved just now";
    return "Each change saves automatically.";
  }, [anySaving, rowStates, savedAt]);

  async function saveTask(taskKey: string, intendedValue: boolean) {
    if (!online || reconnecting) return;
    const requestId = ++requestCounter.current;
    latestRequest.current[taskKey] = requestId;
    setRowStates((current) => ({ ...current, [taskKey]: { status: "saving", intendedValue } }));
    let result: Awaited<ReturnType<typeof saveTodayChecklistItem>>;
    try {
      result = await saveTodayChecklistItem({ taskKey, completed: intendedValue });
    } catch {
      result = { ok: false, error: "Your checklist change could not be saved. Please try again." };
    }
    if (latestRequest.current[taskKey] !== requestId) return;

    if (!result.ok) {
      setPersistedTaskKeys((current) => {
        setCompletedTaskKeys((displayed) => {
          const rolledBack = new Set(displayed);
          if (current.has(taskKey)) rolledBack.add(taskKey); else rolledBack.delete(taskKey);
          return rolledBack;
        });
        setScore(scoreForTasks(props.tasks, current));
        return current;
      });
      setRowStates((current) => ({ ...current, [taskKey]: { status: "error", intendedValue } }));
      return;
    }

    setPersistedTaskKeys((current) => {
      const next = new Set(current);
      if (intendedValue) next.add(taskKey); else next.delete(taskKey);
      setScore(scoreForTasks(props.tasks, next));
      return next;
    });
    setCompletedTaskKeys((current) => {
      const next = new Set(current);
      if (intendedValue) next.add(taskKey); else next.delete(taskKey);
      return next;
    });
    setSavedAt(result.savedAt);
    setRowStates((current) => {
      const next = { ...current };
      delete next[taskKey];
      return next;
    });
  }

  function handleToggle(taskKey: string, completed: boolean) {
    const next = new Set(completedTaskKeys);
    if (completed) next.add(taskKey); else next.delete(taskKey);
    setCompletedTaskKeys(next);
    saveTask(taskKey, completed);
  }

  async function handleSaveNote() {
    setNoteState("saving");
    let result: Awaited<ReturnType<typeof saveTodayCheckInNote>>;
    try {
      result = await saveTodayCheckInNote({ note });
    } catch {
      setNoteState("error");
      return;
    }
    if (!result.ok) { setNoteState("error"); return; }
    setNote(result.note ?? "");
    setSavedAt(result.savedAt);
    setNoteState("saved");
  }

  return (
    <>
      {props.initialNotice ? <div className={`today-initial-notice is-${props.initialNotice.tone}`} role={props.initialNotice.tone === "error" ? "alert" : "status"}>{props.initialNotice.message}</div> : null}
      {!online || reconnecting ? (
        <div className="today-offline" role="status"><WifiSlash aria-hidden="true" size={25} /><span><strong>{reconnecting ? "Refreshing saved progress…" : "You’re offline"}</strong><small>{reconnecting ? "Confirming the latest checklist before editing." : "Checklist changes cannot be saved until you reconnect."}</small></span></div>
      ) : null}
      <div className="today-main-grid">
        <section className="today-checklist-card" aria-labelledby="today-checklist-title">
          <header>
            <div><h2 id="today-checklist-title">Today’s Checklist</h2><p>Complete your authentic Quran practice and track your progress.</p></div>
            <div className="today-score"><small>Today’s score</small><strong>{Math.round(score.dailyScore)}<span>/100</span></strong></div>
          </header>
          <div className="today-save-status" role="status">{savedAt && !anySaving ? <CheckCircle aria-hidden="true" size={16} weight="fill" /> : null}<span>{statusText}</span>{savedAt && !anySaving ? <small>Last saved {formatDateTimeInAppTimeZone(savedAt)}</small> : null}</div>
          <fieldset>
            <legend className="sr-only">Today’s checklist</legend>
            {props.tasks.map((task) => {
              const checked = completedTaskKeys.has(task.key);
              const rowState = rowStates[task.key];
              const disabled = rowState?.status === "saving" || !online || reconnecting;
              return (
                <div className={`today-checklist-row ${rowState?.status === "error" ? "has-error" : ""}`} key={task.key}>
                  <label>
                    <span>{task.label}</span><small>{task.weight} pts</small>
                    <input type="checkbox" checked={checked} disabled={disabled} aria-label={`${task.label}${rowState?.status === "saving" ? ", saving" : rowState?.status === "error" ? ", save failed" : ""}`} onChange={(event) => handleToggle(task.key, event.target.checked)} />
                  </label>
                  <div className="today-row-message" aria-live="polite">
                    {rowState?.status === "saving" ? <span>Saving…</span> : rowState?.status === "error" ? <><WarningCircle aria-hidden="true" size={17} /><span>Could not save this change. Your previously saved selection is still intact.</span><button type="button" onClick={() => saveTask(task.key, rowState.intendedValue)}>Retry</button></> : null}
                  </div>
                </div>
              );
            })}
          </fieldset>
          <details className="today-note" open={Boolean(props.initialNote)}>
            <summary>Add optional note</summary>
            <label><span className="sr-only">Optional note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anything your admin should know?" /></label>
            {noteState === "error" ? <p role="alert">Your note could not be saved. Please try again.</p> : null}
            {noteState === "saved" ? <p role="status">Note saved.</p> : null}
            <button type="button" disabled={noteState === "saving" || !online || reconnecting} onClick={handleSaveNote}>{noteState === "saving" ? "Saving…" : "Save note"}</button>
          </details>
        </section>
        <section className="today-progress-card" aria-labelledby="today-progress-title">
          <h2 id="today-progress-title">Your Progress This Week</h2>
          <div className="today-progress-total"><strong>{Math.round(weeklyTotal)}</strong><span>/ 1000 pts</span><small>{weeklyPercentage}%</small></div>
          <ProgressBar label="Daily checklist" value={Math.round(weeklyDailyPoints)} maximum={700} />
          <ProgressBar label="Partner recitation" value={props.partnerPoints} maximum={150} />
          <ProgressBar label={`Halaqa (${props.halaqaLabel})`} value={props.halaqaPoints} maximum={150} />
          <div className="today-streak"><strong>Below-70 streak</strong><span>{props.below70Streak} {props.below70Streak === 1 ? "week" : "weeks"}</span><small>Completed weeks only.</small></div>
        </section>
      </div>
    </>
  );
}
