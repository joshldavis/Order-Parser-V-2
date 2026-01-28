import React, { useState, useRef, useCallback, useEffect } from 'react';
import { POLineRow, GeminiParsingResult } from './types';
import { ReferencePack } from './referencePack.schema';
import { parseDocument } from './services/geminiService';
import { geminiResultToPOLineRows, downloadCsv } from './services/mappingService';
import { buildControlSurfaceWorkbook, downloadBlob } from './services/xlsxExport';
import { exportControlSurfaceCsv } from './services/controlSurfaceExport';
import { ReferenceService } from './services/referenceService';
import { enrichAndValidate } from './services/enrichAndValidate';
import DataTable from './components/DataTable';
import { loadPolicy, savePolicy } from './policy/policyLocalStore';
import { PolicyAdmin } from './components/PolicyAdmin';
import { ControlSurfacePolicy } from './policy/controlSurfacePolicy';
import { applyPolicyRouting } from './services/policyRouting';
import { loadReferencePack, saveReferencePack } from './reference/referenceLocalStore';
import { ReferencePackAdmin } from './components/ReferencePackAdmin';
import { SetupWizard } from './components/SetupWizard';
import { loadOrgProfile, ensureOrgProfileSeed } from './setup/orgProfile.store';
import { isSetupComplete, OrgSetupProfile } from './setup/orgProfile.types';

declare const Tesseract: any;

const App: React.FC = () => {
  const [currentPolicy, setCurrentPolicy] = useState<ControlSurfacePolicy>(() => loadPolicy());
  const [referencePack, setReferencePack] = useState<ReferencePack>(() => loadReferencePack());
  const [rows, setRows] = useState<POLineRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'ops' | 'policy' | 'reference' | 'setup'>('ops');
  
  const [orgProfileState, setOrgProfileState] = useState<OrgSetupProfile>(() => ensureOrgProfileSeed());

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentPolicy(loadPolicy());
    setReferencePack(loadReferencePack());
    
    const profile = loadOrgProfile();
    if (profile) {
      setOrgProfileState(profile);
      if (!isSetupComplete(profile)) {
        setActiveTab('setup');
      }
    }
  }, []);

  const handlePolicyUpdated = (updated: ControlSurfacePolicy) => {
    setCurrentPolicy(updated);
    const p = loadOrgProfile();
    if (p) {
      setOrgProfileState(p);
    }
  };

  const handleReferencePackUpdated = (updated: ReferencePack) => {
    setReferencePack(updated);
    saveReferencePack(updated);
  };

  const handleProfileUpdated = (updated: OrgSetupProfile) => {
    setOrgProfileState(updated);
  };

  const handleExportCsv = () => {
    if (rows.length === 0) return;
    const csv = exportControlSurfaceCsv(rows);
    const timestamp = new Date().toISOString().split('T')[0];
    downloadCsv(`OrderFlow_Extract_${timestamp}.csv`, csv);
  };

  const handleExportXlsx = async () => {
    if (rows.length === 0) return;
    try {
      // Logic for building workbook. buildControlSurfaceWorkbook handles template logic internally
      const blob = buildControlSurfaceWorkbook({ poLineRows: rows });
      const timestamp = new Date().toISOString().split('T')[0];
      downloadBlob(`OrderFlow_Extract_${timestamp}.xlsx`, blob);
    } catch (err: any) {
      alert("Excel Export failed: " + err.message);
    }
  };

  const processFiles = async (files: FileList) => {
    const currentProfile = loadOrgProfile() || orgProfileState;
    if (!isSetupComplete(currentProfile)) {
      alert("Please complete Organization Setup before parsing documents.");
      setActiveTab('setup');
      return;
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
        const errorMsg = JSON.stringify(error);
        if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
          setProcessingStatus(`Quota Exhausted`);
          alert(`API Rate Limit reached. Please wait 60s.`);
        } else {
          alert(`Error processing ${file.name}`);
        }
      }
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setRows(prev => [...allNewRows, ...prev]);
    setIsProcessing(false);
    setProgress(0);
    setProcessingStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const reRunRouting = useCallback(() => {
    if (rows.length === 0) return;
    const updated = applyPolicyRouting(rows, currentPolicy, { phase: "PHASE_1" });
    setRows(updated);
  }, [rows, currentPolicy]);

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
      className={`min-h-screen bg-slate-50 flex flex-col antialiased text-slate-900 transition-colors duration-300 ${isDragging ? 'bg-blue-50/50' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) processFiles(e.dataTransfer.files); }}
    >
      <header className="bg-white/90 border-b border-slate-200 sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-indigo-600 to-blue-500 p-2.5 rounded-2xl shadow-lg shadow-blue-500/20">
              <i className="fa-solid fa-file-invoice-dollar text-white text-2xl"></i>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">OrderFlow <span className="text-blue-600">Pro</span></h1>
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Enterprise Data Processor</p>
            </div>
          </div>

          <nav className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner">
            <button 
              onClick={() => setActiveTab('ops')}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'ops' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-microchip"></i> Parse
            </button>
            <button 
              onClick={() => setActiveTab('policy')}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'policy' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-shield-halved"></i> Policy
            </button>
            <button 
              onClick={() => setActiveTab('reference')}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'reference' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-book"></i> Catalogue
            </button>
            <button 
              onClick={() => setActiveTab('setup')}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'setup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-wand-magic-sparkles"></i>
              Setup
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {activeTab === 'ops' ? (
              <>
                <div className="flex items-center gap-2 mr-4 border-r border-slate-200 pr-4">
                  <button onClick={reRunRouting} disabled={rows.length === 0} className="text-[10px] font-bold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-30 disabled:pointer-events-none" title="RE-RUN Policy Routing">
                    <i className="fa-solid fa-rotate"></i> Re-Run Policy
                  </button>
                </div>
                
                {rows.length > 0 && (
                  <div className="flex items-center gap-2 mr-2">
                    <button onClick={handleExportCsv} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all text-xs flex items-center gap-2">
                      <i className="fa-solid fa-file-csv"></i> CSV
                    </button>
                    <button onClick={handleExportXlsx} className="px-4 py-2.5 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 text-xs flex items-center gap-2">
                      <i className="fa-solid fa-file-excel"></i> Export Excel
                    </button>
                  </div>
                )}

                <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-2xl font-bold hover:bg-blue-600 transition-all shadow-xl active:scale-95 text-xs">
                  <i className="fa-solid fa-plus-circle"></i> Import
                </button>
                <input type="file" ref={fileInputRef} onChange={(e) => e.target.files && processFiles(e.target.files)} className="hidden" multiple accept="application/pdf,image/*" />
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-8">
        {activeTab === 'ops' ? (
          (() => {
            const setupComplete = isSetupComplete(orgProfileState);

            if (!setupComplete) {
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-[3rem] p-10 shadow-xl max-w-2xl mx-auto text-center animate-in fade-in slide-in-from-bottom-4">
                  <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">
                    <i className="fa-solid fa-lock"></i>
                  </div>
                  <h2 className="text-2xl font-black text-amber-900">Setup Required</h2>
                  <p className="text-amber-800 mt-2 font-medium">
                    Before parsing, complete Setup: historical truth source, catalog, output template, and policy gates.
                  </p>
                  <button
                    onClick={() => setActiveTab('setup')}
                    className="mt-6 px-6 py-3 rounded-2xl bg-slate-900 text-white font-black hover:bg-blue-600 transition-all shadow-xl shadow-slate-900/10"
                  >
                    Go to Setup
                  </button>
                </div>
              );
            }

            return (
              <>
                {isProcessing ? (
                  <div className="mb-10 bg-white border border-blue-100 rounded-[3rem] p-16 text-center shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-50">
                       <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                    </div>
                    <div className="flex flex-col items-center gap-8">
                      <div className="w-28 h-28 border-[6px] border-slate-100 border-t-blue-600 rounded-full animate-spin"></div>
                      <h3 className="text-2xl font-black text-slate-900">{processingStatus}</h3>
                    </div>
                  </div>
                ) : rows.length === 0 ? (
                  <div className="mb-10 bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-24 text-center group hover:border-blue-400 transition-all cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <i className="fa-solid fa-cloud-arrow-up text-4xl text-slate-300 group-hover:text-blue-500 mb-6 block"></i>
                    <h2 className="text-3xl font-black text-slate-900 mb-3">Drop Business Documents to Begin</h2>
                    <p className="text-slate-500 text-lg max-w-md mx-auto">AI will parse your orders and apply governance policies automatically.</p>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                    <DataTable data={rows} onDelete={(idx) => setRows(prev => prev.filter((_, i) => i !== idx))} />
                  </div>
                )}
              </>
            );
          })()
        ) : activeTab === 'policy' ? (
          <PolicyAdmin policy={currentPolicy} onPolicyChange={setCurrentPolicy} />
        ) : activeTab === 'reference' ? (
          <ReferencePackAdmin referencePack={referencePack} onReferencePackChange={handleReferencePackUpdated} />
        ) : (
          <SetupWizard
            currentPolicy={currentPolicy}
            onPolicyUpdated={handlePolicyUpdated}
            onReferencePackUpdated={handleReferencePackUpdated}
            onProfileUpdated={handleProfileUpdated}
            referencePack={referencePack}
          />
        )}
      </main>
    </div>
  );
};

export default App;