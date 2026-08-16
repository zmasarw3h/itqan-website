"use client";

import { useFormStatus } from "react-dom";
import { submitPartnerRecitation } from "@/app/student/actions";

function ConfirmButton() {
  const { pending } = useFormStatus();

  return (
    <button disabled={pending} type="submit">
      {pending ? "Confirming…" : "Confirm partner recitation"}
    </button>
  );
}

export default function PartnerConfirmForm() {
  return <form action={submitPartnerRecitation}><ConfirmButton /></form>;
}
