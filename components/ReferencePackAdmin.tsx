import React, { useState, useRef, useEffect, useMemo } from "react";
import { ReferencePack } from "../referencePack.schema";
import { saveReferencePack, clearReferencePack, EMPTY_REFERENCE_PACK } from "../reference/referenceLocalStore";
import { finalizeReferencePack } from "../reference/referenceVersioning";
import { exportReferencePackToXlsx, importReferencePackFromXlsx } from "../services/referencePackXlsx";

declare const XLSX: any;

type Props = {
  referencePack: ReferencePack;
  onReferencePackChange: (pack: ReferencePack) => void;
};

export function ReferencePackAdmin({ referencePack, onReferencePackChange }: Props) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<'mfrs' | 'finishes' | 'cats'>('mfrs');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSave(kind: "patch" | "minor" | "major") {
    const finalized = finalizeReferencePack(referencePack, kind);
    saveReferencePack(finalized);
    onReferencePackChange(finalized);
    alert(`Catalogue v${finalized.version} saved permanently.`);
  }

  async function handleExport() {
    try {
      const blob = exportReferencePackToXlsx(referencePack);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OrderFlow_Catalogue_v${referencePack.version}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Export failed: " + err.message);
    }
  }

  async function handleImport() {
    if (!importFile) return alert("Please select an Excel file.");
    setIsImporting(true);
    try {
      const buffer = await importFile.arrayBuffer();
      const updated = importReferencePackFromXlsx(buffer, referencePack);
      onReferencePackChange(updated);
      alert("Successfully imported items into the Catalogue! Review them in the browser below.");
    } catch (err: any) {
      console.error(err);
      alert(`Import failed: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  }

  function handleReset() {
    if (confirm("Are you sure? This will wipe the entire Input Catalogue.")) {
      clearReferencePack();
      onReferencePackChange(EMPTY_REFERENCE_PACK);
    }
  }

  const StatCard = ({ label, count, icon, color }: { label: string, count: number, icon: string, color: string }) => (
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
      <div className={`w-12 h-12 ${color} rounded-2xl flex items-center justify-center text-xl`}>
        <i className={`fa-solid ${icon}`}></i>
      </div>
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{label}</p>
        <p className="text-2xl font-black text-slate-900 leading-none">{count}</p>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
      <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-3">
            <div className="bg-indigo-600 text-white w-8 h-8 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <i className="fa-solid fa-book-bookmark text-sm"></i>
            </div>
            Input Catalogue / Grounding Engine
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Catalogue Version: <span className="font-bold text-indigo-600">{referencePack.version}</span> • 
            Last Updated: <span className="font-bold text-slate-400">{referencePack.updated_at ? new Date(referencePack.updated_at).toLocaleString() : 'Never'}</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            <button onClick={() => handleSave("patch")} className="px-3 py-1.5 text-[10px] font-black hover:bg-slate-50 rounded-lg text-slate-600 uppercase tracking-tighter">Patch</button>
            <button onClick={() => handleSave("minor")} className="px-3 py-1.5 text-[10px] font-black hover:bg-slate-50 rounded-lg text-slate-600 uppercase tracking-tighter">Minor</button>
          </div>
          <button onClick={handleReset} className="px-4 py-2.5 text-rose-500 hover:bg-rose-50 rounded-xl text-xs font-bold transition-all">
            Clear
          </button>
        </div>
      </div>

      <div className="p-8 space-y-10">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Mfrs" count={referencePack.manufacturers?.length || 0} icon="fa-industry" color="bg-blue-50 text-blue-600" />
          <StatCard label="Finishes" count={referencePack.finishes?.length || 0} icon="fa-palette" color="bg-emerald-50 text-emerald-600" />
          <StatCard label="Categories" count={referencePack.categories?.length || 0} icon="fa-layer-group" color="bg-amber-50 text-amber-600" />
          <StatCard label="Devices" count={referencePack.electrified_devices?.length || 0} icon="fa-bolt" color="bg-rose-50 text-rose-600" />
          <StatCard label="Wiring" count={referencePack.wiring_configs?.length || 0} icon="fa-network-wired" color="bg-indigo-50 text-indigo-600" />
          <StatCard label="Templates" count={referencePack.hardware_sets?.length || 0} icon="fa-puzzle-piece" color="bg-slate-50 text-slate-600" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
           <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex flex-col justify-between">
             <div>
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Update Master Data</label>
               <h4 className="text-sm font-bold text-slate-700 mb-3">Bulk Import via Excel</h4>
             </div>
             <div className="flex gap-2">
               <input 
                 type="file" 
                 accept=".xlsx" 
                 ref={fileInputRef}
                 onChange={(e) => setImportFile(e.target.files?.[0] || null)} 
                 className="flex-grow text-xs bg-white border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-indigo-500/20"
               />
               <button 
                 onClick={handleImport} 
                 disabled={isImporting || !importFile}
                 className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg"
               >
                 {isImporting ? <i className="fa-solid fa-circle-notch animate-spin"></i> : 'Import'}
               </button>
             </div>
           </div>

           <div className="p-6 bg-indigo-50/30 rounded-3xl border border-indigo-100 flex flex-col justify-between">
             <div>
               <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1">Archive Management</label>
               <h4 className="text-sm font-bold text-slate-700 mb-3">Download Catalogue Template</h4>
             </div>
             <button 
               onClick={handleExport} 
               className="w-full px-5 py-3 bg-white border border-indigo-200 text-indigo-600 rounded-xl text-xs font-black hover:bg-indigo-600 hover:text-white transition-all shadow-md flex items-center justify-center gap-3 uppercase tracking-wider"
             >
               <i className="fa-solid fa-cloud-arrow-down text-base"></i>
               Download Current Catalogue
             </button>
           </div>
        </div>

        {/* DATA BROWSER SECTION */}
        <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-inner bg-slate-50/20">
          <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Data Browser</h3>
            <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
              <button 
                onClick={() => setActivePreviewTab('mfrs')} 
                className={`px-4 py-1.5 text-[10px] font-black rounded-lg transition-all ${activePreviewTab === 'mfrs' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Manufacturers
              </button>
              <button 
                onClick={() => setActivePreviewTab('finishes')} 
                className={`px-4 py-1.5 text-[10px] font-black rounded-lg transition-all ${activePreviewTab === 'finishes' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Finishes
              </button>
              <button 
                onClick={() => setActivePreviewTab('cats')} 
                className={`px-4 py-1.5 text-[10px] font-black rounded-lg transition-all ${activePreviewTab === 'cats' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Categories
              </button>
            </div>
          </div>
          <div className="max-h-[400px] overflow-y-auto p-2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/50">
                  {activePreviewTab === 'mfrs' ? (
                    <>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">Abbr</th>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">Manufacturer Name</th>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">Aliases</th>
                    </>
                  ) : activePreviewTab === 'finishes' ? (
                    <>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">US Code</th>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">BHMA</th>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">Name</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">Symbol</th>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">Category</th>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">Sub-Category</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activePreviewTab === 'mfrs' ? (
                  referencePack.manufacturers.length > 0 ? (
                    referencePack.manufacturers.map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-xs font-mono font-bold text-blue-600">{m.abbr}</td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-700">{m.name}</td>
                        <td className="px-4 py-3 text-[10px] text-slate-400">{m.aliases.join(', ')}</td>
                      </tr>
                    ))
                  ) : <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400 text-xs italic">No data imported yet.</td></tr>
                ) : activePreviewTab === 'finishes' ? (
                  referencePack.finishes.length > 0 ? (
                    referencePack.finishes.map((f, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-xs font-bold text-emerald-600">{f.us_code}</td>
                        <td className="px-4 py-3 text-xs font-mono text-slate-400">{f.bhma_code || '---'}</td>
                        <td className="px-4 py-3 text-xs font-medium text-slate-700">{f.name}</td>
                      </tr>
                    ))
                  ) : <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400 text-xs italic">No data imported yet.</td></tr>
                ) : (
                  referencePack.categories.length > 0 ? (
                    referencePack.categories.map((c, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-xs font-mono font-bold text-amber-600">{c.gordon_symbol}</td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-700">{c.category}</td>
                        <td className="px-4 py-3 text-xs text-slate-400">{c.subcategory || '---'}</td>
                      </tr>
                    ))
                  ) : <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400 text-xs italic">No data imported yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}