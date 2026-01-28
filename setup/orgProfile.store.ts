// setup/orgProfile.store.ts
import { OrgSetupProfile } from "./orgProfile.types";

const KEY = "orderflow_org_profile_v1";

function nowIso() {
  return new Date().toISOString();
}

export function loadOrgProfile(): OrgSetupProfile | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OrgSetupProfile;
  } catch {
    return null;
  }
}

export function saveOrgProfile(profile: OrgSetupProfile) {
  const toSave: OrgSetupProfile = {
    ...profile,
    updated_at: nowIso(),
  };
  localStorage.setItem(KEY, JSON.stringify(toSave));
}

export function resetOrgProfile() {
  localStorage.removeItem(KEY);
}

export function ensureOrgProfileSeed(): OrgSetupProfile {
  const existing = loadOrgProfile();
  if (existing) return existing;

  const seeded: OrgSetupProfile = {
    org_profile_id: crypto.randomUUID(),
    org_name: "Default Org",
    status: "NOT_STARTED",
    updated_at: nowIso(),
  };
  saveOrgProfile(seeded);
  return seeded;
}
