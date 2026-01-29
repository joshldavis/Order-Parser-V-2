import React from 'react';
import { POLineRow } from '../types.ts';

interface DataTableProps {
  data: POLineRow[];
  onDelete: (index: number) => void;
  onUpdate: (index: number, patch: Partial<POLineRow>) => void;
  onHumanOverride?: (evt: {
    doc_id: string;
    line_no: number;
    field: string;
    before: any;
    after: any;
  }) => void;
}

const DataTable: React.FC<DataTableProps> = ({ data, onDelete, onUpdate, onHumanOverride }) => {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 bg-white border-2 border-dashed border-slate-200 rounded-[2rem]">
        <div className="bg-slate-50 p-6 rounded-3xl mb-4">
          <i className="fa-solid fa-file-invoice text-5xl text-slate-300"></i>
        </div>
        <h3 className="text-lg font-bold text-slate-900">Queue is empty</h3>
        <p className="text-slate-500 text-sm mt-2">Upload documents to extract spreadsheet data.</p>
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

  const handleCellBlur = (idx: number, field: keyof POLineRow, value: string) => {
    let parsedValue: any = value;
    if (field === 'qty' || field === 'unit_price' || field === 'extended_price') {
      parsedValue = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
    }
    const before = (data[idx] as any)[field];
    onUpdate(idx, { [field]: parsedValue });

    // log a correction as “learning signal”
    if (onHumanOverride && before !== parsedValue) {
      onHumanOverride({
        doc_id: data[idx].doc_id,
        line_no: data[idx].line_no,
        field: String(field),
        before,
        after: parsedValue,
      });
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/40 border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-left table-fixed border-collapse">
          <thead className="bg-slate-50 sticky top-0 z-20">
            <tr className="divide-x divide-slate-200">
              <th className="w-24 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Route</th>
              <th className="w-32 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Doc Ref</th>
              <th className="w-64 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Description</th>
              <th className="w-48 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Part Final</th>
              <th className="w-32 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Manufacturer</th>
              <th className="w-24 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Finish</th>
              <th className="w-20 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Qty</th>
              <th className="w-24 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Extended</th>
              <th className="w-16 px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Action</th>
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-slate-100">
            {data.map((row, idx) => (
              <tr key={idx} className="hover:bg-slate-50/50 transition-colors group divide-x divide-slate-100">
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <span className={`block px-2 py-0.5 rounded-lg border text-[9px] font-black text-center ${getLaneBadge(row.automation_lane)}`}>
                      {row.automation_lane}
                    </span>

                    {row.routing_reason && (
                      <div className="text-[9px] font-bold text-slate-500 leading-tight line-clamp-2">
                        {row.routing_reason}
                      </div>
                    )}

                    {row.edge_case_flags && row.edge_case_flags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {row.edge_case_flags.slice(0, 2).map((f, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[8px] font-black">
                            {String(f).toUpperCase()}
                          </span>
                        ))}
                        {row.edge_case_flags.length > 2 && (
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[8px] font-black">
                            +{row.edge_case_flags.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </td>

                <td className="px-4 py-3 text-xs font-bold text-slate-900 truncate">{row.doc_id}</td>

                <td className="px-4 py-3">
                  <div className="text-[11px] text-slate-700 font-medium line-clamp-2 leading-snug">{row.customer_item_desc_raw}</div>
                </td>

                <td className="px-4 py-3">
                  <input
                    defaultValue={row.abh_item_no_final || row.abh_item_no_candidate || ''}
                    onBlur={(e) => handleCellBlur(idx, 'abh_item_no_final', e.target.value)}
                    className="w-full text-[11px] font-mono font-black text-blue-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                    placeholder="ABH item #"
                  />
                  <div className="mt-1 text-[9px] font-bold text-slate-400">
                    cand: {row.abh_item_no_candidate || '---'}
                  </div>
                </td>

                <td className="px-4 py-3 text-xs text-slate-600">{row.manufacturer || '---'}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{row.finish || '---'}</td>

                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <input
                      defaultValue={String(row.qty ?? 0)}
                      onBlur={(e) => handleCellBlur(idx, 'qty', e.target.value)}
                      className="w-16 text-right text-xs font-black text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                    />
                    <span className="text-[10px] font-black text-slate-500">{row.uom || 'EA'}</span>
                  </div>
                </td>

                <td className="px-4 py-3 text-right">
                  <div className="text-xs font-black text-slate-900">${(row.extended_price ?? 0).toFixed(2)}</div>
                </td>

                <td className="px-4 py-3 text-center">
                  <button onClick={() => onDelete(idx)} className="p-1.5 text-slate-300 hover:text-rose-500 rounded-lg transition-all">
                    <i className="fa-solid fa-trash-can text-xs"></i>
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