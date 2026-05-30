/**
 * ハイブリッドストレージ
 * - Supabase（クラウド・複数端末共有）
 * - localStorage（ローカルキャッシュ・オフライン対応）
 *
 * Supabaseが使えない場合はlocalStorageでフォールバックします。
 */

import type { DailyReport, PhotoEntry } from "./report-types";
import { supabaseApi, deletePhotoFromStorage } from "./supabase";

export interface StoredReport {
  id: string;
  author_name: string;
  report_date: string;
  payload: DailyReport;
  saved_at: string;
}

const STORAGE_KEY = "nippo-reports";
const ORG_ID = "11111111-1111-1111-1111-111111111111";

// ===== localStorage functions (cache/fallback) =====

function getLocalReports(): StoredReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredReport[];
  } catch {
    return [];
  }
}

function saveLocalReports(reports: StoredReport[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch (e) {
    console.error("localStorage への保存に失敗しました:", e);
  }
}

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ===== Supabase format converter =====

function toSupabaseReport(report: {
  author_name: string;
  report_date: string;
  payload: DailyReport;
  saved_at: string;
}) {
  return {
    org_id: ORG_ID,
    author_id: report.author_name,
    author_name: report.author_name,
    report_date: report.report_date,
    payload: report.payload,
    saved_at: report.saved_at,
  };
}

function fromSupabaseRow(row: any): StoredReport {
  return {
    id: row.id,
    author_name: row.author_name,
    report_date: row.report_date,
    payload: row.payload,
    saved_at: row.saved_at,
  };
}

// ===== Public API =====

export const storageApi = {
  /** 日報を保存（Supabase + localStorage） */
  async saveReport(report: {
    author_name: string;
    report_date: string;
    payload: DailyReport;
  }): Promise<StoredReport> {
    const savedAt = new Date().toISOString();
    const newReport: StoredReport = {
      id: generateId(),
      author_name: report.author_name,
      report_date: report.report_date,
      payload: report.payload,
      saved_at: savedAt,
    };

    // localStorage に保存（常に成功）
    const localReports = getLocalReports();
    localReports.unshift(newReport);
    saveLocalReports(localReports);

    // Supabase に保存（失敗しても無視）
    try {
      const rows = await supabaseApi.saveReport(toSupabaseReport({ ...report, saved_at: savedAt }));
      if (rows && rows.length > 0) {
        newReport.id = rows[0].id!;
        // localStorage のidをSupabaseのidで上書き
        const updatedLocal = getLocalReports();
        const idx = updatedLocal.findIndex((r) => r.saved_at === savedAt);
        if (idx >= 0) {
          updatedLocal[idx].id = rows[0].id!;
          saveLocalReports(updatedLocal);
        }
      }
    } catch (e) {
      console.warn("Supabase保存に失敗しました（localStorageのみに保存）:", e);
    }

    return newReport;
  },

  /** 全日報を取得（Supabase優先 → localStorageフォールバック） */
  async getReports(): Promise<StoredReport[]> {
    // Supabase から取得を試みる
    try {
      const rows = await supabaseApi.getReports();
      if (rows && rows.length > 0) {
        const reports = rows.map(fromSupabaseRow);
        // localStorage も最新に更新
        saveLocalReports(reports);
        return reports;
      }
    } catch (e) {
      console.warn("Supabaseからの読み込みに失敗しました（localStorageを使用）:", e);
    }

    // フォールバック: localStorage
    return getLocalReports();
  },

  /** 日報を削除（Supabase + localStorage + Storage写真） */
  async deleteReport(id: string): Promise<void> {
    // 削除前に写真のStorage URLを取得
    const allReports = getLocalReports();
    const target = allReports.find((r) => r.id === id);
    const storageUrls: string[] = [];
    if (target?.payload?.photos) {
      for (const photo of target.payload.photos as PhotoEntry[]) {
        if (photo.storage_url) storageUrls.push(photo.storage_url);
      }
    }

    // localStorage から削除
    const localReports = allReports.filter((r) => r.id !== id);
    saveLocalReports(localReports);

    // Supabase DB から削除
    try {
      await supabaseApi.deleteReport(id);
    } catch (e) {
      console.warn("Supabaseからの削除に失敗しました（localStorageのみ削除）:", e);
    }

    // Storage の画像ファイルを削除
    for (const url of storageUrls) {
      try {
        await deletePhotoFromStorage(url);
      } catch (e) {
        console.warn("Storage写真の削除に失敗しました:", e);
      }
    }
  },

  /** 全データをエクスポート（JSON） */
  async exportAll(): Promise<StoredReport[]> {
    return this.getReports();
  },
};
