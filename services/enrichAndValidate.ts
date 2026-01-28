import { POLineRow, AutomationLane } from "../types";
import { ReferenceService } from "./referenceService";

export function enrichAndValidate(
  rows: POLineRow[],
  refService: ReferenceService,
  referenceVersion: string
): POLineRow[] {
  return rows.map(row => {
    const violations: string[] = [];
    let score = 0;

    const text = `${row.customer_item_no ?? ""} ${row.customer_item_desc_raw ?? ""}`;

    // 1. Manufacturer
    const mfg = refService.normalizeManufacturer(text);
    if (mfg) {
      row.abh_item_no_candidate = `${mfg.abbr}-${row.customer_item_no}`;
      score += 0.4;
    } else {
      violations.push("No Mfr Match");
    }

    // 2. Finish
    const finish = refService.normalizeFinish(text);
    if (finish) {
      score += 0.2;
    } else {
      violations.push("No Finish Match");
    }

    // 3. Category
    const cat = refService.detectCategory(text);
    if (cat) score += 0.2;

    row.confidence_score = Math.min(score + 0.2, 1);
    row.match_score = row.confidence_score;
    row.policy_version_applied = referenceVersion;

    const isReady = violations.length === 0 && row.confidence_score >= 0.8;
    const lane: AutomationLane = isReady ? "AUTO" : (violations.length > 2 ? "BLOCK" : "ASSIST");

    return {
      ...row,
      automation_lane: lane,
      sage_import_ready: isReady,
      routing_reason: isReady ? "Grounded Match" : `Issues: ${violations.join(", ")}`,
      fields_requiring_review: isReady ? [] : violations,
      policy_rule_ids_applied: ["REF_GROUNDING_V4"]
    };
  });
}
