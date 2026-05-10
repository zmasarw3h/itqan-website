import type { CompletionRow } from "@/lib/types";

const CSV_COLUMNS = [
  "student name",
  "student phone",
  "student email",
  "date",
  "status",
  "daily_score",
  "earned_weight",
  "total_weight",
  "submitted_at",
  "task_breakdown",
  "note",
  "updated_at",
  "updated_by_admin"
] as const;

function escapeCsv(value: string | number | boolean | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

export function completionRowsToCsv(rows: CompletionRow[]) {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) => {
      const taskBreakdown = row.items
        .map((item) => `${item.task_label}: ${item.completed ? "completed" : "missed"} (${item.weight})`)
        .join("; ");

      return [
        row.studentName,
        row.studentPhone,
        row.studentEmail,
        row.date,
        row.status,
        row.checkin?.daily_score,
        row.checkin?.earned_weight,
        row.checkin?.total_weight,
        row.checkin?.submitted_at,
        taskBreakdown,
        row.checkin?.note,
        row.checkin?.updated_at,
        row.checkin?.updated_by_admin
      ]
        .map(escapeCsv)
        .join(",");
    })
  ];

  return `${lines.join("\n")}\n`;
}

export function csvColumns() {
  return [...CSV_COLUMNS];
}
