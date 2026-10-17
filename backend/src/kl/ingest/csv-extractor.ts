/**
 * Extracción de CSV sintético con localizador por fila (I8). El revisor no edita valores: solo el mapeo. La extracción
 * es determinista y no interpreta fórmulas.
 */
export interface ExtractedRowInput {
  locator: string;
  raw_label: string | null;
  raw_value_text: string | null;
  indicator_key: string | null;
  geo_code: string | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  parsed_value: number | null;
  classification: "new_period" | "correction" | "complement" | "method_change" | "conflict" | "unclassifiable";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const REQUIRED = ["indicator_key", "geo_code", "period_label", "period_start", "period_end", "value"] as const;

export function extractCsv(text: string): { rows: ExtractedRowInput[]; missingColumns: string[] } {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missingColumns = REQUIRED.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) return { rows: [], missingColumns: [...missingColumns] };
  const idx = (name: string) => header.indexOf(name);
  const rows: ExtractedRowInput[] = [];
  table.slice(1).forEach((cells, n) => {
    const get = (name: string): string | null => {
      const v = cells[idx(name)];
      return v === undefined || v.trim() === "" ? null : v.trim();
    };
    const raw = get("value");
    const numeric = raw === null ? null : Number(raw.replace(/[%\s]/g, "").replace(/,(?=\d{3}\b)/g, ""));
    rows.push({
      locator: `row:${n + 2}`, // línea del archivo (1 = encabezado)
      raw_label: get("label"),
      raw_value_text: raw,
      indicator_key: get("indicator_key"),
      geo_code: get("geo_code"),
      period_label: get("period_label"),
      period_start: get("period_start"),
      period_end: get("period_end"),
      parsed_value: numeric !== null && Number.isFinite(numeric) ? numeric : null,
      classification: "new_period",
    });
  });
  return { rows, missingColumns: [] };
}

export interface QaCheck {
  name: string;
  status: "pass" | "fail" | "info";
  blocking: boolean;
  detail: string;
}

/** QA mínima de R1: completitud, duplicados, valores numéricos, rango porcentual e indicadores desconocidos (T13 y el cruce con la edición previa llegan con el recolector, R2). */
export function runQa(rows: ExtractedRowInput[], context: { knownIndicators: ReadonlySet<string>; percentIndicators?: ReadonlySet<string> }): { checks: QaCheck[]; blockingFailures: number } {
  const checks: QaCheck[] = [];
  const add = (name: string, failures: string[], blocking: boolean, okDetail: string) =>
    checks.push({ name, status: failures.length === 0 ? "pass" : "fail", blocking: failures.length > 0 && blocking, detail: failures.length === 0 ? okDetail : failures.slice(0, 5).join("; ") });
  add("rows_present", rows.length === 0 ? ["no rows"] : [], true, `${rows.length} rows`);
  add("completeness", rows.filter((r) => !r.indicator_key || !r.geo_code || !r.period_label || !r.period_start || !r.period_end).map((r) => `${r.locator} incomplete`), true, "all required fields present");
  const seen = new Map<string, string>();
  const dups: string[] = [];
  for (const r of rows) {
    const key = `${r.indicator_key}|${r.geo_code}|${r.period_label}`;
    if (seen.has(key)) dups.push(`${r.locator} repeats ${seen.get(key)}`);
    else seen.set(key, r.locator);
  }
  add("duplicates", dups, true, "no repeated indicator/geo/period");
  add("numeric_values", rows.filter((r) => r.raw_value_text !== null && r.parsed_value === null && !/^(n\/?d|n\/?a|-|—)$/i.test(r.raw_value_text)).map((r) => `${r.locator} not numeric`), true, "all values parse");
  add("unknown_indicator", rows.filter((r) => r.indicator_key && !context.knownIndicators.has(r.indicator_key)).map((r) => `${r.locator} ${r.indicator_key}`), true, "all indicators registered");
  const percent = context.percentIndicators ?? new Set<string>();
  add("percent_range", rows.filter((r) => r.indicator_key && percent.has(r.indicator_key) && r.parsed_value !== null && (r.parsed_value < 0 || r.parsed_value > 100)).map((r) => `${r.locator} out of 0..100`), true, "percentages within 0..100");
  add("null_values", rows.filter((r) => r.parsed_value === null).map((r) => `${r.locator} no value`), false, "no nulls");
  return { checks, blockingFailures: checks.filter((c) => c.blocking).length };
}
