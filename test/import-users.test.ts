import { describe, expect, it } from "vitest";
import { importReportRowsToCsv, parseImportCsv, validateImportRecord } from "@/lib/import-users";

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

  it("rejects invalid roles", () => {
    expect(() =>
      validateImportRecord({
        rowNumber: 2,
        name: "Sample User",
        phone: "5550101000",
        role: "teacher"
      })
    ).toThrow("role must be student or admin");
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

  it("formats local credential report CSV rows", () => {
    const csv = importReportRowsToCsv([
      {
        rowNumber: 2,
        name: "Sample Student",
        inputPhone: "5550101000",
        normalizedPhone: "+15550101000",
        role: "student",
        authEmail: "15550101000@itqan.local",
        status: "created",
        temporaryPassword: "temporary-password",
        error: ""
      }
    ]);

    expect(csv).toContain("row_number,name,input_phone,normalized_phone,role,auth_email,status");
    expect(csv).toContain("2,Sample Student,5550101000,+15550101000,student,15550101000@itqan.local,created");
  });
});
