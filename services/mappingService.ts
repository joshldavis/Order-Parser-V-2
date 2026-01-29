
import { GeminiParsingResult, POLineRow, DocType, ItemClass } from "../types.ts";
// Corrected import: abhSchema.ts exports POExportV1, not ABH_PO_V1_Export
import { POExportV1 } from "./abhSchema.ts";
import { ReferencePack } from "../referencePack.schema.ts";
import { ReferenceService } from "./referenceService.ts";
import { applyPolicyRouting } from "./policyRouting.ts";
import { ControlSurfacePolicy } from "../policy/controlSurfacePolicy.ts";

export function geminiResultToPOLineRows(args: {
  parsed: GeminiParsingResult;
  sourceFileStem: string;
  policy: ControlSurfacePolicy;
  refPack?: ReferencePack | null;
}): POLineRow[] {
  const { parsed, sourceFileStem, policy, refPack } = args;
  const rows: POLineRow[] = [];
  const refService = refPack ? new ReferenceService(refPack) : null;

  for (const doc of parsed.documents ?? []) {
    const doc_type = (doc.document.document_type || "PURCHASE_ORDER") as DocType;
    const doc_id = doc.order.customer_order_no || sourceFileStem;

    for (const li of doc.line_items ?? []) {
      const p = li.parsed;
      const combinedText = `${p.customer_item_no ?? ""} ${p.description ?? ""}`.trim();
      
      // Catalog matching
      const mRef = refService?.normalizeManufacturer(combinedText) || (p.manufacturer ? refService?.normalizeManufacturer(p.manufacturer) : undefined);
      const abh_item = mRef ? `${mRef.abbr}-${p.customer_item_no}` : (p.abh_item_no || p.customer_item_no || "");

      const item_class: ItemClass = (li.flags.includes("SPECIAL_LAYOUT") || li.flags.includes("CUSTOM_DIMENSION")) ? "CUSTOM" : "CATALOG";

      rows.push({
        doc_id,
        doc_type,
        customer_name: doc.parties.customer.name || "",
        customer_order_no: doc.order.customer_order_no || "",
        document_date: doc.order.order_date || "",
        
        line_no: rows.length + 1,
        customer_item_no: p.customer_item_no || "",
        customer_item_desc_raw: p.description || "",
        qty: p.quantity,
        uom: p.uom,
        unit_price: p.unit_price,
        extended_price: p.extended_price || (p.quantity * (p.unit_price || 0)),
        currency: doc.order.currency || "USD",

        abh_item_no_candidate: abh_item,
        manufacturer: p.manufacturer,

        item_class,
        edge_case_flags: li.flags || [],
        confidence_score: li.confidence.line_confidence,

        automation_lane: "ASSIST",
        routing_reason: doc.routing.reason_codes.join(" | "),
        fields_requiring_review: [],
        match_score: li.confidence.line_confidence
      });
    }
  }

  return applyPolicyRouting(rows, policy, { phase: "PHASE_1" });
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
