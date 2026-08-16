"use client";

import { CloudArrowUp, File, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { uploadWeeklyPlan } from "@/app/student/weekly-plan/actions";
import { validateWeeklyPlanFile, WEEKLY_PLAN_MAX_SIZE_LABEL } from "@/lib/weekly-plans";

function SubmitButton({ replacement }: { replacement: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button className="weekly-plan-upload-submit" disabled={pending} type="submit">
      {pending ? (replacement ? "Replacing…" : "Uploading…") : (replacement ? "Replace weekly plan" : "Upload weekly plan")}
    </button>
  );
}

export default function WeeklyPlanUploadForm({ replacement = false }: { replacement?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  function setSelectedFile(nextFile: File | null) {
    const validationError = validateWeeklyPlanFile(nextFile);
    setFile(nextFile);
    setFileError(validationError ?? "");

    if (!inputRef.current) return;
    if (!nextFile || validationError) {
      inputRef.current.value = "";
      return;
    }
    if (inputRef.current.files?.[0] !== nextFile) {
      const transfer = new DataTransfer();
      transfer.items.add(nextFile);
      inputRef.current.files = transfer.files;
    }
  }

  return (
    <form action={uploadWeeklyPlan} className={`weekly-plan-upload-form ${replacement ? "is-replacement" : ""}`}>
      <label
        className={`weekly-plan-drop-zone ${fileError ? "has-error" : ""} ${isDragging ? "is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          setSelectedFile(event.dataTransfer.files.item(0));
        }}
      >
        {!file ? <CloudArrowUp aria-hidden="true" size={replacement ? 36 : 54} /> : <File aria-hidden="true" size={38} />}
        <span className="weekly-plan-drop-desktop">
          {replacement ? "Drag and drop a replacement here, or choose a file." : "Drag and drop your weekly plan here, or choose a file."}
        </span>
        <span className="weekly-plan-drop-mobile">Choose a PNG, JPG, or PDF up to {WEEKLY_PLAN_MAX_SIZE_LABEL}.</span>
        <span className="weekly-plan-file-rules">PNG, JPG, or PDF up to {WEEKLY_PLAN_MAX_SIZE_LABEL}.</span>
        <input
          accept="image/png,image/jpeg,application/pdf"
          className="sr-only"
          name="plan"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          ref={inputRef}
          required
          type="file"
        />
        {!file ? <span className="weekly-plan-choose">Choose file</span> : null}
      </label>

      {file ? (
        <div className="weekly-plan-selection">
          <div>
            <strong>{file.name}</strong>
            <span>{file.type === "application/pdf" ? "PDF" : file.type === "image/png" ? "PNG" : "JPG"} · {Math.max(1, Math.round(file.size / 1024))} KB</span>
          </div>
          <button aria-label="Remove selected file" onClick={() => setSelectedFile(null)} type="button"><X aria-hidden="true" size={20} /></button>
        </div>
      ) : null}

      <div aria-live="polite">
        {fileError ? <p className="weekly-plan-validation" role="alert">{fileError}</p> : null}
      </div>
      {file && !fileError ? <SubmitButton replacement={replacement} /> : null}
    </form>
  );
}
