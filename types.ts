// types.ts

export type DocType =
  | "PURCHASE_ORDER"
  | "CREDIT_MEMO"
  | "INVOICE"
  | "SALES_ORDER"
  | "PICKING_SHEET"
  | "EMAIL_COVER"
  | "UNKNOWN";

export type AutomationLane = "AUTO" | "REVIEW" | "BLOCK" | "ASSIST";
export type ItemClass = "CATALOG" | "CONFIGURED" | "CUSTOM" | "UNKNOWN";

export type POLineRow = {
  // --- doc-level identifiers
  doc_id: string;
  doc_type: DocType;

  // segment evidence (debugging / regression)
  source_pages?: number[];   // 0-based page indexes
  page_start?: number;       // 0-based inclusive
  page_end?: number;         // 0-based inclusive

  customer_name?: string;
  customer_order_no?: string;
  abh_order_no?: string;
  document_date?: string;

  // shipping/billing
  ship_to_name?: string;
  ship_to_address_raw?: string;
  bill_to_name?: string;
  bill_to_address_raw?: string;
  mark_instructions?: string;

  // --- line-level fields
  line_no: number;
  customer_item_no?: string;
  customer_item_desc_raw?: string;

  qty?: number;
  uom?: string;

  unit_price?: number;
  extended_price?: number;
  currency?: string;

  // ABH mapping
  abh_item_no_candidate?: string;
  abh_item_no_final?: string;

  // Extra attributes
  manufacturer?: string;
  finish?: string;
  category?: string;

  // classification + detection
  item_class: ItemClass;
  edge_case_flags: string[];
  raw_edge_case_notes?: string;

  // confidence (0..1 internal)
  confidence_score?: number;

  // policy outcomes
  automation_lane: AutomationLane;
  routing_reason?: string;
  fields_requiring_review?: string[];

  // audit
  policy_version_applied?: string;
  policy_rule_ids_applied?: string[];
  
  // compatibility helpers
  match_score?: number;
  sage_import_ready?: boolean;
  sage_blockers?: string[];
};

// Internal interface for parsing results from geminiService
import { POExportV1 } from "./services/abhSchema.ts";

export interface GeminiParsingResult {
  documents: POExportV1[];
}
