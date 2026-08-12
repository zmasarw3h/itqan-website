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
  initialNotice?: { tone: "success" | "error"; message: string } | null;
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
  initialNotice,
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
  const [showInitialNotice, setShowInitialNotice] = useState(Boolean(initialNotice));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isNotePending, startNoteTransition] = useTransition();

  const statusLabel = useMemo(() => {
    if (status === "saving") return "Saving...";
    if (status === "saved") return "Saved";
    if (status === "error") return "Could not save. Try again.";
    return "Not saved yet";
  }, [status]);
  const displayedInitialNotice = showInitialNotice ? initialNotice : null;

  function handleToggle(taskKey: string, completed: boolean) {
    setShowInitialNotice(false);
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
    setShowInitialNotice(false);
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
    <>
      <section className="mt-4 rounded-lg border border-stone-200 bg-white p-4 shadow-none sm:mt-6 sm:p-6 sm:shadow-sm lg:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase text-moss">Live checklist</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">Today&apos;s checklist</h2>
            <p className="mt-1 hidden text-sm text-stone-600 sm:block">
              Check tasks as you complete them. Each change saves immediately.
            </p>
          </div>
          <div className="shrink-0 text-right sm:rounded-md sm:bg-stone-50 sm:px-4 sm:py-3">
            <p className="text-2xl font-semibold text-ink sm:text-3xl">{formatScore(score.dailyScore)}</p>
            <p className="text-xs text-stone-600 sm:text-sm">
              <span className="sm:hidden">
                {score.earnedWeight}/{score.totalWeight}
              </span>
              <span className="hidden sm:inline">
                {score.earnedWeight}/{score.totalWeight} checklist points
              </span>
            </p>
          </div>
        </div>

        <p className="mt-2 text-sm leading-5 text-stone-600 sm:hidden">
          Check tasks as you complete them. Each change saves immediately.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3 sm:mt-4">
          <span
            className={
              displayedInitialNotice?.tone === "error" || status === "error"
                ? "rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                : !displayedInitialNotice && status === "saving"
                  ? "rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700"
                  : "rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-800"
            }
            role={displayedInitialNotice?.tone === "error" || status === "error" ? "alert" : "status"}
          >
            {displayedInitialNotice?.message ?? statusLabel}
          </span>
          {savedAt ? (
            <span className="text-sm text-stone-600">Last saved {formatDateTimeInAppTimeZone(savedAt)}</span>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

        <fieldset className="mt-4 sm:mt-5">
          <legend className="sr-only">Today&apos;s checklist</legend>
          <div className="grid gap-0 border-b border-stone-200 sm:gap-3 sm:border-b-0">
            {tasks.map((task) => {
              const checked = completedTaskKeys.has(task.key);

              return (
                <label
                  className="flex min-h-16 cursor-pointer items-center justify-between gap-4 border-x-0 border-b-0 border-t border-stone-200 bg-transparent px-0 py-3 transition has-[:checked]:border-moss has-[:checked]:bg-moss/5 sm:rounded-md sm:border sm:bg-white sm:px-5"
                  key={task.key}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      checked={checked}
                      className="h-6 w-6 shrink-0 accent-moss"
                      disabled={isPending}
                      onChange={(event) => handleToggle(task.key, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="min-w-0 break-words text-base font-medium text-ink">{task.label}</span>
                  </span>
                  <span className="shrink-0 rounded-md bg-stone-50 px-2 py-1 text-sm font-medium text-stone-700">
                    {task.weight}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>

      <section className="mt-8">
        <label className="block">
          <span className="text-base font-semibold text-ink">Optional note</span>
          <span className="mt-1 block text-sm text-stone-600">Add anything your admin should know.</span>
          <textarea
            className="mt-3 min-h-28 w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-base outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything admin should know?"
            value={note}
          />
        </label>
        <button
          className="mt-3 min-h-12 rounded-md bg-action px-5 py-3 font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:bg-stone-400"
          disabled={isNotePending || isPending}
          onClick={handleSaveNote}
          type="button"
        >
          {isNotePending ? "Saving..." : "Save note"}
        </button>
      </section>
    </>
  );
}
