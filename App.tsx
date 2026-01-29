import React, { useState, useRef, useCallback, useEffect } from 'react';
import { POLineRow, GeminiParsingResult } from './types.ts';
import { ReferencePack } from './referencePack.schema.ts';
import { parseDocument } from './services/geminiService.ts';
import { geminiResultToPOLineRows, downloadCsv } from './services/mappingService.ts';
import { buildControlSurfaceWorkbook, downloadBlob } from './services/xlsxExport.ts';
import { exportControlSurfaceCsv } from './services/controlSurfaceExport.ts';
import { ReferenceService } from './services/referenceService.ts';
import { enrichAndValidate } from './services/enrichAndValidate.ts';
import DataTable from './components/DataTable.tsx';
import { loadPolicy, savePolicy } from './policy/policyLocalStore.ts';
import { PolicyAdmin } from './components/PolicyAdmin.tsx';
import { ControlSurfacePolicy } from './policy/controlSurfacePolicy.ts';
import { applyPolicyRouting } from './services/policyRouting.ts';
import { loadReferencePack, saveReferencePack } from './reference/referenceLocalStore.ts';
import { ReferencePackAdmin } from './components/ReferencePackAdmin.tsx';
import { SetupWizard } from './components/SetupWizard.tsx';
import { HelpGuide } from './components/HelpGuide.tsx';
import { loadOrgProfile, ensureOrgProfileSeed } from './setup/orgProfile.store.ts';
import { isSetupComplete, OrgSetupProfile } from './setup/orgProfile.types.ts';
import { buildPOExportsV1 } from './services/jsonExport.ts';
import { POExportV1, AuditEvent } from './services/abhSchema.ts';
import JsonExportPanel from './components/JsonExportPanel.tsx';

declare const Tesseract: any;

const App: React.FC = () => {
  const [currentPolicy, setCurrentPolicy] = useState<ControlSurfacePolicy>(() => loadPolicy());
  const [referencePack, setReferencePack] = useState<ReferencePack>(() => loadReferencePack());
  const [rows, setRows] = useState<POLineRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'ops' | 'policy' | 'reference' | 'setup' | 'help'>('ops');
  const [bypassSetup, setBypassSetup] = useState(false);
  const [showJsonExport, setShowJsonExport] = useState(false);
  const [poExports, setPoExports] = useState<POExportV1[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  
  const [orgProfileState, setOrgProfileState] = useState<OrgSetupProfile>(() => ensureOrgProfileSeed());

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentPolicy(loadPolicy());
    setReferencePack(loadReferencePack());
    
    const profile = loadOrgProfile();
    if (profile) {
      setOrgProfileState(profile);
    }
  }, []);

  const handleUpdateRow = (idx: number, patch: Partial<POLineRow>) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const handleHumanOverride = useCallback((evt: any) => {
    setAuditEvents(prev => [...prev, {
      at: new Date().toISOString(),
      event_type: 'HUMAN_OVERRIDE',
      actor: 'HUMAN',
      details: evt,
    }]);
  }, []);

  const handlePolicyUpdated = (updated: ControlSurfacePolicy) => {
    setCurrentPolicy(updated);
  };

  const handleReferencePackUpdated = (updated: ReferencePack) => {
    setReferencePack(updated);
    saveReferencePack(updated);
  };

  const handleProfileUpdated = (updated: OrgSetupProfile) => {
    setOrgProfileState(updated);
  };

  const handleExportXlsx = async () => {
    if (rows.length === 0) return;
    try {
      const blob = buildControlSurfaceWorkbook({ poLineRows: rows });
      const timestamp = new Date().toISOString().split('T')[0];
      downloadBlob(`OrderFlow_Spreadsheet_${timestamp}.xlsx`, blob);
    } catch (err: any) {
      alert("Excel Export failed: " + err.message);
    }
  };

  const handleExportJson = () => {
    if (rows.length === 0) return;
    const exports = buildPOExportsV1({
      rows,
      appVersion: '2.5.0',
      runMode: 'PRODUCTION',
      environment: 'PROD',
      vendorName: 'ABH Manufacturing',
      thresholds: {
        auto_stage_min: currentPolicy.defaults.phase_min_confidence_auto.PHASE_1,
        review_min: currentPolicy.defaults.phase_min_confidence_auto.PHASE_1 - 0.15
      },
      auditEvents
    });
    setPoExports(exports);
    setShowJsonExport(true);
  };

  const handleClearQueue = () => {
    if (confirm("Clear all extracted line items?")) {
      setRows([]);
      setAuditEvents([]);
    }
  };

  const processFiles = async (files: FileList) => {
    const currentProfile = loadOrgProfile() || orgProfileState;
    if (!isSetupComplete(currentProfile) && !bypassSetup) {
      if (!confirm("Setup is not complete. AI accuracy might be reduced without custom calibration and catalogues. Proceed anyway?")) {
        setActiveTab('setup');
        return;
      }
      setBypassSetup(true);
    }

    setIsProcessing(true);
    let allNewRows: POLineRow[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileStem = file.name.replace(/\.[^/.]+$/, "");
      const stepSize = 100 / files.length;
      const baseProgress = (i / files.length) * 100;

      if (i > 0) {
        setProcessingStatus(`Pacing for API Quota (5s)...`);
        await new Promise(r => setTimeout(r, 5000));
      }

      try {
        let ocrTextHint = '';
        if (file.type.startsWith('image/')) {
          setProcessingStatus(`OCR analyzing: ${file.name}...`);
          setProgress(baseProgress + (stepSize * 0.2));
          try {
            const result = await Tesseract.recognize(file, 'eng');
            ocrTextHint = result.data.text;
          } catch (ocrErr) {
            console.warn("OCR Hint failed", ocrErr);
          }
        }

        setProcessingStatus(`AI Extracting: ${file.name}...`);
        setProgress(baseProgress + (stepSize * 0.5));

        const base64 = await fileToBase64(file);
        const parsed: GeminiParsingResult = await parseDocument(
          base64, 
          file.type, 
          ocrTextHint, 
          referencePack || undefined,
          (status) => setProcessingStatus(`${file.name}: ${status}`)
        );
        
        let mappedRows = geminiResultToPOLineRows({ 
          parsed, 
          sourceFileStem: fileStem,
          policy: currentPolicy,
          refPack: referencePack
        });

        if (referencePack && referencePack.manufacturers.length > 0) {
          const refService = new ReferenceService(referencePack);
          mappedRows = enrichAndValidate(mappedRows, refService, referencePack.version);
        }

        allNewRows = [...allNewRows, ...mappedRows];

      } catch (error: any) {
        console.error(`Error processing ${file.name}:`, error);
        alert(`Error processing ${file.name}: Check console for details.`);
      }
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setRows(prev => [...allNewRows, ...prev]);
    setIsProcessing(false);
    setProgress(0);
    setProcessingStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result?.toString().split(',')[1];
        if (base64String) resolve(base64String);
        else reject(new Error("Base64 conversion failed"));
      };
      reader.onerror = error => reject(error);
    });
  };

  return (
    <div 
      className={`min-h-screen bg-slate-50 flex flex-col antialiased text-slate-900 transition-colors duration-300 ${isDragging ? 'bg-indigo-50/50' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) processFiles(e.dataTransfer.files); }}
    >
      {showJsonExport && (
        <JsonExportPanel exports={poExports} onClose={() => setShowJsonExport(false)} />
      )}

      <header className="bg-white/95 border-b border-slate-200 sticky top-0 z-40 backdrop-blur-xl shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-indigo-700 to-indigo-500 p-2.5 rounded-2xl shadow-lg shadow-indigo-500/20">
              <i className="fa-solid fa-table-list text-white text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter text-slate-900 leading-none">OrderFlow <span className="text-indigo-600">Spreadsheet</span></h1>
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">AI Data Extractor</p>
            </div>
          </div>

          <nav className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner">
            <button 
              onClick={() => setActiveTab('ops')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'ops' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-file-invoice"></i> Parse
            </button>
            <button 
              onClick={() => setActiveTab('policy')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'policy' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-shield-halved"></i> Rules
            </button>
            <button 
              onClick={() => setActiveTab('reference')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'reference' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-book"></i> Catalog
            </button>
            <button 
              onClick={() => setActiveTab('setup')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'setup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-gear"></i> Setup
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {activeTab === 'ops' && rows.length > 0 && (
              <button onClick={handleClearQueue} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5">
                <i className="fa-solid fa-trash-can"></i> Clear
              </button>
            )}
            
            {activeTab === 'ops' && rows.length > 0 && (
              <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                <button onClick={handleExportJson} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all text-xs flex items-center gap-2">
                  <i className="fa-solid fa-code"></i> JSON Export
                </button>
                <button onClick={handleExportXlsx} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 text-xs flex items-center gap-2">
                  <i className="fa-solid fa-file-excel"></i> Export Spreadsheet
                </button>
              </div>
            )}

            {activeTab === 'ops' && (
              <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-xl font-black hover:bg-slate-800 transition-all shadow-xl active:scale-95 text-xs">
                <i className="fa-solid fa-plus-circle"></i> Import PDF
              </button>
            )}
            <input type="file" ref={fileInputRef} onChange={(e) => e.target.files && processFiles(e.target.files)} className="hidden" multiple accept="application/pdf,image/*" />
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-8">
        {activeTab === 'ops' ? (
          <>
            {isProcessing ? (
              <div className="mb-10 bg-white border border-indigo-100 rounded-[3rem] p-16 text-center shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-50">
                   <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="flex flex-col items-center gap-8">
                  <div className="w-24 h-24 border-[5px] border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">{processingStatus}</h3>
                  <p className="text-slate-400 font-medium max-w-sm">Gemini 3 Pro is analyzing document structure and extracting line items...</p>
                </div>
              </div>
            ) : rows.length === 0 ? (
              <div className="mb-10 bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-24 text-center group hover:border-indigo-400 transition-all cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-8 group-hover:bg-indigo-50 transition-colors">
                  <i className="fa-solid fa-file-upload text-3xl text-slate-300 group-hover:text-indigo-500"></i>
                </div>
                <h2 className="text-3xl font-black text-slate-900 mb-3 tracking-tight">Drop Document to Start</h2>
                <p className="text-slate-500 text-lg max-w-md mx-auto font-medium">Instantly parse Purchase Orders or Invoices into a clean, editable spreadsheet format.</p>
                {!isSetupComplete(orgProfileState) && (
                  <div className="mt-8 flex items-center justify-center gap-2 text-amber-600 font-black text-[10px] uppercase tracking-widest">
                    <i className="fa-solid fa-triangle-exclamation"></i> Standard Policy Active
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center justify-between px-2 mb-2">
                  <div className="flex items-center gap-4">
                    <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Extracted Spreadsheet Data</h2>
                    <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-lg text-[10px] font-black">{rows.length} Items</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-medium italic">
                    <i className="fa-solid fa-circle-info mr-1"></i> Tip: You can edit cells directly in the table before exporting.
                  </div>
                </div>
                <DataTable 
                  data={rows} 
                  onDelete={(idx) => setRows(prev => prev.filter((_, i) => i !== idx))} 
                  onUpdate={handleUpdateRow}
                  onHumanOverride={handleHumanOverride}
                />
              </div>
            )}
          </>
        ) : activeTab === 'policy' ? (
          <PolicyAdmin policy={currentPolicy} onPolicyChange={handlePolicyUpdated} />
        ) : activeTab === 'reference' ? (
          <ReferencePackAdmin referencePack={referencePack} onReferencePackChange={handleReferencePackUpdated} />
        ) : activeTab === 'setup' ? (
          <SetupWizard
            currentPolicy={currentPolicy}
            onPolicyUpdated={handlePolicyUpdated}
            onReferencePackUpdated={handleReferencePackUpdated}
            onProfileUpdated={handleProfileUpdated}
            referencePack={referencePack}
          />
        ) : (
          <HelpGuide />
        )}
      </main>
      
      <footer className="max-w-7xl mx-auto w-full px-6 py-6 border-t border-slate-200 flex items-center justify-between">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          OrderFlow Spreadsheet Utility • v2.5.0
        </div>
        <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400">
          <span className="flex items-center gap-1.5"><i className="fa-solid fa-circle text-emerald-500 text-[6px]"></i> Gemini Engine Online</span>
          <span className="flex items-center gap-1.5"><i className="fa-solid fa-lock"></i> AES-256 Local Encryption</span>
        </div>
      </footer>
    </div>
  );
};

export default App;