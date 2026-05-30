/**
 * Supabase REST API クライアント
 * SDK不要でREST API経由で通信します
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function supabaseFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (!SB_URL || !SB_ANON_KEY) {
    throw new Error("Supabase URL or Anon Key is missing");
  }

  const url = `${SB_URL}/rest/v1/${path}`;
  const headers: Record<string, string> = {
    "apikey": SB_ANON_KEY,
    "Authorization": `Bearer ${SB_ANON_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Supabase request failed (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  // DELETE の場合は空レスポンスの可能性あり
  const contentType = response.headers.get("content-type");
  if (options.method === "DELETE" && (!contentType || !contentType.includes("json"))) {
    return {} as T;
  }

  return response.json();
}

export interface DailyReportRow {
  id?: string;
  org_id: string;
  author_id: string;
  author_name: string;
  report_date: string;
  payload: any;
  saved_at?: string;
}

export const supabaseApi = {
  /** 日報を保存 */
  async saveReport(report: DailyReportRow): Promise<DailyReportRow[]> {
    return supabaseFetch<DailyReportRow[]>("daily_reports", {
      method: "POST",
      body: JSON.stringify(report),
    });
  },

  /** 全日報を取得（新しい順） */
  async getReports(): Promise<DailyReportRow[]> {
    return supabaseFetch<DailyReportRow[]>(
      `daily_reports?select=*&order=saved_at.desc`,
      { method: "GET" },
    );
  },

  /** 日報を削除 */
  async deleteReport(id: string): Promise<void> {
    await supabaseFetch(`daily_reports?id=eq.${id}`, {
      method: "DELETE",
    });
  },
};

// ===== Supabase Storage API（写真ファイル用） =====

/** Base64データURLを Supabase Storage にアップロードし、公開URLを返す */
export async function uploadPhotoToStorage(
  base64DataUrl: string,
  reportId: string,
  index: number,
): Promise<string> {
  const fileName = `${reportId}/${Date.now()}-${index}.jpg`;

  // base64 → Blob 変換（fetch で dataURL をバイナリに変換）
  const res = await fetch(base64DataUrl);
  const blob = await res.blob();

  const url = `${SB_URL}/storage/v1/object/report-photos/${fileName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SB_ANON_KEY}`,
      "Content-Type": blob.type || "application/octet-stream",
    },
    body: blob,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`写真のアップロードに失敗しました: ${text}`);
  }

  // 公開URLを返す
  return `${SB_URL}/storage/v1/object/public/report-photos/${fileName}`;
}

/** Storage 上の画像ファイルを削除 */
export async function deletePhotoFromStorage(storageUrl: string): Promise<void> {
  // URLからパスを抽出: ".../report-photos/abc-123/0.jpg" → "abc-123/0.jpg"
  const path = storageUrl.split("/report-photos/")[1];
  if (!path) return;

  const response = await fetch(`${SB_URL}/storage/v1/object/report-photos/${path}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${SB_ANON_KEY}` },
  });

  if (!response.ok) {
    console.warn(`Storage写真の削除に失敗: ${path} (${response.status})`);
  }
}
