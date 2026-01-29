import React, { useMemo, useState } from "react";
import { ControlSurfacePolicy, PolicyRule } from "../policy/controlSurfacePolicy.ts";
import { bumpVersion, finalizePolicy } from "../policy/policyVersioning.ts";
import { savePolicy } from "../policy/policyLocalStore.ts";
import { importPolicyFromXlsx, exportPolicyToXlsxTemplate } from "../services/policyXlsx.ts";
import { HeaderInfo } from "./SharedUI.tsx";

type Props = {
  policy: ControlSurfacePolicy;
  onPolicyChange: (p: ControlSurfacePolicy) => void;
};

function newRule(): PolicyRule {
  return {
    rule_id: `R-${Math.floor(Math.random() * 9000) + 1000}`,
    enabled: true,
    priority: 50,
    when: {},
    then: { lane: "ASSIST", reason: "New rule" },
  };
}

export function PolicyAdmin({ policy, onPolicyChange }: Props) {
  const [importFile, setImportFile] = useState<File | null>(null);

  const sortedRules = useMemo(
    () => [...policy.rules].sort((a, b) => b.priority - a.priority),
    [policy.rules]
  );

  function updateRule(rule_id: string, patch: Partial<PolicyRule>) {
    onPolicyChange({
      ...policy,
      rules: policy.rules.map(r => r.rule_id === rule_id ? { ...r, ...patch } : r),
    });
  }

  async function save(kind: "patch" | "minor" | "major") {
    const bumped = { ...policy, meta: { ...policy.meta, version: bumpVersion(policy.meta.version, kind) as any } };
    const finalized = await finalizePolicy(bumped);
    savePolicy(finalized);
    onPolicyChange(finalized);
    alert(`Policy v${finalized.meta.version} saved to local storage.`);
  }

  async function doExportPolicyXlsx() {
    try {
      const blob = exportPolicyToXlsxTemplate({ policy });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OrderFlow_Policy_v${policy.meta.version}_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Export failed: " + err.message);
    }
  }

  async function doImportPolicyXlsx() {
    if (!importFile) return alert("Select a policy XLSX file first.");
    try {
      const buf = await importFile.arrayBuffer();
      const merged = importPolicyFromXlsx({ xlsxArrayBuffer: buf, existingPolicy: policy });
      onPolicyChange(merged);
      alert("Rules imported. Changes are live in your session—click 'Patch/Minor/Major' above to commit to persistent storage.");
    } catch (err: any) {
      alert("Import failed: " + err.message);
    }
  }

  const getLaneColor = (lane: string) => {
    switch (lane) {
      case 'AUTO': return 'text-emerald-600 bg-emerald-50';
      case 'REVIEW': return 'text-blue-600 bg-blue-50';
      case 'BLOCK': return 'text-rose-600 bg-rose-50';
      default: return 'text-amber-600 bg-amber-50';
    }
  };

  return (
    <div className="bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
      <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-3">
            <div className="bg-blue-600 text-white w-8 h-8 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <i className="fa-solid fa-shield-halved text-sm"></i>
            </div>
            Policy Automation Engine
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Active Version: <span className="font-bold text-blue-600">{policy.meta.version}</span> • 
            Status: <span className="font-bold text-emerald-600">Operational</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => onPolicyChange({ ...policy, rules: [...policy.rules, newRule()] })}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-blue-600 transition-all shadow-xl active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus-circle"></i> New Rule
          </button>
          <div className="h-8 w-px bg-slate-200 mx-1"></div>
          <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            <button onClick={() => save("patch")} className="px-3 py-1.5 text-[10px] font-black hover:bg-slate-50 rounded-lg text-slate-600 uppercase tracking-tighter" title="Bump Patch (0.0.X)">Patch</button>
            <button onClick={() => save("minor")} className="px-3 py-1.5 text-[10px] font-black hover:bg-slate-50 rounded-lg text-slate-600 uppercase tracking-tighter" title="Bump Minor (0.X.0)">Minor</button>
            <button onClick={() => save("major")} className="px-3 py-1.5 text-[10px] font-black hover:bg-slate-50 rounded-lg text-slate-600 uppercase tracking-tighter" title="Bump Major (X.0.0)">Major</button>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Recommendation Callout */}
        <div className="bg-blue-50/50 border border-blue-100 rounded-[2rem] p-6 flex items-start gap-4">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm text-blue-600">
            <i className="fa-solid fa-lightbulb"></i>
          </div>
          <div className="flex-grow">
            <h4 className="text-sm font-black text-blue-900">Direct Policy Management</h4>
            <p className="text-xs text-blue-800/70 mt-1 font-medium leading-relaxed">
              We recommend using the table below to manage rules directly in the UI. Excel templates are optional and primarily intended for bulk migrations or offline audits. 
              <strong> You do not need an Excel file to configure policy.</strong>
            </p>
          </div>
        </div>

        {/* Rules Table */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Active Rule Registry</h3>
            <span className="text-[10px] font-bold text-slate-400">{sortedRules.length} Rules Applied</span>
          </div>
          <div className="overflow-x-auto border border-slate-100 rounded-2xl bg-white shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    Status
                    <HeaderInfo 
                      title="Rule Enablement" 
                      description="Toggle whether this specific rule is considered during the automation process."
                      align="left"
                      details={[
                        "Checked: Rule is live and will influence routing.",
                        "Unchecked: Rule is stored but bypassed entirely."
                      ]}
                    />
                  </th>
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    Pri
                    <HeaderInfo 
                      title="Evaluation Priority" 
                      description="Determines the sequence in which rules are matched."
                      details={[
                        "Higher numbers are evaluated first.",
                        "The last matching rule (highest priority) dictates the final lane.",
                        "Default priorities range from 0 to 100."
                      ]}
                    />
                  </th>
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Rule ID</th>
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    Match Conditions
                    <HeaderInfo 
                      title="Pattern Matching" 
                      description="Logical filters used to identify matching line items."
                      details={[
                        "Edge: Matches specific system flags (e.g. ZERO_DOLLAR).",
                        "Desc: Regex pattern matching against raw line descriptions.",
                        "Rules use 'AND' logic—all defined fields must match."
                      ]}
                    />
                  </th>
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    Target Lane
                    <HeaderInfo 
                      title="Routing Destination" 
                      description="The automation lane where the item will be sent if this rule matches."
                      details={[
                        "AUTO: Direct pass-through if confidence gates are met.",
                        "REVIEW: Queues for human validation.",
                        "BLOCK: Stops processing for critical manual intervention."
                      ]}
                    />
                  </th>
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    Audit Reason
                    <HeaderInfo 
                      title="Policy Traceability" 
                      description="The explanation provided in the audit logs and final spreadsheets."
                      align="right"
                      details={[
                        "Visible to reviewers in the control surface.",
                        "Should clearly explain why the rule was triggered.",
                        "Essential for SOX compliance and internal audits."
                      ]}
                    />
                  </th>
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedRules.map(r => (
                  <tr key={r.rule_id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-5">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateRule(r.rule_id, { enabled: e.target.checked })}
                        className="w-5 h-5 text-blue-600 border-slate-300 rounded-lg focus:ring-blue-500 transition-all cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-5">
                      <input
                        type="number"
                        value={r.priority}
                        onChange={(e) => updateRule(r.rule_id, { priority: Number(e.target.value) })}
                        className="w-16 px-2 py-1.5 text-xs font-bold border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-center"
                      />
                    </td>
                    <td className="px-4 py-5 text-xs font-mono font-bold text-slate-400">{r.rule_id}</td>
                    <td className="px-4 py-5 space-y-2 min-w-[200px]">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                           <span className="text-[9px] font-black text-slate-300 uppercase w-10">Edge:</span>
                           <input
                             value={(r.when.edge_case_includes_any ?? []).join(", ")}
                             onChange={(e) =>
                               updateRule(r.rule_id, {
                                 when: { ...r.when, edge_case_includes_any: e.target.value.split(",").map(x => x.trim()).filter(Boolean) }
                               })
                             }
                             placeholder="ZERO_DOLLAR..."
                             className="flex-grow text-[11px] font-medium border border-slate-100 rounded-lg px-2 py-1.5 focus:border-blue-300 bg-slate-50/50"
                           />
                        </div>
                        <div className="flex items-center gap-2">
                           <span className="text-[9px] font-black text-slate-300 uppercase w-10">Desc:</span>
                           <input
                             value={r.when.customer_item_desc_regex ?? ""}
                             onChange={(e) => updateRule(r.rule_id, { when: { ...r.when, customer_item_desc_regex: e.target.value || undefined } })}
                             placeholder="Regex..."
                             className="flex-grow text-[11px] font-medium border border-slate-100 rounded-lg px-2 py-1.5 focus:border-blue-300 bg-slate-50/50"
                           />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-5">
                      <select
                        value={r.then.lane}
                        onChange={(e) => updateRule(r.rule_id, { then: { ...r.then, lane: e.target.value as any } })}
                        className={`text-[10px] font-black px-3 py-1.5 rounded-xl border-none focus:ring-4 focus:ring-blue-500/10 cursor-pointer w-full text-center ${getLaneColor(r.then.lane)}`}
                      >
                        <option value="AUTO">AUTO</option>
                        <option value="REVIEW">REVIEW</option>
                        <option value="BLOCK">BLOCK</option>
                        <option value="ASSIST">ASSIST</option>
                      </select>
                    </td>
                    <td className="px-4 py-5">
                      <input
                        value={r.then.reason}
                        onChange={(e) => updateRule(r.rule_id, { then: { ...r.then, reason: e.target.value } })}
                        className="w-full text-[11px] font-medium border border-slate-100 rounded-lg px-3 py-1.5 focus:border-blue-300 bg-slate-50/50"
                        placeholder="Why is this rule here?"
                      />
                    </td>
                    <td className="px-4 py-5 text-center">
                      <button 
                        onClick={() => onPolicyChange({ ...policy, rules: policy.rules.filter(x => x.rule_id !== r.rule_id) })}
                        className="p-2.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                        title="Delete Rule"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECONDARY: Batch Tools (Moved below registry) */}
        <div className="pt-8 border-t border-slate-100">
           <div className="mb-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Advanced / Batch Operations (Optional)</h3>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-700 mb-3">Load Rules from Excel</h4>
                </div>
                <div className="flex gap-2">
                  <input 
                    type="file" 
                    accept=".xlsx" 
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} 
                    className="flex-grow text-[11px] bg-white border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button onClick={doImportPolicyXlsx} className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-300 transition-all">
                    Import
                  </button>
                </div>
              </div>

              <div className="p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-700 mb-3">Export Rules for Audit</h4>
                </div>
                <button 
                  onClick={doExportPolicyXlsx} 
                  className="w-full px-5 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-100 transition-all flex items-center justify-center gap-3"
                >
                  <i className="fa-solid fa-cloud-arrow-down"></i>
                  Download Active Policy XLSX
                </button>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
