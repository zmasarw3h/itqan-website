export function sameTeacherSelection(
  initialTeacherIds: Iterable<string>,
  currentTeacherIds: Iterable<string>
) {
  const initial = new Set(initialTeacherIds);
  const current = new Set(currentTeacherIds);

  if (initial.size !== current.size) {
    return false;
  }

  return [...initial].every((teacherId) => current.has(teacherId));
}
