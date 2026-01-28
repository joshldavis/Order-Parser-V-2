// reference/referenceVersioning.ts
import { ReferencePack } from "../referencePack.schema";

export function bumpReferenceVersion(current: string, kind: "major" | "minor" | "patch"): string {
  const parts = current.split(".").map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return "1.0.0";
  
  let [M, m, p] = parts;
  if (kind === "major") return `${M + 1}.0.0`;
  if (kind === "minor") return `${M}.${m + 1}.0`;
  return `${M}.${m}.${p + 1}`;
}

export function finalizeReferencePack(pack: ReferencePack, versionBump?: "major" | "minor" | "patch"): ReferencePack {
  const newVersion = versionBump 
    ? bumpReferenceVersion(pack.version, versionBump) 
    : pack.version;
    
  return {
    ...pack,
    version: newVersion,
    updated_at: new Date().toISOString()
  };
}
