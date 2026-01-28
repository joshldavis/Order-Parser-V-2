import React from 'react';
import { POLineRow } from '../types';
import { HeaderInfo } from './SharedUI';

interface DataTableProps {
  data: POLineRow[];
  onDelete: (index: number) => void;
}

const DataTable: React.FC<DataTableProps> = ({ data, onDelete }) => {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 bg-white border-2 border-dashed border-slate-200 rounded-[2rem]">
        <div className="bg-slate-50 p-6 rounded-3xl mb-4">
          <i className="fa-solid fa-file-invoice text-5xl text-slate-300"></i>
        </div>
        <h3 className="text-lg font-bold text-slate-900">Queue is empty</h3>
        <p className="text-slate-500 text-sm mt-2">Upload documents to extract order details.</p>
      </div>
    );
  }

  const getLaneBadge = (lane: string) => {
    switch (lane) {
      case 'AUTO': return 'bg-emerald-50 text-emerald-700 border-emerald-100 ring-1 ring-emerald-400/20';
      case 'ASSIST': return 'bg-amber-50 text-amber-700 border-amber-100 ring-1 ring-amber-400/20';
      case 'REVIEW': return 'bg-blue-50 text-blue-700 border-blue-100 ring-1 ring-blue-400/20';
      case 'BLOCK': return 'bg-rose-50 text-rose-700 border-rose-100 ring-1 ring-rose-400/20';
      default: return 'bg-slate-50 text-slate-600 border-slate-100';
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/40 border border-slate-200 overflow-visible">
      <div className="overflow-x-auto rounded-3xl pb-20 -mb-20">
        <table className="min-w-full divide-y divide-slate-100 text-left">
          <thead className="bg-slate-50/80 sticky top-0 z-20 backdrop-blur-sm">
            <tr>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                Status 
                <HeaderInfo 
                  title="Pipeline Lane & Sync" 
                  description="Determines how the order is routed through the automation engine." 
                  align="left"
                  details={[
                    "AUTO: 90%+ confidence with zero policy violations.",
                    "REVIEW: Needs human verification due to low score or edge cases.",
                    "BLOCK: Critical errors requiring manual re-entry.",
                    "SYNC: Green dot indicates Sage-ready data validation."
                  ]}
                />
              </th>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                Reference
                <HeaderInfo 
                  title="Doc Identifiers" 
                  description="Unique keys extracted from document headers." 
                  details={[
                    "Ref: Primary Order or PO number from the source.",
                    "Type: AI-classified document intent (e.g. Sales vs Purchase Order)."
                  ]}
                />
              </th>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                Order Details
                <HeaderInfo 
                  title="Source Extraction" 
                  description="The raw descriptive data as read from the document." 
                  details={[
                    "Entity: The identified customer or vendor name.",
                    "Description: Cleaned multi-line text from the original line item."
                  ]}
                />
              </th>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                Candidate Info
                <HeaderInfo 
                  title="AI Normalization" 
                  description="Transformation of raw text into internal catalog standards." 
                  details={[
                    "Candidate: Grounded Part Number mapped via Reference Pack logic.",
                    "Flags: Detects edge cases like CUSTOM lengths or ZERO-DOLLAR items.",
                    "Class: Differentiates CATALOG items from CUSTOM configurations."
                  ]}
                />
              </th>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">
                Qty/Price
                <HeaderInfo 
                  title="Quantitative Data" 
                  description="Normalized units and pricing extracted from document columns." 
                  details={[
                    "Qty: Unit quantity with normalized UOM (Each, Foot, etc).",
                    "Price: Unit cost per UOM in document currency."
                  ]}
                />
              </th>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">
                Extended
                <HeaderInfo 
                  title="Line Extensions" 
                  description="The total calculated value of the line item." 
                  details={[
                    "Formula: Qty multiplied by Unit Price.",
                    "Validation: AI verifies if document math matches internal calculations."
                  ]}
                />
              </th>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center whitespace-nowrap">
                Score
                <HeaderInfo 
                  title="AI Confidence Index" 
                  description="Overall certainty of the data extraction and grounding result." 
                  align="right"
                  details={[
                    ">90%: High reliability, candidate for AUTO routing.",
                    "<70%: Potential OCR noise or catalog mismatch.",
                    "Based on: Visual positioning and reference database cross-checks."
                  ]}
                />
              </th>
              <th className="px-4 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-50">
            {data.map((row, idx) => (
              <tr key={idx} className="hover:bg-slate-50/80 transition-all group">
                <td className="px-4 py-5 whitespace-nowrap">
                  <div className="flex flex-col gap-1.5">
                    <span className={`block px-2 py-0.5 rounded-lg border text-[10px] font-black text-center transition-transform hover:scale-105 ${getLaneBadge(row.automation_lane)}`}>
                      {row.automation_lane}
                    </span>
                    <div className="flex items-center justify-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${row.sage_import_ready ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`}></div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">SYNC</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-5 whitespace-nowrap">
                  <div className="text-sm font-bold text-slate-900 leading-tight truncate max-w-[120px]">{row.doc_id}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{row.doc_type}</div>
                </td>
                <td className="px-4 py-5">
                  <div className="text-xs font-bold text-slate-900 leading-none mb-1">{row.customer_name}</div>
                  <div className="text-[11px] text-slate-500 line-clamp-1 max-w-[200px]" title={row.customer_item_desc_raw}>
                    {row.customer_item_desc_raw}
                  </div>
                </td>
                <td className="px-4 py-5">
                  <div className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50/50 px-1.5 py-0.5 rounded w-fit mb-1 border border-blue-100/50">
                    {row.abh_item_no_candidate || row.customer_item_no}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {row.edge_case_flags.map((f, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-100 rounded text-[9px] font-black">
                        {f}
                      </span>
                    ))}
                    <span className="px-1.5 py-0.5 bg-slate-50 text-slate-700 border border-slate-200 rounded text-[9px] font-bold">
                      {row.item_class}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-5 whitespace-nowrap text-right">
                  <div className="text-sm font-bold text-slate-900">{row.qty ?? 0} {row.uom}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">@ ${ (row.unit_price ?? 0).toFixed(2) }</div>
                </td>
                <td className="px-4 py-5 whitespace-nowrap text-right">
                  <div className="text-sm font-black text-slate-900">${ (row.extended_price ?? 0).toFixed(2) }</div>
                </td>
                <td className="px-4 py-5 whitespace-nowrap">
                  <div className="flex flex-col items-center">
                    <div className="w-12 bg-slate-100 rounded-full h-1.5 relative overflow-hidden ring-1 ring-slate-200 mb-1">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${ (row.confidence_score ?? 0) > 0.8 ? 'bg-emerald-500' : 'bg-amber-400'}`} 
                        style={{ width: `${(row.confidence_score ?? 0) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-[10px] font-black text-slate-600">{Math.round((row.confidence_score ?? 0) * 100)}%</span>
                  </div>
                </td>
                <td className="px-4 py-5 whitespace-nowrap text-center">
                  <button 
                    onClick={() => onDelete(idx)} 
                    className="p-2.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all" 
                    title="Remove item"
                  >
                    <i className="fa-solid fa-trash-can text-sm"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DataTable;