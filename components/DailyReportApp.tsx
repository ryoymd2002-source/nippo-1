"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyReport, PhotoEntry } from "@/lib/report-types";
import { reportToCsv, csvHeader } from "@/lib/csv-export";
import { storageApi, StoredReport } from "@/lib/storage";
import { fetchWeather } from "@/lib/weather";

type AppTab = "create" | "history";
type Step = "input" | "voice" | "review";

const SAVED_SITES_KEY = "nippo-saved-sites";

function loadSavedSites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_SITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveSavedSites(sites: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SAVED_SITES_KEY, JSON.stringify(sites));
  } catch { /* ignore */ }
}

export default function DailyReportApp() {
  const [tab, setTab] = useState<AppTab>("create");
  const [step, setStep] = useState<Step>("input");
  const [siteHint, setSiteHint] = useState("");
  const [showSiteDropdown, setShowSiteDropdown] = useState(false);
  const [savedSites, setSavedSites] = useState<string[]>(loadSavedSites);
  const siteDropdownRef = useRef<HTMLDivElement>(null);
  const siteInputRef = useRef<HTMLInputElement>(null);
  const [reportDate, setReportDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [source, setSource] = useState<string>("");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("nippo-author-name") ?? "";
  });
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 履歴・期間指定関連
  const [history, setHistory] = useState<StoredReport[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<StoredReport | null>(null);
  const [authorFilter, setAuthorFilter] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchQuery, setSearchQuery] = useState("");

  const formatSavedAt = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const speechRef = useRef<SpeechRecognition | null>(null);

  const canSpeech =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopSpeech = useCallback(() => {
    try {
      speechRef.current?.stop();
    } catch {
      /* ignore */
    }
    speechRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => {
    return () => stopSpeech();
  }, [stopSpeech]);

  // 著者名をlocalStorageに保存
  useEffect(() => {
    if (authorName) {
      localStorage.setItem("nippo-author-name", authorName);
    }
  }, [authorName]);

  // 履歴の取得
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await storageApi.getReports();
      setHistory(data);
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? `履歴の読み込みに失敗しました: ${e.message}`
          : "履歴の読み込みに失敗しました",
      );
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") {
      loadHistory();
    }
  }, [tab, loadHistory]);

  // ユニークな著者一覧を抽出
  const uniqueAuthors = Array.from(new Set(history.map((h) => h.author_name).filter(Boolean))).sort();

  // フィルタリングされた履歴
  const filteredHistory = history.filter((h) => {
    const dateMatch = h.report_date >= startDate && h.report_date <= endDate;
    const authorMatch = !authorFilter || h.author_name === authorFilter;
    const query = searchQuery.toLowerCase();
    const textMatch =
      !query ||
      h.payload?.site_name?.toLowerCase().includes(query) ||
      h.author_name?.toLowerCase().includes(query) ||
      h.payload?.work_items?.some((w: any) =>
        w.description?.toLowerCase().includes(query),
      );
    return dateMatch && authorMatch && textMatch;
  });

  // CSVダウンロード
  const downloadRangeCsv = () => {
    if (filteredHistory.length === 0) {
      alert("選択された条件に一致する日報はありません");
      return;
    }

    const rows = [csvHeader()];
    filteredHistory.forEach((h) => {
      rows.push(reportToCsv(h.payload));
    });
    const fullCsv = rows.join("\n");

    const blob = new Blob([fullCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `日報_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // JSON出力（バックアップ用）
  const downloadBackup = async () => {
    const all = await storageApi.exportAll();
    if (all.length === 0) {
      alert("保存された日報がありません");
      return;
    }
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `日報バックアップ_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startSpeech = () => {
    setError(null);
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setError("このブラウザは音声認識に非対応です。Chrome をお試しください。");
      return;
    }
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let finals = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const row = ev.results[i];
        if (row.isFinal) finals += row[0].transcript;
      }
      if (finals.trim()) {
        setTranscript((prev) => {
          const base = prev.trim();
          const add = finals.trim();
          return base ? `${base}\n${add}` : add;
        });
      }
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => setListening(false);
    speechRef.current = rec;
    rec.start();
    setListening(true);
    setStep("voice");
  };

  const runStructure = async () => {
    setStructuring(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          site_hint: siteHint,
          report_date: reportDate,
        }),
      });
      const data = (await res.json()) as {
        report?: DailyReport;
        source?: string;
        warning?: string;
        error?: string;
      };
      if (!res.ok || !data.report) {
        setError(data.error ?? "構造化に失敗しました");
        return;
      }
      
      if (!data.report.weather || data.report.weather === "不明") {
        const weatherData = await fetchWeather(reportDate);
        if (weatherData) {
          data.report.weather = weatherData.weather as any;
          data.report.temperature_c = weatherData.temperature;
        }
      }

      // 撮影した写真をレポートに含める
      data.report.photos = photos;

      setReport(data.report);
      setSource(data.source ?? "");
      setWarning(data.warning ?? null);
      setStep("review");
    } catch {
      setError("構造化APIに接続できませんでした");
    } finally {
      setStructuring(false);
    }
  };

  const saveToLocal = async () => {
    if (!report) return;
    if (!authorName.trim()) {
      setError("保存するには氏名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 現場名を保存済みリストに追加
      if (report.site_name) {
        saveSiteName(report.site_name);
      }

      await storageApi.saveReport({
        author_name: authorName.trim(),
        report_date: report.report_date,
        payload: report,
      });
      alert("保存しました！");
      setTab("history");
      setStep("input");
      setReport(null);
      setTranscript("");
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? `保存に失敗しました: ${e.message}`
          : "保存に失敗しました",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteReport = async (id: string) => {
    if (!confirm("この日報を削除してもよろしいですか？")) return;
    await storageApi.deleteReport(id);
    loadHistory();
  };

  const handleAddPhoto = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const newPhoto: PhotoEntry = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        data_url: dataUrl,
        caption: "",
        taken_at: new Date().toISOString(),
      };
      setPhotos((prev) => [...prev, newPhoto]);
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  // 現場名を保存済みリストに追加
  const saveSiteName = useCallback((name: string) => {
    if (!name.trim()) return;
    setSavedSites((prev) => {
      if (prev.includes(name.trim())) return prev;
      const next = [name.trim(), ...prev].slice(0, 20); // 最大20件
      saveSavedSites(next);
      return next;
    });
  }, []);

  // 現場名プルダウン外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setShowSiteDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 印刷用ウィンドウを開く
  const printReport = useCallback((report: DailyReport, author: string, savedAt: string) => {
    const printWin = window.open("", "_blank");
    if (!printWin) {
      alert("ポップアップがブロックされました。印刷ウィンドウを許可してください。");
      return;
    }
    const weatherStr = report.weather
      ? `${report.weather}${report.temperature_c != null ? ` (${report.temperature_c}℃)` : ""}`
      : "—";
    const materialsStr = report.materials?.length
      ? report.materials.map((m: any) => `${m.name}${m.quantity != null ? ` ${m.quantity}` : ""}${m.unit ?? ""}`).join(" / ")
      : "—";
    const photosHtml = report.photos?.length
      ? `<div class="print-photos">${report.photos.map((p: any) => `<img src="${p.data_url}" alt="現場写真" />`).join("")}</div>`
      : "";
    const workHtml = report.work_items?.length
      ? `<table><thead><tr><th style="width:8%">No.</th><th>作業内容</th></tr></thead><tbody>${report.work_items.map((w: any, i: number) => `<tr><td>${i + 1}</td><td>${w.description}</td></tr>`).join("")}</tbody></table>`
      : "<p>—</p>";

    printWin.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>日報 ${report.report_date} ${report.site_name || ""}</title>
<style>
  @page { size: A4; margin: 15mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.6; padding: 15mm 20mm; }
  h1 { font-size: 18pt; font-weight: bold; border-bottom: 2px solid #333; padding-bottom: 4mm; margin-bottom: 6mm; }
  h2 { font-size: 13pt; font-weight: bold; border-bottom: 1px solid #999; padding-bottom: 2mm; margin-top: 5mm; margin-bottom: 3mm; }
  .meta { display: flex; gap: 10mm; font-size: 10pt; color: #555; margin-bottom: 4mm; }
  .label { font-size: 8pt; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  th, td { border: 1px solid #ccc; padding: 3mm 4mm; text-align: left; font-size: 10pt; }
  th { background: #f5f5f5; font-weight: bold; }
  .remarks { border: 1px solid #ccc; padding: 3mm 4mm; min-height: 20mm; font-size: 10pt; }
  .photos { display: flex; flex-wrap: wrap; gap: 3mm; margin-top: 3mm; }
  .photos img { width: 40mm; height: 30mm; object-fit: cover; border: 1px solid #ddd; }
  .footer { margin-top: 10mm; padding-top: 2mm; border-top: 1px solid #ccc; font-size: 8pt; color: #999; text-align: center; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>${report.site_name ? `現場：${report.site_name}` : "日報"}</h1>
<div class="meta">
  <span>日付：${report.report_date}</span>
  <span>報告者：${author}</span>
  <span>天気：${weatherStr}</span>
  <span>人員：${report.labor_count != null ? `${report.labor_count}人` : "—"}</span>
</div>
<h2>作業内容</h2>
${workHtml}
<h2>使用材料</h2>
<p style="margin-bottom:4mm;">${materialsStr}</p>
<h2>備考</h2>
<div class="remarks">${report.remarks || "—"}</div>
${photosHtml ? `<h2>現場写真</h2>${photosHtml}` : ""}
<div class="footer">作成日時: ${new Date(savedAt).toLocaleString("ja-JP")}</div>
<script>window.print();</script>
</body>
</html>`);
    printWin.document.close();
  }, []);

  const updateReport = (patch: Partial<DailyReport>) => {
    setReport((r) => (r ? { ...r, ...patch } : r));
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 px-4 pb-28 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Daily Report</p>
          <h1 className="text-2xl font-bold tracking-tight text-white">日報アプリ <span className="text-amber-500 text-lg">PRO</span></h1>
        </div>
        <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button onClick={() => setTab("create")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${tab === "create" ? "bg-amber-500 text-slate-950 shadow-lg" : "text-slate-400"}`}>作成</button>
          <button onClick={() => setTab("history")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${tab === "history" ? "bg-amber-500 text-slate-950 shadow-lg" : "text-slate-400"}`}>履歴</button>
        </div>
      </header>

      {error && (
        <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100 flex items-center gap-3">
          <svg className="w-5 h-5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {error}
        </div>
      )}

      {warning && (
        <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-sm text-amber-200 flex items-start gap-2">
          <svg className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          <span>{warning}</span>
        </div>
      )}

      {tab === "create" ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative rounded-2xl border border-slate-800 bg-slate-900/60 p-3 shadow-xl backdrop-blur-md" ref={siteDropdownRef}>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">現場名ヒント</label>
              <input
                ref={siteInputRef}
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-700"
                placeholder="例：〇〇邸"
                value={siteHint}
                onFocus={() => setShowSiteDropdown(true)}
                onChange={(e) => { setSiteHint(e.target.value); setShowSiteDropdown(true); }}
              />
              {showSiteDropdown && savedSites.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl max-h-48 overflow-y-auto">
                  {savedSites
                    .filter((s) => !siteHint || s.toLowerCase().includes(siteHint.toLowerCase()))
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="w-full text-left px-3 py-2.5 text-sm text-slate-200 hover:bg-amber-500/10 hover:text-amber-300 transition-colors border-b border-slate-800 last:border-b-0"
                        onClick={() => { setSiteHint(s); setShowSiteDropdown(false); }}
                      >
                        {s}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 shadow-xl backdrop-blur-md">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">報告日</label>
              <input type="date" className="w-full bg-transparent text-sm text-white outline-none [color-scheme:dark]" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 shadow-xl backdrop-blur-md">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">報告者氏名</label>
              <input className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-700" placeholder="例：山田太郎" value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
            </div>
          </section>

          {step !== "review" && (
            <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* 音声認識ボタン（録音機能なし） */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-1 flex">
                <button
                  type="button"
                  onClick={() => (listening ? stopSpeech() : startSpeech())}
                  disabled={!canSpeech}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-all ${
                    listening
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                      : "text-slate-300 hover:bg-slate-800"
                  } disabled:opacity-20`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  {listening ? "認識中..." : "音声入力"}
                </button>
              </div>

              <textarea
                className="w-full min-h-[200px] rounded-3xl border border-slate-800 bg-slate-950/50 p-5 text-base text-white outline-none ring-amber-500/20 focus:ring-4 transition-all"
                placeholder="例：A現場で9時からボード貼り。昼にビス1箱追加。17時終了。&#10;&#10;※ 音声入力を使用するか、直接入力してください"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />

              {/* 写真撮影・選択 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddPhoto}
                    className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/50 px-4 py-2.5 text-sm font-bold text-slate-300 hover:bg-slate-700 active:scale-[0.98] transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    写真を追加 {photos.length > 0 && `(${photos.length})`}
                  </button>
                  {photos.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPhotos([])}
                      className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      すべて削除
                    </button>
                  )}
                </div>

                {/* 写真サムネイル一覧 */}
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {photos.map((p) => (
                      <div key={p.id} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900">
                        <img src={p.data_url} alt="現場写真" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(p.id)}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={runStructure}
                disabled={structuring || !transcript.trim()}
                className="w-full rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 py-4 text-base font-bold text-white shadow-lg shadow-emerald-900/20 hover:from-emerald-400 hover:to-teal-500 active:scale-[0.98] disabled:opacity-30 transition-all"
              >
                {structuring ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    構造化中...
                  </span>
                ) : "日報データを生成する"}
              </button>
            </section>
          )}

          {step === "review" && report && (
            <section className="space-y-4 animate-in fade-in zoom-in-95 duration-300 pb-10">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-2xl">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="現場名" value={report.site_name} onChange={(v) => updateReport({ site_name: v })} />
                  <Field label="天気" value={`${report.weather ?? ""}${report.temperature_c ? ` (${report.temperature_c}℃)` : ""}`} onChange={(v) => updateReport({ weather: v as any })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">人員数</label>
                  <input
                    type="number"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/50 transition-all"
                    value={report.labor_count ?? ""}
                    placeholder="例：5"
                    onChange={(e) => updateReport({ labor_count: e.target.value ? parseInt(e.target.value) : null })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">使用材料</label>
                  {report.materials.map((m, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                      <input className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-white outline-none focus:border-amber-500/50 transition-all col-span-2" value={m.name} onChange={(e) => {
                        const next = [...report.materials];
                        next[i] = { ...m, name: e.target.value };
                        updateReport({ materials: next });
                      }} placeholder="材料名" />
                      <input className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-white outline-none focus:border-amber-500/50 transition-all" value={m.quantity ? `${m.quantity}${m.unit ?? ""}` : ""} onChange={(e) => {
                        const next = [...report.materials];
                        const match = e.target.value.match(/([\d.]+)\s*(\D*)/);
                        next[i] = { ...m, quantity: match ? parseFloat(match[1]) : null, unit: match?.[2] || null };
                        updateReport({ materials: next });
                      }} placeholder="数量" />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => updateReport({ materials: [...report.materials, { name: "", quantity: null, unit: null }] })}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    + 材料を追加
                  </button>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">主要な作業内容</label>
                  {report.work_items.map((w, i) => (
                    <div key={i} className="mb-2 rounded-2xl bg-slate-950/50 border border-slate-800 p-3">
                      <textarea className="w-full bg-transparent text-sm text-slate-200 outline-none resize-none" value={w.description} onChange={(e) => {
                        const next = [...report.work_items];
                        next[i] = { ...w, description: e.target.value };
                        updateReport({ work_items: next });
                      }} rows={2} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">備考</label>
                  <textarea
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-white outline-none focus:border-amber-500/50 transition-all resize-none"
                    rows={3}
                    value={report.remarks ?? ""}
                    placeholder="特記事項があれば入力"
                    onChange={(e) => updateReport({ remarks: e.target.value || null })}
                  />
                </div>
                {report.photos && report.photos.length > 0 && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">現場写真</label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {report.photos.map((p: any) => (
                        <div key={p.id} className="aspect-square rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900">
                          <img src={p.data_url} alt="現場写真" className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity" onClick={() => window.open(p.data_url, "_blank")} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {source && (
                  <div className="flex items-center gap-2">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      source === "gemini"
                        ? "bg-emerald-900/40 text-emerald-400 border border-emerald-700/50"
                        : "bg-slate-800 text-slate-400 border border-slate-700/50"
                    }`}>
                      {source === "gemini" ? "✨ Gemini AI" : "⚙️ ヒューリスティック"}
                    </span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button type="button" onClick={saveToLocal} disabled={saving} className="rounded-2xl bg-amber-500 py-4 text-sm font-bold text-slate-950 shadow-lg hover:bg-amber-400 active:scale-[0.98] transition-all">保存する</button>
                <button type="button" onClick={() => { setStep("input"); setReport(null); }} className="rounded-2xl border border-slate-700 bg-slate-800 py-4 text-sm font-bold text-white hover:bg-slate-700 active:scale-[0.98] transition-all">やり直す</button>
                <button type="button" onClick={() => printReport(report, authorName, new Date().toISOString())} className="rounded-2xl border border-blue-700/50 bg-blue-900/30 py-4 text-sm font-bold text-blue-300 hover:bg-blue-800/40 active:scale-[0.98] transition-all">印刷する</button>
                <button type="button" onClick={() => { setStep("input"); setTranscript(""); setReport(null); setPhotos([]); }} className="rounded-2xl border border-slate-700 bg-slate-800/50 py-4 text-sm font-bold text-slate-400 hover:bg-slate-700 active:scale-[0.98] transition-all">最初から</button>
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-xl">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">絞り込みと出力</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">開始日</label>
                <input type="date" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white [color-scheme:dark]" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">終了日</label>
                <input type="date" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white [color-scheme:dark]" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">報告者フィルター</label>
              <select
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500/50 transition-all"
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
              >
                <option value="">すべての報告者</option>
                {uniqueAuthors.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">キーワード検索 (現場名・作業員・内容)</label>
              <input type="text" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500/50 transition-all" placeholder="キーワードを入力..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button onClick={downloadRangeCsv} className="w-full bg-white text-slate-900 py-3 rounded-2xl text-sm font-bold hover:bg-slate-200 active:scale-[0.98] transition-all">表示中のデータをCSV出力</button>
              <button onClick={downloadBackup} className="w-full border border-slate-700 text-slate-300 py-3 rounded-2xl text-sm font-bold hover:bg-slate-800 active:scale-[0.98] transition-all">全データをJSONバックアップ</button>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">
              履歴一覧 ({filteredHistory.length}件)
              {history.length !== filteredHistory.length && (
                <span className="text-slate-600 font-normal"> / 全{history.length}件</span>
              )}
            </h2>
            {filteredHistory.length > 0 ? (
              filteredHistory.map((h) => (
                <div key={h.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 hover:bg-slate-800/60 transition-all">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-bold text-amber-500/80">{h.report_date}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500">{formatSavedAt(h.saved_at)}</span>
                      <button
                        onClick={() => deleteReport(h.id)}
                        className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-slate-500 mb-1">{h.author_name}</p>
                  <button
                    onClick={() => setSelectedHistory(h)}
                    className="w-full text-left"
                  >
                    <h3 className="text-sm font-bold text-slate-200">{h.payload?.site_name || "現場名なし"}</h3>
                    <p className="text-xs text-slate-500 line-clamp-1">{h.payload?.work_items?.[0]?.description || "内容なし"}</p>
                  </button>
                </div>
              ))
            ) : (
              <p className="text-center py-10 text-slate-600 text-sm">該当する日報はありません</p>
            )}
          </div>
        </section>
      )}

      {selectedHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setSelectedHistory(null)}></div>
          <div className="relative w-full max-w-md max-h-[80vh] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col sm:max-w-2xl">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold text-amber-500 uppercase">{selectedHistory.report_date}</p>
                <h3 className="text-lg font-bold text-white">{selectedHistory.payload?.site_name || "現場名なし"}</h3>
                <p className="text-[10px] font-bold text-slate-500 uppercase mt-1">{selectedHistory.author_name}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase mt-1">{formatSavedAt(selectedHistory.saved_at) || "—"}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedHistory.payload) {
                      printReport(selectedHistory.payload, selectedHistory.author_name, selectedHistory.saved_at);
                    }
                  }}
                  className="p-2 rounded-xl bg-blue-900/30 text-blue-400 hover:bg-blue-800/40 transition-all text-xs font-bold"
                  title="印刷"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </button>
                <button onClick={() => setSelectedHistory(null)} className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 transition-all">閉じる</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">天気</p>
                  <p className="text-sm font-bold text-slate-200">
                    {selectedHistory.payload?.weather ?? "—"}
                    {selectedHistory.payload?.temperature_c != null ? ` (${selectedHistory.payload.temperature_c}℃)` : ""}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">人員数</p>
                  <p className="text-sm font-bold text-slate-200">{selectedHistory.payload?.labor_count ?? "—"}</p>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">備考</p>
                <div className="text-sm text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">{selectedHistory.payload?.remarks || "—"}</div>
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">作業内容</p>
                {selectedHistory.payload?.work_items?.length ? (
                  selectedHistory.payload.work_items.map((w: any, i: number) => (
                    <div key={i} className="text-sm text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 mb-2">{w.description}</div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500 bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">—</div>
                )}
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">使用材料</p>
                {selectedHistory.payload?.materials?.length ? (
                  <div className="text-sm text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">
                    {selectedHistory.payload.materials
                      .map((m: any) => `${m.name}${m.quantity != null ? ` ${m.quantity}` : ""}${m.unit ?? ""}`)
                      .join(" / ")}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">—</div>
                )}
              </div>

              {/* 写真表示（履歴詳細） */}
              {selectedHistory.payload?.photos && selectedHistory.payload.photos.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">現場写真</p>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedHistory.payload.photos.map((p: any) => (
                      <div key={p.id} className="aspect-square rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900">
                        <img src={p.data_url} alt="現場写真" className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity" onClick={() => window.open(p.data_url, "_blank")} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">元メッセージ</p>
                <div className="text-xs text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 whitespace-pre-wrap">{selectedHistory.payload?.transcript_raw || "—"}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 隠しファイル入力 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <footer className="mt-auto text-center py-4">
        <p className="text-[10px] text-slate-700 font-bold uppercase tracking-[0.3em]">
          データはこのブラウザに保存されます
          {history.length > 0 && `（${history.length}件）`}
        </p>
      </footer>
    </main>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</label>
      <input className="w-full rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/50 transition-all" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
