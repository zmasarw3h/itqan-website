"use client";

import { ArrowLeft, ArrowsOutLineHorizontal, DownloadSimple, Minus, Plus, X } from "@phosphor-icons/react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

type PlanViewerProps = {
  downloadUrl: string;
  fileName: string;
  fileType: string;
  previewUrl: string;
  weekLabel: string;
};

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;

function PdfDocument({ blobUrl, fit, onPageCount, zoom }: {
  blobUrl: string;
  fit: boolean;
  onPageCount: (count: number) => void;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    async function loadPdf() {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        loadingTask = pdfjs.getDocument(blobUrl);
        const loadedDocument = await loadingTask.promise;
        if (!active) return;
        setDocument(loadedDocument);
        onPageCount(loadedDocument.numPages);
        setRenderError(false);
      } catch {
        if (active) setRenderError(true);
      }
    }

    void loadPdf();
    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [blobUrl, onPageCount]);

  useEffect(() => {
    if (!document) return;
    const loadedDocument = document;
    let active = true;
    let renderTask: RenderTask | undefined;

    async function renderPdf() {
      try {
        const page = await loadedDocument.getPage(1);
        const canvas = canvasRef.current;
        const stage = canvas?.closest<HTMLElement>(".plan-viewer-stage");
        if (!canvas || !stage || !active) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = fit
          ? Math.max(240, stage.clientWidth - 32)
          : baseViewport.width * (zoom / 100);
        const viewport = page.getViewport({ scale: targetWidth / baseViewport.width });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas unavailable");
        const nextRenderTask = page.render({
          canvas,
          canvasContext: context,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
          viewport
        });
        renderTask = nextRenderTask;
        await nextRenderTask.promise;
        if (active) setRenderError(false);
      } catch (error) {
        if (active && !(error instanceof Error && error.name === "RenderingCancelledException")) {
          setRenderError(true);
        }
      }
    }

    void renderPdf();
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, fit, zoom]);

  return renderError ? (
    <div className="plan-viewer-message is-error" role="alert">We couldn&apos;t render this PDF. Download the plan to view it.</div>
  ) : (
    <canvas aria-label="Page 1 of the weekly plan PDF" ref={canvasRef} />
  );
}

export default function WeeklyPlanViewer({ downloadUrl, fileName, fileType, previewUrl, weekLabel }: PlanViewerProps) {
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [blobUrl, setBlobUrl] = useState("");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isPdf = fileType === "application/pdf";

  useEffect(() => {
    if (!open) return;
    let active = true;
    let objectUrl = "";

    fetch(previewUrl, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview unavailable");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, previewUrl]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    const background = [...document.body.children].filter((child) => !child.hasAttribute("data-plan-viewer-root")) as HTMLElement[];
    const prior = background.map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }));
    background.forEach((element) => { element.inert = true; element.setAttribute("aria-hidden", "true"); });
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      prior.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      trigger?.focus();
    };
  }, [open]);

  function changeZoom(delta: number) {
    setFit(false);
    setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + delta)));
  }

  function fitToWidth() {
    setFit(true);
    setZoom(100);
  }

  const viewer = open ? createPortal(
    <div className="plan-viewer-layer" data-plan-viewer-root>
      <div aria-labelledby="plan-viewer-title" aria-modal="true" className="plan-viewer" ref={dialogRef} role="dialog">
        <header className="plan-viewer-header">
          <button aria-label="Close plan preview" className="plan-viewer-back" onClick={() => setOpen(false)} ref={closeRef} type="button">
            <ArrowLeft aria-hidden="true" className="plan-viewer-mobile-icon" size={26} />
            <X aria-hidden="true" className="plan-viewer-desktop-icon" size={24} />
          </button>
          <div>
            <h2 id="plan-viewer-title">{fileName}</h2>
            <p>{weekLabel}</p>
          </div>
          <div className="plan-viewer-desktop-controls" aria-label="Preview controls">
            <button aria-label="Zoom out" disabled={zoom <= MIN_ZOOM && !fit} onClick={() => changeZoom(-25)} type="button"><Minus aria-hidden="true" size={20} /></button>
            <span aria-live="polite">{fit ? "Fit" : `${zoom}%`}</span>
            <button aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(25)} type="button"><Plus aria-hidden="true" size={20} /></button>
            <button onClick={fitToWidth} type="button"><ArrowsOutLineHorizontal aria-hidden="true" size={20} />Fit to width</button>
            <a aria-label="Download weekly plan" href={downloadUrl}><DownloadSimple aria-hidden="true" size={22} />Download</a>
          </div>
          <a aria-label="Download weekly plan" className="plan-viewer-mobile-download" href={downloadUrl}><DownloadSimple aria-hidden="true" size={25} /></a>
        </header>

        <div className="plan-viewer-stage">
          {loadState === "loading" ? <div className="plan-viewer-message" role="status">Loading plan preview…</div> : null}
          {loadState === "error" ? <div className="plan-viewer-message is-error" role="alert">We couldn&apos;t load this plan preview. Close the viewer and try again.</div> : null}
          {loadState === "ready" && blobUrl ? (
            <div
              className={`plan-viewer-document ${fit ? "is-fit" : ""}`}
              style={{ width: fit || isPdf ? "100%" : `${zoom * 6.2}px`, height: "auto" }}
            >
              {isPdf ? (
                <PdfDocument blobUrl={blobUrl} fit={fit} onPageCount={setPdfPageCount} zoom={zoom} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={`Preview of ${fileName}`} src={blobUrl} />
              )}
            </div>
          ) : null}
        </div>

        <footer className="plan-viewer-mobile-controls" aria-label="Preview controls">
          <button aria-label="Zoom out" disabled={zoom <= MIN_ZOOM && !fit} onClick={() => changeZoom(-25)} type="button"><Minus aria-hidden="true" size={24} /></button>
          <button onClick={fitToWidth} type="button">Fit</button>
          <button aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(25)} type="button"><Plus aria-hidden="true" size={24} /></button>
          <span aria-live="polite">{isPdf ? (pdfPageCount ? `1 of ${pdfPageCount}` : "PDF document") : `${fit ? "Fit" : `${zoom}%`}`}</span>
        </footer>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button className="weekly-plan-view-button" onClick={() => { setZoom(100); setFit(window.innerWidth <= 700); setBlobUrl(""); setPdfPageCount(0); setLoadState("loading"); setOpen(true); }} ref={triggerRef} type="button">
        View plan
      </button>
      {viewer}
    </>
  );
}
