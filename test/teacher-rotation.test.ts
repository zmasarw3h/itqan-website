import { describe, expect, it } from "vitest";
import {
  balanceStudentsIntoGroups,
  buildCohortGroupRebalancePreview,
  buildTeacherRotationPersistencePlan,
  generateTeacherRotationAssignments,
  planBalancedMembershipChanges,
  type PriorTeacherAssignment,
  type RotationGroup,
  type RotationStudent,
  type RotationTeacher
} from "@/lib/teacher-rotation";

const groups: RotationGroup[] = [
  { id: "group-a", name: "A", sort_order: 10 },
  { id: "group-b", name: "B", sort_order: 20 },
  { id: "group-c", name: "C", sort_order: 30 }
];

function students(count: number): RotationStudent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `student-${index + 1}`,
    name: `Student ${index + 1}`,
    created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
  }));
}

function teachers(count: number): RotationTeacher[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `teacher-${index + 1}`,
    name: `Teacher ${index + 1}`,
    sort_order: index + 1,
    available: true
  }));
}

describe("balanceStudentsIntoGroups", () => {
  it("splits students equally when possible", () => {
    expect(balanceStudentsIntoGroups(students(6), groups)).toEqual([
      { group_id: "group-a", student_ids: ["student-1", "student-2"] },
      { group_id: "group-b", student_ids: ["student-3", "student-4"] },
      { group_id: "group-c", student_ids: ["student-5", "student-6"] }
    ]);
  });

  it("splits uneven student counts with sizes differing by at most one", () => {
    const result = balanceStudentsIntoGroups(students(7), groups);

    expect(result.map((group) => group.student_ids.length)).toEqual([3, 2, 2]);
  });

  it("returns deterministic output for unsorted inputs", () => {
    const unsortedStudents = [students(3)[2], students(3)[0], students(3)[1]];
    const unsortedGroups = [groups[2], groups[0], groups[1]];

    expect(balanceStudentsIntoGroups(unsortedStudents, unsortedGroups)).toEqual([
      { group_id: "group-a", student_ids: ["student-1"] },
      { group_id: "group-b", student_ids: ["student-2"] },
      { group_id: "group-c", student_ids: ["student-3"] }
    ]);
  });

  it("handles no students", () => {
    expect(balanceStudentsIntoGroups([], groups)).toEqual([
      { group_id: "group-a", student_ids: [] },
      { group_id: "group-b", student_ids: [] },
      { group_id: "group-c", student_ids: [] }
    ]);
  });

  it("handles no groups", () => {
    expect(balanceStudentsIntoGroups(students(3), [])).toEqual([]);
  });
});

describe("buildCohortGroupRebalancePreview", () => {
  it("previews missing groups, balanced sizes, and moved students without mutating input", () => {
    const scopedStudents = students(5).map((student) => ({ ...student, group_id: "group-a" }));
    const existingGroups = [groups[0]];
    const originalStudents = structuredClone(scopedStudents);
    const originalGroups = structuredClone(existingGroups);

    expect(
      buildCohortGroupRebalancePreview({
        students: scopedStudents,
        groups: existingGroups,
        targetGroupCount: 2
      })
    ).toEqual({
      groups: [
        {
          id: "group-a",
          name: "A",
          current_student_count: 5,
          proposed_student_count: 3,
          is_new: false
        },
        {
          id: "new-group-2",
          name: "Group 2",
          current_student_count: 0,
          proposed_student_count: 2,
          is_new: true
        }
      ],
      moved_student_ids: ["student-4", "student-5"],
      target_group_count: 2
    });
    expect(scopedStudents).toEqual(originalStudents);
    expect(existingGroups).toEqual(originalGroups);
  });

  it("rejects invalid targets below the active group count", () => {
    expect(
      buildCohortGroupRebalancePreview({
        students: [],
        groups,
        targetGroupCount: 2
      })
    ).toBeNull();
  });

  it("skips active group names that would collide with an automatically created group", () => {
    const preview = buildCohortGroupRebalancePreview({
      students: [],
      groups: [{ id: "existing-group", name: "Group 2", sort_order: 10 }],
      targetGroupCount: 2
    });

    expect(preview?.groups.map((group) => group.name)).toEqual(["Group 2", "Group 3"]);
  });
});

describe("planBalancedMembershipChanges", () => {
  it("closes changed memberships and inserts next-week memberships without mutating input", () => {
    const currentMemberships = [
      {
        id: "membership-1",
        student_id: "student-1",
        group_id: "group-a",
        starts_on: "2026-06-01",
        ends_on: null
      },
      {
        id: "membership-2",
        student_id: "student-2",
        group_id: "group-b",
        starts_on: "2026-06-01",
        ends_on: null
      }
    ];
    const original = structuredClone(currentMemberships);

    expect(
      planBalancedMembershipChanges({
        currentMemberships,
        proposedGroups: [
          { group_id: "group-a", student_ids: ["student-2"] },
          { group_id: "group-b", student_ids: ["student-1"] }
        ],
        nextWeekStart: "2026-07-05"
      })
    ).toEqual({
      close: [
        { id: "membership-1", ends_on: "2026-07-04" },
        { id: "membership-2", ends_on: "2026-07-04" }
      ],
      insert: [
        { student_id: "student-1", group_id: "group-b", starts_on: "2026-07-05" },
        { student_id: "student-2", group_id: "group-a", starts_on: "2026-07-05" }
      ],
      replace: []
    });
    expect(currentMemberships).toEqual(original);
  });

  it("replaces changed memberships that already start on the next week", () => {
    expect(
      planBalancedMembershipChanges({
        currentMemberships: [
          {
            id: "membership-1",
            student_id: "student-1",
            group_id: "group-a",
            starts_on: "2026-07-05",
            ends_on: null
          }
        ],
        proposedGroups: [{ group_id: "group-b", student_ids: ["student-1"] }],
        nextWeekStart: "2026-07-05"
      })
    ).toEqual({
      close: [],
      insert: [],
      replace: [
        {
          id: "membership-1",
          student_id: "student-1",
          group_id: "group-b",
          starts_on: "2026-07-05"
        }
      ]
    });
  });
});

describe("generateTeacherRotationAssignments", () => {
  it("leaves groups unassigned when fewer teachers than groups", () => {
    const result = generateTeacherRotationAssignments({
      groups,
      teachers: teachers(2),
      priorAssignments: [],
      weekStart: "2026-07-05"
    });

    expect(result.assignments).toEqual([
      { group_id: "group-a", teacher_id: "teacher-1", week_start: "2026-07-05" },
      { group_id: "group-b", teacher_id: "teacher-2", week_start: "2026-07-05" }
    ]);
    expect(result.unassigned_group_ids).toEqual(["group-c"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["UNASSIGNED_GROUPS"]);
  });

  it("leaves extra teachers unassigned when more teachers than groups", () => {
    const result = generateTeacherRotationAssignments({
      groups: groups.slice(0, 2),
      teachers: teachers(3),
      priorAssignments: [],
      weekStart: "2026-07-05"
    });

    expect(result.assignments).toEqual([
      { group_id: "group-a", teacher_id: "teacher-1", week_start: "2026-07-05" },
      { group_id: "group-b", teacher_id: "teacher-2", week_start: "2026-07-05" }
    ]);
    expect(result.unassigned_teacher_ids).toEqual(["teacher-3"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["EXTRA_TEACHERS"]);
  });

  it("seeds teachers with no prior assignment by teacher and group order", () => {
    expect(
      generateTeacherRotationAssignments({
        groups,
        teachers: teachers(3),
        priorAssignments: [],
        weekStart: "2026-07-05"
      }).assignments
    ).toEqual([
      { group_id: "group-a", teacher_id: "teacher-1", week_start: "2026-07-05" },
      { group_id: "group-b", teacher_id: "teacher-2", week_start: "2026-07-05" },
      { group_id: "group-c", teacher_id: "teacher-3", week_start: "2026-07-05" }
    ]);
  });

  it("rotates a teacher to the next group after their latest prior group", () => {
    const priorAssignments: PriorTeacherAssignment[] = [
      { group_id: "group-a", teacher_id: "teacher-1", week_start: "2026-06-21" },
      { group_id: "group-b", teacher_id: "teacher-1", week_start: "2026-06-28" }
    ];

    expect(
      generateTeacherRotationAssignments({
        groups,
        teachers: teachers(1),
        priorAssignments,
        weekStart: "2026-07-05"
      }).assignments
    ).toEqual([{ group_id: "group-c", teacher_id: "teacher-1", week_start: "2026-07-05" }]);
  });

  it("skips unavailable teachers", () => {
    const result = generateTeacherRotationAssignments({
      groups,
      teachers: [
        { id: "teacher-1", sort_order: 1, available: true },
        { id: "teacher-2", sort_order: 2, available: false },
        { id: "teacher-3", sort_order: 3, available: true }
      ],
      priorAssignments: [],
      weekStart: "2026-07-05"
    });

    expect(result.assignments.map((assignment) => assignment.teacher_id)).toEqual([
      "teacher-1",
      "teacher-3"
    ]);
    expect(result.unassigned_group_ids).toEqual(["group-c"]);
  });

  it("handles no groups", () => {
    const result = generateTeacherRotationAssignments({
      groups: [],
      teachers: teachers(2),
      priorAssignments: [],
      weekStart: "2026-07-05"
    });

    expect(result.assignments).toEqual([]);
    expect(result.unassigned_teacher_ids).toEqual(["teacher-1", "teacher-2"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["NO_GROUPS"]);
  });

  it("returns an idempotent generation shape", () => {
    const input = {
      groups,
      teachers: teachers(3),
      priorAssignments: [
        { group_id: "group-c", teacher_id: "teacher-1", week_start: "2026-06-28" },
        { group_id: "group-a", teacher_id: "teacher-2", week_start: "2026-06-28" }
      ],
      weekStart: "2026-07-05"
    };

    expect(generateTeacherRotationAssignments(input)).toEqual(generateTeacherRotationAssignments(input));
  });

  it("preserves existing target-week assignments on regeneration", () => {
    const firstPlan = generateTeacherRotationAssignments({
      groups,
      teachers: teachers(3),
      priorAssignments: [
        { group_id: "group-a", teacher_id: "teacher-1", week_start: "2026-06-28" },
        { group_id: "group-b", teacher_id: "teacher-2", week_start: "2026-06-28" },
        { group_id: "group-c", teacher_id: "teacher-3", week_start: "2026-06-28" }
      ],
      weekStart: "2026-07-05"
    });
    const secondPlan = generateTeacherRotationAssignments({
      groups,
      teachers: teachers(3),
      priorAssignments: firstPlan.assignments,
      weekStart: "2026-07-05"
    });

    expect(secondPlan.assignments).toEqual(firstPlan.assignments);
  });

  it("builds a persistence plan with assignment upserts, deactivations, and run counts", () => {
    const plan = buildTeacherRotationPersistencePlan({
      groups,
      teachers: teachers(2),
      priorAssignments: [],
      weekStart: "2026-07-05"
    });

    expect(plan.assignmentUpserts).toEqual([
      { group_id: "group-a", teacher_id: "teacher-1", week_start: "2026-07-05" },
      { group_id: "group-b", teacher_id: "teacher-2", week_start: "2026-07-05" }
    ]);
    expect(plan.assignmentDeactivations).toEqual([
      { group_id: "group-c", week_start: "2026-07-05" }
    ]);
    expect(plan.run).toEqual({
      available_teacher_count: 2,
      group_count: 3,
      assigned_count: 2,
      warning_count: 1
    });
  });
});
