import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  importReportRowsToCsv,
  parseImportCsv,
  validateImportRecord,
  type ImportReportRow,
  type ValidImportRecord
} from "../lib/import-users";

loadEnvConfig(process.cwd());

const IMPORT_PASSWORD = "itqan2026";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function findAuthUserByEmail(supabase: SupabaseClient, email: string) {
  const normalizedEmail = email.toLowerCase();
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);

    if (user) {
      return user;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function createAuthUser(supabase: SupabaseClient, record: ValidImportRecord) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: record.authEmail,
    password: IMPORT_PASSWORD,
    email_confirm: true
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Supabase did not return the created user.");
  }

  return { user: data.user, temporaryPassword: IMPORT_PASSWORD };
}

async function updateAuthUserPassword(supabase: SupabaseClient, user: User) {
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    password: IMPORT_PASSWORD
  });

  if (error) {
    throw error;
  }

  return data.user ?? user;
}

async function upsertProfile(supabase: SupabaseClient, record: ValidImportRecord, user: User) {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      name: record.name,
      email: record.authEmail,
      phone: record.normalizedPhone,
      role: record.role,
      active: true
    },
    { onConflict: "id" }
  );

  if (error) {
    throw error;
  }
}

async function processRecord(supabase: SupabaseClient, record: ValidImportRecord): Promise<ImportReportRow> {
  let user = await findAuthUserByEmail(supabase, record.authEmail);
  let temporaryPassword = "";
  let status: ImportReportRow["status"] = "existing/updated";

  if (!user) {
    try {
      const created = await createAuthUser(supabase, record);
      user = created.user;
      temporaryPassword = created.temporaryPassword;
      status = "created";
    } catch (error) {
      const maybeExistingUser = await findAuthUserByEmail(supabase, record.authEmail);

      if (!maybeExistingUser) {
        throw error;
      }

      user = await updateAuthUserPassword(supabase, maybeExistingUser);
      temporaryPassword = IMPORT_PASSWORD;
      status = "existing/updated";
    }
  } else {
    user = await updateAuthUserPassword(supabase, user);
    temporaryPassword = IMPORT_PASSWORD;
  }

  await upsertProfile(supabase, record, user);

  return {
    rowNumber: record.rowNumber,
    name: record.name,
    inputPhone: record.inputPhone,
    normalizedPhone: record.normalizedPhone,
    role: record.role,
    authEmail: record.authEmail,
    status,
    temporaryPassword,
    error: ""
  };
}

function reportPathForNow(now = new Date()) {
  const timestamp = now.toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z").replace("T", "-").slice(0, 17);
  return path.join("data", `import-results-${timestamp}.csv`);
}

async function main() {
  const csvPath = process.argv[2];

  if (!csvPath) {
    throw new Error("Usage: npm run import-users -- data/users.csv");
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const input = await readFile(csvPath, "utf8");
  const rawRecords = parseImportCsv(input);
  const reportRows: ImportReportRow[] = [];

  for (const rawRecord of rawRecords) {
    try {
      const validRecord = validateImportRecord(rawRecord);
      reportRows.push(await processRecord(supabase, validRecord));
    } catch (error) {
      reportRows.push({
        rowNumber: rawRecord.rowNumber,
        name: rawRecord.name,
        inputPhone: rawRecord.phone,
        normalizedPhone: "",
        role: rawRecord.role,
        authEmail: "",
        status: "failed",
        temporaryPassword: "",
        error: error instanceof Error ? error.message : "Unknown import error."
      });
    }
  }

  const outputPath = reportPathForNow();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, importReportRowsToCsv(reportRows), "utf8");

  const created = reportRows.filter((row) => row.status === "created").length;
  const updated = reportRows.filter((row) => row.status === "existing/updated").length;
  const failed = reportRows.filter((row) => row.status === "failed").length;

  console.log(`Import complete. created=${created} existing/updated=${updated} failed=${failed}`);
  console.log(`Report written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exit(1);
});
