"use client";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { uploadWeeklyPlan } from "@/app/student/weekly-plan/actions";
import { validateWeeklyPlanFile, WEEKLY_PLAN_MAX_SIZE_LABEL } from "@/lib/weekly-plans";

export default function WeeklyPlanUploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  function setFiles(files: FileList | null) {
    const file = files?.item(0);
    const validationError = validateWeeklyPlanFile(file ?? null);

    setFileName(file?.name ?? "");
    setFileError(validationError ?? "");

    if (!inputRef.current) {
      return;
    }

    if (file && !validationError) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      inputRef.current.files = transfer.files;
      return;
    }

    inputRef.current.value = "";
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const file = inputRef.current?.files?.item(0) ?? null;
    const validationError = validateWeeklyPlanFile(file);

    if (validationError) {
      event.preventDefault();
      setFileError(validationError);
    }
  }

  return (
    <form action={uploadWeeklyPlan} className="mt-5 space-y-4" onSubmit={handleSubmit}>
      <label
        className={`block rounded-lg border-2 border-dashed bg-stone-50 p-6 text-center transition ${
          fileError ? "border-red-300 bg-red-50" : isDragging ? "border-moss bg-green-50" : "border-stone-300"
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          setFiles(event.dataTransfer.files);
        }}
      >
        <span className="block text-base font-medium text-ink">
          Drag and drop your weekly plan here, or choose a file.
        </span>
        <span className="mt-2 block text-sm text-stone-600">PNG, JPG, or PDF up to {WEEKLY_PLAN_MAX_SIZE_LABEL}.</span>
        <input
          accept="image/png,image/jpeg,application/pdf"
          className="sr-only"
          name="plan"
          onChange={(event) => setFiles(event.target.files)}
          ref={inputRef}
          required
          type="file"
        />
        <span className="mt-4 inline-flex rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-ink">
          Choose file
        </span>
      </label>
      {fileName ? <p className="break-words text-sm text-stone-700">Selected: {fileName}</p> : null}
      {fileError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fileError}</p> : null}
      <button
        className="w-full rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
        disabled={Boolean(fileError)}
      >
        Upload weekly plan
      </button>
    </form>
  );
}
