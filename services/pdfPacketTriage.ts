
// services/pdfPacketTriage.ts
import * as pdfjsLib from "pdfjs-dist";

// Using stable 4.x versioning for better ESM compatibility
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

export type PageLabel =
  | "PURCHASE_ORDER"
  | "CREDIT_MEMO"
  | "INVOICE"
  | "SALES_ORDER"
  | "PICKING_SHEET"
  | "EMAIL_COVER"
  | "UNKNOWN";

export type PageTriage = {
  pageIndex: number;         // 0-based
  text: string;              // extracted PDF text if available
  label: PageLabel;
  score: number;             // 0..1
  reasons: string[];
};

export type DocSegment = {
  segmentId: string;
  label: PageLabel;
  pageStart: number;         // 0-based inclusive
  pageEnd: number;           // 0-based inclusive
  pages: number[];           // 0-based
  triage: PageTriage[];
};

function normalize(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function scorePage(textRaw: string): { label: PageLabel; score: number; reasons: string[] } {
  const text = normalize(textRaw).toUpperCase();
  const reasons: string[] = [];

  if (!text || text.length < 20) {
    return { label: "UNKNOWN", score: 0.1, reasons: ["NO_TEXT_OR_TOO_SHORT"] };
  }

  const has = (re: RegExp) => re.test(text);

  const PO = has(/\bPURCHASE\s+ORDER\b/) || has(/\bHUNTINGTON\s+HARDWARE\b/);
  const INVOICE = has(/\bINVOICE\b/) && !has(/\bINVOICE\s+TO\b/);
  const SO = has(/\bSALES\s+ORDER\b/);
  const PICK = has(/\bPICKING\s+SHEET\b/);
  const CM = has(/\bCREDIT\s+MEMO\b/);
  const EMAIL = has(/\bFROM:\b/) && has(/\bSUBJECT:\b/);

  const hasTotals = has(/\bSUBTOTAL\b/) || has(/\bTOTAL\b/) || has(/\bAMOUNT\b/);
  const hasShipTo = has(/\bSHIP\s+TO\b/);
  const hasBillTo = has(/\bBILL\s+TO\b/) || has(/\bSOLD\s+TO\b/);

  if (EMAIL) {
    reasons.push("EMAIL_HEADERS");
    return { label: "EMAIL_COVER", score: 0.9, reasons };
  }
  if (CM) {
    reasons.push("CREDIT_MEMO_HEADER");
    return { label: "CREDIT_MEMO", score: 0.95, reasons };
  }
  if (PO) {
    reasons.push("PURCHASE_ORDER_HEADER");
    return { label: "PURCHASE_ORDER", score: 0.95, reasons };
  }
  if (SO) {
    reasons.push("SALES_ORDER_HEADER");
    return { label: "SALES_ORDER", score: 0.9, reasons };
  }
  if (INVOICE) {
    reasons.push("INVOICE_HEADER");
    return { label: "INVOICE", score: 0.9, reasons };
  }
  if (PICK) {
    reasons.push("PICKING_SHEET_HEADER");
    return { label: "PICKING_SHEET", score: 0.9, reasons };
  }

  if (hasTotals && (hasShipTo || hasBillTo)) {
    reasons.push("TOTALS_PLUS_ADDRESS_BLOCK");
    return { label: "INVOICE", score: 0.6, reasons };
  }

  return { label: "UNKNOWN", score: 0.2, reasons: ["NO_STRONG_HEADER_MATCH"] };
}

export async function extractPdfPageText(fileData: Uint8Array): Promise<string[]> {
  initWorker();
  const getDoc = pdfjsLib.getDocument || (pdfjsLib as any).default?.getDocument;
  const loadingTask = getDoc({ data: fileData.slice(), verbosity: 0 });
  const pdf = await loadingTask.promise;
  const texts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = (content.items || [])
      .map((it: any) => (it.str ? String(it.str) : ""))
      .filter(Boolean);
    texts.push(strings.join(" "));
  }

  return texts;
}

export function triagePages(pageTexts: string[]): PageTriage[] {
  return pageTexts.map((t, idx) => {
    const scored = scorePage(t);
    return {
      pageIndex: idx,
      text: t,
      label: scored.label,
      score: scored.score,
      reasons: scored.reasons,
    };
  });
}

export function buildSegments(triage: PageTriage[]): DocSegment[] {
  const segs: DocSegment[] = [];
  let current: DocSegment | null = null;

  const push = () => {
    if (current) segs.push(current);
    current = null;
  };

  for (const p of triage) {
    const shouldSplit =
      !current ||
      p.label !== current.label ||
      p.label === "UNKNOWN" ||
      current.label === "UNKNOWN";

    if (shouldSplit) {
      push();
      current = {
        segmentId: `seg-${p.pageIndex}-${p.label}`,
        label: p.label,
        pageStart: p.pageIndex,
        pageEnd: p.pageIndex,
        pages: [p.pageIndex],
        triage: [p],
      };
    } else {
      current.pageEnd = p.pageIndex;
      current.pages.push(p.pageIndex);
      current.triage.push(p);
    }
  }

  push();
  return segs;
}
