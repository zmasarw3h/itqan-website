"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Buildings,
  CalendarBlank,
  ChalkboardTeacher,
  CheckCircle,
  ShieldCheck,
  Student,
  User,
  UserMinus
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  prepareGuidedPersonAccessChange,
  savePersonAccess,
  type GuidedChangePreparation
} from "@/app/super-admin/actions";
import {
  operationLabelForSnapshot,
  type GuidedAccessOperation,
  type GuidedAccessSnapshot,
  type GuidedChangeReview
} from "@/lib/super-admin-guided-change";
import { staffAccessLabel, staffMembershipIsActiveOn } from "@/lib/super-admin-access";
import type { StaffRole } from "@/lib/types";

const STEPS = ["Choose operation", "Choose scope", "Set effective date", "Review"] as const;

const OPERATION_COPY: Record<
  GuidedAccessOperation,
  { description: string; icon: typeof ChalkboardTeacher }
> = {
  add_teacher: {
    description: "Add teaching capability at one masjid while preserving existing admin access.",
    icon: ChalkboardTeacher
  },
  add_admin: {
    description: "Add management capability at one masjid while preserving existing teacher access.",
    icon: ShieldCheck
  },
  add_admin_teacher: {
    description: "Ensure both admin and teacher capability at one masjid.",
    icon: Buildings
  },
  assign_student: {
    description: "Assign or move the person into a student group at a Sunday tracker boundary.",
    icon: Student
  },
  deactivate_account: {
    description: "Stop application access and close all open memberships without deleting history.",
    icon: UserMinus
  }
};

function profileRoleLabel(role: GuidedAccessSnapshot["profile"]["role"]) {
  if (role === "super_admin") return "Super admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function staffByMasjid(snapshot: GuidedAccessSnapshot, date: string) {
  const byMasjid = new Map<string, { name: string; roles: Set<StaffRole> }>();

  for (const membership of snapshot.staffMemberships) {
    if (!staffMembershipIsActiveOn(membership, date)) continue;
    const existing = byMasjid.get(membership.masjid_id) ?? {
      name: membership.masjid_name,
      roles: new Set<StaffRole>()
    };
    existing.roles.add(membership.staff_role);
    byMasjid.set(membership.masjid_id, existing);
  }

  return byMasjid;
}

function accessLabel(roles: Set<StaffRole>) {
  return staffAccessLabel({ hasAdmin: roles.has("admin"), hasTeacher: roles.has("teacher") });
}

function Progress({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  return (
    <ol aria-label="Change progress" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const complete = number < step;
        const current = number === step;
        const canEdit = number < step;

        return (
          <li key={label}>
            <button
              aria-current={current ? "step" : undefined}
              className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                current
                  ? "border-moss bg-moss text-white"
                  : complete
                    ? "border-green-200 bg-green-50 text-green-900 hover:border-green-300"
                    : "border-stone-200 bg-white text-stone-500"
              }`}
              disabled={!canEdit}
              onClick={() => onStep(number)}
              type="button"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current" aria-hidden="true">
                {complete ? <CheckCircle size={17} weight="fill" /> : number}
              </span>
              <span>{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function OperationStep({
  operation,
  onChange,
  snapshot,
  today
}: {
  operation: GuidedAccessOperation | null;
  onChange: (operation: GuidedAccessOperation) => void;
  snapshot: GuidedAccessSnapshot;
  today: string;
}) {
  return (
    <fieldset>
      <legend className="text-xl font-semibold text-ink">What needs to change?</legend>
      <p className="mt-1 text-sm text-stone-600">
        Choose one operation. The next steps show only the scope and confirmations that operation needs.
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {(Object.keys(OPERATION_COPY) as GuidedAccessOperation[]).map((value) => {
          const copy = OPERATION_COPY[value];
          const Icon = copy.icon;
          const selected = value === operation;

          return (
            <label
              className={`flex min-h-24 cursor-pointer items-start gap-4 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-moss focus-within:ring-offset-2 ${
                selected ? "border-moss bg-green-50/60" : "border-stone-200 bg-white hover:border-stone-300"
              }`}
              key={value}
            >
              <input
                checked={selected}
                className="sr-only"
                name="operation_choice"
                onChange={() => onChange(value)}
                type="radio"
                value={value}
              />
              <span className={`rounded-lg p-2 ${selected ? "bg-moss text-white" : "bg-stone-100 text-moss"}`}>
                <Icon aria-hidden="true" size={22} weight="duotone" />
              </span>
              <span>
                <span className="block font-semibold text-ink">
                  {operationLabelForSnapshot(snapshot, value, today)}
                </span>
                <span className="mt-1 block text-sm leading-5 text-stone-600">{copy.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ScopeStep({
  operation,
  masjidId,
  groupId,
  onMasjidChange,
  onGroupChange,
  snapshot,
  today
}: {
  operation: GuidedAccessOperation;
  masjidId: string;
  groupId: string;
  onMasjidChange: (id: string) => void;
  onGroupChange: (id: string) => void;
  snapshot: GuidedAccessSnapshot;
  today: string;
}) {
  const currentStaff = staffByMasjid(snapshot, today);
  const availableGroups = snapshot.groups.filter((group) => group.masjid_id === masjidId);

  if (operation === "deactivate_account") {
    return (
      <section>
        <h2 className="text-xl font-semibold text-ink">This is an account-wide operation</h2>
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-900">Entire account and all open access</p>
          <p className="mt-1 text-sm leading-6 text-red-800">
            The review will list every student and staff membership that would close. No masjid is selected here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xl font-semibold text-ink">
        {operation === "assign_student" ? "Choose the student placement" : "Choose the masjid scope"}
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        {operation === "assign_student"
          ? "Select a masjid first; only groups inside that masjid will be offered."
          : "Access at every other masjid remains outside this operation."}
      </p>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-ink">Masjid</legend>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {snapshot.masjids.map((masjid) => {
            const access = currentStaff.get(masjid.id);
            const selected = masjid.id === masjidId;

            return (
              <label
                className={`cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-moss focus-within:ring-offset-2 ${
                  selected ? "border-moss bg-green-50/60" : "border-stone-200 bg-white hover:border-stone-300"
                }`}
                key={masjid.id}
              >
                <input
                  checked={selected}
                  className="sr-only"
                  name="masjid_choice"
                  onChange={() => onMasjidChange(masjid.id)}
                  type="radio"
                  value={masjid.id}
                />
                <span className="block font-semibold text-ink">{masjid.name}</span>
                <span className="mt-1 block text-sm text-stone-600">
                  {access ? accessLabel(access.roles) : "No staff access"}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {operation === "assign_student" ? (
        <fieldset className="mt-6" disabled={!masjidId}>
          <legend className="text-sm font-semibold text-ink">Student group</legend>
          {!masjidId ? (
            <p className="mt-2 rounded-lg bg-stone-50 p-4 text-sm text-stone-600">Choose a masjid to see its groups.</p>
          ) : availableGroups.length === 0 ? (
            <p className="mt-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
              This masjid has no active student groups.
            </p>
          ) : (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {availableGroups.map((group) => {
                const selected = group.id === groupId;

                return (
                  <label
                    className={`cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-moss focus-within:ring-offset-2 ${
                      selected ? "border-moss bg-green-50/60" : "border-stone-200 bg-white hover:border-stone-300"
                    }`}
                    key={group.id}
                  >
                    <input
                      checked={selected}
                      className="sr-only"
                      name="group_choice"
                      onChange={() => onGroupChange(group.id)}
                      type="radio"
                      value={group.id}
                    />
                    <span className="block font-semibold text-ink">{group.name}</span>
                    <span className="mt-1 block text-sm text-stone-600">{group.cohort_name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      ) : null}
    </section>
  );
}

function DateStep({
  operation,
  startsOn,
  onChange,
  today
}: {
  operation: GuidedAccessOperation;
  startsOn: string;
  onChange: (date: string) => void;
  today: string;
}) {
  const studentOperation = operation === "assign_student";
  const deactivation = operation === "deactivate_account";

  return (
    <section>
      <h2 className="text-xl font-semibold text-ink">When should this take effect?</h2>
      <p className="mt-1 text-sm text-stone-600">
        Dates use the configured Toronto application day and its 1:00 AM rollover.
      </p>
      <label className="mt-5 block max-w-md">
        <span className="text-sm font-semibold text-ink">
          {deactivation ? "Stops on" : "Starts on"}
        </span>
        <span className="relative mt-2 block">
          <CalendarBlank aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-stone-500" size={20} />
          <input
            className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-11 pr-3 text-ink focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/20"
            max={deactivation ? today : undefined}
            min={today}
            onInput={(event) => onChange(event.currentTarget.value)}
            required
            type="date"
            value={startsOn}
          />
        </span>
      </label>
      <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
        {studentOperation ? (
          <p>Normal student placement changes must start on a Sunday tracker-week boundary.</p>
        ) : deactivation ? (
          <p>Account deactivation is immediate. Future-dated global deactivation is not supported.</p>
        ) : (
          <p>
            Future membership-only additions are allowed when the person’s global default role remains coherent. A role-changing conversion must use today ({today}).
          </p>
        )}
      </div>
    </section>
  );
}

function ReviewTable({ review }: { review: GuidedChangeReview }) {
  if (review.rows.length === 0) return null;

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-stone-200">
      <ul className="divide-y divide-stone-200" aria-label="Before and after access changes">
        {review.rows.map((row) => (
          <li
            className="bg-white px-4 py-4"
            key={row.id}
          >
            <dl className="grid gap-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-5">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Change</dt>
                <dd className="mt-1 font-semibold text-ink">{row.label}</dd>
                {row.detail ? <dd className="mt-1 text-xs text-stone-500">{row.detail}</dd> : null}
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Current</dt>
                <dd className="mt-1 text-sm leading-6 text-stone-700">{row.current}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">After</dt>
                <dd className="mt-1 text-sm font-medium leading-6 text-green-900">{row.after}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:cursor-not-allowed disabled:bg-stone-300"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Applying change…" : label}
      {!pending ? <ArrowRight aria-hidden="true" size={18} /> : null}
    </button>
  );
}

function ReviewStep({
  review,
  snapshot,
  requestId,
  preparationMessage
}: {
  review: GuidedChangeReview;
  snapshot: GuidedAccessSnapshot;
  requestId: string | null;
  preparationMessage: string | null;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">{review.title}</h2>
          <p className="mt-1 text-sm text-stone-600">{review.timingLabel}</p>
        </div>
        <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">
          {review.operationLabel}
        </span>
      </div>

      <dl className="mt-5 grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-stone-500">Operation</dt>
          <dd className="mt-1 font-semibold text-ink">{review.operationLabel}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Scope</dt>
          <dd className="mt-1 font-semibold text-ink">{review.scopeLabel}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Effective date</dt>
          <dd className="mt-1 font-semibold text-ink">{review.dateLabel}</dd>
        </div>
      </dl>

      {review.blockers.length > 0 ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
          <p className="font-semibold">This change cannot be applied yet</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {review.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      ) : null}

      {!requestId && review.blockers.length === 0 ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
          {preparationMessage ?? "The reviewed change could not be secured for submission. Review it again."}
        </div>
      ) : null}

      {review.warnings.length > 0 ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Important impact</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {review.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      <ReviewTable review={review} />

      {review.unchanged.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">What stays unchanged</h3>
          <ul className="mt-2 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
            {review.unchanged.map((item) => (
              <li className="flex gap-2 rounded-lg bg-stone-50 p-3" key={item}>
                <CheckCircle aria-hidden="true" className="mt-0.5 shrink-0 text-green-700" size={17} weight="fill" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {requestId ? (
        <form action={savePersonAccess} className="mt-6 border-t border-stone-200 pt-5">
          <input name="person_id" type="hidden" value={snapshot.profile.id} />
          <input name="request_id" type="hidden" value={requestId} />
          <input name="guided_change" type="hidden" value="true" />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Confirm person name</span>
              <input
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/20"
                name="confirmation_name"
                placeholder={review.personConfirmation}
                required
              />
            </label>
            {review.adminMasjidConfirmation ? (
              <label className="block">
                <span className="text-sm font-semibold text-ink">Confirm affected admin masjid name</span>
                <input
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/20"
                  name="confirmation_masjid"
                  placeholder={review.adminMasjidConfirmation}
                  required
                />
                <span className="mt-1 block text-xs text-stone-500">
                  Enter the exact text shown in the placeholder.
                </span>
              </label>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs text-stone-500">Reference: {requestId}</p>
            <SubmitButton disabled={review.blockers.length > 0} label={review.submitLabel} />
          </div>
        </form>
      ) : null}
    </section>
  );
}

function CurrentAccessSummary({ snapshot, today }: { snapshot: GuidedAccessSnapshot; today: string }) {
  const staff = staffByMasjid(snapshot, today);
  const student = snapshot.studentMemberships.find(
    (membership) => membership.starts_on <= today && (!membership.ends_on || membership.ends_on >= today)
  );

  return (
    <aside className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm lg:sticky lg:top-5 lg:self-start">
      <div className="flex items-center gap-2">
        <User aria-hidden="true" className="text-moss" size={20} weight="duotone" />
        <h2 className="font-semibold text-ink">Current access</h2>
      </div>
      <dl className="mt-4 border-b border-stone-200 pb-4 text-sm">
        <dt className="text-stone-500">Global default role</dt>
        <dd className="mt-1 font-semibold text-ink">{profileRoleLabel(snapshot.profile.role)}</dd>
        <dt className="mt-3 text-stone-500">Account state</dt>
        <dd className="mt-1 font-semibold text-ink">{snapshot.profile.active ? "Active" : "Inactive"}</dd>
      </dl>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Masjid staff access</h3>
        {staff.size === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No active staff access.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {[...staff.entries()].map(([id, access]) => (
              <li className="rounded-lg bg-stone-50 p-3" key={id}>
                <p className="text-sm font-semibold text-ink">{access.name}</p>
                <p className="mt-1 text-xs text-stone-600">{accessLabel(access.roles)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 border-t border-stone-200 pt-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          <Student aria-hidden="true" size={16} /> Student placement
        </h3>
        <p className="mt-2 text-sm text-stone-700">
          {student ? `${student.group_name} · ${student.masjid_name}` : "No active student placement."}
        </p>
      </div>

      <div className="mt-4 border-t border-stone-200 pt-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          <BookOpen aria-hidden="true" size={16} /> Teacher assignments
        </h3>
        <p className="mt-2 text-sm text-stone-700">
          {snapshot.teacherAssignments.length === 0
            ? "No current or upcoming assignments."
            : `${snapshot.teacherAssignments.length} current or upcoming assignment${snapshot.teacherAssignments.length === 1 ? "" : "s"}.`}
        </p>
      </div>
    </aside>
  );
}

export function GuidedAccessChange({
  snapshot,
  today
}: {
  snapshot: GuidedAccessSnapshot;
  today: string;
}) {
  const [step, setStep] = useState(1);
  const [operation, setOperation] = useState<GuidedAccessOperation | null>(null);
  const [masjidId, setMasjidId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [preparation, setPreparation] = useState<GuidedChangePreparation | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function chooseOperation(nextOperation: GuidedAccessOperation) {
    setOperation(nextOperation);
    setMasjidId("");
    setGroupId("");
    setPreparation(null);
  }

  function chooseMasjid(id: string) {
    setMasjidId(id);
    setGroupId("");
    setPreparation(null);
  }

  async function prepareReview() {
    if (!operation || !startsOn) return;
    const formData = new FormData();
    formData.set("person_id", snapshot.profile.id);
    formData.set("access_operation", operation);
    formData.set("starts_on", startsOn);
    formData.set("masjid_id", masjidId);
    formData.set("group_id", groupId);
    setIsPreparing(true);

    try {
      const result = await prepareGuidedPersonAccessChange(formData);
      setPreparation(result);
      setStep(4);
    } finally {
      setIsPreparing(false);
    }
  }

  const scopeReady = operation === "deactivate_account" || Boolean(masjidId && (operation !== "assign_student" || groupId));
  const canContinue =
    (step === 1 && Boolean(operation)) ||
    (step === 2 && scopeReady) ||
    (step === 3 && Boolean(startsOn));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)]">
      <div className="min-w-0">
        <Progress onStep={setStep} step={step} />
        <div
          aria-labelledby="guided-step-heading"
          className="mt-5 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7"
          ref={headingRef}
          tabIndex={-1}
        >
          <span className="sr-only" id="guided-step-heading">{STEPS[step - 1]}</span>
          {step === 1 ? (
            <OperationStep operation={operation} onChange={chooseOperation} snapshot={snapshot} today={today} />
          ) : null}
          {step === 2 && operation ? (
            <ScopeStep
              groupId={groupId}
              masjidId={masjidId}
              onGroupChange={setGroupId}
              onMasjidChange={chooseMasjid}
              operation={operation}
              snapshot={snapshot}
              today={today}
            />
          ) : null}
          {step === 3 && operation ? (
            <DateStep
              onChange={(date) => {
                setStartsOn(date);
                setPreparation(null);
              }}
              operation={operation}
              startsOn={startsOn}
              today={today}
            />
          ) : null}
          {step === 4 && preparation?.review ? (
            <ReviewStep
              preparationMessage={preparation.message}
              requestId={preparation.requestId}
              review={preparation.review}
              snapshot={preparation.snapshot ?? snapshot}
            />
          ) : null}
          {step === 4 && !preparation?.review ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
              {preparation?.message ?? "The reviewed change could not be prepared. Return to the previous step and try again."}
            </div>
          ) : null}

          {step < 4 ? (
            <div className="mt-7 flex flex-col-reverse justify-between gap-3 border-t border-stone-200 pt-5 sm:flex-row">
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:invisible"
                disabled={step === 1}
                onClick={() => setStep((current) => Math.max(1, current - 1))}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={18} /> Back
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:cursor-not-allowed disabled:bg-stone-300"
                disabled={!canContinue || isPreparing}
                onClick={() => {
                  if (step === 3) {
                    void prepareReview();
                  } else {
                    setStep((current) => Math.min(3, current + 1));
                  }
                }}
                type="button"
              >
                {isPreparing ? "Preparing review…" : "Continue"} <ArrowRight aria-hidden="true" size={18} />
              </button>
            </div>
          ) : (
            <div className="mt-5">
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50"
                onClick={() => {
                  setPreparation(null);
                  setStep(2);
                }}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={18} /> Edit scope or date
              </button>
            </div>
          )}
        </div>
      </div>
      <CurrentAccessSummary snapshot={preparation?.snapshot ?? snapshot} today={today} />
    </div>
  );
}
