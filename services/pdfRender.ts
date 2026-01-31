
// services/pdfRender.ts
import * as pdfjsLib from "pdfjs-dist";

const PDFJS_VERSION = "4.10.38";
const pdfjsWorker = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

function initWorker() {
  if (typeof window !== "undefined") {
    const options = (pdfjsLib as any).GlobalWorkerOptions || (pdfjsLib as any).default?.GlobalWorkerOptions;
    if (options) {
      options.workerSrc = pdfjsWorker;
    }
  }
}

initWorker();

export type RenderedPage = {
  pageIndex: number;
  base64: string;
  mimeType: string;
};

/**
 * Renders specific pages of a PDF to base64 PNG strings.
 */
export async function renderPdfPagesToPngBase64(
  data: Uint8Array,
  pageIndexes: number[],
  scale = 2.0
): Promise<RenderedPage[]> {
  initWorker();
  const getDoc = pdfjsLib.getDocument || (pdfjsLib as any).default?.getDocument;
  if (!getDoc) {
    throw new Error("PDF.js getDocument not found. Ensure script loading or importmap is correct.");
  }

  const loadingTask = getDoc({ data: data.slice(), verbosity: 0 });
  const pdf = await loadingTask.promise;
  const results: RenderedPage[] = [];

  for (const idx of pageIndexes) {
    try {
      const page = await pdf.getPage(idx + 1);
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context failed");

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      await page.render(renderContext).promise;
      
      const base64 = canvas.toDataURL("image/png").split(",")[1];
      
      results.push({
        pageIndex: idx,
        base64,
        mimeType: "image/png",
      });
    } catch (err) {
      console.error(`Error rendering page ${idx + 1}:`, err);
    }
  }

  return results;
}
