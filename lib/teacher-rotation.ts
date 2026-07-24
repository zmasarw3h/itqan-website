type OrderedEntity = {
  id: string;
  name?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
};

export type RotationStudent = OrderedEntity;
export type RotationGroup = OrderedEntity;

export type BalancedGroup = {
  group_id: string;
  student_ids: string[];
};

export type CurrentStudentGroupMembership = {
  id: string;
  student_id: string;
  group_id: string;
  starts_on: string;
  ends_on: string | null;
};

export type MembershipToClose = {
  id: string;
  ends_on: string;
};

export type MembershipToInsert = {
  student_id: string;
  group_id: string;
  starts_on: string;
};

export type MembershipToReplace = {
  id: string;
  student_id: string;
  group_id: string;
  starts_on: string;
};

export type PlannedMembershipChanges = {
  close: MembershipToClose[];
  insert: MembershipToInsert[];
  replace: MembershipToReplace[];
};

export type RotationTeacher = OrderedEntity & {
  available: boolean;
};

export type PriorTeacherAssignment = {
  group_id: string;
  teacher_id: string;
  week_start: string;
  active?: boolean | null;
  created_at?: string | null;
};

export type PlannedTeacherAssignment = {
  group_id: string;
  teacher_id: string;
  week_start: string;
};

export type TeacherRotationWarningCode = "NO_GROUPS" | "UNASSIGNED_GROUPS" | "EXTRA_TEACHERS";

export type TeacherRotationWarning = {
  code: TeacherRotationWarningCode;
  message: string;
  group_ids?: string[];
  teacher_ids?: string[];
};

export type TeacherRotationPlan = {
  assignments: PlannedTeacherAssignment[];
  unassigned_group_ids: string[];
  unassigned_teacher_ids: string[];
  warnings: TeacherRotationWarning[];
};

export type TeacherRotationPersistencePlan = {
  rotationPlan: TeacherRotationPlan;
  assignmentUpserts: PlannedTeacherAssignment[];
  assignmentDeactivations: Array<{
    group_id: string;
    week_start: string;
  }>;
  run: {
    available_teacher_count: number;
    group_count: number;
    assigned_count: number;
    warning_count: number;
  };
};

export type CohortGroupRebalancePreview = {
  groups: Array<{
    id: string;
    name: string;
    current_student_count: number;
    proposed_student_count: number;
    is_new: boolean;
  }>;
  moved_student_ids: string[];
  target_group_count: number;
};

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined) {
  if (a === b) {
    return 0;
  }

  if (a == null) {
    return 1;
  }

  if (b == null) {
    return -1;
  }

  return a - b;
}

function compareNullableString(a: string | null | undefined, b: string | null | undefined) {
  if (a === b) {
    return 0;
  }

  if (a == null) {
    return 1;
  }

  if (b == null) {
    return -1;
  }

  return a.localeCompare(b);
}

function sortOrdered<T extends OrderedEntity>(items: readonly T[]) {
  return [...items].sort((a, b) => {
    const bySortOrder = compareNullableNumber(a.sort_order, b.sort_order);
    if (bySortOrder !== 0) {
      return bySortOrder;
    }

    const byName = compareNullableString(a.name, b.name);
    if (byName !== 0) {
      return byName;
    }

    const byCreatedAt = compareNullableString(a.created_at, b.created_at);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }

    return a.id.localeCompare(b.id);
  });
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isMembershipEffectiveOn(membership: CurrentStudentGroupMembership, date: string) {
  return membership.starts_on <= date && (membership.ends_on === null || membership.ends_on >= date);
}

function latestPriorAssignmentForTeacher(
  teacherId: string,
  priorAssignments: readonly PriorTeacherAssignment[],
  groupIndexById: ReadonlyMap<string, number>,
  weekStart: string
) {
  const relevantAssignments = priorAssignments.filter(
    (assignment) =>
      assignment.teacher_id === teacherId &&
      assignment.week_start < weekStart &&
      assignment.active !== false &&
      groupIndexById.has(assignment.group_id)
  );

  return relevantAssignments.sort((a, b) => {
    const byWeek = b.week_start.localeCompare(a.week_start);
    if (byWeek !== 0) {
      return byWeek;
    }

    return compareNullableString(b.created_at, a.created_at);
  })[0];
}

function currentWeekAssignmentForTeacher(
  teacherId: string,
  priorAssignments: readonly PriorTeacherAssignment[],
  groupIndexById: ReadonlyMap<string, number>,
  weekStart: string
) {
  return priorAssignments
    .filter(
      (assignment) =>
        assignment.teacher_id === teacherId &&
        assignment.week_start === weekStart &&
        assignment.active !== false &&
        groupIndexById.has(assignment.group_id)
    )
    .sort((a, b) => compareNullableString(b.created_at, a.created_at))[0];
}

export function balanceStudentsIntoGroups(
  students: readonly RotationStudent[],
  groups: readonly RotationGroup[]
): BalancedGroup[] {
  const orderedGroups = sortOrdered(groups);
  const orderedStudents = sortOrdered(students);

  if (orderedGroups.length === 0) {
    return [];
  }

  const baseSize = Math.floor(orderedStudents.length / orderedGroups.length);
  const largerGroupCount = orderedStudents.length % orderedGroups.length;
  let nextStudentIndex = 0;

  return orderedGroups.map((group, groupIndex) => {
    const groupSize = baseSize + (groupIndex < largerGroupCount ? 1 : 0);
    const groupStudents = orderedStudents.slice(nextStudentIndex, nextStudentIndex + groupSize);
    nextStudentIndex += groupSize;

    return {
      group_id: group.id,
      student_ids: groupStudents.map((student) => student.id)
    };
  });
}

export function buildCohortGroupRebalancePreview(params: {
  students: readonly (RotationStudent & { group_id: string })[];
  groups: readonly RotationGroup[];
  targetGroupCount: number;
}): CohortGroupRebalancePreview | null {
  if (
    !Number.isInteger(params.targetGroupCount) ||
    params.targetGroupCount <= 0 ||
    params.targetGroupCount < params.groups.length
  ) {
    return null;
  }

  const virtualGroups: RotationGroup[] = [...params.groups];
  const usedGroupNames = new Set(
    params.groups.map((group) => group.name?.toLocaleLowerCase()).filter((name): name is string => Boolean(name))
  );
  let nextGroupNumber = params.groups.length + 1;

  while (virtualGroups.length < params.targetGroupCount) {
    while (usedGroupNames.has(`group ${nextGroupNumber}`)) {
      nextGroupNumber += 1;
    }

    const groupName = `Group ${nextGroupNumber}`;
    virtualGroups.push({
      id: `new-group-${nextGroupNumber}`,
      name: groupName,
      sort_order: nextGroupNumber * 10
    });
    usedGroupNames.add(groupName.toLocaleLowerCase());
    nextGroupNumber += 1;
  }

  const orderedGroups = sortOrdered(virtualGroups);
  const balancedGroups = balanceStudentsIntoGroups(params.students, orderedGroups);
  const proposedGroupByStudentId = new Map<string, string>();
  const currentCountByGroupId = new Map<string, number>();

  for (const student of params.students) {
    currentCountByGroupId.set(student.group_id, (currentCountByGroupId.get(student.group_id) ?? 0) + 1);
  }

  for (const group of balancedGroups) {
    for (const studentId of group.student_ids) {
      proposedGroupByStudentId.set(studentId, group.group_id);
    }
  }

  return {
    groups: orderedGroups.map((group) => ({
      id: group.id,
      name: group.name ?? "Unnamed group",
      current_student_count: currentCountByGroupId.get(group.id) ?? 0,
      proposed_student_count:
        balancedGroups.find((balancedGroup) => balancedGroup.group_id === group.id)?.student_ids.length ?? 0,
      is_new: group.id.startsWith("new-group-")
    })),
    moved_student_ids: params.students
      .filter((student) => proposedGroupByStudentId.get(student.id) !== student.group_id)
      .map((student) => student.id)
      .sort((left, right) => left.localeCompare(right)),
    target_group_count: params.targetGroupCount
  };
}

export function planBalancedMembershipChanges(params: {
  currentMemberships: readonly CurrentStudentGroupMembership[];
  proposedGroups: readonly BalancedGroup[];
  nextWeekStart: string;
}): PlannedMembershipChanges {
  const proposedGroupByStudentId = new Map<string, string>();

  for (const proposedGroup of params.proposedGroups) {
    for (const studentId of proposedGroup.student_ids) {
      proposedGroupByStudentId.set(studentId, proposedGroup.group_id);
    }
  }

  const currentByStudentId = new Map<string, CurrentStudentGroupMembership>();

  for (const membership of params.currentMemberships) {
    if (!isMembershipEffectiveOn(membership, params.nextWeekStart)) {
      continue;
    }

    const existing = currentByStudentId.get(membership.student_id);
    if (
      !existing ||
      membership.starts_on > existing.starts_on ||
      (membership.starts_on === existing.starts_on && membership.id > existing.id)
    ) {
      currentByStudentId.set(membership.student_id, membership);
    }
  }

  const close: MembershipToClose[] = [];
  const insert: MembershipToInsert[] = [];
  const replace: MembershipToReplace[] = [];
  const closeEndDate = addDays(params.nextWeekStart, -1);

  for (const [studentId, currentMembership] of currentByStudentId) {
    const proposedGroupId = proposedGroupByStudentId.get(studentId);

    if (!proposedGroupId) {
      if (currentMembership.starts_on < params.nextWeekStart) {
        close.push({ id: currentMembership.id, ends_on: closeEndDate });
      }

      continue;
    }

    if (proposedGroupId === currentMembership.group_id) {
      continue;
    }

    if (currentMembership.starts_on < params.nextWeekStart) {
      close.push({ id: currentMembership.id, ends_on: closeEndDate });
    } else {
      replace.push({
        id: currentMembership.id,
        student_id: studentId,
        group_id: proposedGroupId,
        starts_on: params.nextWeekStart
      });
    }
  }

  for (const [studentId, proposedGroupId] of proposedGroupByStudentId) {
    const currentMembership = currentByStudentId.get(studentId);

    if (currentMembership?.group_id === proposedGroupId) {
      continue;
    }

    if (currentMembership?.starts_on === params.nextWeekStart) {
      continue;
    }

    insert.push({
      student_id: studentId,
      group_id: proposedGroupId,
      starts_on: params.nextWeekStart
    });
  }

  return {
    close: close.sort((a, b) => a.id.localeCompare(b.id)),
    insert: insert.sort(
      (a, b) =>
        a.student_id.localeCompare(b.student_id) ||
        a.group_id.localeCompare(b.group_id) ||
        a.starts_on.localeCompare(b.starts_on)
    ),
    replace: replace.sort(
      (a, b) =>
        a.id.localeCompare(b.id) ||
        a.student_id.localeCompare(b.student_id) ||
        a.group_id.localeCompare(b.group_id)
    )
  };
}

export function generateTeacherRotationAssignments(params: {
  groups: readonly RotationGroup[];
  teachers: readonly RotationTeacher[];
  priorAssignments: readonly PriorTeacherAssignment[];
  weekStart: string;
}): TeacherRotationPlan {
  const groups = sortOrdered(params.groups);
  const availableTeachers = sortOrdered(params.teachers).filter((teacher) => teacher.available);
  const groupIndexById = new Map(groups.map((group, index) => [group.id, index]));
  const assignedGroupIds = new Set<string>();
  const assignments: PlannedTeacherAssignment[] = [];
  const unassignedTeacherIds: string[] = [];
  const warnings: TeacherRotationWarning[] = [];

  if (groups.length === 0) {
    if (availableTeachers.length > 0) {
      unassignedTeacherIds.push(...availableTeachers.map((teacher) => teacher.id));
    }

    warnings.push({
      code: "NO_GROUPS",
      message: "No active groups were provided for this cohort.",
      teacher_ids: unassignedTeacherIds
    });

    return {
      assignments,
      unassigned_group_ids: [],
      unassigned_teacher_ids: unassignedTeacherIds,
      warnings
    };
  }

  availableTeachers.forEach((teacher, teacherIndex) => {
    if (assignedGroupIds.size === groups.length) {
      unassignedTeacherIds.push(teacher.id);
      return;
    }

    const currentWeekAssignment = currentWeekAssignmentForTeacher(
      teacher.id,
      params.priorAssignments,
      groupIndexById,
      params.weekStart
    );

    if (currentWeekAssignment && !assignedGroupIds.has(currentWeekAssignment.group_id)) {
      assignedGroupIds.add(currentWeekAssignment.group_id);
      assignments.push({
        group_id: currentWeekAssignment.group_id,
        teacher_id: teacher.id,
        week_start: params.weekStart
      });
      return;
    }

    const latestAssignment = latestPriorAssignmentForTeacher(
      teacher.id,
      params.priorAssignments,
      groupIndexById,
      params.weekStart
    );
    const startIndex = latestAssignment
      ? ((groupIndexById.get(latestAssignment.group_id) ?? -1) + 1) % groups.length
      : teacherIndex % groups.length;

    for (let offset = 0; offset < groups.length; offset += 1) {
      const candidate = groups[(startIndex + offset) % groups.length];

      if (!assignedGroupIds.has(candidate.id)) {
        assignedGroupIds.add(candidate.id);
        assignments.push({
          group_id: candidate.id,
          teacher_id: teacher.id,
          week_start: params.weekStart
        });
        return;
      }
    }

    unassignedTeacherIds.push(teacher.id);
  });

  const unassignedGroupIds = groups
    .map((group) => group.id)
    .filter((groupId) => !assignedGroupIds.has(groupId));

  if (unassignedGroupIds.length > 0) {
    warnings.push({
      code: "UNASSIGNED_GROUPS",
      message: "There are fewer available teachers than groups for this week.",
      group_ids: unassignedGroupIds
    });
  }

  if (unassignedTeacherIds.length > 0) {
    warnings.push({
      code: "EXTRA_TEACHERS",
      message: "There are more available teachers than groups for this week.",
      teacher_ids: unassignedTeacherIds
    });
  }

  return {
    assignments,
    unassigned_group_ids: unassignedGroupIds,
    unassigned_teacher_ids: unassignedTeacherIds,
    warnings
  };
}

export function buildTeacherRotationPersistencePlan(params: {
  groups: readonly RotationGroup[];
  teachers: readonly RotationTeacher[];
  priorAssignments: readonly PriorTeacherAssignment[];
  weekStart: string;
}): TeacherRotationPersistencePlan {
  const rotationPlan = generateTeacherRotationAssignments(params);
  const assignedGroupIds = new Set(rotationPlan.assignments.map((assignment) => assignment.group_id));
  const orderedGroups = sortOrdered(params.groups);

  return {
    rotationPlan,
    assignmentUpserts: rotationPlan.assignments,
    assignmentDeactivations: orderedGroups
      .filter((group) => !assignedGroupIds.has(group.id))
      .map((group) => ({
        group_id: group.id,
        week_start: params.weekStart
      })),
    run: {
      available_teacher_count: params.teachers.filter((teacher) => teacher.available).length,
      group_count: orderedGroups.length,
      assigned_count: rotationPlan.assignments.length,
      warning_count: rotationPlan.warnings.length
    }
  };
}
