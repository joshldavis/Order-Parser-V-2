// services/mappingService.ts
import { GeminiParsingResult, POLineRow, DocType, ItemClass } from "../types.ts";
import { ReferencePack } from "../referencePack.schema.ts";
import { ReferenceService } from "./referenceService.ts";
import { applyPolicyRouting } from "./policyRouting.ts";
import { ControlSurfacePolicy } from "../policy/controlSurfacePolicy.ts";
import { makeDocId } from "./id.ts";
import {
  inferDocType,
  extractSignalsFromLineText,
  classifyZeroDollar,
  deriveItemClass,
  computeFieldConfidence,
  fieldsNeedingReview
} from "./edgeCases.ts";

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
    const doc_type = inferDocType(
      (doc as any)?.document?.document_type,
      JSON.stringify(doc).slice(0, 5000)
    ) as DocType;

    // evidence from segmentation (if present)
    const page_start = (doc as any)?.document?.page_start;
    const page_end = (doc as any)?.document?.page_end;
    const source_pages = (doc as any)?.document?.source_pages;

    // Prefer model-provided document_id, else deterministic id
    const modelDocId = (doc as any)?.document?.document_id;
    const doc_id =
      (typeof modelDocId === "string" && modelDocId.trim())
        ? modelDocId.trim()
        : makeDocId({
            sourceFileStem,
            docType: doc_type,
            pageStart: typeof page_start === "number" ? page_start : undefined,
            pageEnd: typeof page_end === "number" ? page_end : undefined,
            customerOrderNo: doc?.order?.customer_order_no,
          });

    const customerName = doc?.parties?.customer?.name || "";

    const reasonCodes = (doc as any)?.routing?.reason_codes;
    const docReason = Array.isArray(reasonCodes) ? reasonCodes.join(" | ") : "";

    for (const li of doc.line_items ?? []) {
      const p = li.parsed;

      // Basic computed prices
      const qty = p.quantity;
      const unit_price = p.unit_price;
      const extended_price =
        typeof p.extended_price === "number"
          ? p.extended_price
          : (typeof qty === "number" && typeof unit_price === "number" ? qty * unit_price : undefined);

      const combinedText = `${p.customer_item_no ?? ""} ${p.description ?? ""}`.trim();

      // Reference grounding (best-effort)
      const mRef =
        refService?.normalizeManufacturer(combinedText) ||
        (p.manufacturer ? refService?.normalizeManufacturer(p.manufacturer) : undefined);

      const abh_item = mRef
        ? `${mRef.abbr}-${p.customer_item_no ?? ""}`
        : (p.abh_item_no || p.customer_item_no || "");

      // Signals from model flags + modifiers + raw text parsing
      const modelFlags: string[] = Array.isArray(li.flags) ? li.flags : [];
      const modifiers = Array.isArray(p.modifiers) ? p.modifiers : [];
      const modifierText = modifiers.map(m => `${m.type}:${m.value ?? ""}`).join(" | ");

      const signals = extractSignalsFromLineText(`${p.description ?? ""} ${modifierText}`);

      // Zero dollar detection
      const isZeroDollar = classifyZeroDollar(qty, unit_price, extended_price);
      if (isZeroDollar) {
        signals.flags.push("ZERO_DOLLAR");
        signals.notes.push("Detected zero-dollar line item");
        signals.is_zero_dollar = true;
      }

      // Credit memo signals should force review (even if “clean”)
      if (doc_type === "CREDIT_MEMO") {
        signals.flags.push("CREDIT_MEMO");
        signals.notes.push("Document type is CREDIT_MEMO (force review)");
      }

      const allFlags = uniq([...modelFlags, ...signals.flags]);

      // Base item class: start as CATALOG unless we see risk signals
      const baseClass: ItemClass = "CATALOG";
      const item_class = deriveItemClass(baseClass, allFlags, !!signals.is_zero_dollar);

      // Confidence
      const lineConfidence =
        typeof li?.confidence?.line_confidence === "number" ? li.confidence.line_confidence : 0;

      const row: POLineRow = {
        doc_id,
        doc_type,
        source_pages: Array.isArray(source_pages) ? source_pages : undefined,
        page_start: typeof page_start === "number" ? page_start : undefined,
        page_end: typeof page_end === "number" ? page_end : undefined,
        customer_name: customerName,
        customer_order_no: doc?.order?.customer_order_no || "",
        document_date: doc?.order?.order_date || "",
        currency: doc?.order?.currency || "USD",

        line_no: rows.length + 1,

        customer_item_no: p.customer_item_no || "",
        customer_item_desc_raw: p.description || "",

        qty,
        uom: p.uom,

        unit_price,
        extended_price,

        abh_item_no_candidate: abh_item,
        manufacturer: p.manufacturer,

        item_class,
        edge_case_flags: allFlags,
        raw_edge_case_notes: [...signals.notes, modifierText ? `Modifiers: ${modifierText}` : ""]
          .filter(Boolean)
          .join(" | "),

        confidence_score: lineConfidence,
        match_score: lineConfidence,

        automation_lane: "ASSIST",
        routing_reason: docReason || "Parsed",
        fields_requiring_review: []
      };

      // Field-level confidence + review fields
      const fc = computeFieldConfidence(row);
      const reviewFields = fieldsNeedingReview(fc, 0.85);

      // Force review fields for certain situations
      if (doc_type === "CREDIT_MEMO") {
        // For credits, we want explicit human validation
        reviewFields.push("doc_type", "extended_price", "unit_price", "customer_item_desc_raw");
      }
      if (allFlags.includes("RGA_REFERENCE")) reviewFields.push("raw_edge_case_notes");
      if (allFlags.includes("SPECIAL_LAYOUT")) reviewFields.push("customer_item_desc_raw");
      if (allFlags.includes("CUSTOM_DIMENSION")) reviewFields.push("customer_item_desc_raw");

      row.fields_requiring_review = uniq(reviewFields);

      rows.push(row);
    }
  }

  // Apply policy routing after enrichment
  return applyPolicyRouting(rows, policy, { phase: "PHASE_1" });
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
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
