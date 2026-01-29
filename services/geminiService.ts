import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GeminiParsingResult } from "../types.ts";
import { ReferencePack } from "../referencePack.schema.ts";

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
        document_type: { type: Type.STRING, description: "PURCHASE_ORDER, SALES_ORDER, INVOICE, or CREDIT_MEMO" },
      },
      required: ["document_type"]
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
        order_type: { type: Type.STRING, description: "PURCHASE_ORDER or CREDIT_MEMO" },
        customer_order_no: { type: Type.STRING },
        order_date: { type: Type.STRING, description: "YYYY-MM-DD" },
        currency: { type: Type.STRING, description: "USD, CAD, etc." },
      },
      required: ["order_type", "customer_order_no"]
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
  onStatusUpdate?: (status: string) => void
): Promise<GeminiParsingResult> {
  
  if (onStatusUpdate) onStatusUpdate("Initializing AI Engine...");

  // Initialize inside function to avoid top-level process.env dependency
  const apiKey = (window as any).process?.env?.API_KEY || "";
  const ai = new GoogleGenAI({ apiKey });

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: [
      {
        parts: [
          {
            text: `EXTRACT ENTERPRISE ORDER DATA INTO ABH PO V1 FORMAT:
            - Accurately identify all line items including Part Numbers, Quantities, and Descriptions.
            - Extract header data: PO Number, Dates, and Parties.
            - Identify special conditions like Credit Memos or Special Layouts.
            - Output strictly as JSON following the provided schema.
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
      thinkingConfig: { thinkingBudget: 4000 },
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