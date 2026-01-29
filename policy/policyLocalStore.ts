// policy/policyLocalStore.ts
import { ControlSurfacePolicy } from "./controlSurfacePolicy.ts";
import { DEFAULT_POLICY } from "./policyStore.ts";

const KEY = "control_surface_policy_v1";

export function loadPolicy(): ControlSurfacePolicy {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_POLICY;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("LocalStorage loadPolicy failed", e);
    return DEFAULT_POLICY;
  }
}

export function savePolicy(policy: ControlSurfacePolicy) {
  try {
    localStorage.setItem(KEY, JSON.stringify(policy));
  } catch (e) {
    console.warn("LocalStorage savePolicy failed", e);
  }
}