
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GeminiParsingResult } from "../types.ts";
import { ReferencePack } from "../referencePack.schema.ts";

type InlinePart = { base64: string; mimeType: string };

const MODIFIER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING, description: "One of: CUT_TO_LENGTH, SPECIAL_LAYOUT, POWER_TRANSFER_CUTOUT, WIRING_SPEC, HANDING, FINISH, OTHER" },
    value: { type: Type.STRING },
  },
  required: ["type"]
};

const LINE_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    line_id: { type: Type.STRING },
    raw: {
      type: Type.OBJECT,
      properties: { raw_text: { type: Type.STRING } },
      required: ["raw_text"]
    },
    parsed: {
      type: Type.OBJECT,
      properties: {
        customer_item_no: { type: Type.STRING },
        abh_item_no: { type: Type.STRING },
        manufacturer: { type: Type.STRING },
        description: { type: Type.STRING },
        quantity: { type: Type.NUMBER },
        uom: { type: Type.STRING },
        unit_price: { type: Type.NUMBER },
        extended_price: { type: Type.NUMBER },
        modifiers: { type: Type.ARRAY, items: MODIFIER_SCHEMA }
      },
      required: ["description", "quantity", "uom"]
    },
    confidence: {
      type: Type.OBJECT,
      properties: { line_confidence: { type: Type.NUMBER } },
      required: ["line_confidence"]
    },
    flags: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ["line_id", "raw", "parsed", "confidence", "flags"]
};

const ABH_DOCUMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    schema_version: { type: Type.STRING },
    document: {
      type: Type.OBJECT,
      properties: {
        document_id: { type: Type.STRING, description: "Ensure this is unique within the array" },
        document_type: { type: Type.STRING, description: "PURCHASE_ORDER, SALES_ORDER, INVOICE, CREDIT_MEMO, PICKING_SHEET, EMAIL_COVER, UNKNOWN" },
        source_pages: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "0-based page indexes used as evidence" },
        page_start: { type: Type.NUMBER, description: "0-based inclusive" },
        page_end: { type: Type.NUMBER, description: "0-based inclusive" },
      },
      required: ["document_id", "document_type", "source_pages", "page_start", "page_end"]
    },
    parties: {
      type: Type.OBJECT,
      properties: {
        customer: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
        vendor: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] }
      },
      required: ["customer", "vendor"]
    },
    order: {
      type: Type.OBJECT,
      properties: {
        order_type: { type: Type.STRING, description: "Match document_type" },
        customer_order_no: { type: Type.STRING },
        order_date: { type: Type.STRING, description: "YYYY-MM-DD" },
        currency: { type: Type.STRING, description: "USD, CAD, etc." },
      },
      required: ["order_type"]
    },
    line_items: {
      type: Type.ARRAY,
      items: LINE_ITEM_SCHEMA
    },
    confidence: {
      type: Type.OBJECT,
      properties: { overall_confidence: { type: Type.NUMBER }, auto_process_eligible: { type: Type.BOOLEAN } }
    },
    routing: {
      type: Type.OBJECT,
      properties: { decision: { type: Type.STRING }, reason_codes: { type: Type.ARRAY, items: { type: Type.STRING } } }
    }
  },
  required: ["schema_version", "document", "order", "line_items"]
};

const PARSER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documents: {
      type: Type.ARRAY,
      items: ABH_DOCUMENT_SCHEMA
    }
  },
  required: ["documents"]
};

export async function parseDocument(
  fileBase64: string, 
  mimeType: string, 
  ocrText?: string,
  refPack?: ReferencePack,
  onStatusUpdate?: (status: string) => void,
  segmentHint?: { label: string; pageRange: string }
): Promise<GeminiParsingResult> {
  
  if (onStatusUpdate) onStatusUpdate("Initializing Ultra-Fast AI Engine...");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Fix: Reference segmentHint.pageRange instead of hintText which is currently being defined
  const hintText = segmentHint 
    ? `\nSEGMENT CONTEXT: You are processing a specific document segment. Pages: ${segmentHint.pageRange}. Predicted Document Type: ${segmentHint.label}.`
    : "";

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            text: `EXTRACT ENTERPRISE ORDER DATA INTO ABH PO V1 FORMAT:
            - Target Document Types: PURCHASE_ORDER, SALES_ORDER, INVOICE, CREDIT_MEMO, PICKING_SHEET.
            - Accurately identify all line items including Part Numbers, Quantities, and Descriptions.
            - Extract header data: Order Number, Dates, and Parties.
            - Identify special conditions like Credit Memos or Special Layouts.
            - Output strictly as JSON following the provided schema.${hintText}
            ${ocrText ? `OCR HINT DATA: ${ocrText}` : ''}`
          },
          {
            inlineData: {
              data: fileBase64,
              mimeType: mimeType,
            },
          },
        ],
      },
    ],
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: PARSER_SCHEMA,
    },
  });

  if (!response.text) {
    throw new Error("Gemini API returned an empty response.");
  }

  try {
    return JSON.parse(response.text.trim()) as GeminiParsingResult;
  } catch (e) {
    console.error("Failed to parse Gemini JSON:", response.text);
    throw new Error("The AI returned a malformed data structure.");
  }
}

export async function parsePacketSegment(
  parts: InlinePart[],
  segmentContext: {
    segmentLabelHint?: string;
    sourcePages: number[];
    pageStart: number;
    pageEnd: number;
    packetFilename?: string;
    triageTextHint?: string; // optional
  },
  refPack?: ReferencePack,
  onStatusUpdate?: (status: string) => void
): Promise<GeminiParsingResult> {

  if (onStatusUpdate) onStatusUpdate(`Parsing segment pages ${segmentContext.pageStart + 1}-${segmentContext.pageEnd + 1}...`);
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const triageHint = segmentContext.triageTextHint ? `\nTRIAGE_TEXT_HINT:\n${segmentContext.triageTextHint}\n` : "";

  const prompt = `
You are parsing document pages from an ABH packet. 

EXTRACT ALL LOGICAL DOCUMENTS:
- The provided pages might contain ONE or MORE distinct documents (e.g. an Invoice and a separate Sales Order).
- Return one entry in the "documents" array for EVERY logical document found.
- Ensure each document has a unique "document_id".
- Classify each document_type correctly:
  PURCHASE_ORDER, SALES_ORDER, INVOICE, CREDIT_MEMO, PICKING_SHEET, EMAIL_COVER, UNKNOWN
- If prices are missing (e.g. Picking Sheet), do NOT hallucinate them.

SEGMENT META (must mirror):
- source_pages: ${JSON.stringify(segmentContext.sourcePages)}
- page_start: ${segmentContext.pageStart}
- page_end: ${segmentContext.pageEnd}
- label_hint: ${segmentContext.segmentLabelHint || "NONE"}

OUTPUT:
- Strict JSON only (schema enforced).
${triageHint}
`.trim();

  const contentParts: any[] = [{ text: prompt }];

  for (const p of parts) {
    contentParts.push({
      inlineData: { data: p.base64, mimeType: p.mimeType },
    });
  }

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts: contentParts }],
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: PARSER_SCHEMA,
    },
  });

  if (!response.text) throw new Error("Gemini returned empty response.");
  try {
    return JSON.parse(response.text.trim()) as GeminiParsingResult;
  } catch (e) {
    console.error("Failed to parse Gemini JSON:", response.text);
    throw new Error("The AI returned a malformed data structure.");
  }
}
