import { describe, expect, it } from "vitest";
import {
  IMPORT_MUTATION_DISABLED_MESSAGE,
  importValidationReportRowsToCsv,
  parseImportArguments,
  parseImportCsv,
  validateImportRecord,
  validateImportRecords
} from "@/lib/import-users";

describe("user import helpers", () => {
  it("parses valid name,phone,role CSV rows", () => {
    const records = parseImportCsv("name,phone,role\nSample Student,5550101000,student\n");

    expect(records).toEqual([
      {
        rowNumber: 2,
        name: "Sample Student",
        phone: "5550101000",
        role: "student"
      }
    ]);
  });

  it("validates rows and creates synthetic auth emails", () => {
    const record = validateImportRecord({
      rowNumber: 2,
      name: "Sample Student",
      phone: "(555) 010-1000",
      role: "student"
    });

    expect(record).toMatchObject({
      normalizedPhone: "+15550101000",
      authEmail: "15550101000@itqan.local",
      role: "student"
    });
  });

  it("rejects teacher and other privileged roles", () => {
    expect(() =>
      validateImportRecord({
        rowNumber: 2,
        name: "Sample User",
        phone: "5550101000",
        role: "teacher"
      })
    ).toThrow("Privileged roles are not supported by the quarantined importer");

    expect(() =>
      validateImportRecord({
        rowNumber: 3,
        name: "Sample Admin",
        phone: "5550101001",
        role: "admin"
      })
    ).toThrow("Privileged roles are not supported by the quarantined importer");
  });

  it("rejects invalid phone numbers", () => {
    expect(() =>
      validateImportRecord({
        rowNumber: 2,
        name: "Sample User",
        phone: "1000",
        role: "student"
      })
    ).toThrow("valid");
  });

  it("formats a privacy-safe validation report without credentials", () => {
    const csv = importValidationReportRowsToCsv([
      {
        rowNumber: 2,
        status: "valid",
        error: ""
      }
    ]);

    expect(csv).toBe("row_number,status,error\n2,valid,\n");
    expect(csv).not.toMatch(/password|temporary|auth_email/i);
  });

  it("defaults to validation and rejects every mutation flag", () => {
    expect(parseImportArguments(["docs/sample-users.csv"])).toEqual({
      csvPath: "docs/sample-users.csv",
      dryRun: true
    });
    expect(parseImportArguments(["--dry-run", "docs/sample-users.csv"])).toEqual({
      csvPath: "docs/sample-users.csv",
      dryRun: true
    });
    expect(() => parseImportArguments(["--mutate", "docs/sample-users.csv"])).toThrow(
      IMPORT_MUTATION_DISABLED_MESSAGE
    );
  });

  it("reports privileged rows as rejected without producing a mutation result", () => {
    const report = validateImportRecords([
      { rowNumber: 2, name: "Sample Admin", phone: "5550101001", role: "admin" }
    ]);

    expect(report).toEqual([
      {
        rowNumber: 2,
        status: "rejected",
        error: "Privileged roles are not supported by the quarantined importer."
      }
    ]);
  });

  it("does not copy untrusted role text into validation reports", () => {
    const report = importValidationReportRowsToCsv(
      validateImportRecords([
        { rowNumber: 2, name: "Synthetic", phone: "5550101001", role: "untrusted-name-phone-email" }
      ])
    );

    expect(report).not.toContain("untrusted-name-phone-email");
    expect(report).toContain("row_number,status,error");
  });
});
