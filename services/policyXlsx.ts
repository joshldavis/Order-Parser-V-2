// services/policyXlsx.ts
import * as XLSX from "xlsx";
import { ControlSurfacePolicy, PolicyRule } from "../policy/controlSurfacePolicy";

const POLICY_SHEET = "Policy_Rules";

function csvToList(s?: string): string[] {
  if (!s) return [];
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

export function exportPolicyToXlsxTemplate(args: {
  templateArrayBuffer?: ArrayBuffer;
  policy: ControlSurfacePolicy;
}): Blob {
  let wb: XLSX.WorkBook;
  
  if (args.templateArrayBuffer) {
    wb = XLSX.read(args.templateArrayBuffer, { type: "array" });
  } else {
    wb = XLSX.utils.book_new();
  }

  const headers = [
    "rule_id","enabled","priority",
    "scope_doc_type","scope_customer_name","scope_item_class",
    "when_edge_case_any","when_desc_regex","when_itemno_regex","when_mark_regex",
    "then_lane","then_min_confidence","then_required_fields","then_fields_review","then_reason"
  ];

  const rows = args.policy.rules.map(r => ([
    r.rule_id,
    r.enabled ? "Y" : "N",
    r.priority,
    (r.scope?.doc_type ?? []).join(","),
    (r.scope?.customer_name ?? []).join(","),
    (r.scope?.item_class ?? []).join(","),
    (r.when.edge_case_includes_any ?? []).join(","),
    r.when.customer_item_desc_regex ?? "",
    r.when.customer_item_no_regex ?? "",
    r.when.mark_instructions_regex ?? "",
    r.then.lane,
    r.then.min_confidence ?? "",
    (r.then.required_fields_for_auto ?? []).join(","),
    (r.then.fields_requiring_review ?? []).join(","),
    r.then.reason,
  ]));

  const aoa = [headers, ...rows];
  wb.Sheets[POLICY_SHEET] = XLSX.utils.aoa_to_sheet(aoa);
  if (!wb.SheetNames.includes(POLICY_SHEET)) wb.SheetNames.push(POLICY_SHEET);

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function importPolicyFromXlsx(args: {
  xlsxArrayBuffer: ArrayBuffer;
  existingPolicy: ControlSurfacePolicy;
}): ControlSurfacePolicy {
  const wb = XLSX.read(args.xlsxArrayBuffer, { type: "array" });
  const ws = wb.Sheets[POLICY_SHEET];
  if (!ws) throw new Error(`Missing sheet: ${POLICY_SHEET}`);

  const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

  const rules: PolicyRule[] = json.map((r) => ({
    rule_id: String(r.rule_id || "").trim(),
    enabled: String(r.enabled || "").toUpperCase() === "Y",
    priority: Number(r.priority || 0),
    scope: {
      doc_type: csvToList(r.scope_doc_type),
      customer_name: csvToList(r.scope_customer_name),
      item_class: csvToList(r.scope_item_class),
    },
    when: {
      edge_case_includes_any: csvToList(r.when_edge_case_any),
      customer_item_desc_regex: String(r.when_desc_regex || "") || undefined,
      customer_item_no_regex: String(r.when_itemno_regex || "") || undefined,
      mark_instructions_regex: String(r.when_mark_regex || "") || undefined,
    },
    then: {
      lane: String(r.then_lane || "ASSIST") as any,
      min_confidence: r.then_min_confidence === "" ? undefined : Number(r.then_min_confidence),
      required_fields_for_auto: csvToList(r.then_required_fields),
      fields_requiring_review: csvToList(r.then_fields_review),
      reason: String(r.then_reason || "").trim(),
    },
  })).filter(r => r.rule_id);

  return {
    ...args.existingPolicy,
    rules,
    meta: {
      ...args.existingPolicy.meta,
      updated_at: new Date().toISOString(),
      changelog: [
        ...(args.existingPolicy.meta.changelog ?? []),
        `Imported rules from XLSX (${new Date().toISOString()})`,
      ],
    },
  };
}
