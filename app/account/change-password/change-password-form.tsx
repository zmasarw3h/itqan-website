"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/account/change-password/actions";

const initialChangePasswordState: ChangePasswordState = {
  status: "idle",
  message: ""
};

export default function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePassword, initialChangePasswordState);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-ink">New password</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
          minLength={8}
          name="new_password"
          type="password"
          autoComplete="new-password"
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Confirm new password</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
          minLength={8}
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
        />
      </label>
      {state.message ? (
        <p
          className={
            state.status === "success"
              ? "rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
              : "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          }
        >
          {state.message}
        </p>
      ) : null}
      <button
        className="rounded-md bg-moss px-4 py-2.5 font-medium text-white hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
