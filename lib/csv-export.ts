import type { DailyReport } from "./report-types";

/**
 * 1件の日報をExcelで見やすい「横1行」CSVに変換する
 * 各作業項目は「;」区切りで1セルにまとめる
 */
export function reportToCsv(r: DailyReport): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  // 作業内容を「;」区切りで1行に
  const workDescriptions = r.work_items
    .map((w) => w.description)
    .join("; ");

  // 材料を「;」区切りで
  const materialsStr = r.materials
    .map((m) => `${m.name} ${m.quantity ?? ""}${m.unit ?? ""}`)
    .filter(Boolean)
    .join("; ");

  // 1行 = 1日報（横に長く、Excelで見やすい形式）
  const columns = [
    esc(r.report_date),       // A: 日付
    esc(r.site_name),         // B: 現場名
    esc(r.weather),           // C: 天気
    esc(r.temperature_c != null ? `${r.temperature_c}℃` : ""), // D: 気温
    esc(workDescriptions),    // E: 作業内容
    esc(r.labor_count),       // F: 人員数
    esc(materialsStr),        // G: 使用材料
    esc(r.remarks),           // H: 備考
    esc(r.transcript_raw),    // I: 元のメッセージ
  ];

  return columns.join(",");
}

/**
 * ヘッダー行を返す（reportToCsvと列を合わせる）
 */
export function csvHeader(): string {
  const headers = [
    "日付",
    "現場名",
    "天気",
    "気温",
    "作業内容",
    "人員数",
    "使用材料",
    "備考",
    "元メッセージ",
  ];
  return "\uFEFF" + headers.join(",");
}
