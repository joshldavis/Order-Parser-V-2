// reference/referenceLocalStore.ts
import { ReferencePack } from "../referencePack.schema.ts";

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
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_REFERENCE_PACK;
    const parsed = JSON.parse(raw);
    if (!parsed.version || !Array.isArray(parsed.manufacturers)) {
      return EMPTY_REFERENCE_PACK;
    }
    return parsed;
  } catch (e) {
    console.warn("LocalStorage loadReferencePack failed", e);
    return EMPTY_REFERENCE_PACK;
  }
}

export function saveReferencePack(pack: ReferencePack) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pack));
  } catch (e) {
    console.warn("LocalStorage saveReferencePack failed", e);
  }
}

export function clearReferencePack() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    console.warn("LocalStorage clearReferencePack failed", e);
  }
}