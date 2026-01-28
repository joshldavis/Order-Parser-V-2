// policy/policyLocalStore.ts
import { ControlSurfacePolicy } from "./controlSurfacePolicy";
import { DEFAULT_POLICY } from "./policyStore";

const KEY = "control_surface_policy_v1";

export function loadPolicy(): ControlSurfacePolicy {
  const raw = localStorage.getItem(KEY);
  if (!raw) return DEFAULT_POLICY;
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULT_POLICY;
  }
}

export function savePolicy(policy: ControlSurfacePolicy) {
  localStorage.setItem(KEY, JSON.stringify(policy));
}
