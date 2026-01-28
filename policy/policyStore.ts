// src/policy/policyStore.ts
import { ControlSurfacePolicy } from "./controlSurfacePolicy";

export const DEFAULT_POLICY: ControlSurfacePolicy = {
  meta: {
    policy_id: "abh-po-control-surface",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    changelog: ["Initial policy created from Control Surface template"],
  },
  defaults: {
    phase_min_confidence_auto: {
      PHASE_1: 0.90,
      PHASE_2: 0.95,
      PHASE_3: 0.98,
    },
    default_lane: "ASSIST",
    lane_for_doc_type: {
      CREDIT_MEMO: "REVIEW",
    },
    lane_for_item_class: {
      CATALOG: "AUTO",
      CONFIGURED: "REVIEW",
      CUSTOM: "REVIEW",
    },
  },
  edge_case_codes: [
    "CREDIT_MEMO",
    "SPECIAL_LAYOUT",
    "CUSTOM_LENGTH",
    "ZERO_DOLLAR",
    "THIRD_PARTY_SHIP",
  ],
  rules: [
    {
      rule_id: "R-100",
      enabled: true,
      priority: 100,
      scope: { doc_type: ["CREDIT_MEMO"] },
      when: { edge_case_includes_any: ["CREDIT_MEMO"] },
      then: {
        lane: "REVIEW",
        reason: "Credit memo requires RGA/invoice linkage review",
        fields_requiring_review: ["doc_type", "customer_order_no", "line_items"],
      },
    },
    {
      rule_id: "R-200",
      enabled: true,
      priority: 90,
      when: { edge_case_includes_any: ["ZERO_DOLLAR"] },
      then: {
        lane: "REVIEW",
        reason: "Zero-dollar line requires warranty/replacement classification",
        fields_requiring_review: ["unit_price", "extended_price", "item_class"],
      },
    },
    {
      rule_id: "R-300",
      enabled: true,
      priority: 80,
      when: { edge_case_includes_any: ["SPECIAL_LAYOUT", "CUSTOM_LENGTH"] },
      then: {
        lane: "REVIEW",
        reason: "Special layout / custom dimension present",
        fields_requiring_review: ["customer_item_desc_raw"],
      },
    },
  ],
};