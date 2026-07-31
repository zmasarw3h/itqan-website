import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseImportCsv } from "@/lib/import-users";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

describe("privacy and legacy importer containment", () => {
  it("keeps the confirmed real-data workbook out of the current tree", () => {
    expect(existsSync(path.join(projectRoot, "data/itqan_admin_add.xlsx"))).toBe(false);
  });

  it("keeps the maintained import fixture synthetic", () => {
    const sample = readFileSync(path.join(projectRoot, "docs/sample-users.csv"), "utf8");
    const records = parseImportCsv(sample);

    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.name.startsWith("Synthetic "))).toBe(true);
    expect(records.every((record) => record.phone.replace(/\D/g, "").startsWith("1555"))).toBe(true);
    expect(records.every((record) => record.role === "student")).toBe(true);
  });

  it("keeps the legacy script free of mutation and password APIs", () => {
    const script = readFileSync(path.join(projectRoot, "scripts/import-users.ts"), "utf8");
    const helper = readFileSync(path.join(projectRoot, "lib/import-users.ts"), "utf8");

    expect(`${script}\n${helper}`).not.toMatch(/supabase|createClient|auth\.admin|updateUserById|password/i);
  });

  it("uses focused ignore rules for known import artifacts", () => {
    const gitignore = readFileSync(path.join(projectRoot, ".gitignore"), "utf8");

    expect(gitignore).toContain("data/itqan_admin_add.*");
    expect(gitignore).toContain("data/itqan_student_list*.csv");
    expect(gitignore).toContain("data/itqan_new_student.csv");
    expect(gitignore).toContain("data/users.csv");
    expect(gitignore).toContain("data/import-results-*.csv");
    expect(gitignore).toContain("data/import-validation-*.csv");
    expect(gitignore).not.toContain("data/*.csv");
  });
});
