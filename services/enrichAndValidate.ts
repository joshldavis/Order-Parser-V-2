import { POLineRow, AutomationLane } from "../types.ts";
import { ReferenceService } from "./referenceService.ts";

export function enrichAndValidate(
  rows: POLineRow[],
  refService: ReferenceService,
  referenceVersion: string
): POLineRow[] {
  return rows.map(row => {
    // --- Hard guardrails by doc type
    if (row.doc_type === "EMAIL_COVER") {
      // Email covers should not produce line items. If they do, quarantine.
      return {
        ...row,
        automation_lane: "BLOCK",
        sage_import_ready: false,
        routing_reason: "EMAIL_COVER should not generate exportable line items (quarantined)",
        fields_requiring_review: ["doc_type"],
        raw_edge_case_notes: `${row.raw_edge_case_notes ?? ""}${row.raw_edge_case_notes ? " | " : ""}ref_pack_version=${referenceVersion}`,
        policy_rule_ids_applied: Array.from(
          new Set([...(row.policy_rule_ids_applied ?? []), `REFPACK:${referenceVersion}`, "DOC_GUARD:EMAIL_COVER"])
        ),
      };
    }

    // Pricing expectation
    const priceExpected = row.doc_type !== "PICKING_SHEET";

    const violations: string[] = [];
    let score = 0;

    const text = `${row.customer_item_no ?? ""} ${row.customer_item_desc_raw ?? ""}`;

    // 1) Manufacturer grounding
    const mfg = refService.normalizeManufacturer(text);
    if (mfg) {
      row.abh_item_no_candidate = `${mfg.abbr}-${row.customer_item_no}`;
      score += 0.4;
    } else {
      violations.push("No Mfr Match");
    }

    // 2) Finish grounding
    const finish = refService.normalizeFinish(text);
    if (finish) {
      score += 0.2;
    } else {
      violations.push("No Finish Match");
    }

    // 3) Category
    const cat = refService.detectCategory(text);
    if (cat) score += 0.2;

    row.confidence_score = Math.min(score + 0.2, 1);
    row.match_score = row.confidence_score;

    // Readiness logic: do NOT punish missing price for picking sheets
    const isReady =
      violations.length === 0 &&
      row.confidence_score >= 0.8;

    const lane: AutomationLane =
      isReady ? "AUTO" : (violations.length > 2 ? "BLOCK" : "ASSIST");

    // Add doc-type hints to routing reason for clarity
    const docHint =
      row.doc_type === "PICKING_SHEET"
        ? " (NO_PRICING_EXPECTED)"
        : "";

    return {
      ...row,
      automation_lane: lane,
      sage_import_ready: isReady,
      routing_reason: isReady ? `Grounded Match${docHint}` : `Issues: ${violations.join(", ")}${docHint}`,
      fields_requiring_review: isReady ? [] : violations,
      raw_edge_case_notes: `${row.raw_edge_case_notes ?? ""}${row.raw_edge_case_notes ? " | " : ""}ref_pack_version=${referenceVersion}`,
      policy_rule_ids_applied: Array.from(
        new Set([...(row.policy_rule_ids_applied ?? []), `REFPACK:${referenceVersion}`, "REF_GROUNDING_V4"])
      ),
    };
  });
}
