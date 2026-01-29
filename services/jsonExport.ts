import { POLineRow, AutomationLane } from '../types.ts';
import {
  POExportV1,
  AuditEvent,
  LineItem,
  RoutingReasonCode,
  RoutingDecision,
  RunMode,
} from './abhSchema.ts';

type BuildJsonExportParams = {
  rows: POLineRow[];
  appVersion: string;
  runMode: RunMode;
  environment?: 'DEV' | 'TEST' | 'PROD';
  vendorName?: string;
  thresholds?: { auto_stage_min: number; review_min: number };
  auditEvents?: AuditEvent[];
};

function nowIso() {
  return new Date().toISOString();
}

function safeMinConfidence(rows: POLineRow[], fallback = 0): number {
  const vals = rows
    .map(r => (typeof r.confidence_score === 'number' ? r.confidence_score : null))
    .filter((v): v is number => v !== null);
  if (vals.length === 0) return fallback;
  return Math.max(0, Math.min(1, Math.min(...vals)));
}

function laneToDecision(lane: AutomationLane): RoutingDecision {
  if (lane === 'AUTO') return 'AUTO_STAGE';
  if (lane === 'REVIEW' || lane === 'ASSIST') return 'REVIEW';
  return 'HUMAN_REQUIRED'; // BLOCK
}

function reasonCodesFromRows(docRows: POLineRow[], thresholds: { auto_stage_min: number; review_min: number }): RoutingReasonCode[] {
  const codes = new Set<RoutingReasonCode>();

  const anyBelowAuto = docRows.some(r => (r.confidence_score ?? 1) < thresholds.auto_stage_min);
  const anyBelowReview = docRows.some(r => (r.confidence_score ?? 1) < thresholds.review_min);

  if (!anyBelowAuto && !anyBelowReview) codes.add('ALL_LINES_HIGH_CONFIDENCE');
  if (anyBelowAuto) codes.add('LOW_CONFIDENCE_FIELDS_PRESENT');

  for (const r of docRows) {
    const flags = (r.edge_case_flags || []).map(f => String(f).toUpperCase());

    if (r.doc_type === 'CREDIT_MEMO' || flags.some(f => f.includes('CREDIT'))) codes.add('CREDIT_MEMO_DETECTED');
    if (flags.some(f => f.includes('SPECIAL'))) codes.add('SPECIAL_LAYOUT_DETECTED');
    if (flags.some(f => f.includes('CUSTOM') || f.includes('CUT'))) codes.add('CUSTOM_DIMENSION_DETECTED');
    if (flags.some(f => f.includes('ZERO') || f.includes('0.00'))) codes.add('ZERO_DOLLAR_LINE_DETECTED');
    if (flags.some(f => f.includes('THIRD') || f.includes('SHIP') || f.includes('MARK'))) codes.add('THIRD_PARTY_SHIP_DETECTED');

    if (r.automation_lane === 'BLOCK' || (r.routing_reason || '').toLowerCase().includes('policy')) {
      codes.add('POLICY_BLOCK');
    }
  }

  if (codes.size === 0) codes.add('PARSING_ERROR');
  return Array.from(codes);
}

function buildLineItem(r: POLineRow): LineItem {
  return {
    line_id: `${r.doc_id}-L${r.line_no}`,
    raw: {
      raw_text: r.customer_item_desc_raw || '',
      line_no: r.line_no,
    },
    parsed: {
      customer_item_no: r.customer_item_no,
      abh_item_no: r.abh_item_no_final || r.abh_item_no_candidate,
      manufacturer: r.manufacturer,
      description: r.customer_item_desc_raw,
      quantity: typeof r.qty === 'number' ? r.qty : (r.qty ? Number(r.qty) : 0),
      uom: r.uom || 'EA',
      unit_price: r.unit_price,
      extended_price: r.extended_price,
      currency: r.currency,
      attributes: {
        finish: r.finish,
        category: r.category,
        item_class: r.item_class,
      },
      modifiers: (r.raw_edge_case_notes || (r.edge_case_flags?.length || 0) > 0)
        ? [
            {
              type: 'OTHER',
              value: r.raw_edge_case_notes || (r.edge_case_flags || []).join(', '),
            },
          ]
        : [],
    },
    confidence: {
      line_confidence: Math.max(0, Math.min(1, r.confidence_score ?? 0)),
      field_confidence: {},
      signals: [],
    },
    flags: (r.edge_case_flags || [])
      .map(f => String(f).toUpperCase())
      .filter(f => ['SPECIAL_LAYOUT', 'CUSTOM_DIMENSION', 'ZERO_DOLLAR', 'THIRD_PARTY_SHIP'].includes(f)) as any,
  };
}

export function buildPOExportsV1(params: BuildJsonExportParams): POExportV1[] {
  const thresholds = params.thresholds ?? { auto_stage_min: 0.9, review_min: 0.7 };
  const vendorName = params.vendorName ?? 'ABH Manufacturing';

  const groups = new Map<string, POLineRow[]>();
  for (const r of params.rows) {
    if (!groups.has(r.doc_id)) groups.set(r.doc_id, []);
    groups.get(r.doc_id)!.push(r);
  }

  const exports: POExportV1[] = [];

  for (const [docId, docRows] of groups.entries()) {
    const first = docRows[0];

    const anyBlock = docRows.some(r => r.automation_lane === 'BLOCK');
    const anyReview = docRows.some(r => r.automation_lane === 'REVIEW' || r.automation_lane === 'ASSIST');
    const allAuto = docRows.every(r => r.automation_lane === 'AUTO');

    let decision: RoutingDecision = anyBlock ? 'HUMAN_REQUIRED' : (allAuto && !anyReview ? 'AUTO_STAGE' : 'REVIEW');

    const anyBelowAuto = docRows.some(r => (r.confidence_score ?? 1) < thresholds.auto_stage_min);
    const anyBelowReview = docRows.some(r => (r.confidence_score ?? 1) < thresholds.review_min);
    if (decision === 'AUTO_STAGE' && anyBelowAuto) decision = 'REVIEW';
    if (anyBelowReview) decision = 'HUMAN_REQUIRED';

    const reason_codes = reasonCodesFromRows(docRows, thresholds);
    const overall = safeMinConfidence(docRows, 0);

    const scopedOverrides =
      (params.auditEvents || []).filter(e => (e.details as any)?.doc_id ? (e.details as any).doc_id === docId : true);

    const auditEvents: AuditEvent[] = [
      ...scopedOverrides,
      {
        at: nowIso(),
        event_type: 'EXPORTED',
        actor: 'SYSTEM',
        details: { doc_id: docId, decision },
      },
    ];

    exports.push({
      schema_version: 'abh.po.v1',
      export_id: `${docId}-${Date.now()}`,
      exported_at: nowIso(),
      source: {
        system: 'orderflow-parser',
        app_version: params.appVersion,
        run_mode: params.runMode,
        environment: params.environment,
      },
      document: {
        document_id: docId,
        document_type: first.doc_type as any,
        file: { filename: `${docId}.pdf` },
      },
      parties: {
        customer: { name: first.customer_name || 'UNKNOWN' },
        vendor: { name: vendorName },
      },
      order: {
        order_type: first.doc_type === 'CREDIT_MEMO' ? 'CREDIT_MEMO' : 'PURCHASE_ORDER',
        customer_order_no: first.customer_order_no,
        order_date: first.document_date,
        currency: first.currency,
        addresses: {
          ship_to_name: first.ship_to_name,
          mark_for: first.mark_instructions,
        },
      },
      line_items: docRows.sort((a, b) => a.line_no - b.line_no).map(buildLineItem),
      confidence: {
        overall_confidence: overall,
        auto_process_eligible: decision === 'AUTO_STAGE' && params.runMode === 'PRODUCTION',
        thresholds,
      },
      routing: {
        decision,
        reason_codes,
        routing_notes: first.routing_reason,
      },
      audit: { events: auditEvents },
    });
  }

  return exports;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}