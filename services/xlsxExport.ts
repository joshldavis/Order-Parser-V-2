import * as XLSX from "xlsx";
import { POLineRow } from "../types";
import { CONTROL_SURFACE_HEADERS, toControlSurfaceRecord } from "./controlSurfaceExport";

type ControlSurfaceRow = Record<string, any>;

const REQUIRED_AUDIT_COLUMNS = [
  "policy_version_applied",
  "policy_rule_ids_applied",
  "routing_reason",
] as const;

function normalizePolicyRuleIds(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(",");
  return String(v);
}

/**
 * Map POLineRow[] -> row objects keyed by worksheet headers.
 * Combines standard Control Surface fields with enterprise audit metadata.
 */
function mapToControlSurfaceRows(rows: POLineRow[]): ControlSurfaceRow[] {
  return rows.map((r) => {
    const rec = toControlSurfaceRecord(r);
    
    return {
      ...rec,
      // Ensure these keys match the REQUIRED_AUDIT_COLUMNS strings
      policy_version_applied: r.policy_version_applied ?? "",
      policy_rule_ids_applied: normalizePolicyRuleIds(r.policy_rule_ids_applied),
      routing_reason: r.routing_reason ?? rec.routing_reason ?? "",
    };
  });
}

/**
 * Ensure required audit columns exist in the header row.
 * If missing, append them to the end (non-breaking).
 */
function ensureHeaders(headers: string[]): string[] {
  const set = new Set(headers.map((h) => String(h).trim()));
  const out = [...headers];

  for (const col of REQUIRED_AUDIT_COLUMNS) {
    if (!set.has(col)) out.push(col);
  }
  return out;
}

export function buildControlSurfaceWorkbook(args: {
  templateArrayBuffer?: ArrayBuffer;
  poLineRows: POLineRow[];
}): Blob {
  const { templateArrayBuffer, poLineRows } = args;
  const sheetName = "PO_LineItem_Analysis";

  let wb: XLSX.WorkBook;
  let headers: string[];

  if (templateArrayBuffer) {
    wb = XLSX.read(templateArrayBuffer, { type: "array" });
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`Template missing sheet: ${sheetName}`);

    // Read header row from template (Row 18 is the typical start, but let's find the headers)
    // We assume row 1 for finding existing headers if it's a raw template, 
    // or row 18 if it's the complex ABH template.
    const headerAOA = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1,
      range: 0,
      blankrows: false,
    }) as any[][];

    const rawHeaders: string[] = (headerAOA?.[0] ?? []).map((h: any) => String(h || "").trim());
    if (!rawHeaders.length) {
       // Fallback to standard headers if we can't read them
       headers = ensureHeaders([...CONTROL_SURFACE_HEADERS]);
    } else {
       headers = ensureHeaders(rawHeaders);
    }
  } else {
    // NO TEMPLATE: Create from scratch
    wb = XLSX.utils.book_new();
    headers = ensureHeaders([...CONTROL_SURFACE_HEADERS]);
  }

  // Build AOAs in header order
  const mapped = mapToControlSurfaceRows(poLineRows);
  const dataAOA: any[][] = mapped.map((rowObj) => headers.map((h) => (rowObj[h] ?? "")));

  const finalAOA: any[][] = [headers, ...dataAOA];

  // Create/Replace sheet
  const newWs = XLSX.utils.aoa_to_sheet(finalAOA);
  wb.Sheets[sheetName] = newWs;
  if (!wb.SheetNames.includes(sheetName)) {
    wb.SheetNames.push(sheetName);
  }

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
