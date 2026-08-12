import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("request-local auth reuse", () => {
  it("memoizes profile and teacher assignment reads without weakening middleware validation", () => {
    const serverAuth = readFileSync("lib/supabase-server.ts", "utf8");
    const teacherScope = readFileSync("lib/teacher-scope.ts", "utf8");
    const middleware = readFileSync("proxy.ts", "utf8");

    expect(serverAuth).toContain('import { cache } from "react";');
    expect(serverAuth).toContain("export const getCurrentProfile = cache(async function getCurrentProfile()");
    expect(teacherScope).toContain(
      "export const loadTeacherAssignmentContexts = cache(async function loadTeacherAssignmentContexts"
    );
    expect(middleware).toContain("auth.getUser()");
  });
});
