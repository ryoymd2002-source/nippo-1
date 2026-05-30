/** 日報の正規JSON形（帳票・CSVの元） */

export type Weather = "晴" | "曇" | "雨" | "雪" | "不明";

export interface WorkItem {
  description: string;
}

export interface MaterialEntry {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface PhotoEntry {
  id: string;
  data_url: string;      // base64 data URL（アップロード後は空になる）
  storage_url?: string;   // Supabase Storage の公開URL（アップロード後に設定）
  caption: string;
  taken_at: string;      // ISO timestamp
}

export interface DailyReport {
  report_date: string;
  site_name: string;
  weather: Weather | null;
  temperature_c: number | null;
  work_items: WorkItem[];
  materials: MaterialEntry[];
  labor_count: number | null;
  remarks: string | null;
  transcript_raw: string;
  confirmed_at: string | null;
  photos?: any[];
  labor_entries?: any[];
}

export function emptyReport(transcript: string): DailyReport {
  const today = new Date().toISOString().slice(0, 10);
  return {
    report_date: today,
    site_name: "",
    weather: null,
    temperature_c: null,
    work_items: [],
    materials: [],
    labor_count: null,
    remarks: null,
    transcript_raw: transcript,
    confirmed_at: null,
    photos: [],
    labor_entries: [],
  };
}
