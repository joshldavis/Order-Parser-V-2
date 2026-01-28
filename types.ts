// types.ts

export type DocType = "PURCHASE_ORDER" | "CREDIT_MEMO" | "INVOICE" | "UNKNOWN";
export type AutomationLane = "AUTO" | "REVIEW" | "BLOCK" | "ASSIST";
export type ItemClass = "CATALOG" | "CONFIGURED" | "CUSTOM" | "UNKNOWN";

export type POLineRow = {
  // --- doc-level identifiers
  doc_id: string;
  doc_type: DocType;

  customer_name?: string;
  customer_order_no?: string;     // aka customer_po_number
  abh_order_no?: string;          // ABH internal order (if known later)
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

  // classification + detection
  item_class: ItemClass;
  edge_case_flags: string[];         // normalized list
  raw_edge_case_notes?: string;      // optional, for traceability

  // confidence (0..1 internal)
  confidence_score?: number;

  // policy outcomes
  automation_lane: AutomationLane;
  routing_reason?: string;
  fields_requiring_review?: string[];

  // audit
  policy_version_applied?: string;
  policy_rule_ids_applied?: string[];
  
  // compatibility helpers (derived or mapped)
  match_score?: number;
  sage_import_ready?: boolean;
  sage_blockers?: string[];
};

// --- API interfaces for Gemini integration ---
export enum DocumentType {
  INVOICE = 'Invoice',
  SALES_ORDER = 'Sales Order',
  PURCHASE_ORDER = 'Purchase Order',
  PICKING_SHEET = 'Picking Sheet',
  UNKNOWN = 'Unknown'
}

export interface DocumentData {
  documentType: DocumentType;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  vendorName: string;
  customerPO: string;
  currency: string;
  billToAddressRaw?: string;
  shipToAddressRaw?: string;
  markInstructions?: string;
  lineItems: Array<{
    itemNumber: string;
    description: string;
    unit: string;
    quantityOrdered: number;
    quantityShipped: number;
    unitPrice: number;
    totalAmount: number;
    manufacturer?: string;
    finish?: string;
    category?: string;
    voltage?: string;
    failMode?: string;
  }>;
}

export interface GeminiParsingResult {
  documents: DocumentData[];
}
