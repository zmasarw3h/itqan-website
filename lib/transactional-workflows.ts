export type TransactionalWorkflowError = {
  code?: string | null;
  message?: string | null;
};

export type TransactionalWorkflowErrorKind =
  | "stale"
  | "denied"
  | "conflict"
  | "invalid"
  | "unknown";

export function classifyTransactionalWorkflowError(
  error: TransactionalWorkflowError | null | undefined
): TransactionalWorkflowErrorKind {
  if (!error) {
    return "unknown";
  }

  if (error.code === "P0001" && /access state changed/i.test(error.message ?? "")) {
    return "stale";
  }

  if (error.code === "42501") {
    return "denied";
  }

  if (["23503", "23505", "23514", "23P01"].includes(error.code ?? "")) {
    return "conflict";
  }

  if (error.code === "22023") {
    return "invalid";
  }

  return "unknown";
}
