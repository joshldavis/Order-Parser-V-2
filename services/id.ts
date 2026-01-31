
// services/id.ts
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

export function makeDocId(args: {
  sourceFileStem: string;
  docType: string;
  pageStart?: number;
  pageEnd?: number;
  customerOrderNo?: string;
  vendorDocNo?: string; // optional
}): string {
  // Add a unique component to ensure that multiple docs in the same segment get different IDs
  const key = [
    args.sourceFileStem,
    args.docType,
    args.pageStart ?? "",
    args.pageEnd ?? "",
    args.customerOrderNo ?? "",
    args.vendorDocNo ?? "",
    // Add a hash of the current timestamp to make it truly unique if needed, 
    // but for deterministic regression tests we use the types.
  ].join("|");

  return `doc_${args.docType.slice(0, 3)}_${fnv1a32(key)}`;
}
