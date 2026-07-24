import { describe, expect, it } from "vitest";
import {
  buildRotationContexts,
  resolveRotationContext,
  rotationPath
} from "@/lib/rotation-scope";
import type { AdminCreateUserScopeOptions } from "@/lib/admin-user-scope";

const options: AdminCreateUserScopeOptions = {
  masjids: [
    { id: "masjid-a", name: "Masjid A", slug: "masjid-a", membership_starts_on: "2026-01-01" },
    { id: "masjid-b", name: "Masjid B", slug: "masjid-b", membership_starts_on: "2026-01-01" }
  ],
  cohorts: [
    { id: "brothers-a", masjid_id: "masjid-a", kind: "brothers", name: "Brothers", sort_order: 10 },
    { id: "sisters-a", masjid_id: "masjid-a", kind: "sisters", name: "Sisters", sort_order: 20 },
    { id: "brothers-b", masjid_id: "masjid-b", kind: "brothers", name: "Brothers", sort_order: 10 }
  ],
  groups: []
};

describe("rotation scope", () => {
  const contexts = buildRotationContexts(options);

  it("includes brothers and sisters cohorts for every scoped masjid", () => {
    expect(
      contexts.map((context) => [context.masjid.id, context.cohort.id, context.cohort.kind])
    ).toEqual([
      ["masjid-a", "brothers-a", "brothers"],
      ["masjid-a", "sisters-a", "sisters"],
      ["masjid-b", "brothers-b", "brothers"]
    ]);
  });

  it("resolves an explicitly selected sisters cohort", () => {
    expect(
      resolveRotationContext(contexts, { masjidId: "masjid-a", cohortId: "sisters-a" })
    ).toMatchObject({
      context: { masjid: { id: "masjid-a" }, cohort: { id: "sisters-a", kind: "sisters" } },
      usedDefault: false,
      error: null
    });
  });

  it("uses the first scoped cohort only when no context was supplied", () => {
    expect(resolveRotationContext(contexts, {})).toMatchObject({
      context: { masjid: { id: "masjid-a" }, cohort: { id: "brothers-a" } },
      usedDefault: true,
      error: null
    });
  });

  it("rejects missing, cross-masjid, and unknown cohort selections without falling back", () => {
    expect(resolveRotationContext(contexts, { masjidId: "masjid-a" })).toEqual({
      context: null,
      usedDefault: false,
      error: "invalid-selection"
    });
    expect(
      resolveRotationContext(contexts, { masjidId: "masjid-a", cohortId: "brothers-b" })
    ).toEqual({ context: null, usedDefault: false, error: "invalid-selection" });
    expect(
      resolveRotationContext(contexts, { masjidId: "masjid-a", cohortId: "unknown" })
    ).toEqual({ context: null, usedDefault: false, error: "invalid-selection" });
  });

  it("preserves the full selected context in rotation URLs", () => {
    expect(
      rotationPath({
        masjidId: "masjid-a",
        cohortId: "sisters-a",
        weekStart: "2026-07-19",
        status: "availability-saved"
      })
    ).toBe(
      "/admin/rotation?masjid=masjid-a&cohort=sisters-a&week=2026-07-19&status=availability-saved"
    );
  });
});
