"use client";

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, type ReactNode } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ZoomIn,
  ZoomOut,
  Download,
  FileText,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ─── Types ──────────────────────────────────────────

interface PdfViewerProps {
  pdfUrl: string | null;
  loading: boolean;
  onTextSelect?: (text: string, before: string, after: string) => void;
  /** Extra actions appended to the end of the toolbar (Share, ZIP). */
  toolbarExtra?: ReactNode;
}

export interface PdfViewerHandle {
  saveScrollPosition: () => void;
}

/** A4-ish placeholder so a rendering page holds its space instead of popping in. */
function PageSkeleton({ width }: { width?: number }) {
  return (
    <div className="mb-3 flex justify-center" aria-hidden>
      <div
        className="animate-pulse-soft aspect-[1/1.414] w-full rounded-sm bg-bg-elevated"
        style={width ? { width } : undefined}
      />
    </div>
  );
}

const TOOLBAR_BUTTON =
  "rounded-md p-1.5 text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";

// ─── Constants ──────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const ZOOM_WHEEL_SENSITIVITY = 0.002;

function pdfNameFromUrl(pdfUrl: string | null): { name: string; path: string } | null {
  if (!pdfUrl) return null;
  const queryIndex = pdfUrl.indexOf("?");
  const query = queryIndex === -1 ? "" : pdfUrl.slice(queryIndex + 1);
  const mainFile = new URLSearchParams(query).get("mainFile");
  if (!mainFile) return null;
  const path = mainFile.replace(/\.tex$/i, ".pdf");
  const name = path.split("/").pop() ?? path;
  return { name, path };
}

// ─── PdfViewer ──────────────────────────────────────

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer({ pdfUrl, loading, onTextSelect, toolbarExtra }, ref) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollPositionRef = useRef<{ ratio: number } | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const zoomPercent = Math.round(zoom * 100);

  // Expose saveScrollPosition so parent can call it before triggering a rebuild
  useImperativeHandle(ref, () => ({
    saveScrollPosition: () => {
      const container = containerRef.current;
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight > clientHeight) {
        scrollPositionRef.current = {
          ratio: scrollTop / (scrollHeight - clientHeight),
        };
      }
    },
  }), []);

  // Measure container width for fit-to-width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.round(entry.contentRect.width));
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    observerRef.current?.disconnect();
    pageRefs.current.clear();
    if (!pdfUrl) scrollPositionRef.current = null;
    setNumPages(0);
    setCurrentPage(1);
  }, [pdfUrl]);

  function onDocumentLoadSuccess({ numPages: n }: { numPages: number }) {
    setNumPages(n);

    if (scrollPositionRef.current && containerRef.current) {
      const { ratio } = scrollPositionRef.current;
      // Attempt restore multiple times — pages may not be fully rendered yet
      let attempts = 0;
      const tryRestore = () => {
        const container = containerRef.current;
        if (!container) return;
        const { scrollHeight, clientHeight } = container;
        if (scrollHeight > clientHeight) {
          container.scrollTop = ratio * (scrollHeight - clientHeight);
          scrollPositionRef.current = null;
          return;
        }
        attempts++;
        // Retry a few times as pages render incrementally
        if (attempts < 20) {
          setTimeout(() => requestAnimationFrame(tryRestore), 50);
        } else {
          scrollPositionRef.current = null;
        }
      };
      requestAnimationFrame(tryRestore);
    }
  }

  // IntersectionObserver for page tracking
  const setPageRef = useCallback(
    (pageNum: number, el: HTMLDivElement | null) => {
      if (el) {
        pageRefs.current.set(pageNum, el);
      } else {
        pageRefs.current.delete(pageNum);
      }
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current || numPages === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0;
        let visiblePage = 1;

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            const pageNum = parseInt(
              entry.target.getAttribute("data-page-number") ?? "1",
              10
            );
            visiblePage = pageNum;
          }
        });

        if (maxRatio > 0) {
          setCurrentPage(visiblePage);
        }
      },
      {
        root: containerRef.current,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    pageRefs.current.forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [numPages]);

  // Trackpad / Ctrl+Wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * ZOOM_WHEEL_SENSITIVITY;
        setZoom((prev) => {
          const next = prev + delta * prev;
          return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
        });
      }
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // PDF text selection → sync to editor
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onTextSelect) return;

    function normalize(s: string) {
      return s.replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim();
    }

    function findTextLayer(node: Node | null): Element | null {
      let cur: Node | null = node;
      while (cur) {
        if (cur instanceof Element) {
          const cls = cur.className;
          if (typeof cls === "string" && /textLayer|textContent/.test(cls)) {
            return cur;
          }
        }
        cur = cur.parentNode;
      }
      return null;
    }

    function handleMouseUp() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const text = normalize(selection.toString());
      if (text.length < 3) return;

      const CTX = 80;
      let before = "";
      let after = "";
      const layer = findTextLayer(range.startContainer);
      if (layer) {
        try {
          const beforeRange = document.createRange();
          beforeRange.setStart(layer, 0);
          beforeRange.setEnd(range.startContainer, range.startOffset);
          before = normalize(beforeRange.toString()).slice(-CTX);

          const afterLayer = findTextLayer(range.endContainer) || layer;
          const afterRange = document.createRange();
          afterRange.setStart(range.endContainer, range.endOffset);
          afterRange.setEnd(afterLayer, afterLayer.childNodes.length);
          after = normalize(afterRange.toString()).slice(0, CTX);
        } catch {
          // Ignore range errors (cross-page selections, etc.)
        }
      }

      onTextSelect!(text, before, after);
    }

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [onTextSelect]);

  function handleZoomIn() {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }

  function handleZoomOut() {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }

  function handleZoomReset() {
    setZoom(1);
  }

  function handlePrevPage() {
    if (currentPage <= 1) return;
    const target = currentPage - 1;
    setCurrentPage(target);
    pageRefs.current.get(target)?.scrollIntoView({ behavior: "smooth" });
  }

  function handleNextPage() {
    if (currentPage >= numPages) return;
    const target = currentPage + 1;
    setCurrentPage(target);
    pageRefs.current.get(target)?.scrollIntoView({ behavior: "smooth" });
  }

  function handleDownload() {
    if (pdfUrl) {
      const [base, query = ""] = pdfUrl.split("?");
      const params = new URLSearchParams(query);
      params.set("download", "true");
      const nextQuery = params.toString();
      const downloadUrl = nextQuery ? `${base}?${nextQuery}` : `${base}?download=true`;
      window.open(downloadUrl, "_blank");
    }
  }

  const pageWidth = containerWidth > 0 ? (containerWidth - 48) * zoom : undefined;
  const pdfName = pdfNameFromUrl(pdfUrl);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-pdf-viewer
        className="relative flex h-full min-h-0 flex-col bg-bg-tertiary"
      >
        {/* Compile in flight: a hairline of progress, not a blocking spinner. */}
        {loading && (
          <div className="compilation-progress absolute inset-x-0 top-0 z-30" />
        )}

        {/* Floating control bar. Chrome hovers over the paper, it does not frame it. */}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-bg-elevated px-1.5 py-1 shadow-lg">
            {pdfName && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 max-w-[9rem] shrink truncate px-1.5 text-xs text-text-secondary">
                      {pdfName.name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="break-all">
                    {pdfName.path}
                  </TooltipContent>
                </Tooltip>
                <div className="mx-1 h-4 w-px shrink-0 bg-border" />
              </>
            )}
            {numPages > 0 && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handlePrevPage}
                      disabled={currentPage <= 1}
                      aria-label="Previous page"
                      className={TOOLBAR_BUTTON}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Previous page</TooltipContent>
                </Tooltip>

                <span className="min-w-[52px] text-center text-xs text-text-secondary tabular-nums">
                  {currentPage} / {numPages}
                </span>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleNextPage}
                      disabled={currentPage >= numPages}
                      aria-label="Next page"
                      className={TOOLBAR_BUTTON}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Next page</TooltipContent>
                </Tooltip>

                <div className="mx-1 h-4 w-px bg-border" />
              </>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="Zoom out"
                  className={TOOLBAR_BUTTON}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleZoomReset}
                  aria-label="Reset zoom"
                  className="min-w-[44px] rounded-md px-1 py-1 text-center text-xs text-text-secondary tabular-nums transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-text-primary"
                >
                  {zoomPercent}%
                </button>
              </TooltipTrigger>
              <TooltipContent>Reset zoom</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="Zoom in"
                  className={TOOLBAR_BUTTON}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>

            <div className="mx-1 h-4 w-px bg-border" />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!pdfUrl}
                  aria-label="Download PDF"
                  className={TOOLBAR_BUTTON}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Download PDF</TooltipContent>
            </Tooltip>

            {toolbarExtra}
          </div>
        </div>

        {/* PDF Content */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {loading && (
            <div className="animate-fade-in pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
              <span
                role="status"
                aria-live="polite"
                className="rounded-full border border-border bg-bg-elevated px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-md"
              >
                Compiling
              </span>
            </div>
          )}

          <div ref={containerRef} className="h-full min-h-0 overflow-auto overscroll-contain">
            {!pdfUrl && loading && (
              <div className="px-6 py-4">
                <PageSkeleton width={pageWidth} />
              </div>
            )}

            {!pdfUrl && !loading && (
              <div className="flex h-full items-center justify-center animate-fade-in">
                <div className="flex flex-col items-center gap-3 px-4 text-center">
                  <FileText className="h-6 w-6 text-text-muted" strokeWidth={1.5} />
                  <div>
                    <p className="text-sm font-medium text-text-secondary">
                      No PDF preview
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      Compile the project, or turn on auto-compile, to generate one.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {pdfUrl && (
              <div className="pt-16 pb-4">
                <Document
                  file={pdfUrl}
                  onLoadSuccess={onDocumentLoadSuccess}
                  loading={
                    <div className="px-6">
                      <PageSkeleton width={pageWidth} />
                    </div>
                  }
                  error={
                    <div className="flex items-center justify-center py-12">
                      <p className="rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
                        Failed to load PDF
                      </p>
                    </div>
                  }
                >
                  {Array.from(new Array(numPages), (_, index) => {
                    const pageNum = index + 1;
                    return (
                      <div
                        key={`page_${pageNum}`}
                        ref={(el) => setPageRef(pageNum, el)}
                        data-page-number={pageNum}
                        className="mb-3 flex justify-center"
                      >
                        <Page
                          pageNumber={pageNum}
                          width={pageWidth}
                          loading={<PageSkeleton width={pageWidth} />}
                          devicePixelRatio={
                            typeof window !== "undefined"
                              ? Math.max(window.devicePixelRatio || 1, 2)
                              : 2
                          }
                          renderTextLayer={true}
                          renderAnnotationLayer={true}
                        />
                      </div>
                    );
                  })}
                </Document>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
