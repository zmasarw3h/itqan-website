import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IMPORT_USAGE,
  importValidationReportRowsToCsv,
  parseImportCsv,
  parseImportArguments,
  validateImportRecords
} from "../lib/import-users";

function reportPathForNow(now = new Date()) {
  const timestamp = now.toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z").replace("T", "-").slice(0, 17);
  return path.join("data", `import-validation-${timestamp}.csv`);
}

async function main() {
  const { csvPath, dryRun } = parseImportArguments(process.argv.slice(2));

  if (!dryRun) {
    throw new Error(IMPORT_USAGE);
  }

  const input = await readFile(csvPath, "utf8");
  const rawRecords = parseImportCsv(input);
  const reportRows = validateImportRecords(rawRecords);

  const outputPath = reportPathForNow();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, importValidationReportRowsToCsv(reportRows), "utf8");

  const valid = reportRows.filter((row) => row.status === "valid").length;
  const rejected = reportRows.filter((row) => row.status === "rejected").length;

  console.log(`Legacy importer validation complete. valid=${valid} rejected=${rejected}`);
  console.log(`Validation report written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exit(1);
});
