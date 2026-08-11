"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowsOut,
  CircleNotch,
  DownloadSimple,
  File,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import {
  formatWeeklyPlanFileSize,
  clampWeeklyPlanZoom,
  WEEKLY_PLAN_MAX_ZOOM,
  WEEKLY_PLAN_MIN_ZOOM,
  weeklyPlanPinchZoom,
  weeklyPlanPreviewKind,
  weeklyPlanTypeLabel
} from "@/lib/admin-student-halaqa-plan";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";
import type { WeeklyPlan } from "@/lib/types";

const ZOOM_STEP = 25;

function IconButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function WeeklyPlanViewer({
  plan,
  previewUrl,
  downloadUrl,
  onClose,
  restoreFocusRef
}: {
  plan: WeeklyPlan;
  previewUrl: string | null;
  downloadUrl: string | null;
  onClose: () => void;
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const previewKind = weeklyPlanPreviewKind(plan.file_type);
  const fileSize = formatWeeklyPlanFileSize(plan.file_size);
  const pointerState = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    pinchDistance: 0,
    pinchZoom: 100
  });

  const close = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }, [onClose, restoreFocusRef]);

  const loadPreview = useCallback(async (signal: AbortSignal) => {
    if (previewKind === "unsupported" || !previewUrl) {
      setLoadState("error");
      return;
    }

    setLoadState("loading");
    setObjectUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });

    try {
      const response = await fetch(previewUrl, {
        cache: "no-store",
        credentials: "same-origin",
        signal
      });
      if (!response.ok) throw new Error("preview unavailable");
      const blob = await response.blob();
      if (!blob.size) throw new Error("empty preview");
      const nextObjectUrl = URL.createObjectURL(blob);
      if (signal.aborted) {
        URL.revokeObjectURL(nextObjectUrl);
        return;
      }
      setObjectUrl(nextObjectUrl);
      setLoadState("ready");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setLoadState("error");
    }
  }, [previewKind, previewUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadPreview(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadPreview]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const inerted = [...document.body.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialog));
    const previouslyInert = new Set(inerted.filter((element) => element.inert));
    inerted.forEach((element) => { element.inert = true; });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog!.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      inerted.forEach((element) => {
        if (!previouslyInert.has(element)) element.inert = false;
      });
    };
  }, [close]);

  function updateZoom(nextZoom: number) {
    setZoom(clampWeeklyPlanZoom(nextZoom));
  }

  function fitPreview() {
    setZoom(100);
    if (scrollerRef.current) {
      scrollerRef.current.scrollLeft = 0;
      scrollerRef.current.scrollTop = 0;
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointerState.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    const values = [...pointerState.current.pointers.values()];
    if (values.length === 2) {
      pointerState.current.pinchDistance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      pointerState.current.pinchZoom = zoom;
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointerState.current.pointers.get(event.pointerId);
    if (!previous) return;
    pointerState.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = [...pointerState.current.pointers.values()];

    if (values.length === 2 && pointerState.current.pinchDistance > 0) {
      const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      updateZoom(weeklyPlanPinchZoom(
        pointerState.current.pinchZoom,
        pointerState.current.pinchDistance,
        distance
      ));
      return;
    }

    if (values.length === 1 && zoom > 100 && scrollerRef.current) {
      scrollerRef.current.scrollLeft -= event.clientX - previous.x;
      scrollerRef.current.scrollTop -= event.clientY - previous.y;
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointerState.current.pointers.delete(event.pointerId);
    if (pointerState.current.pointers.size < 2) pointerState.current.pinchDistance = 0;
  }

  const metadata = [weeklyPlanTypeLabel(plan.file_type), fileSize].filter(Boolean).join(" · ");

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/45 md:flex md:items-center md:justify-center md:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && window.matchMedia("(min-width: 768px)").matches) close();
      }}
    >
      <div
        aria-describedby="weekly-plan-viewer-description"
        aria-labelledby="weekly-plan-viewer-title"
        aria-modal="true"
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl md:h-[min(86dvh,900px)] md:max-w-5xl md:rounded-xl"
        ref={dialogRef}
        role="dialog"
      >
        <header className="shrink-0 border-b border-stone-200 bg-white">
          <div className="flex min-h-16 items-center gap-3 bg-ink px-4 text-white md:min-h-[76px] md:bg-white md:px-6 md:text-ink">
            <button
              aria-label="Close weekly plan viewer"
              className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-white/10 md:order-last md:hover:bg-stone-100"
              onClick={close}
              ref={closeButtonRef}
              type="button"
            >
              <X aria-hidden="true" className="size-6" />
            </button>
            <div className="min-w-0 flex-1 md:order-first">
              <h2 className="truncate text-base font-semibold sm:text-lg" id="weekly-plan-viewer-title">{plan.file_name}</h2>
              <p className="mt-0.5 hidden text-sm text-stone-600 md:block" id="weekly-plan-viewer-description">{metadata} · Uploaded {formatDateTimeInAppTimeZone(plan.uploaded_at)}</p>
            </div>
            {downloadUrl ? (
              <a aria-label="Download weekly plan" className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-white/10 md:hidden" href={downloadUrl}>
                <DownloadSimple aria-hidden="true" className="size-6" />
              </a>
            ) : null}
            <div className="hidden items-center gap-1 md:flex">
              <IconButton disabled={zoom <= WEEKLY_PLAN_MIN_ZOOM} label="Zoom out" onClick={() => updateZoom(zoom - ZOOM_STEP)}><MagnifyingGlassMinus className="size-5" /></IconButton>
              <span className="w-14 text-center text-sm font-medium" aria-live="polite">{zoom}%</span>
              <IconButton disabled={zoom >= WEEKLY_PLAN_MAX_ZOOM} label="Zoom in" onClick={() => updateZoom(zoom + ZOOM_STEP)}><MagnifyingGlassPlus className="size-5" /></IconButton>
              <IconButton label="Fit preview" onClick={fitPreview}><ArrowsOut className="size-5" /></IconButton>
              {previewUrl ? <a aria-label="Open weekly plan in new tab" className="flex size-11 items-center justify-center rounded-md hover:bg-stone-100" href={previewUrl} rel="noreferrer" target="_blank"><ArrowSquareOut className="size-5" /></a> : null}
              {downloadUrl ? <a aria-label="Download weekly plan" className="flex size-11 items-center justify-center rounded-md hover:bg-stone-100" href={downloadUrl}><DownloadSimple className="size-5" /></a> : null}
            </div>
          </div>

          <div className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm text-stone-600 md:hidden">
            <span>{metadata}</span>
            {previewUrl ? <a className="inline-flex min-h-11 items-center gap-2 font-medium text-moss" href={previewUrl} rel="noreferrer" target="_blank">Open in new tab <ArrowSquareOut aria-hidden="true" className="size-5" /></a> : null}
          </div>
          <div className="flex min-h-14 items-center justify-around border-t border-stone-200 px-2 md:hidden">
            <IconButton disabled={zoom <= WEEKLY_PLAN_MIN_ZOOM} label="Zoom out" onClick={() => updateZoom(zoom - ZOOM_STEP)}><MagnifyingGlassMinus className="size-6" /></IconButton>
            <span className="w-14 text-center font-medium" aria-live="polite">{zoom}%</span>
            <IconButton disabled={zoom >= WEEKLY_PLAN_MAX_ZOOM} label="Zoom in" onClick={() => updateZoom(zoom + ZOOM_STEP)}><MagnifyingGlassPlus className="size-6" /></IconButton>
            <button className="min-h-11 rounded-md px-3 font-medium hover:bg-stone-100" onClick={fitPreview} type="button">Fit</button>
            <span className="border-l border-stone-200 pl-5 text-sm text-stone-600">{previewKind === "pdf" ? "PDF pages" : "Image"}</span>
          </div>
        </header>

        <div
          className="relative min-h-0 flex-1 overflow-auto bg-stone-100 p-4 sm:p-8"
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          ref={scrollerRef}
          style={{ touchAction: zoom > 100 ? "none" : "pan-x pan-y" }}
        >
          {loadState === "loading" ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-stone-600" role="status">
              <CircleNotch aria-hidden="true" className="size-8 animate-spin motion-reduce:animate-none" />
              <p className="mt-3 font-medium">Loading weekly plan…</p>
            </div>
          ) : null}

          {loadState === "error" ? (
            <div className="mx-auto flex h-full min-h-64 max-w-lg flex-col items-center justify-center text-center">
              <WarningCircle aria-hidden="true" className="size-12 text-amber-700" />
              <h3 className="mt-4 text-lg font-semibold text-ink">{previewKind === "unsupported" ? "Preview not supported" : "Preview unavailable"}</h3>
              <p className="mt-2 text-sm text-stone-600">{previewKind === "unsupported" ? "This file type cannot be shown in the browser. You can still download the original file." : "The plan could not be loaded. Try again or download the original file."}</p>
              <div className="mt-5 flex w-full max-w-xs flex-col gap-3 sm:flex-row sm:justify-center">
                {previewKind !== "unsupported" ? <button className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss" onClick={() => { const controller = new AbortController(); void loadPreview(controller.signal); }} type="button"><ArrowClockwise aria-hidden="true" className="size-5" />Try again</button> : null}
                {downloadUrl ? <a className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white" href={downloadUrl}><DownloadSimple aria-hidden="true" className="size-5" />Download</a> : null}
              </div>
            </div>
          ) : null}

          {loadState === "ready" && objectUrl && previewKind === "image" ? (
            <div className="mx-auto flex min-h-full items-start justify-center" style={{ width: `${zoom}%` }}>
              {/* The source is the authenticated, object-backed preview response. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={`Weekly plan: ${plan.file_name}`} className="h-auto w-full max-w-none bg-white shadow-md" src={objectUrl} />
            </div>
          ) : null}

          {loadState === "ready" && objectUrl && previewKind === "pdf" ? (
            <div className="mx-auto h-full min-h-[620px]" style={{ width: `${zoom}%` }}>
              <iframe className="h-full min-h-[620px] w-full border-0 bg-white shadow-md" src={objectUrl} title={`PDF preview of ${plan.file_name}`} />
            </div>
          ) : null}
        </div>

        <footer className="hidden min-h-14 shrink-0 items-center justify-between border-t border-stone-200 bg-white px-6 text-sm text-stone-600 md:flex">
          <span>{previewKind === "pdf" ? "Page controls are available inside the PDF preview." : "Image preview"}</span>
          <span>{zoom > 100 ? "Drag to pan while zoomed" : "Use zoom controls to inspect the plan"}</span>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export default function WeeklyPlanPanel({
  plan,
  previewUrl,
  downloadUrl
}: {
  plan: WeeklyPlan | null;
  previewUrl: string | null;
  downloadUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!plan) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center px-2 py-10 text-center">
        <File aria-hidden="true" className="size-14 text-stone-400" />
        <p className="mt-4 font-semibold text-ink">No plan uploaded for this week.</p>
        <p className="mt-2 text-sm text-stone-600">Students upload their own weekly plans.</p>
      </div>
    );
  }

  const typeLabel = weeklyPlanTypeLabel(plan.file_type);
  const fileSize = formatWeeklyPlanFileSize(plan.file_size);
  const metadata = [typeLabel, fileSize].filter(Boolean).join(" · ");

  return (
    <div className="mt-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-moss"><File aria-hidden="true" className="size-6" /></span>
        <div className="min-w-0">
          <p className="break-words font-semibold text-ink">{plan.file_name}</p>
          <p className="mt-1 text-sm text-stone-600">{metadata}</p>
          <p className="mt-1 text-sm text-stone-600">Uploaded {formatDateTimeInAppTimeZone(plan.uploaded_at)}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          className="min-h-11 w-full rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink sm:w-auto"
          onClick={() => setOpen(true)}
          ref={triggerRef}
          type="button"
        >
          View plan
        </button>
        {downloadUrl ? <a className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-moss bg-white px-5 py-2.5 text-sm font-semibold text-moss hover:bg-emerald-50 sm:w-auto" href={downloadUrl}><DownloadSimple aria-hidden="true" className="size-5" />Download</a> : null}
      </div>
      <p className="mt-4 text-sm text-stone-500">Read-only. Students manage their own weekly-plan uploads.</p>
      {open ? (
        <WeeklyPlanViewer
          downloadUrl={downloadUrl}
          onClose={() => setOpen(false)}
          plan={plan}
          previewUrl={previewUrl}
          restoreFocusRef={triggerRef}
        />
      ) : null}
    </div>
  );
}
