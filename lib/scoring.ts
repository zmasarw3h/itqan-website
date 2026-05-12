export type CheckInTask = {
  key: string;
  label: string;
  weight: number;
};

export type SubmittedCheckInItem = CheckInTask & {
  completed: boolean;
};

export type PartnerRound = "round_1" | "round_2";

export type PartnerRecitationScore = {
  round: PartnerRound;
  points: number;
};

export type HalaqaGradeScore = {
  attendance_points: number;
  recitation_points: number;
};

export type WeeklyScore = {
  daily_points: number;
  partner_points: number;
  halaqa_points: number;
  total_points: number;
  total_possible: 1000;
  percentage: number;
};

export const DAILY_WEEKLY_POINTS = 700;
export const PARTNER_RECITATION_POINTS_PER_ROUND = 75;
export const PARTNER_RECITATION_WEEKLY_POINTS = 150;
export const HALAQA_WEEKLY_POINTS = 150;
export const WEEKLY_TOTAL_POINTS = 1000;

const COMMON_WEEKDAY_TASKS: CheckInTask[] = [
  { key: "revise_old", label: "Revise old", weight: 40 },
  { key: "revise_new", label: "Revise new", weight: 20 },
  { key: "tafsir", label: "Tafsir", weight: 10 },
  { key: "recite_next_week_memorization", label: "Recite next week memorization", weight: 5 },
  { key: "read_during_salat", label: "Read during Salat", weight: 5 }
];

const SUNDAY_TO_WEDNESDAY_TASKS: CheckInTask[] = [
  {
    key: "new_memorization_listening",
    label: "New memorization & Listening",
    weight: 20
  },
  ...COMMON_WEEKDAY_TASKS
];

const THURSDAY_TASKS: CheckInTask[] = [
  {
    key: "repeat_new_memorization_3x_listen_1x",
    label: "Repeat new memorization 3 times & listen one time",
    weight: 20
  },
  ...COMMON_WEEKDAY_TASKS
];

const FRIDAY_TASKS: CheckInTask[] = [
  {
    key: "repeat_new_memorization_5x_listen_1x",
    label: "Repeat new memorization 5 times & listen one time",
    weight: 20
  },
  ...COMMON_WEEKDAY_TASKS
];

const SATURDAY_TASKS: CheckInTask[] = [
  {
    key: "tafsir_reflection_group",
    label: "Tafsir and sharing reflection on the group",
    weight: 50
  },
  {
    key: "repeat_week_memorization_2x",
    label: "Repeat the memorization of the week 2 times",
    weight: 50
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

function clampScore(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

export function partnerRoundForDate(dateString: string): PartnerRound {
  const weekday = weekdayForDate(dateString);

  return weekday <= 3 ? "round_1" : "round_2";
}

export function isPartnerRoundAvailable(round: PartnerRound, dateString: string) {
  return partnerRoundForDate(dateString) === round;
}

export function calculateHalaqaGrade(input: { attended: boolean; recitationPoints: number }) {
  if (!input.attended) {
    return {
      attended: false,
      attendance_points: 0,
      recitation_points: 0,
      halaqa_points: 0
    };
  }

  if (!Number.isInteger(input.recitationPoints) || input.recitationPoints < 10 || input.recitationPoints > 50) {
    throw new Error("Recitation points must be between 10 and 50 when attended is true.");
  }

  return {
    attended: true,
    attendance_points: 100,
    recitation_points: input.recitationPoints,
    halaqa_points: 100 + input.recitationPoints
  };
}

export function calculateWeeklyScore(input: {
  dailyScores: Iterable<number | null | undefined>;
  partnerRecitations?: Iterable<PartnerRecitationScore>;
  halaqaGrade?: HalaqaGradeScore | null;
}): WeeklyScore {
  const dailyPoints = clampScore(
    [...input.dailyScores].reduce<number>((sum, score) => sum + Number(score ?? 0), 0),
    0,
    DAILY_WEEKLY_POINTS
  );
  const partnerPointsByRound = new Map<PartnerRound, number>();

  for (const recitation of input.partnerRecitations ?? []) {
    const existing = partnerPointsByRound.get(recitation.round) ?? 0;
    partnerPointsByRound.set(
      recitation.round,
      Math.max(existing, clampScore(Number(recitation.points ?? 0), 0, PARTNER_RECITATION_POINTS_PER_ROUND))
    );
  }

  const partnerPoints = clampScore(
    [...partnerPointsByRound.values()].reduce((sum, points) => sum + points, 0),
    0,
    PARTNER_RECITATION_WEEKLY_POINTS
  );
  const halaqaPoints = clampScore(
    Number(input.halaqaGrade?.attendance_points ?? 0) + Number(input.halaqaGrade?.recitation_points ?? 0),
    0,
    HALAQA_WEEKLY_POINTS
  );
  const totalPoints = roundScore(dailyPoints + partnerPoints + halaqaPoints);

  return {
    daily_points: roundScore(dailyPoints),
    partner_points: roundScore(partnerPoints),
    halaqa_points: roundScore(halaqaPoints),
    total_points: totalPoints,
    total_possible: WEEKLY_TOTAL_POINTS,
    percentage: roundScore((totalPoints / WEEKLY_TOTAL_POINTS) * 100)
  };
}

export function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) {
    return "";
  }

  return `${Number(score).toFixed(Number.isInteger(Number(score)) ? 0 : 2)}%`;
}
