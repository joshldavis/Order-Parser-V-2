// setup/orgProfile.store.ts
import { OrgSetupProfile } from "./orgProfile.types.ts";

const KEY = "orderflow_org_profile_v1";
const POLICY_KEY = "control_surface_policy_v1";
const REF_KEY = "orderflow.referencePack";

function nowIso() {
  return new Date().toISOString();
}

export function loadOrgProfile(): OrgSetupProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OrgSetupProfile;
  } catch (e) {
    console.warn("LocalStorage loadOrgProfile failed", e);
    return null;
  }
}

export function saveOrgProfile(profile: OrgSetupProfile) {
  try {
    const toSave: OrgSetupProfile = {
      ...profile,
      updated_at: nowIso(),
    };
    localStorage.setItem(KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("LocalStorage saveOrgProfile failed", e);
  }
}

/**
 * Perform a full "Factory Reset" of the setup state.
 * Clears Org Profile, Policy, and Reference Pack.
 */
export function resetOrgProfile() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(POLICY_KEY);
    localStorage.removeItem(REF_KEY);
  } catch (e) {
    console.warn("LocalStorage resetOrgProfile failed", e);
  }
}

export function ensureOrgProfileSeed(): OrgSetupProfile {
  const existing = loadOrgProfile();
  if (existing) return existing;

  const seeded: OrgSetupProfile = {
    org_profile_id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
    org_name: "Default Org",
    status: "NOT_STARTED",
    updated_at: nowIso(),
  };
  saveOrgProfile(seeded);
  return seeded;
}