import { normalizePhoneNumber, phoneNumberToAuthEmail } from "@/lib/phone-auth";
import type { Role } from "@/lib/types";

const IMPORT_COLUMNS = ["name", "phone", "role"] as const;
const REPORT_COLUMNS = [
  "row_number",
  "name",
  "input_phone",
  "normalized_phone",
  "role",
  "auth_email",
  "status",
  "temporary_password",
  "error"
] as const;

export type RawImportRecord = {
  rowNumber: number;
  name: string;
  phone: string;
  role: string;
};

export type ValidImportRecord = {
  rowNumber: number;
  name: string;
  inputPhone: string;
  normalizedPhone: string;
  role: Role;
  authEmail: string;
};

export type ImportReportRow = {
  rowNumber: number;
  name: string;
  inputPhone: string;
  normalizedPhone: string;
  role: string;
  authEmail: string;
  status: "created" | "existing/updated" | "failed";
  temporaryPassword: string;
  error: string;
};

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field.");
  }

  row.push(field);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

export function parseImportCsv(input: string): RawImportRecord[] {
  const rows = parseCsvRows(input);

  if (rows.length === 0) {
    throw new Error("CSV is empty.");
  }

  const header = rows[0].map((cell) => cell.trim());
  const expectedHeader = [...IMPORT_COLUMNS];

  if (header.length !== expectedHeader.length || header.some((column, index) => column !== expectedHeader[index])) {
    throw new Error(`CSV header must be exactly: ${expectedHeader.join(",")}`);
  }

  return rows.slice(1).map((cells, index) => {
    if (cells.length !== expectedHeader.length) {
      throw new Error(`Row ${index + 2} must have exactly ${expectedHeader.length} columns.`);
    }

    return {
      rowNumber: index + 2,
      name: cells[0].trim(),
      phone: cells[1].trim(),
      role: cells[2].trim()
    };
  });
}

export function validateImportRecord(record: RawImportRecord): ValidImportRecord {
  if (!record.name) {
    throw new Error("name is required.");
  }

  if (!record.phone) {
    throw new Error("phone is required.");
  }

  if (!record.role) {
    throw new Error("role is required.");
  }

  const role = record.role.toLowerCase();

  if (role !== "student" && role !== "admin") {
    throw new Error("role must be student or admin.");
  }

  const normalizedPhone = normalizePhoneNumber(record.phone);

  return {
    rowNumber: record.rowNumber,
    name: record.name,
    inputPhone: record.phone,
    normalizedPhone,
    role,
    authEmail: phoneNumberToAuthEmail(normalizedPhone)
  };
}

function escapeCsv(value: string | number) {
  const text = String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

export function importReportRowsToCsv(rows: ImportReportRow[]) {
  const lines = [
    REPORT_COLUMNS.join(","),
    ...rows.map((row) =>
      [
        row.rowNumber,
        row.name,
        row.inputPhone,
        row.normalizedPhone,
        row.role,
        row.authEmail,
        row.status,
        row.temporaryPassword,
        row.error
      ]
        .map(escapeCsv)
        .join(",")
    )
  ];

  return `${lines.join("\n")}\n`;
}
