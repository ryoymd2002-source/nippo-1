import type { DailyReport } from "./report-types";
import { emptyReport } from "./report-types";
import { heuristicStructure } from "./heuristic-structure";

const SCHEMA_HINT = `
JSONのみを返す。キーは次の形:
{
  "report_date": "YYYY-MM-DD",
  "site_name": string,
  "weather": "晴"|"曇"|"雨"|"雪"|"不明"|null,
  "temperature_c": number|null,
  "work_items": [{"description":string}],
  "materials": [{"name":string,"quantity":number|null,"unit":string|null}],
  "labor_count": number|null,
  "remarks": string|null
}
「日付：」「天気：」「現場名：」「作業：」などのラベルが付いたテキストが来ることが多いです。
それらを適切に抽出してください。不明な値はnull。
`;

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const s = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeDate(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  if (!v) return fallback;
  const m1 = v.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
  const m2 = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return v;
  return fallback;
}

function normalizeWeather(raw: any): DailyReport["weather"] {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (v === "晴" || /晴れ|快晴/.test(v)) return "晴";
  if (v === "曇" || /曇/.test(v)) return "曇";
  if (v === "雨" || /雨/.test(v)) return "雨";
  if (v === "雪" || /雪/.test(v)) return "雪";
  if (v === "不明") return "不明";
  return null;
}

function mergeMissing(primary: DailyReport, fallback: DailyReport): DailyReport {
  return {
    ...primary,
    report_date: primary.report_date || fallback.report_date,
    site_name: primary.site_name || fallback.site_name,
    weather: primary.weather ?? fallback.weather,
    temperature_c: primary.temperature_c ?? fallback.temperature_c,
    work_items: primary.work_items?.length ? primary.work_items : fallback.work_items,
    materials: primary.materials?.length ? primary.materials : fallback.materials,
    labor_count: primary.labor_count ?? fallback.labor_count,
    remarks: primary.remarks ?? fallback.remarks,
  };
}

async function structureWithGemini(transcript: string, siteHint: string, reportDate: string, apiKey: string): Promise<DailyReport | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `あなたは建設現場の日報を構造化するアシスタントです。以下の発話内容を、指定されたJSON形式に変換してください。\n\n【制約】\n${SCHEMA_HINT}\n\n【情報】\n報告日: ${reportDate}\n現場名ヒント: ${siteHint}\n\n【発話内容】\n${transcript}`
          }]
        }],
        generationConfig: {
          responseMimeType: "application/json",
        }
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = safeJsonParse(text);
    return parsed ? (parsed as DailyReport) : null;
  } catch (e) {
    console.error("Gemini API error:", e);
    return null;
  }
}

export async function structureReport(transcript: string, siteHint: string = "", reportDate?: string): Promise<{ report: DailyReport; source: "gemini" | "heuristic"; warning?: string }> {
  const date = reportDate ?? new Date().toISOString().slice(0, 10);
  
  const geminiKey = process.env.GEMINI_API_KEY;

  let parsed: Partial<DailyReport> | null = null;
  let source: "gemini" | "heuristic" = "heuristic";

  // Gemini (無料) を試す
  if (geminiKey) {
    parsed = await structureWithGemini(transcript, siteHint, date, geminiKey);
    if (parsed) source = "gemini";
  }

  const baseReport: DailyReport = {
    ...emptyReport(transcript),
    ...(parsed || {}),
    report_date: normalizeDate(parsed?.report_date, date),
    transcript_raw: transcript,
    work_items: Array.isArray(parsed?.work_items) ? parsed!.work_items : [],
    labor_entries: Array.isArray(parsed?.labor_entries) ? parsed!.labor_entries : [],
    materials: Array.isArray(parsed?.materials) ? parsed!.materials : [],
    photos: Array.isArray(parsed?.photos) ? parsed!.photos : [],
  };

  baseReport.weather = normalizeWeather((parsed as any)?.weather);

  const fallback = heuristicStructure(transcript, siteHint, baseReport.report_date);
  const finalReport = mergeMissing(baseReport, fallback);
  if (!parsed) source = "heuristic";

  return { report: finalReport, source };
}
