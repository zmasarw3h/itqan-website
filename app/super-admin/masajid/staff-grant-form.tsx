"use client";

import { useState } from "react";
import { grantMasjidStaffAccess, previewMasjidStaffAccess, type MasjidStaffGrantPreview } from "@/app/super-admin/masajid/actions";

type Grant = "admin" | "teacher" | "admin_teacher";

function roleLabel(role: string) {
  return role === "super_admin" ? "Super admin" : role.charAt(0).toUpperCase() + role.slice(1);
}

function accessLabel(grant: Grant) {
  if (grant === "admin_teacher") return "Add admin + teacher access";
  return grant === "admin" ? "Add admin access" : "Add teacher access";
}

export function MasjidStaffGrantForm({
  masjidId,
  masjidName,
  requestId,
  defaultStartsOn
}: {
  masjidId: string;
  masjidName: string;
  requestId: string;
  defaultStartsOn: string;
}) {
  const [personQuery, setPersonQuery] = useState("");
  const [grant, setGrant] = useState<Grant>("admin_teacher");
  const [startsOn, setStartsOn] = useState(defaultStartsOn);
  const [preview, setPreview] = useState<MasjidStaffGrantPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const previewMatchesForm = Boolean(
    preview?.ok && preview.grant === grant && preview.startsOn === startsOn && preview.personName
  );

  async function previewAccess() {
    setIsPreviewing(true);
    const formData = new FormData();
    formData.set("masjid_id", masjidId);
    formData.set("person_query", personQuery);
    formData.set("staff_access", grant);
    formData.set("starts_on", startsOn);
    const result = await previewMasjidStaffAccess(formData);
    setPreview(result);
    setIsPreviewing(false);
  }

  return (
    <form action={grantMasjidStaffAccess} className="grid gap-4 border-t border-stone-200 p-4">
      <input name="masjid_id" type="hidden" value={masjidId} />
      <input name="request_id" type="hidden" value={requestId} />
      <h3 className="font-semibold text-ink">Add missing admin or teacher capability</h3>
      <p className="text-sm leading-6 text-stone-600">
        This form is additive. It never ends an existing staff capability at {masjidName} or another masjid.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink">Existing person email or phone</span>
          <input
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            name="person_query"
            onChange={(event) => {
              setPersonQuery(event.currentTarget.value);
              setPreview(null);
            }}
            required
            value={personQuery}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Access to add</span>
          <select
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
            name="staff_access"
            onChange={(event) => {
              setGrant(event.currentTarget.value as Grant);
              setPreview(null);
            }}
            value={grant}
          >
            <option value="admin">Add admin access</option>
            <option value="teacher">Add teacher access</option>
            <option value="admin_teacher">Add admin + teacher access</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Starts on</span>
          <input
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            name="starts_on"
            onChange={(event) => {
              setStartsOn(event.currentTarget.value);
              setPreview(null);
            }}
            required
            type="date"
            value={startsOn}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Confirm masjid name</span>
          <input
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            name="confirmation_masjid"
            placeholder={masjidName}
            required
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium text-ink">Confirm person name</span>
          <input autoComplete="off" className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="confirmation_name" required />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md border border-moss px-4 py-2.5 text-sm font-semibold text-moss hover:bg-green-50 disabled:cursor-not-allowed disabled:border-stone-300 disabled:text-stone-400"
          disabled={!personQuery.trim() || !startsOn || isPreviewing}
          onClick={() => void previewAccess()}
          type="button"
        >
          {isPreviewing ? "Preparing preview…" : "Preview resulting access"}
        </button>
        {preview?.ok ? (
          <span className="text-sm text-stone-600">Preview prepared for {preview.personName}.</span>
        ) : preview ? (
          <span className="text-sm text-red-700" role="alert">{preview.message}</span>
        ) : null}
      </div>

      {preview?.ok ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Masjid access now</p>
              <p className="font-semibold text-ink">{preview.currentMasjidAccess}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">After this additive grant</p>
              <p className="font-semibold text-green-900">{preview.resultingMasjidAccess}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Global role today</p>
              <p className="font-semibold text-ink">{roleLabel(preview.resultingRole)} · {preview.resultingActive ? "Active" : "Inactive"}</p>
            </div>
          </div>
          <p className="mt-3 border-t border-stone-200 pt-3">
            {preview.noOp
              ? "The selected capabilities are already present at this masjid; no mutation is needed."
              : `Adds: ${preview.addedRoles.map((role) => roleLabel(role)).join(" + ")}. ${accessLabel(grant)} remains additive and does not remove access elsewhere.`}
          </p>
          {preview.effectiveRole !== preview.resultingRole || preview.effectiveActive !== preview.resultingActive ? (
            <p className="mt-2">On {preview.startsOn}, the projected global role will be {roleLabel(preview.effectiveRole)} · {preview.effectiveActive ? "Active" : "Inactive"}.</p>
          ) : null}
        </div>
      ) : null}

      <div>
        <button
          className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink disabled:cursor-not-allowed disabled:bg-stone-300"
          disabled={!previewMatchesForm || (preview?.ok ? preview.noOp : true)}
        >
          Add staff access
        </button>
      </div>
    </form>
  );
}
