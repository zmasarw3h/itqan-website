"use client";

import { useRef, useState } from "react";
import { uploadWeeklyPlan } from "@/app/student/weekly-plan/actions";

export default function WeeklyPlanUploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  function setFiles(files: FileList | null) {
    const file = files?.item(0);
    setFileName(file?.name ?? "");

    if (file && inputRef.current) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      inputRef.current.files = transfer.files;
    }
  }

  return (
    <form action={uploadWeeklyPlan} className="mt-5 space-y-4">
      <label
        className={`block rounded-lg border-2 border-dashed bg-stone-50 p-6 text-center transition ${
          isDragging ? "border-moss bg-green-50" : "border-stone-300"
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
        <span className="mt-2 block text-sm text-stone-600">PNG, JPG, or PDF up to 1 MB.</span>
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
      {fileName ? <p className="text-sm text-stone-700">Selected: {fileName}</p> : null}
      <button className="w-full rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink sm:w-auto">
        Upload weekly plan
      </button>
    </form>
  );
}
