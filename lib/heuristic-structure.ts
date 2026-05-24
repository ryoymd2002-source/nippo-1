import type { DailyReport, Weather, WorkItem, MaterialEntry } from "./report-types";
import { emptyReport } from "./report-types";

/** APIキーなしでも最低限の構造化（デモ・オフライン用） */
export function heuristicStructure(
  transcript: string,
  siteHint: string,
  reportDate: string,
): DailyReport {
  const base = emptyReport(transcript);
  base.report_date = reportDate;
  base.site_name = siteHint.trim() || extractLabeledValue(transcript, ["現場名", "現場"]) || extractSite(transcript) || "";

  base.weather = normalizeWeather(extractLabeledValue(transcript, ["天気"]) || "") ?? extractWeather(transcript);

  const workText =
    extractLabeledValue(transcript, ["作業内容", "作業", "内容"]) || "";
  const workItems = workText
    ? splitWorkItems(workText)
    : extractWorkBullets(transcript);
  base.work_items = workItems.length ? workItems : [{ description: fallbackWork(transcript) }];

  base.materials = extractMaterials(transcript);
  base.labor_count = extractLaborCount(transcript);
  base.remarks = extractLabeledValue(transcript, ["備考", "メモ"]) || null;

  return base;
}

function extractSite(text: string): string {
  const m =
    text.match(/現場[はが]?([^。,\n]+)/) ||
    text.match(/([^。,\n]{2,20})で、/) ||
    text.match(/「([^」]+)」/);
  return m?.[1]?.trim() ?? "";
}

function extractWeather(text: string): Weather | null {
  if (/晴れ?|快晴/.test(text)) return "晴";
  if (/曇/.test(text)) return "曇";
  if (/雨/.test(text)) return "雨";
  if (/雪/.test(text)) return "雪";
  return null;
}

function extractWorkBullets(text: string): WorkItem[] {
  const parts = text.split(/[。\n]+/).filter((p) => p.length > 3);
  const items: WorkItem[] = [];
  for (const p of parts.slice(0, 8)) {
    if (/作業|施工|貼り|塗り|解体|搬入|設置|配線|配管/.test(p)) {
      items.push({
        description: p.trim(),
      });
    }
  }
  return items;
}

function extractMaterials(text: string): MaterialEntry[] {
  const label = extractLabeledValue(text, ["材料", "使用材料"]) || "";
  if (!label) return [];
  const src = label;
  const out: MaterialEntry[] = [];
  const re = /([^、,\n]{2,30})\s*[:：]?\s*([\d.]+)?\s*(箱|本|枚|袋|台|式|セット)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = (m[1] ?? "").trim();
    if (!name) continue;
    const qtyRaw = m[2] ? parseFloat(m[2]) : NaN;
    out.push({
      name,
      quantity: Number.isFinite(qtyRaw) ? qtyRaw : null,
      unit: m[3] ?? null,
    });
    if (out.length >= 10) break;
  }
  return out;
}

function extractLaborCount(text: string): number | null {
  const raw =
    extractLabeledValue(text, ["人員数", "人員", "人数"]) ||
    (text.match(/(\d+)\s*名/)?.[1] ?? "");
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function extractLabeledValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${escapeRe(label)}\\s*[:：]\\s*([^\\n]+)`, "i");
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWeather(raw: string): Weather | null {
  const v = raw.trim();
  if (!v) return null;
  if (v === "晴" || /晴れ|快晴/.test(v)) return "晴";
  if (v === "曇" || /曇/.test(v)) return "曇";
  if (v === "雨" || /雨/.test(v)) return "雨";
  if (v === "雪" || /雪/.test(v)) return "雪";
  return null;
}

function splitWorkItems(workText: string): WorkItem[] {
  const parts = workText
    .split(/[、,\n;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(0, 10).map((description) => ({ description }));
}

function fallbackWork(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !/^(日付|天気|現場名|作業内容|作業|人員数|人員|人数|備考)\s*[:：]/.test(s));
  return (line ?? text).slice(0, 200).trim() || "（作業内容を編集）";
}
