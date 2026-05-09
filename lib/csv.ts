import type { CompletionRow } from "@/lib/types";

const CSV_COLUMNS = [
  "student name",
  "student email",
  "date",
  "completed",
  "submitted_at",
  "note",
  "updated_at",
  "updated_by_admin"
] as const;

function escapeCsv(value: string | boolean | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

export function completionRowsToCsv(rows: CompletionRow[]) {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      [
        row.studentName,
        row.studentEmail,
        row.date,
        row.completed,
        row.checkin?.submitted_at,
        row.checkin?.note,
        row.checkin?.updated_at,
        row.checkin?.updated_by_admin
      ]
        .map(escapeCsv)
        .join(",")
    )
  ];

  return `${lines.join("\n")}\n`;
}

export function csvColumns() {
  return [...CSV_COLUMNS];
}
