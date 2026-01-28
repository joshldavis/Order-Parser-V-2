// policy/controlSurfacePolicy.ts

export type Semver = `${number}.${number}.${number}`;

export type PolicyMeta = {
  policy_id: string;              // stable UUID or slug
  version: Semver;                // e.g., 0.3.0
  created_at: string;             // ISO
  updated_at: string;             // ISO
  author?: string;
  changelog?: string[];
  sha256?: string;                // computed at save/export
};

export type PolicyContext = {
  phase: "PHASE_1" | "PHASE_2" | "PHASE_3";
  customer_name?: string;         // optional scoping
};

export type RoutingAction = {
  lane: "AUTO" | "REVIEW" | "BLOCK" | "ASSIST";
  min_confidence?: number;        // 0..1; if omitted, no confidence gating
  required_fields_for_auto?: string[];  // must be present to AUTO
  fields_requiring_review?: string[];
  reason: string;
};

export type PolicyRule = {
  rule_id: string;                // stable ID for audit trail
  enabled: boolean;
  priority: number;               // higher wins; ties break by order
  scope?: {
    doc_type?: string[];
    customer_name?: string[];
    item_class?: string[];
  };

  // match conditions (simple but effective)
  when: {
    edge_case_includes_any?: string[];     // e.g. ["CREDIT_MEMO", "ZERO_DOLLAR"]
    customer_item_desc_regex?: string;     // regex string
    customer_item_no_regex?: string;
    mark_instructions_regex?: string;
    qty_equals?: number;
    unit_price_equals?: number;
    extended_price_equals?: number;
  };

  then: RoutingAction;
};

export type ControlSurfacePolicy = {
  meta: PolicyMeta;
  defaults: {
    // baselines by phase
    phase_min_confidence_auto: Record<PolicyContext["phase"], number>; // e.g. {PHASE_1: 0.90,...}
    default_lane: "ASSIST" | "REVIEW";
    lane_for_doc_type?: Partial<Record<string, "REVIEW" | "BLOCK" | "ASSIST">>;
    lane_for_item_class?: Partial<Record<string, "AUTO" | "REVIEW" | "ASSIST">>;
  };
  edge_case_codes: string[];     // known codes for validation/UI
  rules: PolicyRule[];
};
