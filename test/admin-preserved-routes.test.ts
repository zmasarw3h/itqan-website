import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preserved admin report routes", () => {
  it("keeps legacy incentive and reward bookmarks through redirects", () => {
    expect(readFileSync("app/admin/incentives/page.tsx", "utf8")).toContain("/admin/reports?");
    expect(readFileSync("app/admin/rewards/page.tsx", "utf8")).toContain("/admin/reports?");
  });
});
