// services/referencePackXlsx.ts
import * as XLSX from "xlsx";
import { ReferencePack } from "../referencePack.schema";

const SHEETS = {
  MANUFACTURERS: "Manufacturers",
  FINISHES: "Finishes",
  CATEGORIES: "Categories",
  ELECTRIFIED: "ElectrifiedDevices",
  WIRING: "WiringConfigs",
  SETS: "HardwareSets"
};

/**
 * Common aliases for sheet names to make import more user-friendly.
 */
const SHEET_ALIASES: Record<string, string[]> = {
  [SHEETS.MANUFACTURERS]: ["manufacturer", "mfr", "mfrs", "manufacturers", "mfg", "mfgs", "brands", "mfr list", "mfrs list"],
  [SHEETS.FINISHES]: ["finish", "finishes", "pallete", "color", "colors", "finish list"],
  [SHEETS.CATEGORIES]: ["category", "categories", "cat", "cats", "mapping", "hardware types"],
  [SHEETS.ELECTRIFIED]: ["electrified", "electrifieddevice", "electrifieddevices", "devices", "device", "power", "elec"],
  [SHEETS.WIRING]: ["wiring", "wiringconfig", "wiringconfigs", "wiring_configs", "cables", "wiring logic"],
  [SHEETS.SETS]: ["set", "sets", "hardwaresets", "templates", "template", "hardware_sets", "hw sets"]
};

/**
 * Intelligent header matching synonyms.
 */
const COLUMN_ALIASES = {
  abbr: ["abbr", "abbreviation", "code", "mfr_code", "prefix", "mfr code", "mfrabbr"],
  name: ["name", "description", "manufacturer", "mfr", "full_name", "manufacturer name", "mfr name"],
  aliases: ["aliases", "alias", "synonyms", "search_terms", "keywords", "other names"],
  us_code: ["us_code", "us", "finish_code", "finish", "code", "us code", "finish code"],
  bhma_code: ["bhma_code", "bhma", "ansi_code", "ansi", "bhma code", "ansi code"],
  gordon_symbol: ["gordon_symbol", "symbol", "key", "id", "mapping_id", "gordon code", "symbol code"],
  category: ["category", "cat", "group", "hardware category"],
  subcategory: ["subcategory", "subcat", "subgroup", "hardware subcategory"],
  device_type: ["device_type", "type", "hardware_type", "device", "device type"],
  voltage: ["voltage", "volts", "v", "power_req", "power"],
  fail_modes: ["fail_modes", "fail_mode", "failsafe", "operation", "fail safe"],
  keywords: ["keywords", "keyword", "search", "tags", "terms"],
  device_types: ["device_types", "devices", "compatible_devices", "device types"],
  wire_count: ["wire_count", "wires", "conductors", "wire count"],
  template_id: ["template_id", "id", "template", "set_id", "set code", "template id"],
  defaults_json: ["defaults_json", "defaults", "config_json", "json", "set defaults"]
};

function listToCsv(list?: string[]): string {
  if (!list || !Array.isArray(list)) return "";
  return list.join(", ");
}

function csvToList(s?: any): string[] {
  if (s === undefined || s === null || s === "") return [];
  return String(s).split(/[,;]/).map(x => x.trim()).filter(Boolean);
}

/**
 * Robustly matches an object property based on a list of potential names.
 * Improved to handle partial matches like "Manufacturer Name" matching target "manufacturer".
 */
function getVal(obj: any, targetKeys: string[]): any {
  if (!obj) return undefined;
  const objKeys = Object.keys(obj);
  const normalizedTargets = targetKeys.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''));
  
  for (const k of objKeys) {
    const normalizedK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // 1. Exact match (e.g., "mfr" === "mfr")
    if (normalizedTargets.includes(normalizedK)) {
      return obj[k];
    }
    
    // 2. Partial match (e.g., "manufacturername" contains "manufacturer")
    if (normalizedTargets.some(t => normalizedK.includes(t) || t.includes(normalizedK))) {
      return obj[k];
    }
  }
  return undefined;
}

export function exportReferencePackToXlsx(pack: ReferencePack): Blob {
  const wb = XLSX.utils.book_new();

  const createSheet = (data: any[], sheetName: string, headers: string[]) => {
    const aoa = [headers, ...data.map(item => headers.map(h => {
      const val = item[h];
      return val === undefined || val === null ? "" : val;
    }))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  createSheet((pack.manufacturers || []).map(m => ({
    abbr: m.abbr,
    name: m.name,
    aliases: listToCsv(m.aliases)
  })), SHEETS.MANUFACTURERS, ["abbr", "name", "aliases"]);

  createSheet((pack.finishes || []).map(f => ({
    us_code: f.us_code,
    bhma_code: f.bhma_code ?? "",
    name: f.name
  })), SHEETS.FINISHES, ["us_code", "bhma_code", "name"]);

  createSheet((pack.categories || []).map(c => ({
    gordon_symbol: c.gordon_symbol,
    category: c.category,
    subcategory: c.subcategory ?? ""
  })), SHEETS.CATEGORIES, ["gordon_symbol", "category", "subcategory"]);

  createSheet((pack.electrified_devices || []).map(d => ({
    device_type: d.device_type,
    voltage: listToCsv(d.voltage),
    fail_modes: listToCsv(d.fail_modes),
    keywords: listToCsv(d.keywords)
  })), SHEETS.ELECTRIFIED, ["device_type", "voltage", "fail_modes", "keywords"]);

  createSheet((pack.wiring_configs || []).map(w => ({
    name: w.name,
    device_types: listToCsv(w.device_types),
    wire_count: w.wire_count ?? ""
  })), SHEETS.WIRING, ["name", "device_types", "wire_count"]);

  createSheet((pack.hardware_sets || []).map(s => ({
    template_id: s.template_id,
    keywords: listToCsv(s.keywords),
    defaults_json: JSON.stringify(s.defaults)
  })), SHEETS.SETS, ["template_id", "keywords", "defaults_json"]);

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function importReferencePackFromXlsx(buffer: ArrayBuffer, existingPack: ReferencePack): ReferencePack {
  console.log("%c[KB IMPORT] Starting XLSX Parsing...", "color: #4f46e5; font-weight: bold;");
  
  let wb;
  try {
    wb = XLSX.read(buffer, { type: "array" });
  } catch (err) {
    console.error("XLSX read failed:", err);
    throw new Error("Failed to read Excel file format. Ensure it is a valid .xlsx file.");
  }

  console.log("Found Sheets:", wb.SheetNames);
  
  const findSheetName = (target: string): string | undefined => {
    const lowerTarget = target.toLowerCase();
    const possibleNames = SHEET_ALIASES[target] || [lowerTarget];
    
    // 1. Try direct exact match
    let found = wb.SheetNames.find(n => n.toLowerCase() === lowerTarget);
    if (found) return found;

    // 2. Try alias match
    found = wb.SheetNames.find(n => possibleNames.includes(n.toLowerCase()));
    if (found) return found;

    // 3. Try partial match
    return wb.SheetNames.find(n => n.toLowerCase().includes(lowerTarget));
  };

  const getSheetData = <T>(name: string): T[] => {
    const actualName = findSheetName(name);
    if (!actualName) {
      console.warn(`%cSheet '${name}' not found. Checked aliases: ${SHEET_ALIASES[name]?.join(', ') || 'none'}`, "color: #94a3b8;");
      return [];
    }
    const ws = wb.Sheets[actualName];
    // sheet_to_json is robust for finding the first row with content as headers
    const data = XLSX.utils.sheet_to_json<T>(ws, { defval: "" });
    console.log(`%cLoaded '${actualName}' (${data.length} rows)`, "color: #10b981;");
    if (data.length > 0) {
      console.log("Headers detected:", Object.keys(data[0]));
    }
    return data;
  };

  const manufacturers = getSheetData<any>(SHEETS.MANUFACTURERS).map(r => ({
    abbr: String(getVal(r, COLUMN_ALIASES.abbr) || "").trim(),
    name: String(getVal(r, COLUMN_ALIASES.name) || "").trim(),
    aliases: csvToList(getVal(r, COLUMN_ALIASES.aliases))
  })).filter(m => m.abbr || m.name);

  const finishes = getSheetData<any>(SHEETS.FINISHES).map(r => ({
    us_code: String(getVal(r, COLUMN_ALIASES.us_code) || "").trim(),
    bhma_code: String(getVal(r, COLUMN_ALIASES.bhma_code) || "").trim() || undefined,
    name: String(getVal(r, COLUMN_ALIASES.name) || "").trim()
  })).filter(f => f.us_code || f.name);

  const categories = getSheetData<any>(SHEETS.CATEGORIES).map(r => ({
    gordon_symbol: String(getVal(r, COLUMN_ALIASES.gordon_symbol) || "").trim(),
    category: String(getVal(r, COLUMN_ALIASES.category) || "").trim(),
    subcategory: String(getVal(r, COLUMN_ALIASES.subcategory) || "").trim() || undefined
  })).filter(c => c.gordon_symbol || c.category);

  const electrified_devices = getSheetData<any>(SHEETS.ELECTRIFIED).map(r => ({
    device_type: String(getVal(r, COLUMN_ALIASES.device_type) || "").trim(),
    voltage: csvToList(getVal(r, COLUMN_ALIASES.voltage)),
    fail_modes: csvToList(getVal(r, COLUMN_ALIASES.fail_modes)),
    keywords: csvToList(getVal(r, COLUMN_ALIASES.keywords))
  })).filter(d => d.device_type);

  const wiring_configs = getSheetData<any>(SHEETS.WIRING).map(r => ({
    name: String(getVal(r, COLUMN_ALIASES.name) || "").trim(),
    device_types: csvToList(getVal(r, COLUMN_ALIASES.device_types)),
    wire_count: getVal(r, COLUMN_ALIASES.wire_count) !== "" ? Number(getVal(r, COLUMN_ALIASES.wire_count)) : undefined
  })).filter(w => w.name);

  const hardware_sets = getSheetData<any>(SHEETS.SETS).map(r => {
    let defaults = {};
    const dJson = getVal(r, COLUMN_ALIASES.defaults_json);
    if (dJson && dJson !== "") {
       try {
         defaults = typeof dJson === 'string' ? JSON.parse(dJson) : dJson;
       } catch {
         console.warn("Could not parse defaults_json for template", getVal(r, COLUMN_ALIASES.template_id));
       }
    }
    return {
      template_id: String(getVal(r, COLUMN_ALIASES.template_id) || "").trim(),
      keywords: csvToList(getVal(r, COLUMN_ALIASES.keywords)),
      defaults
    };
  }).filter(s => s.template_id);

  const finalPack = {
    ...existingPack,
    manufacturers,
    finishes,
    categories,
    electrified_devices,
    wiring_configs,
    hardware_sets,
    updated_at: new Date().toISOString()
  };

  console.log("%c[KB IMPORT] Finished.", "color: #4f46e5; font-weight: bold;");
  return finalPack;
}
