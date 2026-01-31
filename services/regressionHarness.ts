// services/regressionHarness.ts
import { POExportV1 } from "./abhSchema.ts";

export type DocSignature = {
  doc_id: string;
  doc_type: string;
  page_start?: number;
  page_end?: number;
  source_pages_count?: number;
  line_count: number;
  customer_order_no?: string;
};

export type ParseSignature = {
  schema: "regression.signature.v1";
  file_hash: string;
  filename: string;
  created_at: string;
  doc_count: number;
  docs: DocSignature[];
};

export type RegressionDiff = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const LS_KEY = "orderflow_regression_baselines_v1";

export async function sha256Base64(base64: string): Promise<string> {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function buildSignature(args: {
  filename: string;
  fileHash: string;
  docs: POExportV1[];
}): ParseSignature {
  const docSigs: DocSignature[] = (args.docs ?? []).map((d: any) => {
    const doc = d?.document || {};
    const order = d?.order || {};
    const line_items = Array.isArray(d?.line_items) ? d.line_items : [];

    return {
      doc_id: String(doc.document_id || ""),
      doc_type: String(doc.document_type || "UNKNOWN"),
      page_start: typeof doc.page_start === "number" ? doc.page_start : undefined,
      page_end: typeof doc.page_end === "number" ? doc.page_end : undefined,
      source_pages_count: Array.isArray(doc.source_pages) ? doc.source_pages.length : undefined,
      line_count: line_items.length,
      customer_order_no: typeof order.customer_order_no === "string" ? order.customer_order_no : undefined,
    };
  });

  // stable sort for consistent diffs
  docSigs.sort((a, b) => {
    const ka = `${a.doc_type}|${a.page_start ?? 9999}|${a.page_end ?? 9999}|${a.line_count}`;
    const kb = `${b.doc_type}|${b.page_start ?? 9999}|${b.page_end ?? 9999}|${b.line_count}`;
    return ka.localeCompare(kb);
  });

  return {
    schema: "regression.signature.v1",
    file_hash: args.fileHash,
    filename: args.filename,
    created_at: new Date().toISOString(),
    doc_count: docSigs.length,
    docs: docSigs,
  };
}

function loadAllBaselines(): Record<string, ParseSignature> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveAllBaselines(b: Record<string, ParseSignature>) {
  localStorage.setItem(LS_KEY, JSON.stringify(b));
}

export function saveBaseline(sig: ParseSignature) {
  const all = loadAllBaselines();
  all[sig.file_hash] = sig;
  saveAllBaselines(all);
}

export function getBaseline(fileHash: string): ParseSignature | null {
  const all = loadAllBaselines();
  return all[fileHash] || null;
}

export function listBaselines(): ParseSignature[] {
  const all = loadAllBaselines();
  return Object.values(all).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function deleteBaseline(fileHash: string) {
  const all = loadAllBaselines();
  delete all[fileHash];
  saveAllBaselines(all);
}

// Compare current vs baseline (tight but not brittle)
export function diffSignatures(baseline: ParseSignature, current: ParseSignature): RegressionDiff {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (baseline.doc_count !== current.doc_count) {
    errors.push(`Doc count changed: baseline=${baseline.doc_count} current=${current.doc_count}`);
  }

  const max = Math.max(baseline.docs.length, current.docs.length);
  for (let i = 0; i < max; i++) {
    const b = baseline.docs[i];
    const c = current.docs[i];
    if (!b) { errors.push(`Extra doc in current: ${describe(c)}`); continue; }
    if (!c) { errors.push(`Missing doc in current: ${describe(b)}`); continue; }

    if (b.doc_type !== c.doc_type) {
      errors.push(`Doc[${i}] type changed: baseline=${b.doc_type} current=${c.doc_type}`);
    }

    // page range is important when segmentation exists
    if ((b.page_start ?? null) !== (c.page_start ?? null) || (b.page_end ?? null) !== (c.page_end ?? null)) {
      warnings.push(`Doc[${i}] page range changed: baseline=${b.page_start}-${b.page_end} current=${c.page_start}-${c.page_end}`);
    }

    if (b.line_count !== c.line_count) {
      warnings.push(`Doc[${i}] line count changed: baseline=${b.line_count} current=${c.line_count}`);
    }

    // If doc_id is empty, that's a correctness bug
    if (!c.doc_id) {
      errors.push(`Doc[${i}] missing document_id in current output`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function describe(d?: DocSignature) {
  if (!d) return "(none)";
  return `${d.doc_type} pages=${d.page_start ?? "?"}-${d.page_end ?? "?"} lines=${d.line_count}`;
}
