import { GeminiParsingResult, POLineRow, DocType, ItemClass } from "../types";
import { ReferencePack } from "../referencePack.schema";
import { ReferenceService } from "./referenceService";
import { applyPolicyRouting } from "./policyRouting";
import { ControlSurfacePolicy } from "../policy/controlSurfacePolicy";

const DIMENSION_RE = /\bCUT\s*TO\b|(\d+\s*-\s*\d+\/\d+)|(\d+\s*\/\s*\d+)\s*\"/i;

function docTypeToRowDocType(dt: string): DocType {
  const normalized = (dt || "").toUpperCase();
  if (normalized.includes("INVOICE")) return "INVOICE";
  if (normalized.includes("PURCHASE ORDER") || normalized.includes("ORDER")) return "PURCHASE_ORDER";
  if (normalized.includes("CREDIT")) return "CREDIT_MEMO";
  return "UNKNOWN";
}

export function geminiResultToPOLineRows(args: {
  parsed: GeminiParsingResult;
  sourceFileStem: string;
  policy: ControlSurfacePolicy;
  refPack?: ReferencePack | null;
}): POLineRow[] {
  const { parsed, sourceFileStem, policy, refPack } = args;
  const rows: POLineRow[] = [];
  let lineCounter = 1;

  const refService = refPack ? new ReferenceService(refPack) : null;

  for (const doc of parsed.documents ?? []) {
    const doc_type = docTypeToRowDocType(doc.documentType);
    const doc_id = (doc.orderNumber && doc.orderNumber.trim()) ? doc.orderNumber.trim() : sourceFileStem;

    for (const li of doc.lineItems ?? []) {
      const combinedText = `${li.itemNumber ?? ""} ${li.description ?? ""}`.trim();

      // deterministic normalization
      const mRef = refService?.normalizeManufacturer(combinedText) || refService?.normalizeManufacturer(li.manufacturer || "");
      
      const candidate = mRef ? `${mRef.abbr}-${li.itemNumber}` : (li.itemNumber ?? "");

      // Initial detection of edge cases to feed into policy engine
      const desc = combinedText.toUpperCase();
      const flags: string[] = [];
      if (doc_type === "CREDIT_MEMO") flags.push("CREDIT_MEMO");
      if (desc.includes("RGA")) flags.push("RGA");
      if (desc.includes("SPECIAL LAYOUT")) flags.push("SPECIAL_LAYOUT");
      if (DIMENSION_RE.test(combinedText)) flags.push("CUSTOM_LENGTH");
      if ((li.unitPrice ?? 0) === 0) flags.push("ZERO_DOLLAR");

      const item_class: ItemClass =
        (flags.includes("SPECIAL_LAYOUT") || flags.includes("CUSTOM_LENGTH")) ? "CUSTOM" :
        (li.itemNumber && li.itemNumber.trim().length > 0) ? "CATALOG" :
        "UNKNOWN";

      rows.push({
        doc_id,
        doc_type,
        customer_name: doc.customerName ?? "",
        customer_order_no: doc.customerPO ?? "",
        document_date: doc.orderDate ?? "",

        line_no: lineCounter++,
        customer_item_no: li.itemNumber ?? "",
        customer_item_desc_raw: li.description ?? "",
        qty: li.quantityOrdered || undefined,
        uom: li.unit ?? "",
        unit_price: li.unitPrice || undefined,
        extended_price: li.totalAmount || undefined,
        currency: doc.currency || "USD",

        abh_item_no_candidate: candidate,

        item_class,
        edge_case_flags: flags,
        confidence_score: 0.65,

        automation_lane: "ASSIST",
        routing_reason: "",
        fields_requiring_review: [],

        bill_to_address_raw: doc.billToAddressRaw,
        ship_to_address_raw: doc.shipToAddressRaw,
        mark_instructions: doc.markInstructions,
        
        match_score: 0.65
      });
    }
  }

  // Apply the dynamic policy routing
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
