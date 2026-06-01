"use client";

import { useMemo, useState, useTransition } from "react";
import { saveTodayCheckInNote, saveTodayChecklistItem } from "@/app/student/actions";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";
import { formatScore, type CheckInTask } from "@/lib/scoring";

type ChecklistScore = {
  earnedWeight: number;
  totalWeight: number;
  dailyScore: number;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  tasks: CheckInTask[];
  initialCompletedTaskKeys: string[];
  initialEarnedWeight: number;
  initialTotalWeight: number;
  initialDailyScore: number;
  initialNote: string;
  initialSavedAt: string | null;
};

function scoreForTasks(tasks: CheckInTask[], completedTaskKeys: Set<string>): ChecklistScore {
  const totalWeight = tasks.reduce((sum, task) => sum + task.weight, 0);
  const earnedWeight = tasks.reduce((sum, task) => sum + (completedTaskKeys.has(task.key) ? task.weight : 0), 0);
  const dailyScore = totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 10000) / 100;

  return { earnedWeight, totalWeight, dailyScore };
}

export default function CheckInChecklist({
  tasks,
  initialCompletedTaskKeys,
  initialEarnedWeight,
  initialTotalWeight,
  initialDailyScore,
  initialNote,
  initialSavedAt
}: Props) {
  const [completedTaskKeys, setCompletedTaskKeys] = useState(() => new Set(initialCompletedTaskKeys));
  const [score, setScore] = useState<ChecklistScore>({
    earnedWeight: initialEarnedWeight,
    totalWeight: initialTotalWeight,
    dailyScore: initialDailyScore
  });
  const [note, setNote] = useState(initialNote);
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [status, setStatus] = useState<SaveStatus>(initialSavedAt ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isNotePending, startNoteTransition] = useTransition();

  const statusLabel = useMemo(() => {
    if (status === "saving") return "Saving...";
    if (status === "saved") return "Saved";
    if (status === "error") return "Could not save. Try again.";
    return "Not saved yet";
  }, [status]);

  function handleToggle(taskKey: string, completed: boolean) {
    const previousCompletedTaskKeys = new Set(completedTaskKeys);
    const optimisticCompletedTaskKeys = new Set(completedTaskKeys);

    if (completed) {
      optimisticCompletedTaskKeys.add(taskKey);
    } else {
      optimisticCompletedTaskKeys.delete(taskKey);
    }

    setCompletedTaskKeys(optimisticCompletedTaskKeys);
    setScore(scoreForTasks(tasks, optimisticCompletedTaskKeys));
    setStatus("saving");
    setError(null);

    startTransition(async () => {
      const result = await saveTodayChecklistItem({ taskKey, completed });

      if (!result.ok) {
        setCompletedTaskKeys(previousCompletedTaskKeys);
        setScore(scoreForTasks(tasks, previousCompletedTaskKeys));
        setStatus("error");
        setError(result.error);
        return;
      }

      setCompletedTaskKeys(new Set(result.completedTaskKeys));
      setScore({
        earnedWeight: result.earnedWeight,
        totalWeight: result.totalWeight,
        dailyScore: result.dailyScore
      });
      setSavedAt(result.savedAt);
      setStatus("saved");
    });
  }

  function handleSaveNote() {
    setStatus("saving");
    setError(null);

    startNoteTransition(async () => {
      const result = await saveTodayCheckInNote({ note });

      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        return;
      }

      setNote(result.note ?? "");
      setCompletedTaskKeys(new Set(result.completedTaskKeys));
      setScore({
        earnedWeight: result.earnedWeight,
        totalWeight: result.totalWeight,
        dailyScore: result.dailyScore
      });
      setSavedAt(result.savedAt);
      setStatus("saved");
    });
  }

  return (
    <section className="mt-6 rounded-lg border-2 border-moss bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase text-moss">Live checklist</p>
          <h2 className="mt-1 text-xl font-semibold text-ink">Today&apos;s checklist</h2>
          <p className="mt-1 text-sm text-stone-600">
            Check tasks as you complete them. Each change saves immediately.
          </p>
        </div>
        <div className="rounded-md bg-stone-50 px-4 py-3 text-right">
          <p className="text-3xl font-semibold text-ink">{formatScore(score.dailyScore)}</p>
          <p className="text-sm text-stone-600">
            {score.earnedWeight}/{score.totalWeight} checklist points
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          className={
            status === "error"
              ? "rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
              : status === "saving"
                ? "rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700"
                : "rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-800"
          }
          role="status"
        >
          {statusLabel}
        </span>
        {savedAt ? (
          <span className="text-sm text-stone-600">Last saved {formatDateTimeInAppTimeZone(savedAt)}</span>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <fieldset className="mt-5">
        <legend className="sr-only">Today&apos;s checklist</legend>
        <div className="grid gap-3">
          {tasks.map((task) => {
            const checked = completedTaskKeys.has(task.key);

            return (
              <label
                className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-stone-200 bg-white p-4 transition has-[:checked]:border-moss has-[:checked]:bg-moss/5"
                key={task.key}
              >
                <span className="flex min-w-0 items-start gap-3">
                  <input
                    checked={checked}
                    className="mt-1 h-4 w-4 shrink-0 accent-moss"
                    disabled={isPending}
                    onChange={(event) => handleToggle(task.key, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0 break-words text-sm font-medium text-ink">{task.label}</span>
                </span>
                <span className="shrink-0 rounded-md bg-stone-50 px-2 py-1 text-sm font-medium text-stone-700">
                  {task.weight}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5">
        <label className="block">
          <span className="text-sm font-medium text-ink">Optional note</span>
          <textarea
            className="mt-1 min-h-28 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything admin should know?"
            value={note}
          />
        </label>
        <button
          className="mt-3 rounded-md bg-moss px-4 py-2.5 font-medium text-white hover:bg-ink disabled:cursor-not-allowed disabled:bg-stone-400"
          disabled={isNotePending || isPending}
          onClick={handleSaveNote}
          type="button"
        >
          {isNotePending ? "Saving..." : "Save note"}
        </button>
      </div>
    </section>
  );
}
