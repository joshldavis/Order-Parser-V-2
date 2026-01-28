// reference/referenceLocalStore.ts
import { ReferencePack } from "../referencePack.schema";

const KEY = "orderflow.referencePack";

export const EMPTY_REFERENCE_PACK: ReferencePack = {
  version: "1.0.0",
  manufacturers: [],
  finishes: [],
  categories: [],
  electrified_devices: [],
  wiring_configs: [],
  hardware_sets: []
};

export function loadReferencePack(): ReferencePack {
  const raw = localStorage.getItem(KEY);
  if (!raw) return EMPTY_REFERENCE_PACK;
  try {
    const parsed = JSON.parse(raw);
    // Basic validation to ensure it looks like a ReferencePack
    if (!parsed.version || !Array.isArray(parsed.manufacturers)) {
      return EMPTY_REFERENCE_PACK;
    }
    return parsed;
  } catch {
    return EMPTY_REFERENCE_PACK;
  }
}

export function saveReferencePack(pack: ReferencePack) {
  localStorage.setItem(KEY, JSON.stringify(pack));
}

export function clearReferencePack() {
  localStorage.removeItem(KEY);
}
