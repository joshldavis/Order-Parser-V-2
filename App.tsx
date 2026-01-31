import React, { useState, useRef, useCallback, useEffect } from 'react';
import { POLineRow, GeminiParsingResult } from './types.ts';
import { ReferencePack } from './referencePack.schema.ts';
import { parseDocument, parsePacketSegment } from './services/geminiService.ts';
import { geminiResultToPOLineRows } from './services/mappingService.ts';
import { buildControlSurfaceWorkbook, downloadBlob } from './services/xlsxExport.ts';
import { ReferenceService } from './services/referenceService.ts';
import { enrichAndValidate } from './services/enrichAndValidate.ts';
import DataTable from './components/DataTable.tsx';
import { loadPolicy } from './policy/policyLocalStore.ts';
import { PolicyAdmin } from './components/PolicyAdmin.tsx';
import { ControlSurfacePolicy } from './policy/controlSurfacePolicy.ts';
import { loadReferencePack, saveReferencePack } from './reference/referenceLocalStore.ts';
import { ReferencePackAdmin } from './components/ReferencePackAdmin.tsx';
import { SetupWizard } from './components/SetupWizard.tsx';
import { HelpGuide } from './components/HelpGuide.tsx';
import { loadOrgProfile, ensureOrgProfileSeed } from './setup/orgProfile.store.ts';
import { isSetupComplete, OrgSetupProfile } from './setup/orgProfile.types.ts';
import { buildPOExportsV1 } from './services/jsonExport.ts';
import { POExportV1, AuditEvent } from './services/abhSchema.ts';
import JsonExportPanel from './components/JsonExportPanel.tsx';
import { extractPdfPageText, triagePages, buildSegments } from './services/pdfPacketTriage.ts';
import { renderPdfPagesToPngBase64 } from './services/pdfRender.ts';
import { RegressionHarness } from './components/RegressionHarness.tsx';

declare const Tesseract: any;

const App: React.FC = () => {
  const [currentPolicy, setCurrentPolicy] = useState<ControlSurfacePolicy>(() => loadPolicy());
  const [referencePack, setReferencePack] = useState<ReferencePack>(() => loadReferencePack());
  const [rows, setRows] = useState<POLineRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'ops' | 'policy' | 'reference' | 'setup' | 'help' | 'regression'>('ops');
  const [bypassSetup, setBypassSetup] = useState(false);
  const [showJsonExport, setShowJsonExport] = useState(false);
  const [poExports, setPoExports] = useState<POExportV1[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  
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
      setLastError(null);
    }
  };

  const fileToUint8Array = async (file: File): Promise<Uint8Array> => {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
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

  const runParseForFile = async (file: File): Promise<POExportV1[]> => {
    const fileStem = file.name.replace(/\.[^/.]+$/, "");
    let documents: POExportV1[] = [];

    if (file.type === 'application/pdf') {
      const data = await fileToUint8Array(file);
      const pageTexts = await extractPdfPageText(data.slice());
      const triage = triagePages(pageTexts);
      const segments = buildSegments(triage).filter(s => s.label !== "UNKNOWN" || (s.pageEnd - s.pageStart) >= 0);

      for (const seg of segments) {
        if (seg.label === 'EMAIL_COVER') continue;
        const rendered = await renderPdfPagesToPngBase64(data.slice(), seg.pages, 2.0);
        const parts = rendered.map(r => ({ base64: r.base64, mimeType: r.mimeType }));
        const triageHint = seg.triage
          .map(p => `PAGE ${p.pageIndex + 1}: ${p.label} (${p.score.toFixed(2)}) ${p.reasons.join(", ")}`)
          .join("\n");

        const result = await parsePacketSegment(
          parts,
          {
            segmentLabelHint: seg.label,
            sourcePages: seg.pages,
            pageStart: seg.pageStart,
            pageEnd: seg.pageEnd,
            packetFilename: file.name,
            triageTextHint: triageHint,
          },
          referencePack
        );
        documents = [...documents, ...(result.documents || [])];
      }
    } else {
      const base64 = await fileToBase64(file);
      let ocrTextHint = '';
      if (file.type.startsWith('image/')) {
        try {
          const result = await Tesseract.recognize(file, 'eng');
          ocrTextHint = result.data.text;
        } catch {}
      }
      const parsed = await parseDocument(base64, file.type, ocrTextHint, referencePack || undefined);
      documents = parsed.documents || [];
    }

    const mappedRows = geminiResultToPOLineRows({
      parsed: { documents },
      sourceFileStem: fileStem,
      policy: currentPolicy,
      refPack: referencePack
    });

    return buildPOExportsV1({
      rows: mappedRows,
      appVersion: '2.5.0',
      runMode: 'PRODUCTION',
      environment: 'PROD',
      vendorName: 'ABH Manufacturing',
      thresholds: {
        auto_stage_min: currentPolicy.defaults.phase_min_confidence_auto.PHASE_1,
        review_min: currentPolicy.defaults.phase_min_confidence_auto.PHASE_1 - 0.15
      },
      auditEvents: []
    });
  };

  const processFiles = async (files: FileList) => {
    setLastError(null);
    const currentProfile = loadOrgProfile() || orgProfileState;
    setSelectedFiles(files);
    
    if (!isSetupComplete(currentProfile) && !bypassSetup) {
      if (!confirm("Setup is not complete. AI accuracy might be reduced without custom calibration and catalogues. Proceed anyway?")) {
        setActiveTab('setup');
        return;
      }
      setBypassSetup(true);
    }

    setIsProcessing(true);
    let allNewRows: POLineRow[] = [];
    const filesArray = Array.from(files);

    try {
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        const fileStem = file.name.replace(/\.[^/.]+$/, "");
        const stepSize = 100 / filesArray.length;
        const baseProgress = (i / filesArray.length) * 100;

        if (i > 0) {
          setProcessingStatus(`Pacing for next file...`);
          await new Promise(r => setTimeout(r, 1000));
        }

        if (file.type === 'application/pdf') {
          setProcessingStatus(`Analyzing Document Packet: ${file.name}...`);
          setProgress(baseProgress + (stepSize * 0.1));

          const data = await fileToUint8Array(file);
          const pageTexts = await extractPdfPageText(data.slice());
          const triage = triagePages(pageTexts);
          const segments = buildSegments(triage).filter(s => s.label !== "UNKNOWN" || (s.pageEnd - s.pageStart) >= 0);

          setProcessingStatus(`Found ${segments.length} documents in ${file.name}...`);

          for (let sIdx = 0; sIdx < segments.length; sIdx++) {
            const seg = segments[sIdx];
            if (seg.label === 'EMAIL_COVER') continue;

            setProcessingStatus(`Processing ${seg.label} (Part ${sIdx + 1}/${segments.length})...`);
            setProgress(baseProgress + (stepSize * (0.2 + (0.8 * ((sIdx + 1) / segments.length)))));

            const rendered = await renderPdfPagesToPngBase64(data.slice(), seg.pages, 2.0);
            const parts = rendered.map(r => ({ base64: r.base64, mimeType: r.mimeType }));
            const triageHint = seg.triage
              .map(p => `PAGE ${p.pageIndex + 1}: ${p.label} (${p.score.toFixed(2)}) ${p.reasons.join(", ")}`)
              .join("\n");

            const result = await parsePacketSegment(
              parts,
              {
                segmentLabelHint: seg.label,
                sourcePages: seg.pages,
                pageStart: seg.pageStart,
                pageEnd: seg.pageEnd,
                packetFilename: file.name,
                triageTextHint: triageHint,
              },
              referencePack,
              (status) => setProcessingStatus(status)
            );
            
            let mappedRows = geminiResultToPOLineRows({ 
              parsed: result, 
              sourceFileStem: `${fileStem}_doc${sIdx+1}`,
              policy: currentPolicy,
              refPack: referencePack
            });

            if (referencePack && referencePack.manufacturers.length > 0) {
              const refService = new ReferenceService(referencePack);
              mappedRows = enrichAndValidate(mappedRows, refService, referencePack.version);
            }
            allNewRows = [...allNewRows, ...mappedRows];
          }
        } else {
          const base64 = await fileToBase64(file);
          let ocrTextHint = '';
          if (file.type.startsWith('image/')) {
            setProcessingStatus(`Running OCR: ${file.name}...`);
            setProgress(baseProgress + (stepSize * 0.2));
            try {
              if (typeof Tesseract !== 'undefined') {
                const result = await Tesseract.recognize(file, 'eng');
                ocrTextHint = result.data.text;
              }
            } catch (ocrErr) {
              console.warn("OCR Hint failed", ocrErr);
            }
          }

          setProcessingStatus(`AI Extracting: ${file.name}...`);
          setProgress(baseProgress + (stepSize * 0.5));

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
        }
        setProgress(Math.round(((i + 1) / filesArray.length) * 100));
      }
      setRows(prev => [...allNewRows, ...prev]);
    } catch (error: any) {
      console.error("Critical Processing Error:", error);
      setLastError(error?.message || "An unknown error occurred during document processing.");
    } finally {
      setIsProcessing(false);
      setProgress(0);
      setProcessingStatus('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
              onClick={() => setActiveTab('regression')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'regression' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <i className="fa-solid fa-flask"></i> Regressions
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

            {(activeTab === 'ops' || activeTab === 'regression') && (
              <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-xl font-black hover:bg-slate-800 transition-all shadow-xl active:scale-95 text-xs">
                <i className="fa-solid fa-plus-circle"></i> Import PDF
              </button>
            )}
            <input type="file" ref={fileInputRef} onChange={(e) => { if(activeTab === 'ops' && e.target.files) processFiles(e.target.files); else setSelectedFiles(e.target.files); }} className="hidden" multiple accept="application/pdf,image/*" />
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-8">
        {lastError && (
          <div className="mb-8 p-6 bg-rose-50 border border-rose-200 rounded-[2rem] flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
            <div className="w-10 h-10 bg-rose-600 text-white rounded-full flex items-center justify-center shrink-0 shadow-lg">
              <i className="fa-solid fa-circle-exclamation"></i>
            </div>
            <div>
              <h3 className="text-sm font-black text-rose-900 uppercase tracking-widest mb-1">Processing Failed</h3>
              <p className="text-xs text-rose-800 font-medium leading-relaxed">{lastError}</p>
              <button onClick={() => setLastError(null)} className="mt-3 text-[10px] font-black text-rose-600 uppercase hover:underline">Dismiss Error</button>
            </div>
          </div>
        )}

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
                  <p className="text-slate-400 font-medium max-w-sm">Gemini Flash is analyzing document structure and extracting line items...</p>
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
        ) : activeTab === 'regression' ? (
          <RegressionHarness files={selectedFiles} runParseForFile={runParseForFile} />
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