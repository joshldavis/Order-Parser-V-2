import React, { useMemo, useState, useEffect } from "react";
import { OrgSetupProfile, ExclusionAction, ExclusionReasonCode, isSetupComplete } from "../setup/orgProfile.types";
import { ensureOrgProfileSeed, loadOrgProfile, resetOrgProfile, saveOrgProfile } from "../setup/orgProfile.store";
import { ControlSurfacePolicy } from "../policy/controlSurfacePolicy";
import { savePolicy } from "../policy/policyLocalStore";
import { bumpVersion } from "../policy/policyVersioning";
import { ReferencePack } from "../referencePack.schema";
import { importReferencePackFromXlsx, exportReferencePackToXlsx } from "../services/referencePackXlsx";
import { EMPTY_REFERENCE_PACK } from "../reference/referenceLocalStore";
import { buildControlSurfaceWorkbook, downloadBlob } from "../services/xlsxExport";

type Step = 1 | 2 | 3 | 4;

const defaultExclusions: Array<{ reason_code: ExclusionReasonCode; action: ExclusionAction }> = [
  { reason_code: "CREDIT_MEMO", action: "MANUAL_PROCESS" },
  { reason_code: "SPECIAL_LAYOUT", action: "HUMAN_REVIEW" },
  { reason_code: "CUSTOM_LENGTH", action: "HUMAN_REVIEW" },
  { reason_code: "ZERO_DOLLAR", action: "HUMAN_REVIEW" },
  { reason_code: "THIRD_PARTY_SHIP", action: "HUMAN_REVIEW" },
];

function nowIso() {
  return new Date().toISOString();
}

export const SetupWizard: React.FC<{
  currentPolicy: ControlSurfacePolicy;
  onPolicyUpdated?: (p: ControlSurfacePolicy) => void;
  onReferencePackUpdated?: (r: ReferencePack) => void;
  onProfileUpdated?: (p: OrgSetupProfile) => void;
  referencePack: ReferencePack;
}> = ({ currentPolicy, onPolicyUpdated, onReferencePackUpdated, onProfileUpdated, referencePack }) => {
  const seeded = useMemo(() => ensureOrgProfileSeed(), []);
  const [profile, setProfile] = useState<OrgSetupProfile>(() => loadOrgProfile() ?? seeded);
  const [step, setStep] = useState<Step>(isSetupComplete(profile) ? 4 : 1);

  // Status states
  const [isDirty, setIsDirty] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [wasJustDeployed, setWasJustDeployed] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isTemplateImporting, setIsTemplateImporting] = useState(false);

  // Form states initialized from profile
  const [orgName, setOrgName] = useState(profile.org_name ?? "Default Org");
  const [truthSourceType, setTruthSourceType] = useState(profile.truth_source_type ?? "ERP_EXPORT");
  const [calibDocsCount, setCalibDocsCount] = useState(profile.calibration?.n_docs ?? 25);
  const [calibLinesCount, setCalibLinesCount] = useState(profile.calibration?.n_lines ?? 100);
  const [calibNotes, setCalibNotes] = useState(profile.calibration?.notes ?? "");
  const [catalogName, setCatalogName] = useState(profile.catalog?.name ?? "Standard System Catalog");
  const [templateName, setTemplateName] = useState(profile.output_template?.name ?? "Default Automation Template");
  const [autoMin, setAutoMin] = useState(profile.policy?.auto_process_min ?? 0.92);
  const [reviewMin, setReviewMin] = useState(profile.policy?.review_min ?? 0.75);
  const [blockBelow, setBlockBelow] = useState(profile.policy?.block_below ?? 0.50);
  const [exclusions, setExclusions] = useState(profile.policy?.exclusions || defaultExclusions);

  const markDirty = () => {
    setIsDirty(true);
    setWasJustDeployed(false);
  };

  const handleCatalogueFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const updated = importReferencePackFromXlsx(buffer, referencePack);
      onReferencePackUpdated?.(updated);
      markDirty();
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setIsImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsTemplateImporting(true);
    try {
      // In this version, we don't store the binary in the profile to avoid LocalStorage limits,
      // but we update the metadata to indicate a custom template is being registered.
      setTemplateName(file.name.replace(/\.[^/.]+$/, ""));
      markDirty();
    } catch (err: any) {
      alert(`Template import failed: ${err.message}`);
    } finally {
      setIsTemplateImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleExportCatalogue = () => {
    try {
      const blob = exportReferencePackToXlsx(referencePack);
      downloadBlob(`OrderFlow_Catalogue_${referencePack.version}.xlsx`, blob);
    } catch (err: any) {
      alert("Catalogue export failed: " + err.message);
    }
  };

  const handleExportTemplate = () => {
    try {
      // Generates a sample template with standard headers
      const blob = buildControlSurfaceWorkbook({ poLineRows: [] });
      downloadBlob(`${templateName}_Sample.xlsx`, blob);
    } catch (err: any) {
      alert("Template export failed: " + err.message);
    }
  };

  const persistProfile = (next: OrgSetupProfile) => {
    setProfile(next);
    saveOrgProfile(next);
    onProfileUpdated?.(next);
  };

  const applyPolicyToApp = async () => {
    setIsDeploying(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const nextVersion = bumpVersion(currentPolicy.meta.version, "patch");
    const updated: ControlSurfacePolicy = {
      ...currentPolicy,
      meta: {
        ...currentPolicy.meta,
        version: nextVersion as any,
        updated_at: nowIso(),
        notes: JSON.stringify({ gates: { autoMin, reviewMin, blockBelow }, exclusions }),
      },
    };
    
    savePolicy(updated);
    onPolicyUpdated?.(updated);
    
    const nextProfile: OrgSetupProfile = {
      ...profile,
      org_name: orgName,
      status: "COMPLETE",
      updated_at: nowIso(),
      policy: {
        policy_version_id: `pol-${nextVersion}`,
        created_at: nowIso(),
        auto_process_min: autoMin,
        review_min: reviewMin,
        block_below: blockBelow,
        exclusions: exclusions.map(e => ({ reason_code: e.reason_code, action: e.action }))
      }
    };
    persistProfile(nextProfile);

    setIsDeploying(false);
    setIsDirty(false);
    setWasJustDeployed(true);
    
    setTimeout(() => setWasJustDeployed(false), 3000);
  };

  const finalizeSetup = () => {
    const next: OrgSetupProfile = {
      ...profile,
      org_name: orgName,
      truth_source_type: truthSourceType as any,
      calibration: { 
        dataset_id: profile.calibration?.dataset_id || crypto.randomUUID(),
        version: profile.calibration?.version || "1.0.0",
        created_at: profile.calibration?.created_at || nowIso(),
        n_docs: calibDocsCount, 
        n_lines: calibLinesCount, 
        notes: calibNotes 
      },
      catalog: { 
        catalog_version_id: profile.catalog?.catalog_version_id || crypto.randomUUID(),
        created_at: profile.catalog?.created_at || nowIso(),
        name: catalogName 
      },
      output_template: { 
        output_template_id: profile.output_template?.output_template_id || crypto.randomUUID(),
        created_at: profile.output_template?.created_at || nowIso(),
        name: templateName, 
        required_audit_columns_present: true 
      },
      policy: {
        policy_version_id: `setup-${crypto.randomUUID()}`,
        created_at: nowIso(),
        auto_process_min: autoMin,
        review_min: reviewMin,
        block_below: blockBelow,
        exclusions: exclusions.map((e) => ({ reason_code: e.reason_code, action: e.action })),
      },
      status: "COMPLETE",
      updated_at: nowIso(),
    };
    persistProfile(next);
    setStep(4);
  };

  const resetAll = () => {
    if (!confirm("Reset organization setup? This will clear all wizard data and grounding catalogues. Your active automation policy will remain until you deploy a new configuration.")) return;
    
    // Clear external persistent stores
    resetOrgProfile();
    onReferencePackUpdated?.(EMPTY_REFERENCE_PACK);
    
    // Create fresh seeded profile
    const newSeeded = ensureOrgProfileSeed();
    
    // Reset local wizard states
    setProfile(newSeeded);
    onProfileUpdated?.(newSeeded); // Notify parent App immediately
    
    setOrgName(newSeeded.org_name);
    setTruthSourceType("ERP_EXPORT");
    setCalibDocsCount(25);
    setCalibLinesCount(100);
    setCalibNotes("");
    setCatalogName("Standard System Catalog");
    setTemplateName("Default Automation Template");
    setAutoMin(0.92);
    setReviewMin(0.75);
    setBlockBelow(0.50);
    setExclusions(defaultExclusions);
    
    setIsDirty(false);
    setWasJustDeployed(false);
    setStep(1);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-xl p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Enterprise Setup Wizard</h2>
          <p className="text-slate-500 mt-1">Configure your grounding database and automation gates.</p>
        </div>
        <button 
          onClick={resetAll} 
          className="px-4 py-2 rounded-2xl border border-slate-200 text-slate-400 font-bold hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all flex items-center gap-2 group"
        >
          <i className="fa-solid fa-rotate-left group-hover:rotate-[-45deg] transition-transform"></i>
          Reset Wizard
        </button>
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs font-bold">
        {[1, 2, 3, 4].map(s => (
          <React.Fragment key={s}>
            <span 
              onClick={() => s < step ? setStep(s as Step) : null}
              className={`px-4 py-1.5 rounded-full transition-all ${step === s ? "bg-slate-900 text-white shadow-lg" : s < step ? "bg-slate-100 text-slate-900 cursor-pointer hover:bg-slate-200" : "bg-slate-50 text-slate-300"}`}
            >
              {s}. {["Org Info", "Resources", "Automation", "Verify"][s-1]}
            </span>
            {s < 4 && <div className="h-px w-4 bg-slate-200"></div>}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6">
              <h3 className="font-black text-slate-900 mb-4">Organization Detail</h3>
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Org Name</label>
                <input value={orgName} onChange={(e) => { setOrgName(e.target.value); markDirty(); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-medium outline-none focus:ring-4 focus:ring-blue-500/10 transition-all" />
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Verification Source</label>
                <select value={truthSourceType} onChange={(e) => { setTruthSourceType(e.target.value); markDirty(); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-bold bg-white transition-all">
                  <option value="ERP_EXPORT">Direct ERP Integration</option>
                  <option value="CONTROL_WORKBOOK">Historical Control Workbook</option>
                </select>
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6">
              <h3 className="font-black text-slate-900 mb-4">Historical Benchmark</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1"># Documents</label>
                  <input type="number" value={calibDocsCount} onChange={(e) => { setCalibDocsCount(Number(e.target.value)); markDirty(); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-bold" />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1"># Line Items</label>
                  <input type="number" value={calibLinesCount} onChange={(e) => { setCalibLinesCount(Number(e.target.value)); markDirty(); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-bold" />
                </div>
              </div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mt-4 mb-1">Dataset Calibration Notes</label>
              <textarea value={calibNotes} onChange={(e) => { setCalibNotes(e.target.value); markDirty(); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-4 focus:ring-blue-500/10 transition-all" rows={3} placeholder="Calibration dataset description..." />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setStep(2)} className="px-8 py-3.5 rounded-2xl bg-slate-900 text-white font-black hover:bg-blue-600 transition-all shadow-xl active:scale-95 flex items-center gap-2">Next Step <i className="fa-solid fa-arrow-right"></i></button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-black text-slate-900 flex items-center gap-3">
                <i className="fa-solid fa-book-bookmark text-indigo-600"></i> Resource Configuration (Optional)
              </h3>
              <span className="text-[10px] font-black bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg uppercase tracking-tight">System Defaults Available</span>
            </div>
            
            <p className="text-xs text-slate-500 mb-8 max-w-2xl">
              You can optionally upload custom master catalogues or output templates. These enhance grounding accuracy and report formatting.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* CATALOGUE SECTION */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Catalogue</label>
                  {referencePack.manufacturers.length > 0 && (
                    <button onClick={handleExportCatalogue} className="text-[9px] font-black text-indigo-600 uppercase hover:underline">
                      <i className="fa-solid fa-download mr-1"></i> Export Current
                    </button>
                  )}
                </div>
                <input value={catalogName} onChange={(e) => { setCatalogName(e.target.value); markDirty(); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-medium outline-none focus:ring-4 focus:ring-blue-500/10" placeholder="Catalogue Name" />
                
                <div className={`p-8 border-2 border-dashed rounded-[2rem] text-center transition-all relative group ${referencePack.manufacturers.length > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200 hover:border-indigo-400'}`}>
                  {isImporting ? (
                    <div className="py-4"><i className="fa-solid fa-circle-notch animate-spin text-indigo-600 text-2xl"></i></div>
                  ) : referencePack.manufacturers.length > 0 ? (
                    <div className="space-y-2">
                      <div className="w-12 h-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center mx-auto shadow-lg"><i className="fa-solid fa-check text-xl"></i></div>
                      <p className="text-xs font-black text-emerald-800">Catalogue Active</p>
                      <p className="text-[10px] text-emerald-600 font-bold">{referencePack.manufacturers.length} Manufacturers</p>
                    </div>
                  ) : (
                    <>
                      <i className="fa-solid fa-file-excel text-slate-300 text-3xl mb-3 block group-hover:text-indigo-300"></i>
                      <p className="text-xs font-bold text-slate-600">Drop Excel Catalogue</p>
                      <p className="text-[9px] text-slate-400 mt-1 uppercase font-black">Optional - Skip to use system defaults</p>
                    </>
                  )}
                  <input type="file" accept=".xlsx" onChange={handleCatalogueFile} className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
              </div>

              {/* REPORT TEMPLATE SECTION */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Report Output (XLSX Template)</label>
                  <button onClick={handleExportTemplate} className="text-[9px] font-black text-blue-600 uppercase hover:underline">
                    <i className="fa-solid fa-download mr-1"></i> Export Active
                  </button>
                </div>
                <input value={templateName} onChange={(e) => { setTemplateName(e.target.value); markDirty(); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-medium outline-none focus:ring-4 focus:ring-blue-500/10" placeholder="Template Name" />
                
                <div className={`p-8 border-2 border-dashed rounded-[2rem] text-center transition-all relative group ${profile.output_template?.name ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200 hover:border-blue-400'}`}>
                  {isTemplateImporting ? (
                    <div className="py-4"><i className="fa-solid fa-circle-notch animate-spin text-blue-600 text-2xl"></i></div>
                  ) : (
                    <>
                      <i className="fa-solid fa-table-list text-slate-300 text-3xl mb-3 block group-hover:text-blue-300"></i>
                      <p className="text-xs font-bold text-slate-600">Drop Custom Template</p>
                      <p className="text-[9px] text-slate-400 mt-1 uppercase font-black">Optional - Maps columns for ERP/Sage</p>
                    </>
                  )}
                  <input type="file" accept=".xlsx" onChange={handleTemplateFile} className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-6 py-3 rounded-2xl border border-slate-200 font-black text-slate-700 hover:bg-slate-50 transition-all">Back</button>
            <button onClick={() => setStep(3)} className="px-8 py-3.5 rounded-2xl bg-slate-900 text-white font-black hover:bg-blue-600 transition-all shadow-xl active:scale-95 flex items-center gap-2">Configure Policy <i className="fa-solid fa-arrow-right"></i></button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-black text-slate-900">Automation Policy Gates</h3>
              <span className="flex items-center gap-2 text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg ring-1 ring-blue-100">
                <i className="fa-solid fa-circle text-[6px] animate-pulse"></i> UI-DRIVEN CONFIGURATION
              </span>
            </div>
            
            <p className="text-xs text-slate-500 mb-8 max-w-2xl">
              No template required. Adjust these sliders to define how the AI routes extracted data. Changes are committed when you deploy.
            </p>

            <div className="grid grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm text-center transition-all hover:shadow-md">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Auto Threshold</label>
                <input type="number" step="0.01" value={autoMin} onChange={(e) => { setAutoMin(Number(e.target.value)); markDirty(); }} className="w-full bg-slate-50 rounded-2xl border-none px-4 py-4 font-black text-center text-2xl text-emerald-600 outline-none" />
                <p className="text-[9px] text-slate-400 mt-3 font-bold">Routing: FAST-LANE</p>
              </div>
              <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm text-center transition-all hover:shadow-md">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Review Threshold</label>
                <input type="number" step="0.01" value={reviewMin} onChange={(e) => { setReviewMin(Number(e.target.value)); markDirty(); }} className="w-full bg-slate-50 rounded-2xl border-none px-4 py-4 font-black text-center text-2xl text-blue-600 outline-none" />
                <p className="text-[9px] text-slate-400 mt-3 font-bold">Routing: QUEUE</p>
              </div>
              <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm text-center transition-all hover:shadow-md">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Block Threshold</label>
                <input type="number" step="0.01" value={blockBelow} onChange={(e) => { setBlockBelow(Number(e.target.value)); markDirty(); }} className="w-full bg-slate-50 rounded-2xl border-none px-4 py-4 font-black text-center text-2xl text-rose-600 outline-none" />
                <p className="text-[9px] text-slate-400 mt-3 font-bold">Routing: STOP</p>
              </div>
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-6 py-3 rounded-2xl border border-slate-200 font-black text-slate-700 hover:bg-slate-50 transition-all">Back</button>
            <button onClick={finalizeSetup} className="px-8 py-3.5 rounded-2xl bg-indigo-600 text-white font-black hover:bg-indigo-700 transition-all shadow-xl active:scale-95">Verify & Finish</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-emerald-50 border border-emerald-200 rounded-[2.5rem] p-10">
            <div className="flex items-center gap-4 mb-8">
               <div className="w-14 h-14 bg-emerald-500 text-white rounded-2xl flex items-center justify-center text-2xl shadow-lg"><i className="fa-solid fa-check-double"></i></div>
               <div>
                 <h3 className="text-2xl font-black text-emerald-900 leading-none">Setup Successful</h3>
                 <p className="text-sm text-emerald-700 mt-2 font-medium">Your organization profile is now active and synchronized.</p>
               </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
              <div className="space-y-3">
                 <div className="flex justify-between text-xs pb-2 border-b border-emerald-100"><span className="font-bold text-slate-400 uppercase">Organization:</span> <span className="font-black text-slate-900">{orgName}</span></div>
                 <div className="flex justify-between text-xs pb-2 border-b border-emerald-100"><span className="font-bold text-slate-400 uppercase">Catalogue:</span> <span className={`font-black ${referencePack.manufacturers.length > 0 ? 'text-emerald-600' : 'text-slate-400 italic'}`}>{referencePack.manufacturers.length > 0 ? `${referencePack.manufacturers.length} items active` : 'Using System Defaults'}</span></div>
                 <div className="flex justify-between text-xs pb-2 border-b border-emerald-100"><span className="font-bold text-slate-400 uppercase">Export Profile:</span> <span className="font-black text-slate-900">{templateName}</span></div>
              </div>
              <div className="bg-white/60 rounded-[2rem] p-6 border border-emerald-100 shadow-sm">
                <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest mb-4">Live Policy Gates</p>
                <div className="flex gap-4">
                  <div className="flex-grow">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Auto Gate</div>
                    <div className="text-xl font-black text-emerald-600">{(autoMin * 100).toFixed(0)}%</div>
                  </div>
                  <div className="flex-grow">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Review Gate</div>
                    <div className="text-xl font-black text-blue-600">{(reviewMin * 100).toFixed(0)}%</div>
                  </div>
                  <div className="flex-grow">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Block Gate</div>
                    <div className="text-xl font-black text-rose-600">{(blockBelow * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <button onClick={() => setStep(3)} className="px-6 py-4 rounded-2xl border border-slate-200 font-black text-slate-700 hover:bg-white transition-all">Edit Gates</button>
              
              <div className="relative group">
                <button 
                  onClick={applyPolicyToApp} 
                  disabled={(!isDirty && !isDeploying) || isDeploying}
                  className={`
                    relative px-10 py-4 rounded-2xl font-black transition-all duration-300 active:scale-95 flex items-center gap-3 overflow-hidden
                    ${isDeploying ? 'bg-slate-200 text-slate-400 cursor-wait' : 
                      wasJustDeployed ? 'bg-emerald-600 text-white shadow-emerald-500/20 shadow-xl' :
                      isDirty ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/30 shadow-xl cursor-pointer' :
                      'bg-slate-100 text-slate-400 cursor-default opacity-80'}
                  `}
                >
                  {isDeploying ? (
                    <>
                      <i className="fa-solid fa-circle-notch animate-spin"></i>
                      Synchronizing...
                    </>
                  ) : wasJustDeployed ? (
                    <>
                      <i className="fa-solid fa-check-circle animate-in zoom-in duration-300"></i>
                      System Synchronized
                    </>
                  ) : isDirty ? (
                    <>
                      <i className="fa-solid fa-bolt-lightning"></i>
                      Deploy Governance
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-shield-check"></i>
                      Up to Date
                    </>
                  )}
                  
                  {/* Shimmer Effect for active deployment or success */}
                  {(isDeploying || wasJustDeployed) && (
                    <span className="absolute inset-0 pointer-events-none overflow-hidden">
                        <span className="absolute top-[-100%] left-[-100%] w-[300%] h-[300%] bg-gradient-to-tr from-transparent via-white/20 to-transparent rotate-45 animate-[shimmer_2s_infinite]"></span>
                    </span>
                  )}
                </button>
                
                {/* Tooltip for disabled locked state */}
                {!isDirty && !isDeploying && !wasJustDeployed && (
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                    <div className="bg-slate-900 text-white text-[10px] px-3 py-1.5 rounded-lg shadow-xl font-bold border border-white/10">
                      Edit configuration above to redeploy changes
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes shimmer { 
          0% { transform: translate(-100%, -100%) rotate(45deg); } 
          100% { transform: translate(100%, 100%) rotate(45deg); } 
        }
      `}</style>
    </div>
  );
};
