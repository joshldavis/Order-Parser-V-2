// setup/orgProfile.types.ts

export type SetupStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";

export type TruthSourceType = "ERP_EXPORT" | "CONTROL_WORKBOOK" | "MANUAL_JSON";

export type ExclusionAction = "HUMAN_REVIEW" | "MANUAL_PROCESS" | "BLOCK";

export interface CalibrationDatasetSummary {
  dataset_id: string;
  version: string; // "1.0.0"
  created_at: string; // ISO
  n_docs: number;
  n_lines: number;

  // v1: user-reported / computed later
  join_match_rate?: number; // 0..1
  ece?: number; // 0..+ (lower better)
  brier_score?: number; // 0..+ (lower better)

  notes?: string;
}

export interface OutputTemplateSummary {
  output_template_id: string;
  name: string;
  created_at: string;
  required_audit_columns_present: boolean;
}

export interface CatalogSummary {
  catalog_version_id: string;
  name: string;
  created_at: string;
}

export interface ExclusionRule {
  reason_code: string;
  action: ExclusionAction;
  description?: string;
  keywords?: string[]; // Trigger keywords for auto-detection
  instructions?: string; // Guidance for the reviewer when this flag is raised
  scope_doc_type?: string[]; // Optional: only apply to these doc types
}

export interface PolicySummary {
  policy_version_id: string; 
  created_at: string;
  auto_process_min: number; 
  review_min: number; 
  block_below: number; 
  exclusions: ExclusionRule[];
}

export interface OrgSetupProfile {
  org_profile_id: string;
  org_name: string;
  status: SetupStatus;
  updated_at: string; // ISO

  truth_source_type?: TruthSourceType;

  calibration?: CalibrationDatasetSummary;
  catalog?: CatalogSummary;
  output_template?: OutputTemplateSummary;
  policy?: PolicySummary;
}

export function isSetupComplete(p?: OrgSetupProfile | null): boolean {
  if (!p) return false;
  return !!(
    p.catalog?.catalog_version_id &&
    p.policy?.policy_version_id &&
    p.status === "COMPLETE"
  );
}
