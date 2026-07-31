import { normalizePhoneNumber, phoneNumberToAuthEmail } from "@/lib/phone-auth";

const IMPORT_COLUMNS = ["name", "phone", "role"] as const;
const REPORT_COLUMNS = ["row_number", "status", "error"] as const;

export const IMPORT_USAGE = "Usage: npm run import-users -- [--dry-run] data/users.csv";
export const IMPORT_MUTATION_DISABLED_MESSAGE =
  "The legacy user importer is validation-only. Mutation is disabled; use the guarded application workflows.";

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
  role: "student";
  authEmail: string;
};

export type ImportValidationReportRow = {
  rowNumber: number;
  status: "valid" | "rejected";
  error: string;
};

export type ImportArguments = {
  csvPath: string;
  dryRun: true;
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

  if (role === "admin" || role === "teacher" || role === "super_admin") {
    throw new Error("Privileged roles are not supported by the quarantined importer.");
  }

  if (role !== "student") {
    throw new Error("Only student rows are supported by the quarantined importer.");
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

export function validateImportRecords(records: RawImportRecord[]): ImportValidationReportRow[] {
  return records.map((record) => {
    try {
      validateImportRecord(record);
      return {
        rowNumber: record.rowNumber,
        status: "valid",
        error: ""
      };
    } catch (error) {
      return {
        rowNumber: record.rowNumber,
        status: "rejected",
        error: error instanceof Error ? error.message : "Unknown validation error."
      };
    }
  });
}

export function parseImportArguments(args: readonly string[]): ImportArguments {
  if (args.includes("--mutate")) {
    throw new Error(IMPORT_MUTATION_DISABLED_MESSAGE);
  }

  const unsupportedOption = args.find((arg) => arg.startsWith("--") && arg !== "--dry-run");

  if (unsupportedOption) {
    throw new Error(`Unsupported option: ${unsupportedOption}. ${IMPORT_MUTATION_DISABLED_MESSAGE}`);
  }

  const paths = args.filter((arg) => arg !== "--dry-run");

  if (paths.length !== 1) {
    throw new Error(IMPORT_USAGE);
  }

  return { csvPath: paths[0], dryRun: true };
}

function escapeCsv(value: string | number) {
  const text = String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

export function importValidationReportRowsToCsv(rows: ImportValidationReportRow[]) {
  const lines = [
    REPORT_COLUMNS.join(","),
    ...rows.map((row) =>
      [
        row.rowNumber,
        row.status,
        row.error
      ]
        .map(escapeCsv)
        .join(",")
    )
  ];

  return `${lines.join("\n")}\n`;
}
