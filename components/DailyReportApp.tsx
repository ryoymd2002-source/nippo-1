
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyReport, type DailyReport, type PhotoEntry } from "@/lib/report-types";
import { reportToCsv, csvHeader } from "@/lib/csv-export";
import { storageApi, StoredReport } from "@/lib/storage";
import { fetchWeather } from "@/lib/weather";
import { uploadPhotoToStorage } from "@/lib/supabase";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type AppTab = "create" | "history" | "gallery" | "dashboard";

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

// === テンプレート機能 ===
interface Template {
  id: string;
  name: string;
  site_name: string;
  materials: { name: string; quantity: number | null; unit: string | null }[];
  work_items: { description: string }[];
  created_at: string;
}

const TEMPLATES_KEY = "nippo-templates";

function loadTemplates(): Template[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as Template[]) : [];
  } catch {
    return [];
  }
}

function saveTemplatesToDisk(templates: Template[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch { /* ignore */ }
}

export default function DailyReportApp() {
  const [tab, setTab] = useState<AppTab>("create");
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

  // カレンダー・ギャラリー・ダッシュボード 関連
  const [historyViewMode, setHistoryViewMode] = useState<"list" | "calendar">("list");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [lightboxPhoto, setLightboxPhoto] = useState<{ photo: PhotoEntry; report: StoredReport } | null>(null);
  const [galleryGroupBy, setGalleryGroupBy] = useState<"site" | "date">("site");
  const [templates, setTemplates] = useState<Template[]>(loadTemplates);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const [siteProgress, setSiteProgress] = useState<string | null>(null);

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

  // 履歴の取得（履歴・ギャラリー・ダッシュボード タブで読み込み）
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
    if (tab === "history" || tab === "gallery" || tab === "dashboard") {
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
      setTranscript(reportToFormattedText(data.report));
    } catch {
      setError("構造化APIに接続できませんでした");
    } finally {
      setStructuring(false);
    }
  };

  const saveToLocal = async () => {
    const target = report ?? { ...emptyReport(transcript), photos };
    if (!transcript.trim()) {
      setError("保存するテキストがありません");
      return;
    }
    if (!authorName.trim()) {
      setError("保存するには氏名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 現場名を保存済みリストに追加
      if (target.site_name) {
        saveSiteName(target.site_name);
      }

      // 写真をクラウドストレージにアップロード（base64 → Storage URL）
      if (target.photos && target.photos.length > 0) {
        const tmpId = `tmp-${Date.now()}`;
        for (let i = 0; i < target.photos.length; i++) {
          const photo = target.photos[i];
          // data_url が存在し、まだ storage_url がない場合のみアップロード
          if (photo.data_url && !photo.storage_url) {
            try {
              const url = await uploadPhotoToStorage(photo.data_url, tmpId, i);
              photo.storage_url = url;
              photo.data_url = ""; // DB肥大化防止のため base64 をクリア
            } catch (e) {
              console.warn(`写真${i}のアップロードに失敗しました（base64のまま保存）:`, e);
              // アップロード失敗時は base64 のまま保存（フォールバック）
            }
          }
        }
      }

      await storageApi.saveReport({
        author_name: authorName.trim(),
        report_date: target.report_date,
        payload: target,
      });
      alert("保存しました！");
      setTab("history");
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

  // 現場名プルダウン・テンプレートプルダウン外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setShowSiteDropdown(false);
      }
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setShowTemplateDropdown(false);
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

  // === PDFダウンロード（jspdf + html2canvas） ===
  const downloadPdf = useCallback(async (report: DailyReport, author: string, savedAt: string) => {
    const pdfDiv = document.createElement("div");
    pdfDiv.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:40px;font-family: sans-serif;color:#1a1a1a;";
    const weatherStr = report.weather
      ? `${report.weather}${report.temperature_c != null ? ` (${report.temperature_c}℃)` : ""}`
      : "—";
    const materialsStr = report.materials?.length
      ? report.materials.map((m: any) => `${m.name}${m.quantity != null ? ` ${m.quantity}` : ""}${m.unit ?? ""}`).join(" / ")
      : "—";
    const photosHtml = report.photos?.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">${report.photos.map((p: any) => `<img src="${p.data_url}" style="width:160px;height:120px;object-fit:cover;border:1px solid #ddd;" />`).join("")}</div>`
      : "";
    const workHtml = report.work_items?.length
      ? `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><thead><tr style="background:#f5f5f5;"><th style="border:1px solid #ccc;padding:8px;text-align:left;width:8%;font-size:11pt;">No.</th><th style="border:1px solid #ccc;padding:8px;text-align:left;font-size:11pt;">作業内容</th></tr></thead><tbody>${report.work_items.map((w: any, i: number) => `<tr><td style="border:1px solid #ccc;padding:8px;font-size:10pt;">${i + 1}</td><td style="border:1px solid #ccc;padding:8px;font-size:10pt;">${w.description}</td></tr>`).join("")}</tbody></table>`
      : "<p style='font-size:10pt;'>—</p>";
    pdfDiv.innerHTML = `
      <h1 style="font-size:20pt;font-weight:bold;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px;">${report.site_name ? `現場：${report.site_name}` : "日報"}</h1>
      <div style="display:flex;gap:20px;font-size:10pt;color:#555;margin-bottom:12px;">
        <span>日付：${report.report_date}</span>
        <span>報告者：${author}</span>
        <span>天気：${weatherStr}</span>
        <span>人員：${report.labor_count != null ? `${report.labor_count}人` : "—"}</span>
      </div>
      <h2 style="font-size:14pt;font-weight:bold;border-bottom:1px solid #999;padding-bottom:4px;margin-top:16px;margin-bottom:8px;">作業内容</h2>
      ${workHtml}
      <h2 style="font-size:14pt;font-weight:bold;border-bottom:1px solid #999;padding-bottom:4px;margin-top:16px;margin-bottom:8px;">使用材料</h2>
      <p style="margin-bottom:12px;font-size:10pt;">${materialsStr}</p>
      <h2 style="font-size:14pt;font-weight:bold;border-bottom:1px solid #999;padding-bottom:4px;margin-top:16px;margin-bottom:8px;">備考</h2>
      <div style="border:1px solid #ccc;padding:8px;min-height:40px;font-size:10pt;">${report.remarks || "—"}</div>
      ${report.photos?.length ? `<h2 style="font-size:14pt;font-weight:bold;border-bottom:1px solid #999;padding-bottom:4px;margin-top:16px;margin-bottom:8px;">現場写真</h2>${photosHtml}` : ""}
      <div style="margin-top:24px;padding-top:4px;border-top:1px solid #ccc;font-size:8pt;color:#999;text-align:center;">作成日時: ${new Date(savedAt).toLocaleString("ja-JP")}</div>
    `;
    document.body.appendChild(pdfDiv);
    try {
      const canvas = await html2canvas(pdfDiv, { scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfW = 210;
      const pdfH = 297;
      const margin = 15;
      const usableW = pdfW - margin * 2;
      const usableH = pdfH - margin * 2;
      const imgAspect = canvas.width / canvas.height;
      let renderW = usableW;
      let renderH = usableW / imgAspect;
      if (renderH > usableH) {
        renderH = usableH;
        renderW = usableH * imgAspect;
      }
      const offsetX = (pdfW - renderW) / 2;
      const offsetY = (pdfH - renderH) / 2;
      pdf.addImage(imgData, "JPEG", offsetX, offsetY, renderW, renderH);
      pdf.save(`日報_${report.report_date}_${report.site_name || "現場"}.pdf`);
    } catch (e) {
      console.error(e);
      alert("PDFの生成に失敗しました");
    } finally {
      document.body.removeChild(pdfDiv);
    }
  }, []);

  // === テンプレート保存 ===
  const saveAsTemplate = useCallback(() => {
    if (!report) return;
    const name = prompt("テンプレート名を入力してください", report.site_name || "テンプレート");
    if (!name) return;
    const newTemplate: Template = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      name,
      site_name: report.site_name || "",
      materials: report.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
      work_items: report.work_items.map((w) => ({ description: w.description })),
      created_at: new Date().toISOString(),
    };
    const next = [newTemplate, ...templates].slice(0, 20);
    setTemplates(next);
    saveTemplatesToDisk(next);
  }, [report, templates]);

  // === テンプレート読み込み ===
  const loadTemplate = useCallback((t: Template) => {
    console.log("[loadTemplate] called with", t.name, t.site_name);
    try {
      const patch = {
        site_name: t.site_name,
        materials: t.materials ? t.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })) : [],
        work_items: t.work_items ? t.work_items.map((w) => ({ description: w.description })) : [],
      };
      console.log("[loadTemplate] patch:", patch);
      setReport((r) => {
        console.log("[loadTemplate] setReport callback, r =", r, "transcript =", transcript);
        const base = r ?? emptyReport(transcript);
        const result = { ...base, ...patch };
        console.log("[loadTemplate] setReport result:", result);
        return result;
      });
      // テキストエリアをテンプレート内容で上書き（常に反映）
      setTranscript(() => {
        const merged = { ...emptyReport(""), ...patch } as DailyReport;
        const formatted = reportToFormattedText(merged);
        console.log("[loadTemplate] formatted:", formatted);
        return formatted;
      });
      if (t.site_name) {
        console.log("[loadTemplate] setting siteHint:", t.site_name);
        setSiteHint(t.site_name);
      }
      setShowTemplateDropdown(false);
      console.log("[loadTemplate] completed successfully");
    } catch (err) {
      console.error("[loadTemplate] ERROR:", err);
    }
  }, [transcript]);

  // === テンプレート削除 ===
  const deleteTemplate = useCallback((id: string) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    saveTemplatesToDisk(next);
  }, [templates]);

  const updateReport = (patch: Partial<DailyReport>) => {
    setReport((r) => {
      const base = r ?? emptyReport(transcript);
      return { ...base, ...patch };
    });
  };

  // === カレンダー用ヘルパー ===
  const getMonthDateRange = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    return { firstDay, lastDay, year, month };
  };

  const calendarNav = (dir: -1 | 1) => {
    setCalendarDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  // カレンダー用：日付→報告有無マップ
  const reportDateMap = new Map<string, StoredReport[]>();
  filteredHistory.forEach((h) => {
    const key = h.report_date;
    if (!reportDateMap.has(key)) reportDateMap.set(key, []);
    reportDateMap.get(key)!.push(h);
  });

  // カレンダーグリッド生成
  const buildCalendarGrid = () => {
    const { year, month } = getMonthDateRange(calendarDate);
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: ({ day: number; reports: StoredReport[] } | null)[] = [];
    
    // 前月の空白埋め
    for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
    
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, reports: reportDateMap.get(dateStr) ?? [] });
    }
    return cells;
  };

  // === ギャラリー用：写真収集 ===
  const allGalleryPhotos = history
    .filter((h) => h.payload?.photos?.length)
    .flatMap((h) =>
      (h.payload.photos as PhotoEntry[]).map((p) => ({ photo: p, report: h })),
    );

  // 現場名でグループ化
  const galleryBySite = new Map<string, typeof allGalleryPhotos>();
  allGalleryPhotos.forEach((item) => {
    const site = item.report.payload?.site_name || "現場名なし";
    if (!galleryBySite.has(site)) galleryBySite.set(site, []);
    galleryBySite.get(site)!.push(item);
  });

  // 日付でグループ化
  const galleryByDate = new Map<string, typeof allGalleryPhotos>();
  allGalleryPhotos.forEach((item) => {
    const date = item.report.report_date;
    if (!galleryByDate.has(date)) galleryByDate.set(date, []);
    galleryByDate.get(date)!.push(item);
  });

  // === ダッシュボード用：統計 ===
  const dashboardStats = {
    totalReports: filteredHistory.length,
    uniqueSites: new Set(filteredHistory.map((h) => h.payload?.site_name).filter(Boolean)).size,
    uniqueAuthors: new Set(filteredHistory.map((h) => h.author_name).filter(Boolean)).size,
    totalLabor: filteredHistory.reduce((sum, h) => sum + (h.payload?.labor_count ?? 0), 0),
    weatherCounts: new Map<string, number>(),
    siteCounts: new Map<string, number>(),
  };
  filteredHistory.forEach((h) => {
    const w = h.payload?.weather;
    if (w) dashboardStats.weatherCounts.set(w, (dashboardStats.weatherCounts.get(w) ?? 0) + 1);
    const s = h.payload?.site_name;
    if (s) dashboardStats.siteCounts.set(s, (dashboardStats.siteCounts.get(s) ?? 0) + 1);
  });
  const topSites = Array.from(dashboardStats.siteCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // 日付ごとの報告数（棒グラフ用）
  const reportsPerDay = new Map<string, number>();
  filteredHistory.forEach((h) => {
    reportsPerDay.set(h.report_date, (reportsPerDay.get(h.report_date) ?? 0) + 1);
  });
  const maxReportsPerDay = Math.max(...Array.from(reportsPerDay.values()), 1);

  // recharts用データ
  const chartWeatherData = ["晴", "曇", "雨", "雪"]
    .map((w) => ({ name: w, value: dashboardStats.weatherCounts.get(w) ?? 0 }))
    .filter((d) => d.value > 0);
  const chartSiteData = topSites.map(([site, count]) => ({ name: site, 報告数: count }));
  const chartDailyData = Array.from(reportsPerDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date: date.slice(-5), 報告数: count }));
  const CHART_COLORS = ["#60a5fa", "#10b981", "#f59e0b", "#f472b6", "#a78bfa", "#34d399", "#fb923c"];
  const PIE_COLORS = ["#60a5fa", "#f59e0b", "#60a5fa", "#e2e8f0"];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 px-4 pb-28 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] gradient-text-primary">Daily Report</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-700">日報アプリ <span className="gradient-text text-lg">PRO</span></h1>
        </div>
        <div className="flex bg-white p-1 rounded-xl border border-slate-200">
          <button onClick={() => setTab("create")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${tab === "create" ? "bg-gradient-to-r from-primary-400 to-primary-500 text-white shadow-lg shadow-primary-500/20" : "text-slate-400 hover:text-slate-600"}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            作成
          </button>
          <button onClick={() => setTab("history")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${tab === "history" ? "bg-gradient-to-r from-primary-400 to-primary-500 text-white shadow-lg shadow-primary-500/20" : "text-slate-400 hover:text-slate-600"}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            履歴
          </button>
          <button onClick={() => setTab("gallery")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${tab === "gallery" ? "bg-gradient-to-r from-primary-400 to-primary-500 text-white shadow-lg shadow-primary-500/20" : "text-slate-400 hover:text-slate-600"}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            写真
          </button>
          <button onClick={() => { setTab("dashboard"); }} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${tab === "dashboard" ? "bg-gradient-to-r from-primary-400 to-primary-500 text-white shadow-lg shadow-primary-500/20" : "text-slate-400 hover:text-slate-600"}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            集計
          </button>
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
          {/* --- 常時表示：現場名ヒント・報告日・報告者氏名 --- */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative glass-card rounded-2xl p-3" ref={siteDropdownRef}>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">現場名ヒント</label>
              <input
                ref={siteInputRef}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-300"
                placeholder="例：〇〇邸"
                value={siteHint}
                onFocus={() => setShowSiteDropdown(true)}
                onChange={(e) => { setSiteHint(e.target.value); setShowSiteDropdown(true); }}
              />
              {showSiteDropdown && savedSites.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-slate-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                  {savedSites
                    .filter((s) => !siteHint || s.toLowerCase().includes(siteHint.toLowerCase()))
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="w-full text-left px-3 py-2.5 text-sm text-slate-600 hover:bg-primary-400/10 hover:text-primary-300 transition-colors border-b border-slate-200 last:border-b-0"
                        onClick={() => { setSiteHint(s); setShowSiteDropdown(false); }}
                      >
                        {s}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="glass-card rounded-2xl p-3">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">報告日</label>
              <input type="date" className="w-full bg-transparent text-sm text-slate-700 outline-none" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </div>
            <div className="glass-card rounded-2xl p-3">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">報告者氏名</label>
              <input className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-300" placeholder="例：山田太郎" value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
            </div>
          </section>

          {/* テンプレート読み込み */}
          {templates.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                className="flex items-center gap-2 glass-card rounded-2xl px-4 py-2.5 text-sm font-bold text-emerald-600 hover:bg-emerald-50 active:scale-[0.98] transition-all"
              >
                <span>📋</span>
                テンプレートから読み込む
                <span className="text-[10px] text-emerald-400">（{templates.length}件）</span>
              </button>
              {showTemplateDropdown && (
                <div ref={templateDropdownRef} className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-slate-200 bg-white shadow-lg max-h-60 overflow-y-auto">
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 last:border-b-0">
                      <button
                        type="button"
                        className="flex-1 text-left text-sm text-slate-600 hover:text-emerald-600 transition-colors"
                        onClick={() => loadTemplate(t)}
                      >
                        <span className="font-bold">{t.name}</span>
                        <span className="text-[10px] text-slate-400 ml-2">{t.site_name}</span>
                        <span className="text-[10px] text-slate-400 ml-2">{new Date(t.created_at).toLocaleDateString("ja-JP")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTemplate(t.id)}
                        className="text-[10px] text-red-400/60 hover:text-red-400 ml-2 shrink-0"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* --- 常時表示：入力エリア（音声・テキスト・写真） --- */}
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* 音声認識ボタン */}
            <div className="glass-card rounded-3xl p-1 flex">
              <button
                type="button"
                onClick={() => (listening ? stopSpeech() : startSpeech())}
                disabled={!canSpeech}
                className={`flex-1 flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-all ${
                  listening
                    ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                    : "text-slate-500 hover:bg-slate-100"
                } disabled:opacity-20`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {listening ? "認識中..." : "音声入力"}
              </button>
            </div>

            <textarea
              className="w-full min-h-[200px] rounded-3xl border border-slate-200 bg-white p-5 text-base text-slate-700 outline-none ring-primary-400/20 focus:ring-4 focus:border-primary-400/50 transition-all"
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
                  className="flex items-center gap-2 glass-card rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 active:scale-[0.98] transition-all"
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

              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((p) => (
                    <div key={p.id} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 bg-white hover:border-primary-400/30 transition-all">
                      <img src={p.data_url} alt="現場写真" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
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

            {/* --- アクションボタン（常時表示） --- */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={runStructure}
                disabled={structuring || !transcript.trim()}
                className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 py-4 text-sm font-bold text-white shadow-lg shadow-emerald-500/10 hover:from-emerald-400 hover:to-teal-500 active:scale-[0.98] disabled:opacity-30 transition-all"
              >
                {structuring ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    構造化中...
                  </span>
                ) : "⚡ 構造化する"}
              </button>
              <button
                type="button"
                onClick={saveToLocal}
                disabled={saving || !transcript.trim()}
                className="rounded-2xl bg-gradient-to-r from-primary-400 to-primary-500 py-4 text-sm font-bold text-white shadow-lg shadow-primary-500/20 hover:from-primary-300 hover:to-primary-400 active:scale-[0.98] transition-all disabled:opacity-30"
              >
                {saving ? "保存中..." : "💾 保存する"}
              </button>
              <button
                type="button"
                onClick={() => { setReport(null); setTranscript(""); setSource(""); setWarning(null); setError(null); setPhotos([]); }}
                className="rounded-2xl border border-slate-200 bg-white py-4 text-sm font-bold text-slate-600 hover:bg-slate-50 active:scale-[0.98] transition-all shadow-sm"
              >
                🔄 やり直す
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = report ?? { ...emptyReport(transcript), photos };
                  printReport(r, authorName, new Date().toISOString());
                }}
                disabled={!transcript.trim()}
                className="rounded-2xl border border-blue-200 bg-blue-50 py-4 text-sm font-bold text-blue-600 hover:bg-blue-100 active:scale-[0.98] transition-all disabled:opacity-30"
              >
                印刷する
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = report ?? { ...emptyReport(transcript), photos };
                  downloadPdf(r, authorName, new Date().toISOString());
                }}
                disabled={!transcript.trim()}
                className="rounded-2xl border border-rose-200 bg-rose-50 py-4 text-sm font-bold text-rose-600 hover:bg-rose-100 active:scale-[0.98] transition-all disabled:opacity-30"
              >
                📄 PDF出力
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = report ?? { ...emptyReport(transcript), photos };
                  const name = prompt("テンプレート名を入力してください", r.site_name || "テンプレート");
                  if (!name) return;
                  const newTemplate: Template = {
                    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
                    name,
                    site_name: r.site_name || "",
                    materials: r.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
                    work_items: r.work_items.map((w) => ({ description: w.description })),
                    created_at: new Date().toISOString(),
                  };
                  const next = [newTemplate, ...templates].slice(0, 20);
                  setTemplates(next);
                  saveTemplatesToDisk(next);
                }}
                disabled={!transcript.trim()}
                className="rounded-2xl border border-emerald-200 bg-emerald-50 py-4 text-sm font-bold text-emerald-600 hover:bg-emerald-100 active:scale-[0.98] transition-all disabled:opacity-30"
              >
                📋 テンプレート保存
              </button>
            </div>
          </section>

          {/* --- 構造化結果の編集フィールド（reportがある時のみ表示） --- */}
          {report && (
            <section className="space-y-4 animate-in fade-in zoom-in-95 duration-300 pb-10">
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="現場名" value={report.site_name} onChange={(v) => updateReport({ site_name: v })} />
                  <Field label="天気" value={`${report.weather ?? ""}${report.temperature_c ? ` (${report.temperature_c}℃)` : ""}`} onChange={(v) => updateReport({ weather: v as any })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">人員数</label>
                  <input
                    type="number"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary-400/50 transition-all"
                    value={report.labor_count ?? ""}
                    placeholder="例：5"
                    onChange={(e) => updateReport({ labor_count: e.target.value ? parseInt(e.target.value) : null })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">使用材料</label>
                  {report.materials.map((m, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                      <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary-400/50 transition-all col-span-2" value={m.name} onChange={(e) => {
                        const next = [...report.materials];
                        next[i] = { ...m, name: e.target.value };
                        updateReport({ materials: next });
                      }} placeholder="材料名" />
                      <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary-400/50 transition-all" value={m.quantity ? `${m.quantity}${m.unit ?? ""}` : ""} onChange={(e) => {
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
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    + 材料を追加
                  </button>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">主要な作業内容</label>
                  {report.work_items.map((w, i) => (
                    <div key={i} className="mb-2 glass-card rounded-2xl p-3">
                      <textarea className="w-full bg-transparent text-sm text-slate-600 outline-none resize-none" value={w.description} onChange={(e) => {
                        const next = [...report.work_items];
                        next[i] = { ...w, description: e.target.value };
                        updateReport({ work_items: next });
                      }} rows={2} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">備考</label>
                  <textarea
                    className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700 outline-none focus:border-primary-400/50 transition-all resize-none"
                    rows={3}
                    value={report.remarks ?? ""}
                    placeholder="特記事項があれば入力"
                    onChange={(e) => updateReport({ remarks: e.target.value || null })}
                  />
                </div>
                {report.photos && report.photos.length > 0 && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">現場写真</label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {report.photos.map((p: any) => (
                        <div key={p.id} className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-white hover:border-primary-400/30 transition-all group">
                          <img src={p.storage_url || p.data_url} alt="現場写真" className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform duration-300" onClick={() => window.open(p.storage_url || p.data_url, "_blank")} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {source && (
                  <div className="flex items-center gap-2">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      source === "gemini"
                        ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                        : "bg-slate-100 text-slate-500 border border-slate-200"
                    }`}>
                      {source === "gemini" ? "✨ Gemini AI" : "⚙️ ヒューリスティック"}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      ) : tab === "history" ? (
        <section className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="glass-card rounded-3xl p-5 space-y-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">絞り込みと出力</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">開始日</label>
                <input type="date" className="w-full bg-white border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-700 outline-none focus:border-primary-400/50 transition-all" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">終了日</label>
                <input type="date" className="w-full bg-white border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-700 outline-none focus:border-primary-400/50 transition-all" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">報告者フィルター</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary-400/50 transition-all"
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
              <label className="text-[10px] text-slate-400 block mb-1">キーワード検索 (現場名・作業員・内容)</label>
              <input type="text" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary-400/50 transition-all" placeholder="キーワードを入力..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button onClick={downloadRangeCsv} className="w-full bg-gradient-to-r from-primary-400 to-primary-500 text-white py-3 rounded-2xl text-sm font-bold shadow-lg shadow-primary-500/20 hover:from-primary-300 hover:to-primary-400 active:scale-[0.98] transition-all">表示中のデータをCSV出力</button>
              <button onClick={downloadBackup} className="w-full border border-slate-200 text-slate-500 py-3 rounded-2xl text-sm font-bold hover:bg-slate-100 active:scale-[0.98] transition-all">全データをJSONバックアップ</button>
            </div>
          </div>

          {/* 表示切替：一覧 / カレンダー */}
          <div className="flex gap-1 p-1 rounded-xl border border-slate-200 bg-slate-100 self-start">
            <button
              onClick={() => setHistoryViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${historyViewMode === "list" ? "bg-primary-400/20 text-primary-300" : "text-slate-500 hover:text-slate-600"}`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
              一覧
            </button>
            <button
              onClick={() => setHistoryViewMode("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${historyViewMode === "calendar" ? "bg-primary-400/20 text-primary-300" : "text-slate-500 hover:text-slate-600"}`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              カレンダー
            </button>
          </div>

          {siteProgress ? (
            /* ===== 現場進捗タイムライン ===== */
            <div className="space-y-4 animate-in fade-in duration-500">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">現場進捗 タイムライン</h2>
                  <h3 className="text-lg font-bold gradient-text-primary mt-1">{siteProgress}</h3>
                </div>
                <button
                  onClick={() => setSiteProgress(null)}
                  className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all"
                >
                  ← 一覧に戻る
                </button>
              </div>

              {(() => {
                const siteReports = filteredHistory
                  .filter((h) => h.payload?.site_name === siteProgress)
                  .sort((a, b) => a.report_date.localeCompare(b.report_date));
                if (siteReports.length === 0) {
                  return <p className="text-center py-10 text-slate-400 text-sm">該当する日報はありません</p>;
                }
                const totalLabor = siteReports.reduce((s, h) => s + (h.payload?.labor_count ?? 0), 0);
                const dateRange = siteReports.length === 1
                  ? siteReports[0].report_date
                  : `${siteReports[0].report_date} 〜 ${siteReports[siteReports.length - 1].report_date}`;
                const uniqueAuthors = new Set(siteReports.map((h) => h.author_name).filter(Boolean)).size;
                return (
                  <>
                    {/* サマリー */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="glass-card rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">報告件数</p>
                        <p className="text-2xl font-bold text-slate-700">{siteReports.length}</p>
                      </div>
                      <div className="glass-card rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">期間</p>
                        <p className="text-xs font-bold text-slate-700 leading-tight">{dateRange}</p>
                      </div>
                      <div className="glass-card rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">報告者</p>
                        <p className="text-2xl font-bold text-slate-700">{uniqueAuthors}人</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">延べ人員: {totalLabor}人 / 平均: {siteReports.length > 0 ? Math.round(totalLabor / siteReports.length) : 0}人/日</p>

                    {/* タイムライン */}
                    <div className="relative space-y-0">
                      {siteReports.map((h, idx) => {
                        const prevDate = idx > 0 ? siteReports[idx - 1].report_date : null;
                        const showDateSeparator = !prevDate || prevDate !== h.report_date;
                        return (
                          <div key={h.id} className="relative flex gap-4 pb-6">
                            {/* タイムライン線 */}
                            <div className="flex flex-col items-center">
                              <div className="w-3 h-3 rounded-full bg-primary-400/60 border-2 border-primary-400 z-10 shrink-0" />
                              {idx < siteReports.length - 1 && (
                                <div className="w-0.5 flex-1 bg-gradient-to-b from-primary-400/40 to-transparent mt-1" />
                              )}
                            </div>
                            {/* カード */}
                            <div className="flex-1 glass-card rounded-2xl p-4 hover:bg-white/[0.03] transition-all">
                              <div className="flex justify-between items-start mb-1">
                                <div>
                                  {showDateSeparator && (
                                    <span className="text-[10px] font-bold text-primary-400/80">{h.report_date}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold text-slate-400">{h.author_name}</span>
                                  <button
                                    onClick={() => setSelectedHistory(h)}
                                    className="text-[10px] text-blue-400/60 hover:text-blue-400 transition-colors"
                                  >
                                    詳細
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                                {h.payload?.weather && `☁️ ${h.payload.weather}`}
                                {h.payload?.labor_count != null && ` 👤${h.payload.labor_count}人`}
                              </p>
                              {h.payload?.work_items?.[0]?.description && (
                                <p className="text-xs text-slate-400 mt-1 line-clamp-2">{h.payload.work_items[0].description}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          ) : historyViewMode === "list" ? (
            /* ===== 一覧表示 ===== */
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">
                履歴一覧 ({filteredHistory.length}件)
                {history.length !== filteredHistory.length && (
                  <span className="text-slate-400 font-normal"> / 全{history.length}件</span>
                )}
              </h2>
              {filteredHistory.length > 0 ? (
                filteredHistory.map((h) => (
                  <div key={h.id} className="relative glass-card rounded-2xl p-4 pl-5 hover:bg-white/[0.03] transition-all group overflow-hidden">
                    {/* アクセントバー */}
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary-400 to-primary-600 rounded-full opacity-60 group-hover:opacity-100 transition-opacity" />
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[10px] font-bold text-primary-400/80">{h.report_date}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400">{formatSavedAt(h.saved_at)}</span>
                        <button
                          onClick={() => deleteReport(h.id)}
                          className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 mb-1">{h.author_name}</p>
                    <button
                      onClick={() => setSelectedHistory(h)}
                      className="w-full text-left"
                    >
                      <h3 className="text-sm font-bold text-slate-600">{h.payload?.site_name || "現場名なし"}</h3>
                      <p className="text-xs text-slate-400 line-clamp-1">{h.payload?.work_items?.[0]?.description || "内容なし"}</p>
                    </button>
                    {h.payload?.site_name && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSiteProgress(h.payload!.site_name!);
                        }}
                        className="mt-2 text-[10px] font-bold text-primary-400/60 hover:text-primary-400 transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        この現場の全履歴を見る
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-center py-10 text-slate-400 text-sm">該当する日報はありません</p>
              )}
            </div>
          ) : (
            /* ===== カレンダー表示 ===== */
            <div className="glass-card rounded-3xl p-4 space-y-3">
              {/* 月移動 */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => calendarNav(-1)}
                  className="px-3 py-1.5 rounded-xl bg-white text-slate-500 hover:bg-slate-50 transition-all text-xs font-bold border border-slate-200"
                >
                  ◀
                </button>
                <h3 className="text-sm font-bold text-slate-700">
                  {calendarDate.getFullYear()}年{calendarDate.getMonth() + 1}月
                </h3>
                <button
                  onClick={() => calendarNav(1)}
                  className="px-3 py-1.5 rounded-xl bg-white text-slate-500 hover:bg-slate-50 transition-all text-xs font-bold border border-slate-200"
                >
                  ▶
                </button>
              </div>

              {/* 曜日ヘッダー */}
              <div className="grid grid-cols-7 gap-1 text-center">
                {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
                  <div key={i} className={`text-[10px] font-bold py-1 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-400"}`}>
                    {d}
                  </div>
                ))}
              </div>

              {/* 日付グリッド */}
              <div className="grid grid-cols-7 gap-1">
                {buildCalendarGrid().map((cell, i) =>
                  cell ? (
                    <button
                      key={i}
                      onClick={() => {
                        const dateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
                        setStartDate(dateStr);
                        setEndDate(dateStr);
                        setHistoryViewMode("list");
                      }}
                      className={`aspect-square rounded-xl flex flex-col items-center justify-center text-xs font-bold transition-all
                        ${cell.reports.length > 0
                          ? "bg-primary-400/10 border border-primary-400/30 text-primary-300 hover:bg-primary-400/20"
                          : "bg-white border border-slate-200/50 text-slate-400 hover:bg-slate-50"
                        }`}
                    >
                      <span>{cell.day}</span>
                      {cell.reports.length > 0 && (
                        <span className="text-[8px] mt-0.5 text-primary-400/80">{cell.reports.length}件</span>
                      )}
                    </button>
                  ) : (
                    <div key={i} className="aspect-square" />
                  ),
                )}
              </div>
            </div>
          )}
        </section>
      ) : tab === "gallery" ? (
        /* ===== 写真ギャラリー ===== */
        <section className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              写真ギャラリー
              <span className="ml-2 text-slate-400 font-normal">({allGalleryPhotos.length}枚)</span>
            </h2>
            <div className="flex gap-1 p-1 rounded-xl border border-slate-200 bg-slate-100">
              <button
                onClick={() => setGalleryGroupBy("site")}
                className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-all ${galleryGroupBy === "site" ? "bg-primary-400/20 text-primary-300" : "text-slate-500 hover:text-slate-600"}`}
              >
                現場別
              </button>
              <button
                onClick={() => setGalleryGroupBy("date")}
                className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-all ${galleryGroupBy === "date" ? "bg-primary-400/20 text-primary-300" : "text-slate-500 hover:text-slate-600"}`}
              >
                日付別
              </button>
            </div>
          </div>

          {allGalleryPhotos.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <p className="text-4xl mb-3">📷</p>
              <p className="text-sm">写真が添付された日報がまだありません</p>
            </div>
          )}

          {galleryGroupBy === "site"
            ? Array.from(galleryBySite.entries()).map(([site, items]) => (
                <div key={site} className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-primary-300 px-1"><span className="accent-bar-primary inline-block w-1 h-4 rounded-full" />{site}（{items.length}枚）</h3>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {items.map(({ photo, report }) => (
                      <button
                        key={photo.id}
                        onClick={() => setLightboxPhoto({ photo, report })}
                        className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-white hover:border-primary-400/50 transition-all group"
                      >
                        <img src={photo.storage_url || photo.data_url} alt={photo.caption || "現場写真"} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            : Array.from(galleryByDate.entries()).map(([date, items]) => (
                <div key={date} className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-primary-300 px-1"><span className="accent-bar-primary inline-block w-1 h-4 rounded-full" />{date}（{items.length}枚）</h3>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {items.map(({ photo, report }) => (
                      <button
                        key={photo.id}
                        onClick={() => setLightboxPhoto({ photo, report })}
                        className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-white hover:border-primary-400/50 transition-all group"
                      >
                        <img src={photo.storage_url || photo.data_url} alt={photo.caption || "現場写真"} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}

          {/* ローディング */}
          {loadingHistory && history.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-sm">読み込み中...</div>
          )}
        </section>
      ) : (
        /* ===== ダッシュボード ===== */
        <section className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            ダッシュボード
            <span className="ml-2 text-slate-400 font-normal">（{startDate} 〜 {endDate}）</span>
          </h2>

          {/* 統計カード */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">報告件数</p>
              <p className="text-2xl font-bold text-slate-700">{dashboardStats.totalReports}</p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">現場数</p>
              <p className="text-2xl font-bold text-slate-700">{dashboardStats.uniqueSites}</p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">報告者数</p>
              <p className="text-2xl font-bold text-slate-700">{dashboardStats.uniqueAuthors}</p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">延べ人員</p>
              <p className="text-2xl font-bold text-slate-700">{dashboardStats.totalLabor}</p>
            </div>
          </div>

          {/* 天気内訳（PieChart） */}
          {chartWeatherData.length > 0 && (
            <div className="glass-card rounded-3xl p-5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">天気内訳</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={chartWeatherData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                    {chartWeatherData.map((entry, i) => (
                      <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px", fontSize: "12px" }}
                    formatter={(value: any, name: any) => [`${value}件`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                {chartWeatherData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    {d.name}（{d.value}件）
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 現場別ランキング（BarChart） */}
          {chartSiteData.length > 0 && (
            <div className="glass-card rounded-3xl p-5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">現場別 報告数 TOP5</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartSiteData} layout="vertical" margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={90} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px", fontSize: "12px" }}
                    formatter={(value: any) => [`${value}件`, "報告数"]}
                  />
                  <Bar dataKey="報告数" radius={[0, 6, 6, 0]}>
                    {chartSiteData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 日別報告数（LineChart） */}
          {chartDailyData.length > 0 && (
            <div className="glass-card rounded-3xl p-5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">日別 報告数推移</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartDailyData} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                  <defs>
                    <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px", fontSize: "12px" }}
                    formatter={(value: any) => [`${value}件`, "報告数"]}
                  />
                  <Line type="monotone" dataKey="報告数" stroke="#60a5fa" strokeWidth={2.5} dot={{ fill: "#60a5fa", r: 3, stroke: "#60a5fa" }} activeDot={{ r: 6, fill: "#60a5fa" }} />
                  <Area type="monotone" dataKey="報告数" fill="url(#lineGradient)" stroke="none" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ローディング */}
          {loadingHistory && history.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-sm">読み込み中...</div>
          )}
        </section>
      )}

      {/* ライトボックス（写真拡大表示） */}
      {lightboxPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setLightboxPhoto(null)}></div>
          <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute -top-10 right-0 text-white/60 hover:text-white transition-colors text-sm font-bold"
            >
              ✕ 閉じる
            </button>
            <img
              src={lightboxPhoto.photo.data_url}
              alt={lightboxPhoto.photo.caption || "現場写真"}
              className="w-full max-h-[70vh] object-contain rounded-2xl border border-slate-200"
            />
            <div className="mt-3 text-center">
              {lightboxPhoto.photo.caption && (
                <p className="text-sm text-white font-bold">{lightboxPhoto.photo.caption}</p>
              )}
              <p className="text-[10px] text-slate-400 mt-1">
                {lightboxPhoto.report.payload?.site_name && `${lightboxPhoto.report.payload.site_name} / `}
                {lightboxPhoto.report.report_date} / {lightboxPhoto.report.author_name}
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedHistory && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedHistory(null)}></div>
          <div className="relative w-full max-w-md max-h-[80vh] overflow-hidden glass-card rounded-3xl flex flex-col sm:max-w-2xl">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold gradient-text-primary uppercase">{selectedHistory.report_date}</p>
                <h3 className="text-lg font-bold text-slate-700">{selectedHistory.payload?.site_name || "現場名なし"}</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{selectedHistory.author_name}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{formatSavedAt(selectedHistory.saved_at) || "—"}</p>
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
                <button
                  onClick={() => {
                    if (selectedHistory.payload) {
                      downloadPdf(selectedHistory.payload, selectedHistory.author_name, selectedHistory.saved_at);
                    }
                  }}
                  className="p-2 rounded-xl bg-rose-900/30 text-rose-400 hover:bg-rose-800/40 transition-all text-xs font-bold"
                  title="PDF出力"
                >
                  📄
                </button>
                {selectedHistory.payload?.site_name && (
                  <button
                    onClick={() => {
                      const site = selectedHistory.payload!.site_name!;
                      setSelectedHistory(null);
                      setSiteProgress(site);
                    }}
                    className="text-[10px] font-bold text-primary-400/60 hover:text-primary-400 transition-colors"
                  >
                    現場履歴
                  </button>
                )}
                <button onClick={() => setSelectedHistory(null)} className="p-2 rounded-xl bg-white text-slate-500 hover:bg-slate-50 transition-all border border-slate-200">閉じる</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="glass-card rounded-2xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">天気</p>
                  <p className="text-sm font-bold text-slate-600">
                    {selectedHistory.payload?.weather ?? "—"}
                    {selectedHistory.payload?.temperature_c != null ? ` (${selectedHistory.payload.temperature_c}℃)` : ""}
                  </p>
                </div>
                <div className="glass-card rounded-2xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">人員数</p>
                  <p className="text-sm font-bold text-slate-600">{selectedHistory.payload?.labor_count ?? "—"}</p>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">備考</p>
                <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">{selectedHistory.payload?.remarks || "—"}</div>
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">作業内容</p>
                {selectedHistory.payload?.work_items?.length ? (
                  selectedHistory.payload.work_items.map((w: any, i: number) => (
                    <div key={i} className="text-sm text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200 mb-2">{w.description}</div>
                  ))
                ) : (
                  <div className="text-sm text-slate-400 bg-slate-50 p-3 rounded-xl border border-slate-200">—</div>
                )}
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">使用材料</p>
                {selectedHistory.payload?.materials?.length ? (
                  <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    {selectedHistory.payload.materials
                      .map((m: any) => `${m.name}${m.quantity != null ? ` ${m.quantity}` : ""}${m.unit ?? ""}`)
                      .join(" / ")}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 bg-slate-50 p-3 rounded-xl border border-slate-200">—</div>
                )}
              </div>

              {/* 写真表示（履歴詳細） */}
              {selectedHistory.payload?.photos && selectedHistory.payload.photos.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">現場写真</p>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedHistory.payload.photos.map((p: any) => (
                      <div key={p.id} className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-white hover:border-primary-400/30 transition-all group">
                        <img src={p.storage_url || p.data_url} alt="現場写真" className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform duration-300" onClick={() => window.open(p.storage_url || p.data_url, "_blank")} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">元メッセージ</p>
                <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200 whitespace-pre-wrap">{selectedHistory.payload?.transcript_raw || "—"}</div>
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

    </main>
  );
}

function reportToFormattedText(report: DailyReport): string {
  const lines: string[] = [];
  if (report.site_name) lines.push(`現場名：${report.site_name}`);
  const weatherStr = report.weather
    ? `${report.weather}${report.temperature_c != null ? ` (${report.temperature_c}℃)` : ""}`
    : "";
  if (weatherStr) lines.push(`天気：${weatherStr}`);
  if (report.work_items.length > 0) {
    lines.push("作業内容：");
    report.work_items.forEach((w) => lines.push(`・${w.description}`));
  }
  if (report.materials.length > 0) {
    const mats = report.materials
      .filter((m) => m.name)
      .map((m) => `${m.name}${m.quantity != null ? ` ${m.quantity}` : ""}${m.unit ?? ""}`);
    if (mats.length) lines.push(`材料：${mats.join(" / ")}`);
  }
  if (report.labor_count != null) lines.push(`人員：${report.labor_count}名`);
  if (report.remarks) lines.push(`備考：${report.remarks}`);
  return lines.join("\n");
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</label>
      <input className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary-400/50 transition-all" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
