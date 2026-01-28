import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GeminiParsingResult } from "../types";
import { ReferencePack } from "../referencePack.schema";

// Initialize with named parameter and direct process.env reference
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const DOCUMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documentType: {
      type: Type.STRING,
      description: "Document type: e.g., 'Purchase Order', 'Sales Order', 'Invoice'.",
    },
    orderNumber: {
      type: Type.STRING,
      description: "The primary reference number (Order #, PO #, Invoice #).",
    },
    orderDate: {
      type: Type.STRING,
      description: "Date of issuance as written on the doc.",
    },
    customerName: {
      type: Type.STRING,
      description: "Full name of the customer or purchasing entity.",
    },
    vendorName: {
      type: Type.STRING,
      description: "Full name of the seller or issuing entity.",
    },
    customerPO: {
      type: Type.STRING,
      description: "Reference PO number provided by the customer.",
    },
    currency: {
      type: Type.STRING,
      description: "ISO currency code or symbol found.",
    },
    billToAddressRaw: { 
      type: Type.STRING, 
      description: "Complete Bill-To block text." 
    },
    shipToAddressRaw: { 
      type: Type.STRING, 
      description: "Complete Ship-To block text." 
    },
    markInstructions: { 
      type: Type.STRING, 
      description: "Special 'MARK FOR' or delivery instructions." 
    },
    lineItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          itemNumber: { type: Type.STRING, description: "Part Number or SKU." },
          description: { type: Type.STRING, description: "Full item description." },
          unit: { type: Type.STRING, description: "UOM (EA, FT, PC, etc.)." },
          quantityOrdered: { type: Type.NUMBER, description: "Total quantity ordered." },
          quantityShipped: { type: Type.NUMBER, description: "Total quantity shipped/supplied." },
          unitPrice: { type: Type.NUMBER, description: "Cost per single unit." },
          totalAmount: { type: Type.NUMBER, description: "Line extension total." },
          manufacturer: { type: Type.STRING, description: "Identified manufacturer from Ref Pack or text." },
          finish: { type: Type.STRING, description: "Identified finish code (e.g. US26D)." },
          category: { type: Type.STRING, description: "Identified hardware category." },
          voltage: { type: Type.STRING, description: "Voltage if electrified (e.g. 12V, 24V)." },
          failMode: { type: Type.STRING, description: "Fail Safe/Secure if applicable." },
        },
        required: ["itemNumber", "description"],
      },
    },
  },
  required: ["documentType", "orderNumber", "lineItems"],
};

const PARSER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documents: {
      type: Type.ARRAY,
      description: "A list of distinct business documents extracted from the file.",
      items: DOCUMENT_SCHEMA,
    }
  },
  required: ["documents"]
};

/**
 * Enhanced retry helper for 429 Resource Exhausted errors.
 * Uses a 10s base delay for rate limits to ensure the window resets.
 */
async function withRetry<T>(fn: () => Promise<T>, onRetry?: (msg: string) => void, retries = 5, delay = 10000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorStr = JSON.stringify(error).toUpperCase();
    const messageStr = (error?.message || "").toUpperCase();
    
    const isRateLimit = 
      error?.status === 429 || 
      error?.error?.code === 429 ||
      errorStr.includes("429") || 
      errorStr.includes("RESOURCE_EXHAUSTED") ||
      messageStr.includes("429") ||
      messageStr.includes("RESOURCE_EXHAUSTED") ||
      messageStr.includes("QUOTA");

    if (isRateLimit && retries > 0) {
      const waitTime = Math.round(delay / 1000);
      const waitMsg = `Quota reached. Waiting ${waitTime}s for reset...`;
      if (onRetry) onRetry(waitMsg);
      console.warn(waitMsg);
      await new Promise(resolve => setTimeout(resolve, delay));
      // Exponentially increase delay for subsequent rate limits
      return withRetry(fn, onRetry, retries - 1, delay * 1.5);
    }
    throw error;
  }
}

export async function parseDocument(
  fileBase64: string, 
  mimeType: string, 
  ocrText?: string,
  refPack?: ReferencePack,
  onStatusUpdate?: (status: string) => void
): Promise<GeminiParsingResult> {
  
  let refContext = '';
  if (refPack) {
    refContext = `
    INDUSTRIAL KNOWLEDGE BASE (Reference Pack v${refPack.version}):
    - Known Manufacturers: ${refPack.manufacturers.map(m => `${m.name} (${m.abbr})`).join(', ')}
    - Standard Finishes: ${refPack.finishes.map(f => f.us_code).join(', ')}
    - Hardware Categories: ${refPack.categories.map(c => c.category).join(', ')}
    
    INSTRUCTION: Normalize extracted data against this KB.
    `;
  }

  const response: GenerateContentResponse = await withRetry(
    () => ai.models.generateContent({
      // Switched to Flash for better rate limit tolerance in batch scenarios
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              text: `EXTRACT DATA:
              1. Header details (IDs, Dates, Entities).
              2. ALL line items.
              3. Normalize Mfr/Finish/Category based on context.

              ${refContext}
              ${ocrText ? `OCR HINT:\n${ocrText}` : ''}

              Return JSON following schema.`
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
        responseMimeType: "application/json",
        responseSchema: PARSER_SCHEMA,
        temperature: 0.1,
      },
    }),
    onStatusUpdate
  );

  if (!response.text) {
    throw new Error("Empty response from AI engine");
  }

  try {
    return JSON.parse(response.text.trim()) as GeminiParsingResult;
  } catch (e) {
    console.error("JSON Parsing failed", e, response.text);
    throw new Error("AI returned invalid JSON.");
  }
}
