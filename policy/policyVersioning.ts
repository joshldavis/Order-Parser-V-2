// src/policy/policyVersioning.ts
import { ControlSurfacePolicy } from "./controlSurfacePolicy";

async function sha256String(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function finalizePolicy(policy: ControlSurfacePolicy): Promise<ControlSurfacePolicy> {
  const cloned: ControlSurfacePolicy = JSON.parse(JSON.stringify(policy));
  cloned.meta.updated_at = new Date().toISOString();

  // hash without sha itself
  const tmp = JSON.parse(JSON.stringify(cloned));
  delete tmp.meta.sha256;
  const hash = await sha256String(JSON.stringify(tmp));

  cloned.meta.sha256 = hash;
  return cloned;
}

export function bumpVersion(current: string, kind: "major" | "minor" | "patch"): string {
  const [M, m, p] = current.split(".").map(n => parseInt(n, 10));
  if ([M, m, p].some(n => Number.isNaN(n))) return "0.1.0";
  if (kind === "major") return `${M + 1}.0.0`;
  if (kind === "minor") return `${M}.${m + 1}.0`;
  return `${M}.${m}.${p + 1}`;
}
