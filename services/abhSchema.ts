/**
 * ABH PO Automation — JSON Export v1
 * - Includes: (1) JSON Schema v1 (fixed), (2) TypeScript types,
 *            (3) example payloads, (4) tiny helpers for export + download,
 */

export const ABH_PO_V1_SCHEMA_ID =
  "https://abh.example/schemas/po-automation/abh.po.v1.schema.json";

export const ABH_PO_V1_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ABH_PO_V1_SCHEMA_ID,
  title: "ABH PO Automation Export Schema v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "export_id",
    "exported_at",
    "source",
    "document",
    "parties",
    "order",
    "line_items",
    "confidence",
    "routing",
    "audit",
  ],
  properties: {
    schema_version: { type: "string", const: "abh.po.v1" },
    export_id: { type: "string" },
    exported_at: { type: "string", format: "date-time" },
    source: {
      type: "object",
      required: ["system", "app_version", "run_mode"],
      properties: {
        system: { type: "string" },
        app_version: { type: "string" },
        run_mode: { type: "string", enum: ["SHADOW", "PILOT", "PRODUCTION"] },
        environment: { type: "string", enum: ["DEV", "TEST", "PROD"] },
      },
    },
    document: {
      type: "object",
      required: ["document_id", "document_type", "file"],
      properties: {
        document_id: { type: "string" },
        document_type: {
          type: "string",
          enum: ["PURCHASE_ORDER","SALES_ORDER","INVOICE","CREDIT_MEMO","PICKING_SHEET","EMAIL_COVER","UNKNOWN"]
        },
        file: { type: "object", required: ["filename"], properties: { filename: { type: "string" } } },
        source_pages: {
          type: "array",
          items: { type: "number" },
          description: "0-based page indexes that were used as evidence for this document"
        },
        page_start: { type: "number", description: "0-based inclusive" },
        page_end: { type: "number", description: "0-based inclusive" },
      },
    },
    parties: {
      type: "object",
      required: ["customer", "vendor"],
      properties: {
        customer: { type: "object", properties: { name: { type: "string" } } },
        vendor: { type: "object", properties: { name: { type: "string" } } },
      },
    },
    order: {
      type: "object",
      required: ["order_type"],
      properties: {
        order_type: {
          type: "string",
          enum: ["PURCHASE_ORDER","SALES_ORDER","INVOICE","CREDIT_MEMO","PICKING_SHEET","EMAIL_COVER","UNKNOWN"]
        },
        customer_order_no: { type: "string" },
        order_date: { type: "string" },
        currency: { type: "string" },
        addresses: {
          type: "object",
          properties: {
            ship_to_name: { type: "string" },
            mark_for: { type: "string" }
          }
        }
      },
    },
    line_items: { type: "array", items: { type: "object" } },
    confidence: { type: "object", required: ["overall_confidence", "auto_process_eligible"] },
    routing: { type: "object", required: ["decision", "reason_codes"] },
    audit: { type: "object", required: ["events"] },
  },
};

export type RunMode = "SHADOW" | "PILOT" | "PRODUCTION";
export type Env = "DEV" | "TEST" | "PROD";

export type DocumentType =
  | "PURCHASE_ORDER"
  | "SALES_ORDER"
  | "INVOICE"
  | "CREDIT_MEMO"
  | "PICKING_SHEET"
  | "EMAIL_COVER"
  | "UNKNOWN";

export type OrderType = DocumentType;
export type RoutingDecision = "AUTO_STAGE" | "REVIEW" | "HUMAN_REQUIRED" | "REJECTED";

export type RoutingReasonCode =
  | "ALL_LINES_HIGH_CONFIDENCE"
  | "LOW_CONFIDENCE_FIELDS_PRESENT"
  | "MISSING_REQUIRED_FIELDS"
  | "CREDIT_MEMO_DETECTED"
  | "SPECIAL_LAYOUT_DETECTED"
  | "CUSTOM_DIMENSION_DETECTED"
  | "ZERO_DOLLAR_LINE_DETECTED"
  | "THIRD_PARTY_SHIP_DETECTED"
  | "PARSING_ERROR"
  | "POLICY_BLOCK";

export type LineFlag =
  | "SPECIAL_LAYOUT"
  | "CUSTOM_DIMENSION"
  | "ZERO_DOLLAR"
  | "THIRD_PARTY_SHIP"
  | "CREDIT_MEMO_CONTEXT"
  | "MISSING_ITEM_NO"
  | "MISSING_QTY"
  | "AMBIGUOUS_UOM"
  | "LOW_CONFIDENCE";

export type ModifierType =
  | "CUT_TO_LENGTH"
  | "SPECIAL_LAYOUT"
  | "POWER_TRANSFER_CUTOUT"
  | "WIRING_SPEC"
  | "HANDING"
  | "FINISH"
  | "OTHER";

export type SignalType =
  | "EXACT_CATALOG_MATCH"
  | "FUZZY_MATCH"
  | "REGEX_MATCH"
  | "HISTORICAL_MATCH"
  | "MODEL_CONSENSUS"
  | "LAYOUT_KEYWORD"
  | "PRICE_SANITY_CHECK"
  | "UOM_SANITY_CHECK";

export interface Party {
  name: string;
  account_id?: string;
  contact?: {
    email?: string;
    phone?: string;
  };
}

export interface Address {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface Modifier {
  type: ModifierType;
  value?: string;
  structured?: Record<string, unknown>;
}

export interface Signal {
  type: SignalType;
  weight: number;
  detail?: string;
}

export interface LineItem {
  line_id: string;
  raw: {
    raw_text: string;
    page?: number;
    line_no?: number;
  };
  parsed: {
    customer_item_no?: string;
    abh_item_no?: string;
    manufacturer?: string;
    description?: string;
    quantity: number;
    uom: string;
    unit_price?: number;
    extended_price?: number;
    discount?: number;
    currency?: string;
    attributes?: Record<string, unknown>;
    modifiers?: Modifier[];
  };
  confidence: {
    line_confidence: number;
    field_confidence: Partial<Record<string, number>>;
    signals: Signal[];
  };
  flags: LineFlag[];
}

export interface AuditEvent {
  at: string;
  event_type: string;
  actor?: "SYSTEM" | "HUMAN";
  details?: Record<string, unknown>;
}

export interface POExportV1 {
  schema_version: "abh.po.v1";
  export_id: string;
  exported_at: string;
  source: {
    system: string;
    app_version: string;
    run_mode: RunMode;
    environment?: Env;
  };
  document: {
    document_id: string;
    document_type: DocumentType;
    file: {
      filename: string;
      mime_type?: string;
      page_count?: number;
    };
    source_pages?: number[];
    page_start?: number;
    page_end?: number;
  };
  parties: {
    customer: Party;
    vendor: Party;
  };
  order: {
    order_type: OrderType;
    customer_order_no?: string;
    order_date?: string;
    currency?: string;
    addresses?: {
      bill_to?: Address;
      ship_to?: Address;
      ship_to_name?: string;
      mark_for?: string;
    };
  };
  line_items: LineItem[];
  confidence: {
    overall_confidence: number;
    auto_process_eligible: boolean;
    thresholds: { auto_stage_min: number; review_min: number };
  };
  routing: {
    decision: RoutingDecision;
    reason_codes: RoutingReasonCode[];
    routing_notes?: string;
  };
  audit: {
    events: AuditEvent[];
  };
}

export function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
