import { generateRotation, rebalanceStudentGroups, saveRotationSettings } from "@/app/admin/rotation/actions";
import { RotationPreviewGuard, RotationPublishButton } from "@/app/admin/rotation/availability-state";
import type { RotationContext, RotationPageData } from "@/app/admin/rotation/data";

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function PermanentGroupManagement({
  context,
  data,
  hasChanges,
  movedStudentCount,
  newGroupCount
}: {
  context: RotationContext;
  data: RotationPageData;
  hasChanges: boolean;
  movedStudentCount: number;
  newGroupCount: number;
}) {
  return <section aria-label="Permanent group management" className="mt-6 border-t border-stone-200 pt-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-semibold text-ink">Permanent group setup &amp; balancing</h3><p className="mt-1 max-w-3xl text-sm text-stone-600">This is a separate administrative operation. It changes normal memberships for future weeks; it is not Saturday-only session redistribution. If it changes a draft source, refresh and review that Saturday draft before publishing.</p></div><form action={saveRotationSettings} className="flex flex-wrap items-end gap-2"><input name="masjid_id" type="hidden" value={context.masjid.id} /><input name="cohort_id" type="hidden" value={context.cohort.id} /><input name="week_start" type="hidden" value={data.selectedWeekStart} /><label className="block"><span className="text-xs font-semibold text-stone-600">Target groups</span><input className="mt-1 min-h-11 w-24 rounded-md border border-stone-300 px-3" defaultValue={data.settings?.target_group_count ?? ""} min={1} name="target_group_count" required type="number" /></label><button className="min-h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium text-ink hover:bg-stone-50">Save target</button></form></div>
    {data.rebalancePreview ? <><div className="mt-4 overflow-x-auto border-y border-stone-200"><table className="min-w-[620px] w-full divide-y divide-stone-200 text-sm"><thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Permanent group</th><th className="px-3 py-3">Current students</th><th className="px-3 py-3">After confirmed balance</th></tr></thead><tbody className="divide-y divide-stone-100">{data.rebalancePreview.groups.map((group) => <tr key={group.id}><td className="px-3 py-3 font-medium text-ink">{group.name}{group.is_new ? <span className="ml-2 rounded border border-green-300 bg-green-50 px-1.5 py-0.5 text-xs text-green-800">New</span> : null}</td><td className="px-3 py-3 text-stone-700">{group.current_student_count}</td><td className="px-3 py-3 text-stone-700">{group.proposed_student_count}</td></tr>)}</tbody></table></div>{hasChanges ? <form action={rebalanceStudentGroups} className="mt-4"><input name="masjid_id" type="hidden" value={context.masjid.id} /><input name="cohort_id" type="hidden" value={context.cohort.id} /><input name="week_start" type="hidden" value={data.selectedWeekStart} /><label className="flex items-start gap-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-3 text-sm text-amber-950"><input className="mt-0.5 size-4 shrink-0 rounded border-amber-300 text-moss" name="confirm_rebalance" required type="checkbox" value="confirmed" /><span>Confirm {countLabel(newGroupCount, "new group")} and {countLabel(movedStudentCount, "student move")} as permanent normal-membership changes. Saturday session placements are not changed by this confirmation.</span></label><button className="mt-3 min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-moss">Apply permanent student rebalance</button></form> : <p className="mt-4 border-l-4 border-green-600 bg-green-50 px-3 py-2.5 text-sm text-green-900">Permanent student groups already match this target.</p>}</> : <p className="mt-4 bg-stone-50 px-3 py-3 text-sm text-stone-600">Save a valid target group count to load the permanent balancing preview.</p>}
  </section>;
}

export function LegacyTeacherAssignmentPublication({
  availableTeacherCount,
  data,
  publishedAssignmentCount,
  publishReady,
  proposedAssignmentCount
}: {
  availableTeacherCount: number;
  data: RotationPageData;
  publishedAssignmentCount: number;
  publishReady: boolean;
  proposedAssignmentCount: number;
}) {
  return <section aria-label="Weekly teacher assignment publication" className="mt-8 border-t border-stone-200 pt-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-semibold text-ink">Weekly teacher-assignment publication</h3><p className="mt-1 max-w-3xl text-sm text-stone-600">This existing weekly teacher-assignment workflow remains available until the later teacher-authorization rollout replaces or adapts it. It is separate from Saturday primary responsibility and session-roster publishing above.</p></div><form action={generateRotation}><input name="masjid_id" type="hidden" value={data.context?.masjid.id ?? ""} /><input name="cohort_id" type="hidden" value={data.context?.cohort.id ?? ""} /><input name="week_start" type="hidden" value={data.selectedWeekStart} /><input name="request_id" type="hidden" value={data.publicationRequestId ?? ""} /><RotationPublishButton baseDisabled={!publishReady} /></form></div><p className="mt-3 text-sm text-stone-600"><span className="font-semibold text-ink">{proposedAssignmentCount}/{data.groups.length}</span> proposed · {availableTeacherCount} available · {publishedAssignmentCount} currently published</p><RotationPreviewGuard><>{data.persistencePlan?.rotationPlan.warnings.length ? <div className="mt-4 space-y-2">{data.persistencePlan.rotationPlan.warnings.map((warning) => <p className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950" key={warning.code}>{warning.message}</p>)}</div> : null}<div className="mt-4 overflow-x-auto border-y border-stone-200"><table className="min-w-[760px] w-full divide-y divide-stone-200 text-sm"><thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Group</th><th className="px-3 py-3">Students</th><th className="px-3 py-3">Current teacher</th><th className="px-3 py-3">Proposed teacher</th></tr></thead><tbody className="divide-y divide-stone-100">{data.groups.length ? data.groups.map((group) => { const current = data.assignments.find((assignment) => assignment.group_id === group.id); const proposal = data.persistencePlan?.assignmentUpserts.find((assignment) => assignment.group_id === group.id); const proposedTeacher = proposal ? data.teachers.find((teacher) => teacher.id === proposal.teacher_id) : null; return <tr key={group.id}><td className="px-3 py-3 font-medium text-ink">{group.name}</td><td className="px-3 py-3 text-stone-700">{group.student_count}</td><td className="px-3 py-3 text-stone-700">{current?.teacher_name ?? "Unassigned"}</td><td className={`px-3 py-3 font-medium ${proposedTeacher ? "text-green-800" : "text-amber-800"}`}>{proposedTeacher?.name ?? "Unassigned"}</td></tr>; }) : <tr><td className="px-3 py-4 text-stone-600" colSpan={4}>No active groups yet.</td></tr>}</tbody></table></div></></RotationPreviewGuard></section>;
}
