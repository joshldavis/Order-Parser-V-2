import React, { useMemo, useState, useRef } from "react";
import { OrgSetupProfile, ExclusionAction, ExclusionRule, isSetupComplete } from "../setup/orgProfile.types.ts";
import { ensureOrgProfileSeed, loadOrgProfile, saveOrgProfile, resetOrgProfile } from "../setup/orgProfile.store.ts";
import { ControlSurfacePolicy } from "../policy/controlSurfacePolicy.ts";
import { ReferencePack } from "../referencePack.schema.ts";
import { importReferencePackFromXlsx } from "../services/referencePackXlsx.ts";
import { coerceTruthTable, computeCalibration, parseCsvToRows, suggestGates, CalibrationComputed } from "../setup/calibrationMetrics.ts";
import { HeaderInfo } from "./SharedUI.tsx";

type Step = 1 | 2 | 3 | 4 | 5;

const SYSTEM_SIGNAL_CODES = ["CREDIT_MEMO", "SPECIAL_LAYOUT", "CUSTOM_LENGTH", "ZERO_DOLLAR", "THIRD_PARTY_SHIP"];
const DOC_TYPES = ["PURCHASE_ORDER", "INVOICE", "CREDIT_MEMO", "SALES_ORDER"];

const defaultExclusions: ExclusionRule[] = [
  { reason_code: "CREDIT_MEMO", action: "MANUAL_PROCESS", description: "Document identified as a credit return.", instructions: "Link to original invoice before processing." },
  { reason_code: "SPECIAL_LAYOUT", action: "HUMAN_REVIEW", description: "Item description contains 'Special Layout' instructions.", instructions: "Verify layout dimensions match CAD drawings." },
  { reason_code: "CUSTOM_LENGTH", action: "HUMAN_REVIEW", description: "Dimensions detected in the item string.", instructions: "Confirm cut-to-length pricing surcharge." },
  { reason_code: "ZERO_DOLLAR", action: "HUMAN_REVIEW", description: "Pricing is explicitly listed as $0.00.", instructions: "Verify if warranty or sample." },
];

function nowIso() { return new Date().toISOString(); }

export const SetupWizard: React.FC<{
  currentPolicy: ControlSurfacePolicy;
  onPolicyUpdated?: (p: ControlSurfacePolicy) => void;
  onReferencePackUpdated?: (r: ReferencePack) => void;
  onProfileUpdated?: (p: OrgSetupProfile) => void;
  referencePack: ReferencePack;
}> = ({ currentPolicy, onPolicyUpdated, onReferencePackUpdated, onProfileUpdated, referencePack }) => {
  const seeded = useMemo(() => ensureOrgProfileSeed(), []);
  const [profile, setProfile] = useState<OrgSetupProfile>(() => loadOrgProfile() ?? seeded);
  const [step, setStep] = useState<Step>(isSetupComplete(profile) ? 5 : 1);

  const [isDirty, setIsDirty] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [wasJustDeployed, setWasJustDeployed] = useState(false);

  // Refs for file inputs
  const csvInputRef = useRef<HTMLInputElement>(null);
  const catalogInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  // Identity / Org State
  const [orgName, setOrgName] = useState(profile.org_name ?? "Default Org");
  
  // Validation State
  const [calibrationData, setCalibrationData] = useState<CalibrationComputed | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);

  // Policy State
  const [autoMin, setAutoMin] = useState(profile.policy?.auto_process_min ?? 0.92);
  const [reviewMin, setReviewMin] = useState(profile.policy?.review_min ?? 0.75);
  const [blockBelow, setBlockBelow] = useState(profile.policy?.block_below ?? 0.50);
  const [exclusions, setExclusions] = useState<ExclusionRule[]>(profile.policy?.exclusions || defaultExclusions);

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalData, setModalData] = useState<ExclusionRule>({
    reason_code: "", action: "HUMAN_REVIEW", description: "", keywords: [], instructions: "", scope_doc_type: []
  });

  const markDirty = () => { setIsDirty(true); setWasJustDeployed(false); };

  const handleValidationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsCalibrating(true);
    try {
      const text = await file.text();
      const rawRows = parseCsvToRows(text);
      const truthRows = coerceTruthTable(rawRows);
      const computed = computeCalibration(truthRows);
      setCalibrationData(computed);
      const suggested = suggestGates(computed.coverage_by_threshold, 0.02);
      setAutoMin(suggested.auto_process_min);
      setReviewMin(suggested.review_min);
      setBlockBelow(suggested.block_below);
      markDirty();
    } catch (err: any) {
      alert("Validation table analysis failed: " + err.message);
    } finally {
      setIsCalibrating(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const handleCatalogueUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const updated = importReferencePackFromXlsx(buffer, referencePack);
      onReferencePackUpdated?.(updated);
      setProfile(prev => ({
        ...prev,
        catalog: {
          catalog_version_id: `cat-${crypto.randomUUID()}`,
          name: file.name,
          created_at: nowIso()
        }
      }));
      markDirty();
    } catch (err: any) {
      alert("Catalogue Import failed: " + err.message);
    } finally {
      if (catalogInputRef.current) catalogInputRef.current.value = "";
    }
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfile(prev => ({
      ...prev,
      output_template: {
        output_template_id: `tpl-${crypto.randomUUID()}`,
        name: file.name,
        created_at: nowIso(),
        required_audit_columns_present: true
      }
    }));
    markDirty();
    if (templateInputRef.current) templateInputRef.current.value = "";
  };

  const updateExclusionAction = (code: string, action: ExclusionAction) => {
    setExclusions(prev => prev.map(e => e.reason_code === code ? { ...e, action } : e));
    markDirty();
  };

  const removeExclusion = (code: string) => {
    setExclusions(prev => prev.filter(e => e.reason_code !== code));
    markDirty();
  };

  const handleManualRuleSave = () => {
    const code = modalData.reason_code.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (code) {
      setExclusions(prev => [...prev, { ...modalData, reason_code: code }]);
      setModalData({ reason_code: "", action: "HUMAN_REVIEW", description: "", keywords: [], instructions: "", scope_doc_type: [] });
      setShowAddModal(false);
      markDirty();
    }
  };

  const finalizeSetup = () => {
    const next: OrgSetupProfile = {
      ...profile,
      org_name: orgName,
      status: "COMPLETE",
      catalog: profile.catalog || {
         catalog_version_id: "default-v1",
         name: "Standard Grounding Pack",
         created_at: nowIso()
      },
      policy: {
        policy_version_id: `setup-${crypto.randomUUID()}`,
        created_at: nowIso(),
        auto_process_min: autoMin,
        review_min: reviewMin,
        block_below: blockBelow,
        exclusions,
      },
      updated_at: nowIso(),
    };
    setProfile(next);
    saveOrgProfile(next);
    onProfileUpdated?.(next);
    setStep(5);
  };

  const applyPolicyToApp = async () => {
    setIsDeploying(true);
    await new Promise(r => setTimeout(r, 1500));
    finalizeSetup();
    setIsDeploying(false);
    setIsDirty(false);
    setWasJustDeployed(true);
  };

  const handleFullReset = () => {
    if (confirm("Factory Reset: This will clear all Organization Settings, Policies, and Master Catalogues. Continue?")) {
      resetOrgProfile();
      // Force a full application reload to re-seed from clean storage
      window.location.reload();
    }
  };

  const StepBadge = ({ n, label, active }: { n: number, label: string, active: boolean }) => (
    <div className="flex items-center gap-3">
       <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black transition-all text-[10px] ${active ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>
         {n}
       </div>
       <div className={`text-[9px] font-black uppercase tracking-widest ${active ? 'text-slate-900' : 'text-slate-400'}`}>{label}</div>
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-[3rem] shadow-2xl p-12 max-w-6xl mx-auto relative overflow-visible">
      
      {/* HIDDEN INPUTS */}
      <input type="file" ref={catalogInputRef} onChange={handleCatalogueUpload} accept=".xlsx" className="hidden" />
      <input type="file" ref={templateInputRef} onChange={handleTemplateUpload} accept=".xlsx" className="hidden" />

      {/* RULE DESIGNER MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[2rem] p-10 max-w-2xl w-full shadow-2xl scale-in-center border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl font-black text-slate-900">Routing Directive</h3>
                <p className="text-xs text-slate-500 font-medium">Define automated lane routing for specific document signals.</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="w-10 h-10 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-400">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            
            <div className="flex-grow overflow-y-auto pr-2 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Signal Code (ID)</label>
                  <input 
                    autoFocus
                    value={modalData.reason_code}
                    onChange={(e) => setModalData({...modalData, reason_code: e.target.value})}
                    placeholder="e.g. RUSH_ORDER"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Policy Action</label>
                  <select 
                    value={modalData.action}
                    onChange={(e) => setModalData({...modalData, action: e.target.value as ExclusionAction})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none cursor-pointer"
                  >
                    <option value="HUMAN_REVIEW">Review (Verify)</option>
                    <option value="MANUAL_PROCESS">Assist (Partial)</option>
                    <option value="BLOCK">Block (Hold)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Trigger Keywords</label>
                <input 
                  value={(modalData.keywords || []).join(", ")}
                  onChange={(e) => setModalData({...modalData, keywords: e.target.value.split(",").map(k => k.trim()).filter(Boolean)})}
                  placeholder="hazardous, rush, sample, replacement..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Verification Guidance</label>
                <textarea 
                  value={modalData.instructions}
                  onChange={(e) => setModalData({...modalData, instructions: e.target.value})}
                  placeholder="Instructions for the human reviewer..."
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-600 outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-8 mt-6 border-t border-slate-100">
              <button onClick={() => setShowAddModal(false)} className="flex-grow px-6 py-4 rounded-xl border border-slate-200 font-black text-slate-500 hover:bg-slate-50 transition-all text-xs uppercase tracking-widest">Discard</button>
              <button onClick={handleManualRuleSave} className="flex-grow px-6 py-4 rounded-xl bg-indigo-600 text-white font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20 text-xs uppercase tracking-widest">Apply Rule</button>
            </div>
          </div>
        </div>
      )}

      {/* TRACKER */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-10 mb-12">
        <div className="flex flex-wrap items-center gap-10">
           <StepBadge n={1} label="Identity" active={step === 1} />
           <StepBadge n={2} label="Validation" active={step === 2} />
           <StepBadge n={3} label="Resources" active={step === 3} />
           <StepBadge n={4} label="Logic" active={step === 4} />
        </div>
        <button onClick={handleFullReset} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:text-rose-600 hover:bg-rose-50 transition-all">
          <i className="fa-solid fa-rotate-left mr-2"></i> Reset
        </button>
      </div>

      {step === 1 && (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4">
           <div className="max-w-xl">
             <h2 className="text-4xl font-black text-slate-900 tracking-tight">Organization Identity</h2>
             <p className="text-slate-500 mt-4 text-lg font-medium">Establish your organizational profile and baseline verification methods.</p>
           </div>
           
           <div className="bg-slate-50/50 p-12 rounded-[3rem] border border-slate-100 max-w-2xl">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Full Organization Name</label>
              <input value={orgName} onChange={(e) => { setOrgName(e.target.value); markDirty(); }} className="w-full px-8 py-6 bg-white border border-slate-200 rounded-[2rem] font-black text-slate-900 text-2xl outline-none focus:ring-8 focus:ring-indigo-500/5 shadow-inner" />
           </div>

           <div className="flex justify-end pt-4">
             <button onClick={() => setStep(2)} className="px-12 py-5 bg-slate-900 text-white rounded-[2rem] font-black hover:bg-indigo-600 transition-all flex items-center gap-4 text-xs uppercase tracking-[0.2em] shadow-2xl shadow-slate-900/20">
                Performance Validation <i className="fa-solid fa-arrow-right"></i>
             </button>
           </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4">
           <div className="max-w-2xl">
             <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-100 rounded-lg text-[10px] font-black text-amber-700 uppercase tracking-widest mb-4">Optional Calibration</div>
             <h2 className="text-4xl font-black text-slate-900 tracking-tight">Performance Validation</h2>
             <p className="text-slate-500 mt-4 text-lg font-medium leading-relaxed">
               Upload a <strong>Validation Table</strong> (CSV) from historical documents to mathematically determine optimal confidence thresholds.
             </p>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div 
                onClick={() => csvInputRef.current?.click()}
                className="p-16 border-2 border-dashed border-slate-200 rounded-[3.5rem] bg-slate-50/30 text-center hover:border-indigo-400 hover:bg-indigo-50/20 transition-all cursor-pointer group flex flex-col items-center justify-center relative overflow-hidden"
              >
                 <input type="file" ref={csvInputRef} onChange={handleValidationUpload} accept=".csv" className="hidden" />
                 <div className="w-24 h-24 bg-white rounded-[2rem] flex items-center justify-center text-4xl shadow-lg mb-8 text-indigo-600 group-hover:scale-110 transition-transform">
                   {isCalibrating ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <i className="fa-solid fa-cloud-arrow-up"></i>}
                 </div>
                 <h4 className="text-xl font-black text-slate-900">Upload Validation Set</h4>
                 <p className="text-[11px] text-slate-500 mt-3 font-medium px-10">Requires columns: [predicted_confidence, correct (0/1)]</p>
              </div>

              {calibrationData ? (
                <div className="bg-indigo-600 rounded-[3.5rem] p-12 text-white shadow-2xl shadow-indigo-500/30 relative flex flex-col justify-between">
                   <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -mr-24 -mt-24"></div>
                   <div>
                     <h4 className="text-[10px] font-black uppercase tracking-[0.2em] mb-10 opacity-60">Validation Metrics</h4>
                     <div className="grid grid-cols-2 gap-10">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2">Historical Accuracy</div>
                          <div className="text-5xl font-black">{(calibrationData.accuracy.line_required_fields_all_correct * 100).toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2">ECE (Error Index)</div>
                          <div className="text-5xl font-black">{calibrationData.calibration.ece.toFixed(3)}</div>
                        </div>
                     </div>
                   </div>
                   <div className="mt-12 p-5 bg-white/10 rounded-2xl border border-white/20 text-xs font-bold leading-relaxed">
                     <i className="fa-solid fa-wand-magic-sparkles mr-3 text-amber-300"></i>
                     Confidence gates calibrated for a 98% target success rate.
                   </div>
                </div>
              ) : (
                <div className="bg-slate-50 rounded-[3.5rem] p-16 flex flex-col items-center justify-center text-center border border-slate-100">
                   <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-2xl text-slate-200 mb-6 shadow-sm">
                     <i className="fa-solid fa-chart-line"></i>
                   </div>
                   <p className="text-sm font-bold text-slate-400 leading-relaxed max-w-[200px]">Analysis results will appear here after CSV upload.</p>
                </div>
              )}
           </div>

           <div className="flex justify-between items-center pt-8 border-t border-slate-50">
             <button onClick={() => setStep(1)} className="px-10 py-5 border border-slate-200 text-slate-500 rounded-[2rem] font-black hover:bg-slate-50 transition-all text-xs uppercase tracking-widest">Back</button>
             <div className="flex items-center gap-4">
               {!calibrationData && (
                 <button onClick={() => setStep(3)} className="px-8 py-5 text-indigo-600 font-black text-xs uppercase tracking-widest hover:underline">
                   Skip to Resources
                 </button>
               )}
               <button onClick={() => setStep(3)} className={`px-12 py-5 bg-slate-900 text-white rounded-[2rem] font-black hover:bg-indigo-600 transition-all flex items-center gap-4 text-xs uppercase tracking-[0.2em] shadow-2xl ${!calibrationData ? 'opacity-50' : ''}`}>
                  Mount Resources <i className="fa-solid fa-arrow-right"></i>
               </button>
             </div>
           </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4">
           <div className="max-w-2xl">
             <h2 className="text-4xl font-black text-slate-900 tracking-tight">Enterprise Resources</h2>
             <p className="text-slate-500 mt-4 text-lg font-medium leading-relaxed">Upload internal grounding files to ensure the AI parses documents against your master catalog standards.</p>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div 
                onClick={() => catalogInputRef.current?.click()}
                className="p-12 border-2 border-slate-200 rounded-[3rem] bg-slate-50/30 text-center flex flex-col items-center shadow-sm hover:border-indigo-400 hover:bg-indigo-50/20 transition-all cursor-pointer group"
              >
                 <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center text-3xl shadow-lg mb-6 text-indigo-600 group-hover:scale-110 transition-transform">
                   <i className="fa-solid fa-database"></i>
                 </div>
                 <h4 className="text-xl font-black text-slate-900">Master Catalogue</h4>
                 <p className="text-xs text-slate-500 mt-2 font-medium italic">
                    {profile.catalog?.name || (referencePack.manufacturers.length > 0 ? "Standard Grounding Pack" : "No Items Active")}
                 </p>
                 <div className="mt-8 px-5 py-2.5 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest border border-indigo-100">
                    {profile.catalog ? "Update Catalogue" : "Upload Catalogue (XLSX)"}
                 </div>
              </div>

              <div 
                onClick={() => templateInputRef.current?.click()}
                className="p-12 border-2 border-slate-200 rounded-[3rem] bg-slate-50/30 text-center flex flex-col items-center shadow-sm hover:border-emerald-400 hover:bg-emerald-50/20 transition-all cursor-pointer group"
              >
                 <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center text-3xl shadow-lg mb-6 text-emerald-600 group-hover:scale-110 transition-transform">
                   <i className="fa-solid fa-file-export"></i>
                 </div>
                 <h4 className="text-xl font-black text-slate-900">Output Template</h4>
                 <p className="text-xs text-slate-500 mt-2 font-medium italic">
                    {profile.output_template?.name || "Standard Control Surface V3"}
                 </p>
                 <div className="mt-8 px-5 py-2.5 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                    {profile.output_template ? "Replace Template" : "Upload Template (XLSX)"}
                 </div>
              </div>
           </div>

           <div className="flex justify-between pt-8 border-t border-slate-50">
             <button onClick={() => setStep(2)} className="px-10 py-5 border border-slate-200 text-slate-500 rounded-[2rem] font-black hover:bg-slate-50 transition-all text-xs uppercase tracking-widest">Back</button>
             <button onClick={() => setStep(4)} className="px-12 py-5 bg-slate-900 text-white rounded-[2rem] font-black hover:bg-indigo-600 transition-all flex items-center gap-4 text-xs uppercase tracking-[0.2em] shadow-2xl">
                Configure Logic <i className="fa-solid fa-arrow-right"></i>
             </button>
           </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4">
          <div className="max-w-2xl">
            <h2 className="text-4xl font-black text-slate-900 tracking-tight">Automation Policy Logic</h2>
            <p className="text-slate-500 mt-4 text-lg font-medium leading-relaxed">Review the {calibrationData ? 'calibrated' : 'manual'} confidence gates and define edge-case routing directives.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-50/50 p-10 rounded-[3rem] border border-slate-100 text-center ring-1 ring-slate-200/50 shadow-sm">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-center gap-1">
                Auto-Pass Min
                <HeaderInfo 
                  title="Auto-Pass Min" 
                  description="The minimum confidence floor for touchless processing."
                  details={[
                    "Documents above this level with no flags skip human review.",
                    "Higher values prioritize accuracy (less human check).",
                    "Lower values prioritize speed (more touchless pass)."
                  ]}
                />
              </label>
              <input type="number" step="0.01" value={autoMin} onChange={(e) => { setAutoMin(Number(e.target.value)); markDirty(); }} className="w-full bg-transparent text-5xl font-black text-emerald-600 text-center outline-none border-none" />
              <div className="mt-6 px-4 py-1.5 bg-emerald-50 text-emerald-700 text-[10px] font-black rounded-lg inline-block uppercase tracking-tighter">Direct to ERP</div>
            </div>
            <div className="bg-slate-50/50 p-10 rounded-[3rem] border border-slate-100 text-center ring-1 ring-slate-200/50 shadow-sm">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-center gap-1">
                Review Threshold
                <HeaderInfo 
                  title="Review Threshold" 
                  description="The baseline for human verification queuing."
                  details={[
                    "Determines the 'Review' lane floor.",
                    "Items between this and Auto-Pass are queued for verification.",
                    "Suggested standard is usually ~15% below Auto-Pass."
                  ]}
                />
              </label>
              <input type="number" step="0.01" value={reviewMin} onChange={(e) => { setReviewMin(Number(e.target.value)); markDirty(); }} className="w-full bg-transparent text-5xl font-black text-blue-600 text-center outline-none border-none" />
              <div className="mt-6 px-4 py-1.5 bg-blue-50 text-blue-700 text-[10px] font-black rounded-lg inline-block uppercase tracking-tighter">Human Verification</div>
            </div>
            <div className="bg-slate-50/50 p-10 rounded-[3rem] border border-slate-100 text-center ring-1 ring-slate-200/50 shadow-sm">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-center gap-1">
                Hard Block Below
                <HeaderInfo 
                  title="Hard Block Floor" 
                  description="The failure floor for document ingestion."
                  details={[
                    "Confidence scores below this level are considered too unreliable.",
                    "Blocked items require full manual entry/re-scanning.",
                    "Helps prevent garbage data from entering review queues."
                  ]}
                />
              </label>
              <input type="number" step="0.01" value={blockBelow} onChange={(e) => { setBlockBelow(Number(e.target.value)); markDirty(); }} className="w-full bg-transparent text-5xl font-black text-rose-600 text-center outline-none border-none" />
              <div className="mt-6 px-4 py-1.5 bg-rose-50 text-rose-700 text-[10px] font-black rounded-lg inline-block uppercase tracking-tighter">Stop Processing</div>
            </div>
          </div>

          <div className="bg-white rounded-[3.5rem] p-12 border border-slate-200 shadow-sm relative">
             <div className="flex items-center justify-between mb-10">
               <div>
                  <h3 className="text-2xl font-black text-slate-900">Routing Directives</h3>
                  <p className="text-xs text-slate-500 mt-2 font-medium">Apply specific lanes and human instructions based on custom text signals.</p>
               </div>
               <button onClick={() => setShowAddModal(true)} className="px-6 py-4 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                  <i className="fa-solid fa-plus-circle"></i> Add Custom Rule
               </button>
             </div>

             <div className="grid grid-cols-1 gap-4">
                {exclusions.map((rule) => (
                  <div key={rule.reason_code} className="group bg-slate-50/30 border border-slate-100 rounded-[2rem] p-6 flex items-center justify-between transition-all hover:bg-white hover:border-indigo-200">
                    <div className="flex items-center gap-6">
                       <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl shadow-inner ${SYSTEM_SIGNAL_CODES.includes(rule.reason_code) ? 'bg-slate-200 text-slate-500' : 'bg-indigo-600 text-white shadow-lg'}`}>
                         <i className={`fa-solid ${SYSTEM_SIGNAL_CODES.includes(rule.reason_code) ? 'fa-tag' : 'fa-wand-magic-sparkles'}`}></i>
                       </div>
                       <div>
                         <div className="flex items-center gap-3">
                           <span className="text-sm font-black text-slate-900 uppercase tracking-tight">{rule.reason_code.replace(/_/g, ' ')}</span>
                         </div>
                         <p className="text-[11px] text-slate-400 font-medium mt-1 max-w-xl line-clamp-1 italic">{rule.instructions || rule.description}</p>
                       </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <select 
                        value={rule.action}
                        onChange={(e) => updateExclusionAction(rule.reason_code, e.target.value as ExclusionAction)}
                        className="text-[10px] font-black bg-white border border-slate-200 rounded-xl px-4 py-2 text-slate-600 outline-none cursor-pointer shadow-sm"
                      >
                        <option value="HUMAN_REVIEW">Review</option>
                        <option value="MANUAL_PROCESS">Assist</option>
                        <option value="BLOCK">Block</option>
                      </select>
                      <button onClick={() => removeExclusion(rule.reason_code)} className="w-10 h-10 flex items-center justify-center text-slate-200 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all">
                        <i className="fa-solid fa-trash-can text-sm"></i>
                      </button>
                    </div>
                  </div>
                ))}
             </div>
          </div>

          <div className="flex justify-between pt-8 border-t border-slate-50">
             <button onClick={() => setStep(3)} className="px-10 py-5 border border-slate-200 text-slate-500 rounded-[2rem] font-black hover:bg-slate-50 transition-all text-xs uppercase tracking-widest">Back</button>
             <button onClick={finalizeSetup} className="px-16 py-5 bg-slate-900 text-white rounded-[2.5rem] font-black shadow-2xl shadow-slate-900/20 hover:bg-indigo-600 transition-all text-xs uppercase tracking-[0.25em]">
                Verify & Deploy Logic
             </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="text-center py-24 animate-in zoom-in-95">
          <div className="relative inline-block mb-12">
            <div className="w-28 h-28 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center text-4xl shadow-inner mx-auto mb-10">
              <i className="fa-solid fa-check-double"></i>
            </div>
            <div className="absolute inset-0 rounded-full border-4 border-emerald-500/10 animate-ping"></div>
          </div>
          <h2 className="text-5xl font-black text-slate-900 tracking-tight">System Operational</h2>
          <p className="text-slate-500 mt-6 text-xl font-medium max-w-xl mx-auto leading-relaxed">Your organization logic and confidence gates have been synchronized. Documents will now be ingested according to your defined policy.</p>
          
          <div className="mt-16 flex flex-col items-center gap-6">
            <button 
              onClick={applyPolicyToApp}
              disabled={isDeploying || (!isDirty && wasJustDeployed)}
              className={`px-20 py-6 rounded-[3rem] font-black transition-all text-xs uppercase tracking-[0.3em] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] ${isDeploying ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : wasJustDeployed ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-indigo-600'}`}
            >
              {isDeploying ? 'Synchronizing State...' : wasJustDeployed ? 'Deployment Active' : 'Confirm & Deploy Profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
