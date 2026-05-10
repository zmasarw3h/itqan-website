export type CheckInTask = {
  key: string;
  label: string;
  weight: number;
};

export type SubmittedCheckInItem = CheckInTask & {
  completed: boolean;
};

const OLD_REVISION: CheckInTask = {
  key: "old_revision",
  label: "Old revision recited",
  weight: 25
};

const SALAT_RECITATION: CheckInTask = {
  key: "salat_recitation",
  label: "Weekly assigned recitation recited during salat",
  weight: 25
};

const TAJWEED_HEARING: CheckInTask = {
  key: "tajweed_hearing",
  label: "Hearing tajweed from a sheikh",
  weight: 20
};

const SUNDAY_TO_WEDNESDAY_TASKS: CheckInTask[] = [
  {
    key: "new_memorization_3x",
    label: "New memorization assigned recited three times",
    weight: 30
  },
  OLD_REVISION,
  SALAT_RECITATION,
  TAJWEED_HEARING
];

const THURSDAY_TASKS: CheckInTask[] = [
  {
    key: "weekly_recitation_3x",
    label: "Weekly recitation made 3 times",
    weight: 30
  },
  OLD_REVISION,
  SALAT_RECITATION,
  TAJWEED_HEARING
];

const FRIDAY_TASKS: CheckInTask[] = [
  {
    key: "weekly_recitation_5x",
    label: "Weekly recitation made 5 times",
    weight: 30
  },
  OLD_REVISION,
  SALAT_RECITATION,
  TAJWEED_HEARING
];

const SATURDAY_TASKS: CheckInTask[] = [
  {
    key: "attending_halaqa",
    label: "Attending halaqa",
    weight: 40
  },
  {
    key: "reflection_group",
    label: "Put your reflection for the weekly recitation on the group",
    weight: 30
  },
  {
    key: "next_week_tafsir",
    label: "Read tafsir of next week recitation",
    weight: 30
  }
];

const TASKS_BY_DAY: Record<number, CheckInTask[]> = {
  0: SUNDAY_TO_WEDNESDAY_TASKS,
  1: SUNDAY_TO_WEDNESDAY_TASKS,
  2: SUNDAY_TO_WEDNESDAY_TASKS,
  3: SUNDAY_TO_WEDNESDAY_TASKS,
  4: THURSDAY_TASKS,
  5: FRIDAY_TASKS,
  6: SATURDAY_TASKS
};

function weekdayForDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid check-in date.");
  }

  return date.getUTCDay();
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

export function tasksForDate(dateString: string): CheckInTask[] {
  return TASKS_BY_DAY[weekdayForDate(dateString)].map((task) => ({ ...task }));
}

export function allScoringTasks() {
  const tasksByKey = new Map<string, CheckInTask>();

  for (const tasks of Object.values(TASKS_BY_DAY)) {
    for (const task of tasks) {
      tasksByKey.set(task.key, task);
    }
  }

  return [...tasksByKey.values()].map((task) => ({ ...task }));
}

export function calculateDailySubmission(dateString: string, completedTaskKeys: Iterable<string>) {
  const completedKeys = new Set(completedTaskKeys);
  const items: SubmittedCheckInItem[] = tasksForDate(dateString).map((task) => ({
    ...task,
    completed: completedKeys.has(task.key)
  }));
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const earnedWeight = items.reduce((sum, item) => sum + (item.completed ? item.weight : 0), 0);
  const dailyScore = totalWeight === 0 ? 0 : roundScore((earnedWeight / totalWeight) * 100);

  return {
    items,
    earnedWeight,
    totalWeight,
    dailyScore
  };
}

export function calculateWeeklyAverage(dailyScores: Iterable<number | null | undefined>) {
  const scores = [...dailyScores].map((score) => Number(score ?? 0));

  if (scores.length === 0) {
    return null;
  }

  return roundScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) {
    return "";
  }

  return `${Number(score).toFixed(Number.isInteger(Number(score)) ? 0 : 2)}%`;
}
