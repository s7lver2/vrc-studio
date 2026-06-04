import { useState, useEffect, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  X, FolderOpen, Link, User, Package, Loader2,
  CheckCircle, AlertTriangle, Users, Layers, Plus,
  Upload, Store, ChevronRight, ChevronLeft, Image,
  Tag, Trash2, Search,
} from "lucide-react";
import { useInventoryStore } from "../../store/inventoryStore";
import {
  tauriGetBoothProductDetail,
  BoothProductDetail,
  tauriCheckDuplicateItems,
  tauriDeleteInventoryItem,
  tauriListZipContents,
  tauriImportMultiAvatarPackage,
} from "../../lib/tauri";
import { useT } from "../../i18n";
import { TagInput } from "./TagInput";
import { GlobalBoothPickerModal, BoothPickerResult } from "@/components/shared/GlobalBoothPickerModal";

// ── Known VRChat avatar bases ─────────────────────────────────────────────────
const KNOWN_VRCHAT_BASES = [
  "Airi", "Karin", "Kikyo", "Manuka", "Lime", "Chiffon",
  "Selestia", "Shinano", "Moe", "Milltina", "Kumaly", "Chocolat",
  "Imeris", "Rindo", "Sio", "Yuki", "Kokoa", "Yuuka", "Toufu",
  "Torino", "Canna", "Matsuha", "Anon", "Lune", "Aria", "Shina",
  "Lilia", "Rein", "Nayu", "Miiko", "Hiyori", "Sol", "Nyamyamko",
  "Chise", "Ukon", "Hakka", "Velle", "Quiche", "Maru", "Niaou",
  "Mochi", "Satsuki", "Mutsuki", "Kohane", "Almond", "Rainy",
  "Rue", "Nia", "Chloe", "Toto", "Ash", "Natsuki", "Erina",
  "Lily", "Luna", "Iris", "Eve", "Momo", "Nana", "Akko", "Hana",
  "Saki", "Yuri", "Koko", "Rem", "Ai", "Ao", "Miku", "Riku",
  "Atlas", "Coco", "Koyuki", "Shiori", "Ichika", "Hinata",
  "Haruka", "Kotori", "Sayaka", "Minori", "Nozomi", "Honoka",
  "Rin", "Maki", "Hanayo", "Nico", "Umi", "Eli",
].sort((a, b) => b.length - a.length);

// ── Detection helpers ─────────────────────────────────────────────────────────
export interface DetectedVariant {
  filename: string;
  avatarName: string;
  isMaterials: boolean;
}

export interface DetectionResult {
  productName: string;
  variants: DetectedVariant[];
}

export function detectAvatarVariants(filename: string): DetectionResult | null {
  const base = filename.replace(/\.(zip|unitypackage)$/i, "");

  const matMatch = base.match(/^_{3,}Materials_{3,}(.+?)(?:_v[\d.]+)?$/i);
  if (matMatch) {
    return {
      productName: matMatch[1],
      variants: [{ filename, avatarName: "Materials", isMaterials: true }],
    };
  }

  const parts = base.split("_");
  if (parts.length < 2) return null;

  const lastIsVersion = /^v[\d.]+$/i.test(parts[parts.length - 1]);
  const coreParts = lastIsVersion ? parts.slice(0, -1) : parts;
  if (coreParts.length < 2) return null;

  for (let i = coreParts.length - 1; i >= 1; i--) {
    const candidate = coreParts[i];
    if (KNOWN_VRCHAT_BASES.some((b) => b.toLowerCase() === candidate.toLowerCase())) {
      const productName = coreParts.slice(0, i).join("_");
      return {
        productName,
        variants: [{ filename, avatarName: candidate, isMaterials: false }],
      };
    }
  }

  return null;
}

// ── Booth ID helper ───────────────────────────────────────────────────────────
function extractBoothId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{5,8}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/booth\.pm\/(?:[a-z]{2}\/)?items\/(\d+)/);
  return m ? m[1] : null;
}

// ── Step indicator ────────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Package",  short: "File & type"   },
  { id: 2, label: "Info",     short: "Name & source" },
  { id: 3, label: "Media",    short: "Cover & tags"  },
];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 px-6 pt-5 pb-4 shrink-0">
      {STEPS.map((step, i) => {
        const done   = step.id < current;
        const active = step.id === current;
        const future = step.id > current;
        return (
          <div key={step.id} className="flex items-center gap-0 flex-1">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`
                h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold
                transition-all duration-300 border
                ${done   ? "bg-red-600 border-red-600 text-white" : ""}
                ${active ? "bg-zinc-950 border-red-500 text-red-400 ring-2 ring-red-500/30" : ""}
                ${future ? "bg-zinc-900 border-zinc-700 text-zinc-600" : ""}
              `}>
                {done ? <CheckCircle className="h-3.5 w-3.5" /> : step.id}
              </div>
              <span className={`text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
                active ? "text-red-400" : done ? "text-zinc-500" : "text-zinc-700"
              }`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 mb-4 transition-colors duration-300 ${
                done ? "bg-red-700/60" : "bg-zinc-800"
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">
      {children}
    </p>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="text-zinc-700 font-normal normal-case tracking-normal ml-1">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-zinc-600 text-sm text-zinc-200 placeholder-zinc-700 outline-none transition-colors w-full";

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
  onImported?: (itemId: string) => void;
  preselectedFile?: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ImportLocalDialog({ onClose, onImported, preselectedFile }: Props) {
  const t = useT();
  const { importLocalPackage } = useInventoryStore();

  // ── Wizard step ───────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── Step 1: Package ───────────────────────────────────────────────────────
  const [importMode, setImportMode] = useState<"single" | "multi">("single");
  const [zipPath, setZipPath]       = useState(preselectedFile ?? "");
  const [detection, setDetection]   = useState<DetectionResult | null>(null);
  const [zipEntries, setZipEntries] = useState<string[]>([]);
  const [variantRows, setVariantRows] = useState<Array<{ label: string; subZipName: string; isMaterials: boolean }>>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // ── Step 2: Info ──────────────────────────────────────────────────────────
  const [boothInput, setBoothInput]       = useState("");
  const [boothDetail, setBoothDetail]     = useState<BoothProductDetail | null>(null);
  const [fetchingBooth, setFetchingBooth] = useState(false);
  const [boothError, setBoothError]       = useState<string | null>(null);
  const [showBoothPicker, setShowBoothPicker] = useState(false);
  const [name, setName]     = useState("");
  const [author, setAuthor] = useState("");
  const [tags, setTags]     = useState<string[]>([]);

  // ── Step 3: Media ─────────────────────────────────────────────────────────
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [detailImages, setDetailImages] = useState<string[]>([]);

  // ── Import ────────────────────────────────────────────────────────────────
  const [importing, setImporting]       = useState(false);
  const [importError, setImportError]   = useState<string | null>(null);
  const [importedId, setImportedId]     = useState<string | null>(null);
  const [duplicateCheck, setDuplicateCheck] = useState<{ exists: boolean; existing_item_ids: string[] } | null>(null);

  // ── Preselected file ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!preselectedFile) return;
    const filename = preselectedFile.split(/[/\\]/).pop() ?? "";
    const baseName = filename.replace(/\.(zip|unitypackage)$/i, "");
    const detected = detectAvatarVariants(filename);
    setDetection(detected);
    if (!name) setName(detected ? detected.productName : baseName);
  }, [preselectedFile]);

  // ── Auto-fetch Booth info ─────────────────────────────────────────────────
  useEffect(() => {
    const boothId = extractBoothId(boothInput);
    if (!boothId) return;
    const timer = setTimeout(async () => {
      setFetchingBooth(true);
      try {
        const detail = await tauriGetBoothProductDetail(boothId);
        if (!name) setName(detail.name);
        if (!author) setAuthor(detail.author);
        if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
        setBoothDetail(detail);
        setDetailImages(detail.images ?? []);
        setBoothError(null);
      } catch {
        // silent
      } finally {
        setFetchingBooth(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [boothInput]);

  // ── Scan zip for sub-entries (multi mode) ─────────────────────────────────
  const scanZip = useCallback(async (path: string) => {
    setLoadingEntries(true);
    try {
      const entries = await tauriListZipContents(path);
      setZipEntries(entries);
      const autoRows = entries.map((fn) => {
        const det = detectAvatarVariants(fn);
        return {
          label: det?.variants[0]?.avatarName ?? fn,
          subZipName: fn,
          isMaterials: det?.variants[0]?.isMaterials ?? false,
        };
      });
      setVariantRows(autoRows);
    } catch {
      setZipEntries([]);
      setVariantRows([]);
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  // ── File picker ───────────────────────────────────────────────────────────
  const pickFile = async () => {
    try {
      const result = await openDialog({
        multiple: false,
        filters: [
          { name: "ZIP Archive", extensions: ["zip"] },
          { name: "Unity Package", extensions: ["unitypackage"] },
          { name: "All Supported", extensions: ["zip", "unitypackage"] },
        ],
        title: t("import_title"),
      });
      if (!result || typeof result !== "string") return;

      setZipPath(result);
      const filename = result.split(/[/\\]/).pop() ?? "";
      const baseName = filename.replace(/\.(zip|unitypackage)$/i, "");
      const detected = detectAvatarVariants(filename);
      setDetection(detected);
      if (!name) setName(detected ? detected.productName : baseName);

      if (importMode === "multi") await scanZip(result);
    } catch (e) {
      console.warn("File picker error:", e);
    }
  };

  const handleModeChange = async (mode: "single" | "multi") => {
    setImportMode(mode);
    if (mode === "multi" && zipPath && zipEntries.length === 0) {
      await scanZip(zipPath);
    }
  };

  // ── Booth ─────────────────────────────────────────────────────────────────
  const handleBoothPick = async (result: BoothPickerResult) => {
    setBoothInput(`https://booth.pm/items/${result.boothId}`);
    if (!name)   setName(result.name);
    if (!author) setAuthor(result.author);
    if (!thumbnailUrl && result.thumbnailUrl) setThumbnailUrl(result.thumbnailUrl);
    try {
      const detail = await tauriGetBoothProductDetail(result.boothId);
      setBoothDetail(detail);
      setDetailImages(detail.images ?? []);
      if (!name)   setName(detail.name);
      if (!author) setAuthor(detail.author);
      if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
    } catch { /* ignore */ }
  };

  const lookupBooth = async () => {
    const boothId = extractBoothId(boothInput);
    if (!boothId) { setBoothError("URL o ID de Booth.pm inválido"); return; }
    setFetchingBooth(true);
    setBoothError(null);
    setBoothDetail(null);
    try {
      const detail = await tauriGetBoothProductDetail(boothId);
      setBoothDetail(detail);
      setDetailImages(detail.images ?? []);
      if (!name)   setName(detail.name);
      if (!author) setAuthor(detail.author);
      if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
    } catch (e) {
      setBoothError(`No se pudo obtener el producto: ${e}`);
    } finally {
      setFetchingBooth(false);
    }
  };

  // ── Thumbnail ─────────────────────────────────────────────────────────────
  const pickLocalThumbnail = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof selected === "string") {
      try {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        setThumbnailUrl(convertFileSrc(selected));
      } catch {
        setThumbnailUrl(selected);
      }
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = async (overwrite = false) => {
    if (!zipPath || !name.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const boothId = extractBoothId(boothInput) ?? undefined;
      const newId = await importLocalPackage({
        zip_path: zipPath,
        name: name.trim(),
        author: author.trim() || undefined,
        thumbnail_url: thumbnailUrl.trim() || boothDetail?.images[0] || undefined,
        booth_id: boothId,
        product_images: detailImages,
        overwrite,
      });
      setImportedId(newId);
      onImported?.(newId);
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleOverwrite = async () => {
    setImporting(true);
    setDuplicateCheck(null);
    try {
      if (duplicateCheck?.existing_item_ids) {
        await Promise.all(
          duplicateCheck.existing_item_ids.map((id) =>
            tauriDeleteInventoryItem(id, "InventoryOnly")
          )
        );
      }
      await handleImport(true);
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleImportClick = async () => {
    if (!zipPath || !name.trim()) return;
    setImportError(null);
    setDuplicateCheck(null);
    setImporting(true);
    try {
      if (importMode === "multi") {
        if (variantRows.length === 0) {
          setImportError("Add at least one variant before importing.");
          setImporting(false);
          return;
        }
        const newId = await tauriImportMultiAvatarPackage({
          zip_path: zipPath,
          name: name.trim(),
          author: author.trim() || undefined,
          thumbnail_url: thumbnailUrl.trim() || boothDetail?.images[0] || undefined,
          booth_id: extractBoothId(boothInput) ?? undefined,
          product_images: detailImages,
          variants: variantRows.map((r) => ({
            label: r.label || r.subZipName,
            is_materials: r.isMaterials,
            sub_zip_name: r.subZipName,
          })),
        });
        await useInventoryStore.getState().fetchAll();
        setImportedId(newId);
        onImported?.(newId);
        return;
      }

      const result = await tauriCheckDuplicateItems(name.trim(), zipPath);
      if (result.exists) {
        setDuplicateCheck(result);
        setImporting(false);
      } else {
        await handleImport(false);
      }
    } catch (e) {
      setImportError(String(e));
      setImporting(false);
    }
  };

  // ── Step validation ───────────────────────────────────────────────────────
  const canAdvanceStep1 = zipPath.trim() !== "" &&
    (importMode === "single" || variantRows.length > 0);
  const canAdvanceStep2 = name.trim() !== "";
  const canImport       = zipPath.trim() !== "" && name.trim() !== "" && !importing;

  // ── Done state ────────────────────────────────────────────────────────────
  if (importedId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
        <div className="relative z-10 w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 text-center">
          <div className="h-16 w-16 rounded-full bg-green-950/60 border border-green-800/50 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{t("import_success")}</h3>
            <p className="text-sm text-zinc-500 mt-1">
              <span className="text-zinc-300 font-medium">{name}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Duplicate conflict dialog ───────────────────────────────────── */}
      {duplicateCheck?.exists && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-amber-950/60 border border-amber-800/50 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">{t("import_duplicate_title")}</p>
                <p className="text-xs text-zinc-500 mt-1">{t("import_duplicate_desc")}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDuplicateCheck(null)} className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700">
                {t("import_duplicate_cancel")}
              </button>
              <button onClick={() => { setDuplicateCheck(null); handleImport(false); }} className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600">
                {t("import_duplicate_keep")}
              </button>
              <button onClick={handleOverwrite} className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500">
                {t("import_duplicate_overwrite")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main wizard dialog ──────────────────────────────────────────── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />

        <div
          className="relative z-10 w-full max-w-2xl bg-zinc-950 border border-zinc-800/80 rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden"
          style={{ maxHeight: "88vh" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-0 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-red-950/60 border border-red-900/50 flex items-center justify-center">
                <Package className="h-3.5 w-3.5 text-red-400" />
              </div>
              <h2 className="text-sm font-bold text-zinc-100 tracking-tight">{t("import_title")}</h2>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Step bar */}
          <StepBar current={step} />

          {/* Divider */}
          <div className="h-px bg-zinc-800/80 shrink-0" />

          {/* Step content */}
          <div className="flex-1 overflow-y-auto">

            {/* ─────────── STEP 1: PACKAGE ─────────────────────────────── */}
            {step === 1 && (
              <div className="p-6 flex flex-col gap-6">

                {/* Mode picker */}
                <div>
                  <SectionLabel>Import type</SectionLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleModeChange("single")}
                      className={`flex flex-col items-center gap-2 py-4 rounded-xl border text-xs font-semibold transition-all ${
                        importMode === "single"
                          ? "border-red-600/70 bg-red-950/30 text-red-300"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                      }`}
                    >
                      <Package className={`h-5 w-5 ${importMode === "single" ? "text-red-400" : "text-zinc-600"}`} />
                      Single Avatar
                      <span className="text-[10px] font-normal opacity-60">One package, one avatar</span>
                    </button>
                    <button
                      onClick={() => handleModeChange("multi")}
                      className={`flex flex-col items-center gap-2 py-4 rounded-xl border text-xs font-semibold transition-all ${
                        importMode === "multi"
                          ? "border-violet-600/70 bg-violet-950/30 text-violet-300"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                      }`}
                    >
                      <Users className={`h-5 w-5 ${importMode === "multi" ? "text-violet-400" : "text-zinc-600"}`} />
                      <span className="flex items-center gap-1.5">
                        Multi Avatar
                        <span className="text-[8px] px-1.5 py-px rounded-full bg-violet-900/60 text-violet-300 border border-violet-700/40 font-bold tracking-wide uppercase">BETA</span>
                      </span>
                      <span className="text-[10px] font-normal opacity-60">Zip with multiple variants</span>
                    </button>
                  </div>
                </div>

                {/* File picker */}
                <div>
                  <SectionLabel>Package file *</SectionLabel>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={pickFile}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") pickFile(); }}
                    className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border-2 border-dashed transition-all text-left cursor-pointer ${
                      zipPath
                        ? "border-zinc-700 bg-zinc-900/40 text-zinc-300"
                        : "border-zinc-800 bg-zinc-900/20 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400"
                    }`}
                  >
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                      zipPath ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-600"
                    }`}>
                      <FolderOpen className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {zipPath ? (
                        <>
                          <p className="text-xs font-semibold text-zinc-200 truncate">
                            {zipPath.split(/[/\\]/).pop()}
                          </p>
                          <p className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">{zipPath}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-medium">Browse for .zip or .unitypackage</p>
                          <p className="text-[10px] mt-0.5 opacity-60">Click to open file picker</p>
                        </>
                      )}
                    </div>
                    {zipPath && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setZipPath(""); setZipEntries([]); setVariantRows([]); setDetection(null);
                        }}
                        className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Single: detection badge */}
                {importMode === "single" && detection && zipPath && (
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-950/20 border border-amber-800/30">
                    <Users className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-300 mb-1.5">Avatars detected</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detection.variants.map((v) => (
                          <span key={v.filename} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                            v.isMaterials
                              ? "border-lime-700/50 bg-lime-950/40 text-lime-300"
                              : "border-amber-700/50 bg-amber-950/40 text-amber-200"
                          }`}>
                            {v.isMaterials ? <Layers className="h-2.5 w-2.5" /> : <Users className="h-2.5 w-2.5" />}
                            {v.avatarName}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Multi: variant table */}
                {importMode === "multi" && zipPath && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <SectionLabel>Variants</SectionLabel>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setVariantRows([...variantRows, { label: "", subZipName: zipEntries[0] ?? "", isMaterials: false }])}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-[10px] transition-colors"
                        >
                          <Plus className="h-3 w-3" /> Avatar
                        </button>
                        <button
                          onClick={() => setVariantRows([...variantRows, { label: "Materials", subZipName: zipEntries[0] ?? "", isMaterials: true }])}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-lime-900/30 hover:bg-lime-900/50 border border-lime-700/50 text-lime-300 text-[10px] transition-colors"
                        >
                          <Layers className="h-3 w-3" /> Materials
                        </button>
                      </div>
                    </div>

                    {loadingEntries ? (
                      <div className="flex items-center gap-2 text-xs text-zinc-500 py-3">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning zip contents…
                      </div>
                    ) : variantRows.length === 0 ? (
                      <p className="text-xs text-zinc-700 italic py-2">No variants yet. Add one above or pick a zip first.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                        {variantRows.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-800">
                            <div className={`h-5 w-5 rounded flex items-center justify-center shrink-0 ${
                              row.isMaterials ? "bg-lime-950/60 text-lime-400" : "bg-zinc-800 text-zinc-400"
                            }`}>
                              {row.isMaterials ? <Layers className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                            </div>
                            <input
                              value={row.label}
                              onChange={(e) => {
                                const next = [...variantRows];
                                next[idx] = { ...next[idx], label: e.target.value };
                                setVariantRows(next);
                              }}
                              placeholder="Label"
                              className={`w-28 px-2 py-1 rounded-lg bg-zinc-950 border text-xs outline-none transition-colors ${
                                row.isMaterials
                                  ? "border-lime-800/50 text-lime-300 focus:border-lime-700"
                                  : "border-zinc-700 text-zinc-200 focus:border-zinc-600"
                              }`}
                            />
                            <select
                              value={row.subZipName}
                              onChange={(e) => {
                                const next = [...variantRows];
                                next[idx] = { ...next[idx], subZipName: e.target.value };
                                setVariantRows(next);
                              }}
                              className="flex-1 px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                            >
                              {zipEntries.map((entry) => (
                                <option key={entry} value={entry}>{entry}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => setVariantRows(variantRows.filter((_, i) => i !== idx))}
                              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-zinc-800 text-zinc-700 hover:text-zinc-400 transition-colors shrink-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─────────── STEP 2: INFO ─────────────────────────────────── */}
            {step === 2 && (
              <div className="p-6 flex flex-col gap-5">

                {/* Booth */}
                <div>
                  <SectionLabel>Booth.pm (optional)</SectionLabel>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={boothInput}
                        onChange={(e) => { setBoothInput(e.target.value); setBoothError(null); setBoothDetail(null); }}
                        onKeyDown={(e) => e.key === "Enter" && boothInput && lookupBooth()}
                        placeholder="https://booth.pm/items/1234567"
                        className={inputCls}
                      />
                      {fetchingBooth && (
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400 animate-pulse" />
                      )}
                    </div>
                    <button
                      onClick={() => setShowBoothPicker(true)}
                      title="Buscar en Booth"
                      className="shrink-0 flex items-center px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-pink-400 hover:text-pink-300 transition-colors"
                    >
                      <Store className="h-4 w-4" />
                    </button>
                    <button
                      onClick={lookupBooth}
                      disabled={!boothInput.trim() || fetchingBooth}
                      className="shrink-0 flex items-center px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 border border-zinc-800 text-zinc-300 text-xs transition-colors"
                    >
                      {fetchingBooth ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Fetch"}
                    </button>
                  </div>

                  {boothError && (
                    <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{boothError}
                    </p>
                  )}

                  {boothDetail && (
                    <div className="mt-2 flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-green-900/40">
                      {boothDetail.images[0] && (
                        <img src={boothDetail.images[0]} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-200 truncate">{boothDetail.name}</p>
                        <p className="text-[10px] text-zinc-500">{boothDetail.author} · {boothDetail.price_display}</p>
                      </div>
                      <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
                    </div>
                  )}
                </div>

                {/* Name & Author */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("import_name_label")} required>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Avatar name"
                      className={inputCls}
                    />
                  </Field>
                  <Field label={t("import_author_label")} hint="optional">
                    <input
                      type="text"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      placeholder="Creator name"
                      className={inputCls}
                    />
                  </Field>
                </div>

                {/* Tags */}
                <Field label={t("import_tags_label")} hint="optional">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <TagInput tags={tags} onChange={setTags} placeholder={t("import_add_tag_placeholder")} />
                  </div>
                </Field>

              </div>
            )}

            {/* ─────────── STEP 3: MEDIA ───────────────────────────────── */}
            {step === 3 && (
              <div className="p-6 flex flex-col gap-5">

                {/* Thumbnail */}
                <div>
                  <SectionLabel>Cover image</SectionLabel>
                  <div className="flex gap-4 items-start">
                    <div className="shrink-0 h-24 w-24 rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden flex items-center justify-center">
                      {thumbnailUrl ? (
                        <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Image className="h-7 w-7 text-zinc-700" />
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                      <input
                        type="text"
                        value={thumbnailUrl}
                        onChange={(e) => setThumbnailUrl(e.target.value)}
                        placeholder="https://… or leave blank"
                        className={inputCls}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={pickLocalThumbnail}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                        >
                          <Upload className="h-3 w-3" /> Local file
                        </button>
                        {thumbnailUrl && (
                          <button
                            onClick={() => setThumbnailUrl("")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-red-900/30 border border-zinc-800 hover:border-red-800/50 text-zinc-600 hover:text-red-400 text-xs transition-colors"
                          >
                            <X className="h-3 w-3" /> Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Gallery from Booth */}
                {detailImages.length > 0 && (
                  <div>
                    <SectionLabel>Gallery — click to use as cover</SectionLabel>
                    <div className="grid grid-cols-6 gap-2">
                      {detailImages.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => setThumbnailUrl(img)}
                          className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            thumbnailUrl === img
                              ? "border-red-500 ring-1 ring-red-500/30 scale-105"
                              : "border-zinc-800 hover:border-zinc-600"
                          }`}
                        >
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error */}
                {importError && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-900/20 border border-red-900/40 text-xs text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    {importError}
                  </div>
                )}

              </div>
            )}
          </div>

          {/* ── Footer navigation ─────────────────────────────────────── */}
          <div className="h-px bg-zinc-800/80 shrink-0" />
          <div className="flex items-center justify-between gap-3 px-6 py-4 shrink-0">

            {step > 1 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-500 text-sm transition-colors"
              >
                {t("import_cancel")}
              </button>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={step === 1 ? !canAdvanceStep1 : step === 2 ? !canAdvanceStep2 : false}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleImportClick}
                disabled={!canImport}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {importing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />{t("import_importing")}</>
                ) : (
                  <><Package className="h-4 w-4" />{t("import_import")}</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Booth picker modal */}
      {showBoothPicker && (
        <GlobalBoothPickerModal
          title="Buscar en Booth"
          subtitle="Selecciona el producto para asociarlo al import"
          onClose={() => setShowBoothPicker(false)}
          onSelect={(result) => { setShowBoothPicker(false); handleBoothPick(result); }}
        />
      )}
    </>
  );
}