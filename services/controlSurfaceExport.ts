import * as XLSX from "xlsx";
import { POLineRow } from "../types";

/**
 * These MUST match row 1 of PO_LineItem_Analysis in:
 * PO_Automation_Control_Surface_Template_v3.xlsx
 */
export const CONTROL_SURFACE_HEADERS = [
  "doc_id",
  "doc_type",
  "customer_name",
  "customer_order_no",
  "abh_order_no",
  "document_date",
  "ship_to_name",
  "ship_to_address_raw",
  "bill_to_name",
  "bill_to_address_raw",
  "mark_instructions",
  "line_no",
  "customer_item_no",
  "customer_item_desc_raw",
  "qty",
  "uom",
  "unit_price",
  "extended_price",
  "currency",
  "abh_item_no_candidate",
  "item_class",
  "edge_case_flags",
  "edge_case_flag_1",
  "edge_case_flag_2",
  "edge_case_flag_3",
  "confidence_score",
  "automation_lane",
  "deterministic_rule_exists",
  "phase_target",
  "fields_requiring_review",
  "routing_reason",
  "review_status",
  "reviewer",
  "review_timestamp",
  "final_abh_item_no",
  "final_qty",
  "final_uom",
  "final_unit_price",
  "final_ship_to",
  "notes",
] as const;

type ControlHeader = (typeof CONTROL_SURFACE_HEADERS)[number];

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  const needsQuotes = /[,"\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function toControlSurfaceRecord(r: POLineRow): Record<ControlHeader, any> {
  const flags = r.edge_case_flags || [];
  const edgeStr = flags.join(";");

  const conf = typeof r.confidence_score === "number" ? Math.round(r.confidence_score * 100) : "";

  return {
    doc_id: r.doc_id ?? "",
    doc_type: r.doc_type ?? "UNKNOWN",
    customer_name: r.customer_name ?? "",
    customer_order_no: r.customer_order_no ?? "",
    abh_order_no: r.abh_order_no ?? "",
    document_date: r.document_date ?? "",

    ship_to_name: r.ship_to_name ?? "",
    ship_to_address_raw: r.ship_to_address_raw ?? "",
    bill_to_name: r.bill_to_name ?? "",
    bill_to_address_raw: r.bill_to_address_raw ?? "",
    mark_instructions: r.mark_instructions ?? "",

    line_no: r.line_no ?? "",
    customer_item_no: r.customer_item_no ?? "",
    customer_item_desc_raw: r.customer_item_desc_raw ?? "",
    qty: r.qty ?? "",
    uom: r.uom ?? "",
    unit_price: r.unit_price ?? "",
    extended_price: r.extended_price ?? "",
    currency: r.currency ?? "USD",

    abh_item_no_candidate: r.abh_item_no_candidate ?? "",

    item_class: r.item_class ?? "UNKNOWN",
    edge_case_flags: edgeStr,
    edge_case_flag_1: flags[0] ?? "",
    edge_case_flag_2: flags[1] ?? "",
    edge_case_flag_3: flags[2] ?? "",

    confidence_score: conf,
    automation_lane: r.automation_lane ?? "ASSIST",
    deterministic_rule_exists: r.automation_lane === "AUTO" ? "Y" : "",
    phase_target: 1,
    fields_requiring_review: (r.fields_requiring_review || []).join(";"),
    routing_reason: r.routing_reason ?? "",

    review_status: "",
    reviewer: "",
    review_timestamp: "",

    final_abh_item_no: r.abh_item_no_final ?? "",
    final_qty: "",
    final_uom: "",
    final_unit_price: "",
    final_ship_to: "",

    notes: r.raw_edge_case_notes ?? "",
  };
}

export function exportControlSurfaceCsv(rows: POLineRow[]): string {
  const headerLine = CONTROL_SURFACE_HEADERS.join(",");
  const lines = rows.map((r) => {
    const rec = toControlSurfaceRecord(r);
    return CONTROL_SURFACE_HEADERS.map((h) => csvEscape(rec[h])).join(",");
  });
  return [headerLine, ...lines].join("\n");
}

export function exportControlSurfaceXlsxUsingTemplate(args: {
  rows: POLineRow[];
  templateArrayBuffer: ArrayBuffer;
  sheetName?: string;
}): ArrayBuffer {
  const { rows, templateArrayBuffer } = args;
  const sheetName = args.sheetName ?? "PO_LineItem_Analysis";

  const wb = XLSX.read(templateArrayBuffer, { type: "array" });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Template missing sheet: ${sheetName}`);

  const startRow = 18;

  function isFormulaCell(cell: any): boolean {
    return !!cell && typeof cell === "object" && !!cell.f;
  }

  rows.forEach((r, idx) => {
    const rec = toControlSurfaceRecord(r);
    const rowNumber = startRow + idx;

    CONTROL_SURFACE_HEADERS.forEach((h, colIdx) => {
      const addr = XLSX.utils.encode_cell({ r: rowNumber - 1, c: colIdx });
      if (isFormulaCell(ws[addr])) return;

      const v = rec[h];
      if (v === null || v === undefined || v === "") {
        ws[addr] = { t: "s", v: "" };
      } else if (typeof v === "number") {
        ws[addr] = { t: "n", v };
      } else {
        ws[addr] = { t: "s", v: String(v) };
      }
    });
  });

  const currentRef = ws["!ref"] ?? "A1:A1";
  const range = XLSX.utils.decode_range(currentRef);
  range.e.r = Math.max(range.e.r, startRow - 1 + rows.length);
  range.e.c = Math.max(range.e.c, CONTROL_SURFACE_HEADERS.length - 1);
  ws["!ref"] = XLSX.utils.encode_range(range);

  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
