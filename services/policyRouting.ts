// services/policyRouting.ts
import { POLineRow } from "../types";
import { ControlSurfacePolicy, PolicyContext, PolicyRule } from "../policy/controlSurfacePolicy";

function safeRegexTest(pattern?: string, value?: string): boolean {
  if (!pattern) return false;
  if (!value) return false;
  try {
    const re = new RegExp(pattern, "i");
    return re.test(value);
  } catch {
    return false;
  }
}

function matchesRule(row: POLineRow, rule: PolicyRule): boolean {
  if (!rule.enabled) return false;

  // scope filters
  const s = rule.scope;
  if (s?.doc_type && !s.doc_type.includes(row.doc_type)) return false;
  if (s?.customer_name && row.customer_name && !s.customer_name.includes(row.customer_name)) return false;
  if (s?.item_class && !s.item_class.includes(row.item_class)) return false;

  const w = rule.when;

  if (w.edge_case_includes_any?.length) {
    const hit = w.edge_case_includes_any.some(code => row.edge_case_flags.includes(code));
    if (!hit) return false;
  }

  if (w.customer_item_desc_regex && !safeRegexTest(w.customer_item_desc_regex, row.customer_item_desc_raw)) return false;
  if (w.customer_item_no_regex && !safeRegexTest(w.customer_item_no_regex, row.customer_item_no)) return false;
  if (w.mark_instructions_regex && !safeRegexTest(w.mark_instructions_regex, row.mark_instructions)) return false;

  if (typeof w.qty_equals === "number" && row.qty === w.qty_equals) {
      // continues
  } else if (typeof w.qty_equals === "number") return false;

  if (typeof w.unit_price_equals === "number" && row.unit_price === w.unit_price_equals) {
      // continues
  } else if (typeof w.unit_price_equals === "number") return false;

  if (typeof w.extended_price_equals === "number" && row.extended_price === w.extended_price_equals) {
      // continues
  } else if (typeof w.extended_price_equals === "number") return false;

  return true;
}

export function applyPolicyRouting(rows: POLineRow[], policy: ControlSurfacePolicy, ctx: PolicyContext): POLineRow[] {
  const minAuto = policy.defaults.phase_min_confidence_auto[ctx.phase];

  const sortedRules = [...policy.rules].sort((a, b) => b.priority - a.priority);

  return rows.map((row) => {
    let lane = row.automation_lane; // start from whatever extraction did
    let reason = row.routing_reason ?? "";
    const applied: string[] = [];

    // baseline defaults
    // doc type default lane
    const laneForDoc = policy.defaults.lane_for_doc_type?.[row.doc_type];
    if (laneForDoc) {
      lane = laneForDoc as any;
      reason = `Default lane for doc_type=${row.doc_type}`;
      applied.push("DEFAULT:DOC_TYPE");
    }

    // item class default lane
    const laneForClass = policy.defaults.lane_for_item_class?.[row.item_class];
    if (laneForClass) {
      lane = laneForClass as any;
      reason = `Default lane for item_class=${row.item_class}`;
      applied.push("DEFAULT:ITEM_CLASS");
    }

    // apply top-matching rule
    for (const rule of sortedRules) {
      if (matchesRule(row, rule)) {
        lane = rule.then.lane;
        reason = rule.then.reason;
        row.fields_requiring_review = rule.then.fields_requiring_review;
        applied.push(rule.rule_id);
        // Usually break after first high priority match if desired, 
        // but here we allow the last matching (highest priority) to stick.
      }
    }

    // confidence gating for AUTO
    if (lane === "AUTO") {
      const conf = row.confidence_score ?? 0;
      
      // Check required fields for auto (from applied rules)
      const requiredFields = sortedRules
        .filter(r => applied.includes(r.rule_id))
        .map(r => r.then.required_fields_for_auto ?? [])
        .flat();

      const missingRequired = requiredFields.filter((field) => !(row as any)[field]);

      if (missingRequired.length) {
        lane = "REVIEW";
        reason = `Missing required fields for AUTO: ${missingRequired.join(", ")}`;
      } else if (conf < minAuto) {
        lane = "REVIEW";
        reason = `Confidence ${conf.toFixed(2)} < minAuto ${minAuto.toFixed(2)} for ${ctx.phase}`;
      }
    }

    return {
      ...row,
      automation_lane: lane,
      routing_reason: reason,
      policy_version_applied: policy.meta.version,
      policy_rule_ids_applied: applied,
    };
  });
}