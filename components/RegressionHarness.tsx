
// components/RegressionHarness.tsx
import React, { useMemo, useState, useCallback } from "react";
import { POExportV1 } from "../services/abhSchema.ts";
import {
  sha256Base64,
  buildSignature,
  saveBaseline,
  getBaseline,
  listBaselines,
  deleteBaseline,
  diffSignatures,
  ParseSignature,
} from "../services/regressionHarness.ts";

type Props = {
  files: FileList | null;
  runParseForFile: (file: File) => Promise<POExportV1[]>; 
};

export const RegressionHarness: React.FC<Props> = ({ files, runParseForFile }) => {
  const [results, setResults] = useState<Array<{
    filename: string;
    fileHash: string;
    baseline: ParseSignature | null;
    current: ParseSignature;
    ok: boolean;
    errors: string[];
    warnings: string[];
  }>>([]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);

  const baselinesList = useMemo(() => listBaselines(), [refreshNonce]);

  const fileToBase64 = useCallback((file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const b64 = reader.result?.toString().split(",")[1];
        if (b64) resolve(b64);
        else reject(new Error("Base64 conversion failed"));
      };
      reader.onerror = reject;
    }), []);

  const createBaseline = async () => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setResults([]);
    try {
      const filesArray = Array.from(files) as File[];
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        setStatus(`Creating baseline for ${file.name} (${i + 1}/${filesArray.length})...`);
        
        const b64 = await fileToBase64(file);
        const fileHash = await sha256Base64(b64);
        const docs = await runParseForFile(file);

        if (!docs || docs.length === 0) {
          console.warn(`No documents extracted for baseline: ${file.name}`);
        }

        const sig = buildSignature({ filename: file.name, fileHash, docs });
        saveBaseline(sig);
      }
      setRefreshNonce(n => n + 1);
      setStatus("");
      alert("Baselines saved for selected files.");
    } catch (err: any) {
      console.error("Baseline error:", err);
      alert("Baseline creation failed: " + err.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const runRegression = async () => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setStatus("Running regression analysis...");
    try {
      const out: any[] = [];
      const filesArray = Array.from(files) as File[];
      
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        setStatus(`Analyzing ${file.name} (${i + 1}/${filesArray.length})...`);
        
        const b64 = await fileToBase64(file);
        const fileHash = await sha256Base64(b64);

        const baseline = getBaseline(fileHash);
        const docs = await runParseForFile(file);
        const current = buildSignature({ filename: file.name, fileHash, docs });

        if (!baseline) {
          out.push({
            filename: file.name,
            fileHash,
            baseline: null,
            current,
            ok: false,
            errors: ["No baseline found for this file hash. Create baseline first."],
            warnings: [],
          });
          continue;
        }

        const diff = diffSignatures(baseline, current);
        out.push({
          filename: file.name,
          fileHash,
          baseline,
          current,
          ok: diff.ok,
          errors: diff.errors,
          warnings: diff.warnings,
        });
      }
      setResults(out);
    } catch (err: any) {
      console.error("Regression error:", err);
      alert("Regression run failed: " + err.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const handleDelete = (hash: string) => {
    if (confirm("Delete this baseline Golden? This cannot be undone.")) {
      deleteBaseline(hash);
      setRefreshNonce(n => n + 1);
      setResults(prev => prev.filter(r => r.fileHash !== hash));
    }
  };

  return (
    <div className="bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
      <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-3">
            <div className="bg-rose-600 text-white w-8 h-8 rounded-xl flex items-center justify-center shadow-lg shadow-rose-500/30">
              <i className="fa-solid fa-flask-vial text-sm"></i>
            </div>
            Regression Testing Harness
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Compare AI outputs against ground-truth baselines to catch regressions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={createBaseline}
            disabled={busy || !files || files.length === 0}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-anchor"></i> Create Baseline
          </button>
          <button
            onClick={runRegression}
            disabled={busy || !files || files.length === 0}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20"
          >
            <i className="fa-solid fa-play"></i> Run Regression
          </button>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {busy && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-center">
              <span className="block font-black text-slate-900 text-sm">AI Engine Processing...</span>
              <span className="block text-xs text-slate-400 font-medium mt-1">{status}</span>
            </div>
          </div>
        )}

        {!busy && results.length > 0 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Analysis Results</h3>
            <div className="space-y-3">
              {results.map(r => (
                <div key={r.fileHash} className={`border rounded-[2rem] p-6 transition-all ${r.ok ? "bg-emerald-50/30 border-emerald-100" : "bg-rose-50/30 border-rose-100"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                       <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${r.ok ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                         <i className={`fa-solid ${r.ok ? 'fa-check' : 'fa-xmark'}`}></i>
                       </div>
                       <div>
                         <div className="text-sm font-black text-slate-900">{r.filename}</div>
                         <div className="text-[10px] text-slate-400 font-mono">{r.fileHash.slice(0, 12)}...</div>
                       </div>
                    </div>
                    <div className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${r.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
                      {r.ok ? "Pass" : "Fail"}
                    </div>
                  </div>

                  {r.errors.length > 0 && (
                    <div className="mb-4 p-4 bg-rose-100/50 rounded-2xl border border-rose-200">
                      <div className="text-[10px] font-black text-rose-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <i className="fa-solid fa-triangle-exclamation"></i> Errors
                      </div>
                      <ul className="space-y-1">
                        {r.errors.map((e, i) => (
                          <li key={i} className="text-[11px] font-bold text-rose-800">• {e}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {r.warnings.length > 0 && (
                    <div className="mb-4 p-4 bg-amber-100/50 rounded-2xl border border-amber-200">
                      <div className="text-[10px] font-black text-amber-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <i className="fa-solid fa-circle-info"></i> Warnings
                      </div>
                      <ul className="space-y-1">
                        {r.warnings.map((w, i) => (
                          <li key={i} className="text-[11px] font-bold text-amber-800">• {w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <details className="mt-4">
                    <summary className="text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-600 transition-all outline-none">
                      Technical Diffs
                    </summary>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div className="space-y-2">
                         <div className="text-[9px] font-black text-slate-400 uppercase">Baseline Golden</div>
                         <pre className="p-4 bg-slate-900 text-indigo-100 rounded-2xl text-[10px] overflow-auto max-h-48 font-mono">
                           {JSON.stringify(r.baseline, null, 2)}
                         </pre>
                       </div>
                       <div className="space-y-2">
                         <div className="text-[9px] font-black text-slate-400 uppercase">Current Output</div>
                         <pre className="p-4 bg-slate-900 text-indigo-100 rounded-2xl text-[10px] overflow-auto max-h-48 font-mono">
                           {JSON.stringify(r.current, null, 2)}
                         </pre>
                       </div>
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-8 border-t border-slate-100">
          <div className="flex items-center justify-between px-2 mb-4">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Baseline Registry (Goldens)</h3>
            <span className="text-[10px] font-bold text-slate-400">{baselinesList.length} Items Stored</span>
          </div>
          
          {baselinesList.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2.5rem]">
               <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-200">
                 <i className="fa-solid fa-box-open text-2xl"></i>
               </div>
               <p className="text-xs font-bold text-slate-400">No baselines configured. Select files and click "Create Baseline".</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {baselinesList.map(b => (
                <div key={b.file_hash} className="bg-white border border-slate-100 p-5 rounded-2xl shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center text-lg">
                      <i className="fa-solid fa-file-shield"></i>
                    </div>
                    <button
                      onClick={() => handleDelete(b.file_hash)}
                      className="w-8 h-8 flex items-center justify-center text-slate-200 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash-can text-sm"></i>
                    </button>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-900 truncate mb-1" title={b.filename}>{b.filename}</div>
                    <div className="text-[9px] font-bold text-slate-400 flex items-center gap-2">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded uppercase">{b.doc_count} Docs</span>
                      <span>{new Date(b.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
