// services/edgeCases.ts
import { DocType, ItemClass, POLineRow } from "../types.ts";

export type FieldConfidenceMap = Record<string, number>;

export type EdgeCaseSignals = {
  flags: string[];
  notes: string[];
  rga_no?: string;
  invoice_ref?: string;
  cut_to_inches?: number; // normalized numeric inches (best-effort)
  has_special_layout?: boolean;
  is_zero_dollar?: boolean;
};

const RX_RGA = /\bRGA\s*#?\s*([A-Z0-9\-]{3,})\b/i;
const RX_INVOICE = /\bINVOICE\s*#?\s*([A-Z0-9\-]{3,})\b/i;

// Matches: CUT TO 107-1/4", CUT TO 83", CUT TO 83 1/2"
const RX_CUT_TO = /\bCUT\s*TO\s*([0-9]{1,3})(?:\s*-\s*([0-9]{1,2})\s*\/\s*([0-9]{1,2})|\s+([0-9]{1,2})\s*\/\s*([0-9]{1,2}))?\s*"?\b/i;

function fracToFloat(n?: string, d?: string): number {
  const nn = n ? parseFloat(n) : 0;
  const dd = d ? parseFloat(d) : 0;
  if (!dd) return 0;
  return nn / dd;
}

export function inferDocType(docTypeRaw?: string, docText?: string): DocType {
  const t = (docTypeRaw || "").toUpperCase();

  // direct from model label
  if (t.includes("CREDIT")) return "CREDIT_MEMO";
  if (t.includes("INVOICE")) return "INVOICE";
  if (t.includes("PURCHASE")) return "PURCHASE_ORDER";
  if (t.includes("SALES")) return "SALES_ORDER";
  if (t.includes("PICKING")) return "PICKING_SHEET";
  if (t.includes("EMAIL")) return "EMAIL_COVER";

  // fallback by text
  const blob = (docText || "").toLowerCase();

  if (blob.includes("credit memo") || blob.includes("credit memorandum")) return "CREDIT_MEMO";
  if (blob.includes("invoice")) return "INVOICE";
  if (blob.includes("purchase order") || blob.includes("p.o.")) return "PURCHASE_ORDER";
  if (blob.includes("sales order")) return "SALES_ORDER";
  if (blob.includes("picking sheet")) return "PICKING_SHEET";

  // Email cover heuristic: common "From:" "Subject:"
  if (blob.includes("from:") && blob.includes("subject:")) return "EMAIL_COVER";

  return "UNKNOWN";
}

export function extractSignalsFromLineText(textRaw: string): EdgeCaseSignals {
  const text = textRaw || "";
  const flags: string[] = [];
  const notes: string[] = [];

  // Special layout
  if (/\bspecial\s+layout\b/i.test(text)) {
    flags.push("SPECIAL_LAYOUT");
    notes.push("Detected 'Special Layout' language");
  }

  // Power transfer / wiring hints
  if (/\bpower\s+transfer\b/i.test(text)) flags.push("POWER_TRANSFER");
  if (/\bwired\s+for\b/i.test(text) || /\bwiring\b/i.test(text)) flags.push("WIRING_SPEC");

  // CUT TO
  const mCut = text.match(RX_CUT_TO);
  let cut_to_inches: number | undefined;
  if (mCut) {
    const whole = parseFloat(mCut[1]);
    const fracA = fracToFloat(mCut[2], mCut[3]);
    const fracB = fracToFloat(mCut[4], mCut[5]);
    const frac = fracA || fracB || 0;
    cut_to_inches = whole + frac;
    flags.push("CUSTOM_DIMENSION");
    notes.push(`Detected CUT TO length: ${cut_to_inches.toFixed(2)} inches`);
  }

  // RGA / invoice refs
  const mRga = text.match(RX_RGA);
  const rga_no = mRga?.[1];
  if (rga_no) {
    flags.push("RGA_REFERENCE");
    notes.push(`Detected RGA: ${rga_no}`);
  }

  const mInv = text.match(RX_INVOICE);
  const invoice_ref = mInv?.[1];
  if (invoice_ref) {
    flags.push("INVOICE_REFERENCE");
    notes.push(`Detected Invoice ref: ${invoice_ref}`);
  }

  return { flags, notes, rga_no, invoice_ref, cut_to_inches, has_special_layout: flags.includes("SPECIAL_LAYOUT") };
}

export function classifyZeroDollar(qty?: number, unitPrice?: number, extPrice?: number): boolean {
  const q = typeof qty === "number" ? qty : undefined;
  const up = typeof unitPrice === "number" ? unitPrice : undefined;
  const ep = typeof extPrice === "number" ? extPrice : undefined;

  // treat as zero-dollar if an order qty exists but price is 0
  if (typeof q === "number" && q !== 0) {
    if (up === 0 || ep === 0) return true;
  }
  return false;
}

export function deriveItemClass(base: ItemClass, flags: string[], isZeroDollar: boolean): ItemClass {
  // Escalate based on risk signals
  const hard = flags.includes("SPECIAL_LAYOUT") || flags.includes("CUSTOM_DIMENSION") || isZeroDollar || flags.includes("RGA_REFERENCE");
  if (hard) return "CUSTOM";

  const configured = flags.includes("WIRING_SPEC") || flags.includes("POWER_TRANSFER");
  if (configured) return "CONFIGURED";

  return base;
}

export function computeFieldConfidence(row: POLineRow): FieldConfidenceMap {
  const base = clamp01(row.confidence_score ?? 0);

  const priceExpected =
    row.doc_type !== "PICKING_SHEET" &&
    row.doc_type !== "EMAIL_COVER";

  const penalties: Record<string, number> = {
    customer_item_no: row.customer_item_no ? 0 : 0.25,
    qty: typeof row.qty === "number" ? 0 : 0.25,

    // pricing penalties only when pricing is expected
    unit_price: priceExpected ? (typeof row.unit_price === "number" ? 0 : 0.15) : 0,
    extended_price: priceExpected ? (typeof row.extended_price === "number" ? 0 : 0.10) : 0,

    uom: row.uom ? 0 : 0.10,
    customer_item_desc_raw: row.customer_item_desc_raw ? 0 : 0.10,
  };

  // Edge cases reduce confidence on certain fields
  if (row.edge_case_flags.includes("SPECIAL_LAYOUT")) {
    penalties.customer_item_desc_raw += 0.15;
  }
  if (row.edge_case_flags.includes("CUSTOM_DIMENSION")) {
    penalties.customer_item_desc_raw += 0.10;
    penalties.customer_item_no += 0.05;
  }
  if (row.edge_case_flags.includes("RGA_REFERENCE")) {
    penalties.customer_item_desc_raw += 0.15;
  }
  if (row.edge_case_flags.includes("ZERO_DOLLAR") && priceExpected) {
    penalties.unit_price += 0.20;
    penalties.extended_price += 0.20;
  }

  // Convert penalties to confidences
  const out: FieldConfidenceMap = {};
  for (const k of Object.keys(penalties)) {
    out[k] = clamp01(base - penalties[k]);
  }

  return out;
}

export function fieldsNeedingReview(fieldConf: FieldConfidenceMap, threshold = 0.85): string[] {
  return Object.entries(fieldConf)
    .filter(([_, v]) => v < threshold)
    .map(([k]) => k);
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
