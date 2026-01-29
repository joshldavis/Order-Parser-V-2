// setup/calibrationMetrics.ts

export type TruthTableRow = {
  order_id?: string;           // optional join key
  line_id?: string;            // optional
  predicted_confidence: number; // 0..1 (or 0..100 accepted; auto-normalized)
  correct: number;              // 0/1

  // Optional field-level correctness (0/1). If omitted, field metrics won’t compute.
  item_number_correct?: number;
  quantity_correct?: number;
  unit_price_correct?: number;
  ship_to_correct?: number;

  // Optional signals for exclusions.
  is_credit_memo?: number;
  has_special_layout?: number;
  has_custom_length?: number;
  is_zero_dollar?: number;
  third_party_ship?: number;
};

export type CalibrationComputed = {
  n_rows: number;
  confidence_scale_detected: "0_1" | "0_100";
  join_match_rate?: number; // If provided externally; otherwise undefined in v2-min

  accuracy: {
    line_required_fields_all_correct: number; // uses "correct"
    field_level?: {
      item_number?: number;
      quantity?: number;
      unit_price?: number;
      ship_to?: number;
    };
  };

  calibration: {
    brier_score: number;
    ece: number;
    reliability_bins: Array<{
      bin_min: number;
      bin_max: number;
      avg_pred: number;
      empirical_acc: number;
      count: number;
    }>;
  };

  coverage_by_threshold: Array<{
    threshold: number;        // 0..1
    auto_rate: number;        // fraction >= threshold
    expected_error_rate: number; // among auto, 1 - empirical accuracy
  }>;

  signals_distribution?: {
    CREDIT_MEMO?: number;
    SPECIAL_LAYOUT?: number;
    CUSTOM_LENGTH?: number;
    ZERO_DOLLAR?: number;
    THIRD_PARTY_SHIP?: number;
  };
};

function safeNum(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Very small CSV parser: handles comma-separated with optional quotes.
// (Good enough for truth tables exported from Excel/Sheets.)
export function parseCsvToRows(csvText: string): Array<Record<string, string>> {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  };

  const header = parseLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => (row[h] = cells[idx] ?? ""));
    rows.push(row);
  }
  return rows;
}

export function coerceTruthTable(rows: Array<Record<string, string>>): TruthTableRow[] {
  const normKey = (k: string) => k.trim().toLowerCase();

  // map common header variants
  const get = (r: Record<string, string>, keys: string[]) => {
    const map = new Map(Object.keys(r).map(k => [normKey(k), k]));
    for (const k of keys) {
      const kk = map.get(normKey(k));
      if (kk) return r[kk];
    }
    return "";
  };

  return rows
    .map(r => {
      const predicted = safeNum(get(r, ["predicted_confidence", "confidence", "p_correct", "prob", "score"])) ?? NaN;
      const correct = safeNum(get(r, ["correct", "is_correct", "line_correct", "truth"])) ?? NaN;

      if (!Number.isFinite(predicted) || !Number.isFinite(correct)) return null;

      const row: TruthTableRow = {
        order_id: get(r, ["order_id", "order_number", "po_number", "document_id"]) || undefined,
        line_id: get(r, ["line_id", "row_id", "line_number"]) || undefined,
        predicted_confidence: predicted,
        correct: correct,

        item_number_correct: safeNum(get(r, ["item_number_correct", "item_correct"])) ,
        quantity_correct: safeNum(get(r, ["quantity_correct", "qty_correct"])) ,
        unit_price_correct: safeNum(get(r, ["unit_price_correct", "price_correct"])) ,
        ship_to_correct: safeNum(get(r, ["ship_to_correct", "shipto_correct"])) ,

        is_credit_memo: safeNum(get(r, ["is_credit_memo", "credit_memo"])) ,
        has_special_layout: safeNum(get(r, ["has_special_layout", "special_layout"])) ,
        has_custom_length: safeNum(get(r, ["has_custom_length", "custom_length"])) ,
        is_zero_dollar: safeNum(get(r, ["is_zero_dollar", "zero_dollar"])) ,
        third_party_ship: safeNum(get(r, ["third_party_ship", "third_party"])) ,
      };

      return row;
    })
    .filter((x): x is TruthTableRow => !!x);
}

export function computeCalibration(rows: TruthTableRow[], bins = 10): CalibrationComputed {
  if (rows.length === 0) {
    throw new Error("No usable rows found. Required columns: predicted_confidence and correct.");
  }

  // detect confidence scale
  const maxC = Math.max(...rows.map(r => r.predicted_confidence));
  const scale: "0_1" | "0_100" = maxC > 1.5 ? "0_100" : "0_1";

  const norm = (c: number) => {
    const v = scale === "0_100" ? c / 100 : c;
    return Math.min(1, Math.max(0, v));
  };

  const p = rows.map(r => norm(r.predicted_confidence));
  const y = rows.map(r => (r.correct >= 0.5 ? 1 : 0));

  const n = rows.length;

  // Brier score
  let brier = 0;
  for (let i = 0; i < n; i++) {
    const d = p[i] - y[i];
    brier += d * d;
  }
  brier /= n;

  // Reliability bins + ECE
  const binsArr: CalibrationComputed["calibration"]["reliability_bins"] = [];
  let ece = 0;

  for (let b = 0; b < bins; b++) {
    const binMin = b / bins;
    const binMax = (b + 1) / bins;
    const idx = p
      .map((val, i) => ({ val, i }))
      .filter(o => (b === bins - 1 ? o.val >= binMin && o.val <= binMax : o.val >= binMin && o.val < binMax))
      .map(o => o.i);

    const count = idx.length;
    if (count === 0) {
      binsArr.push({ bin_min: binMin, bin_max: binMax, avg_pred: 0, empirical_acc: 0, count: 0 });
      continue;
    }

    const avgPred = idx.reduce((s, i) => s + p[i], 0) / count;
    const empAcc = idx.reduce((s, i) => s + y[i], 0) / count;

    binsArr.push({ bin_min: binMin, bin_max: binMax, avg_pred: avgPred, empirical_acc: empAcc, count });
    ece += (count / n) * Math.abs(avgPred - empAcc);
  }

  // Coverage by threshold
  const thresholds = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.95, 0.98];
  const coverage_by_threshold = thresholds.map(t => {
    const idx = p.map((val, i) => ({ val, i })).filter(o => o.val >= t).map(o => o.i);
    const count = idx.length;
    if (count === 0) return { threshold: t, auto_rate: 0, expected_error_rate: 0 };
    const empAcc = idx.reduce((s, i) => s + y[i], 0) / count;
    return { threshold: t, auto_rate: count / n, expected_error_rate: 1 - empAcc };
  });

  // Optional field-level accuracies
  const fieldAcc = (key: keyof TruthTableRow) => {
    const vals = rows.map(r => r[key]).filter(v => v === 0 || v === 1) as number[];
    if (vals.length === 0) return undefined;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return mean;
  };

  // Optional signals distribution (fraction of rows with signal=1)
  const sig = (key: keyof TruthTableRow) => {
    const vals = rows.map(r => r[key]).filter(v => v === 0 || v === 1) as number[];
    if (vals.length === 0) return undefined;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return mean;
  };

  return {
    n_rows: n,
    confidence_scale_detected: scale,
    accuracy: {
      line_required_fields_all_correct: y.reduce((s, v) => s + v, 0) / n,
      field_level: {
        item_number: fieldAcc("item_number_correct"),
        quantity: fieldAcc("quantity_correct"),
        unit_price: fieldAcc("unit_price_correct"),
        ship_to: fieldAcc("ship_to_correct"),
      },
    },
    calibration: {
      brier_score: brier,
      ece,
      reliability_bins: binsArr,
    },
    coverage_by_threshold,
    signals_distribution: {
      CREDIT_MEMO: sig("is_credit_memo"),
      SPECIAL_LAYOUT: sig("has_special_layout"),
      CUSTOM_LENGTH: sig("has_custom_length"),
      ZERO_DOLLAR: sig("is_zero_dollar"),
      THIRD_PARTY_SHIP: sig("third_party_ship"),
    },
  };
}

/**
 * Suggest conservative gates using computed coverage.
 * Target: keep expected_error_rate <= maxError in auto bucket.
 */
export function suggestGates(
  coverage: CalibrationComputed["coverage_by_threshold"],
  maxError = 0.02
): { auto_process_min: number; review_min: number; block_below: number } {
  // pick the *lowest* threshold that still meets maxError, so you maximize coverage safely
  const candidates = coverage.filter(c => c.auto_rate > 0 && c.expected_error_rate <= maxError);
  const auto = candidates.length ? Math.min(...candidates.map(c => c.threshold)) : 0.95;

  // review band and block are conservative defaults; keep them stable unless user edits
  const review = Math.min(auto - 0.15, 0.85);
  const block = 0.50;

  return {
    auto_process_min: Number(auto.toFixed(2)),
    review_min: Number(Math.max(0, review).toFixed(2)),
    block_below: Number(block.toFixed(2)),
  };
}
