import React, { useMemo, useState } from 'react';
import { POExportV1 } from '../services/abhSchema.ts';
import { downloadJson } from '../services/jsonExport.ts';

type Props = {
  exports: POExportV1[];
  onClose: () => void;
};

function decisionBadge(decision: string) {
  switch (decision) {
    case 'AUTO_STAGE':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100 ring-1 ring-emerald-400/20';
    case 'REVIEW':
      return 'bg-blue-50 text-blue-700 border-blue-100 ring-1 ring-blue-400/20';
    case 'HUMAN_REQUIRED':
      return 'bg-amber-50 text-amber-700 border-amber-100 ring-1 ring-amber-400/20';
    case 'REJECTED':
      return 'bg-rose-50 text-rose-700 border-rose-100 ring-1 ring-rose-400/20';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-100';
  }
}

const JsonExportPanel: React.FC<Props> = ({ exports, onClose }) => {
  const [selected, setSelected] = useState(0);
  const current = exports[selected];

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ex of exports) {
      const k = ex.routing?.decision || 'UNKNOWN';
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [exports]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-6">
      <div className="w-full max-w-5xl bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">ABH PO Export</div>
            <div className="text-lg font-black text-slate-900 tracking-tight">JSON v1 Export Preview</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadJson(`abh_po_exports_${new Date().toISOString().slice(0, 10)}.json`, exports)}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 transition-all active:scale-95"
            >
              <i className="fa-solid fa-download mr-2"></i>
              Download All
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200 transition-all active:scale-95"
            >
              Close
            </button>
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span className="text-slate-900">Docs:</span> {exports.length}
            <span className="mx-2 text-slate-200">|</span>
            {Object.entries(summary).map(([k, v]) => (
              <span key={k} className={`px-2 py-0.5 rounded-lg border ${decisionBadge(k)} text-[9px]`}>
                {k}: {v}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none"
            >
              {exports.map((ex, idx) => (
                <option key={ex.document.document_id + idx} value={idx}>
                  {ex.document.document_id} • {ex.routing.decision}
                </option>
              ))}
            </select>
            <button
              onClick={() => downloadJson(`abh_po_export_${current.document.document_id}.json`, current)}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition-all active:scale-95"
            >
              <i className="fa-solid fa-code mr-2"></i>
              Download Selected
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 overflow-hidden min-h-0">
          {/* Left Sidebar - Scrollable */}
          <div className="lg:col-span-1 border-r border-slate-100 flex flex-col overflow-y-auto">
            <div className="p-6 space-y-8">
              <div className="flex items-center justify-between">
                <div className="text-sm font-black text-slate-900">Routing Decision</div>
                <span className={`px-2 py-0.5 rounded-lg border text-[9px] font-black ${decisionBadge(current.routing.decision)}`}>
                  {current.routing.decision}
                </span>
              </div>

              <div className="text-xs text-slate-600">
                <div className="font-bold text-slate-900 uppercase tracking-widest text-[10px]">Reason codes</div>
                <ul className="mt-3 space-y-2">
                  {current.routing.reason_codes.map((c) => (
                    <li
                      key={c}
                      className="text-[11px] font-mono text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Confidence Metrics</div>
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Overall Certainty</span>
                    <span className="font-black text-slate-900">{Math.round((current.confidence.overall_confidence || 0) * 100)}%</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Auto Threshold</span>
                    <span className="font-bold text-emerald-600">≥ {Math.round(current.confidence.thresholds.auto_stage_min * 100)}%</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Review Threshold</span>
                    <span className="font-bold text-blue-600">≥ {Math.round(current.confidence.thresholds.review_min * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Yellow Alert Box - Audit Ready */}
              <div className="p-5 bg-amber-50 rounded-[1.5rem] border border-amber-200/50 shadow-sm mb-4">
                <div className="flex items-center gap-2 text-[10px] font-black text-amber-900 uppercase tracking-widest mb-2">
                  <i className="fa-solid fa-fingerprint"></i>
                  Audit Ready
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed opacity-80">
                  <strong>{current.audit?.events?.length || 0} events</strong> have been recorded for this document including extraction results and policy routing decisions.
                </p>
              </div>
              
              {/* Extra spacing at bottom of sidebar to ensure yellow box is never cut off */}
              <div className="h-8"></div>
            </div>
          </div>

          {/* Right Main Area - Code Preview */}
          <div className="lg:col-span-2 p-6 bg-slate-900 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="text-xs font-black text-indigo-300 uppercase tracking-widest flex items-center gap-2">
                <i className="fa-solid fa-code"></i>
                V1 Document Payload
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">schema: {current.schema_version}</div>
            </div>
            <div className="flex-grow overflow-hidden relative rounded-2xl">
              <pre className="absolute inset-0 bg-slate-950/50 text-indigo-100 p-6 overflow-auto text-[11px] leading-relaxed font-mono custom-scrollbar">
                {JSON.stringify(current, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JsonExportPanel;