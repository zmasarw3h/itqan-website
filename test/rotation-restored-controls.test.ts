import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  LegacyTeacherAssignmentPublication,
  PermanentGroupManagement
} from "@/app/admin/rotation/legacy-rotation-controls";
import { RotationAvailabilityProvider } from "@/app/admin/rotation/availability-state";
import type { RotationPageData } from "@/app/admin/rotation/data";

const context: NonNullable<RotationPageData["context"]> = {
  masjid: { id: "masjid-a", name: "Masjid A", slug: "masjid-a" },
  cohort: { id: "cohort-a", name: "Brothers", kind: "brothers", masjid_id: "masjid-a" }
};

const data = {
  context,
  selectedWeekStart: "2026-08-02",
  settings: { id: "settings-a", target_group_count: 2 },
  groups: [{ id: "group-a", name: "Level 1", student_count: 4, sort_order: 1, created_at: "" }],
  assignments: [{ group_id: "group-a", group_name: "Level 1", teacher_id: null, teacher_name: null, active: false }],
  teachers: [],
  rebalancePreview: {
    groups: [{ id: "group-a", name: "Level 1", current_student_count: 4, proposed_student_count: 3, is_new: false }],
    moved_student_ids: ["student-a"]
  },
  persistencePlan: null,
  publicationRequestId: null
} as unknown as RotationPageData;
const ProviderForRender = RotationAvailabilityProvider as React.ComponentType<{
  initialAvailableTeacherIds: string[];
  children?: React.ReactNode;
}>;

describe("restored rotation controls", () => {
  it("renders group settings and the separately confirmed permanent rebalance control", () => {
    const html = renderToStaticMarkup(React.createElement(PermanentGroupManagement, {
      context,
      data,
      hasChanges: true,
      newGroupCount: 0,
      movedStudentCount: 1
    }));

    expect(html).toContain("Permanent group setup");
    expect(html).toContain("Save target");
    expect(html).toContain("Apply permanent student rebalance");
    expect(html).toContain("Saturday session placements are not changed");
  });

  it("renders the legacy weekly teacher-assignment publication control under its existing availability guard", () => {
    const html = renderToStaticMarkup(React.createElement(
      ProviderForRender,
      { initialAvailableTeacherIds: [] },
      React.createElement(LegacyTeacherAssignmentPublication, {
        availableTeacherCount: 0,
        data,
        publishedAssignmentCount: 0,
        publishReady: false,
        proposedAssignmentCount: 0
      })
    ));

    expect(html).toContain("Weekly teacher-assignment publication");
    expect(html).toContain("Publish assignments");
    expect(html).toContain("Current teacher");
    expect(html).toContain("Proposed teacher");
  });
});
