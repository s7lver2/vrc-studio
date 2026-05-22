import { useState, useEffect, useMemo } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  X, FolderOpen, Link, User, Package, Loader2,
  CheckCircle, AlertTriangle, Users, Layers, ChevronDown, ChevronUp,
  Search, Store, Tag, Plus, Upload,
} from "lucide-react";
import { useInventoryStore } from "../../store/inventoryStore";
import {
  tauriGetBoothProductDetail,
  BoothProductDetail,
  tauriCheckDuplicateItems,
  tauriDeleteInventoryItem,
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

  // Materials bundle: _____Materials_____ProductName_v1.0
  const matMatch = base.match(/^_{3,}Materials_{3,}(.+?)(?:_v[\d.]+)?$/i);
  if (matMatch) {
    return {
      productName: matMatch[1],
      variants: [{ filename, avatarName: "Materials", isMaterials: true }],
    };
  }

  // Standard: ProductName_AvatarName_vX.X
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

  const [zipPath, setZipPath] = useState(preselectedFile ?? "");
  const [boothInput, setBoothInput] = useState("");
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");

  const [fetchingBooth, setFetchingBooth] = useState(false);
  const [boothDetail, setBoothDetail] = useState<BoothProductDetail | null>(null);
  const [boothError, setBoothError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedId, setImportedId] = useState<string | null>(null);
  const [showBoothPicker, setShowBoothPicker] = useState(false);

  // Avatar detection
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [groupVariants, setGroupVariants] = useState(true);
  const [showVariants, setShowVariants] = useState(false);

  // Duplicate detection
  const [duplicateCheck, setDuplicateCheck] = useState<{ exists: boolean; existing_item_ids: string[] } | null>(null);

  // NEW: tags, avatars, detailImages, autocomplete
  const [tags, setTags] = useState<string[]>([]);
  const [avatars, setAvatars] = useState<string[]>([]);
  const [newAvatar, setNewAvatar] = useState("");
  const [showAvatarSuggestions, setShowAvatarSuggestions] = useState(false);
  const [detailImages, setDetailImages] = useState<string[]>([]);

  // Avatar autocomplete (from existing inventory items)
  const inventoryItems = useInventoryStore((s) => s.items);
  const avatarSuggestions = useMemo(() => {
    if (!newAvatar.trim()) return [];
    const q = newAvatar.toLowerCase();
    return inventoryItems
      .filter((item) =>
        item.tags.some((t) => ["avatar", "base", "vrchat_avatar", "avatar_base", "vrm"].includes(t.toLowerCase()))
        && item.name.toLowerCase().includes(q)
        && !avatars.includes(item.name)
      )
      .slice(0, 8);
  }, [newAvatar, inventoryItems, avatars]);

  // Preselección de archivo externo
  useEffect(() => {
    if (preselectedFile) {
      const filename = preselectedFile.split(/[/\\]/).pop() ?? '';
      const baseName = filename.replace(/\.(zip|unitypackage)$/i, '');
      if (!name) setName(baseName);
      const detected = detectAvatarVariants(filename);
      setDetection(detected);
    }
  }, [preselectedFile]);

  // ── AUTO‑FETCH: Booth info ──────────────────────────────────────────────────
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
      } catch (err) {
        console.warn("[auto-fetch] Booth detail error:", err);
      } finally {
        setFetchingBooth(false);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [boothInput, name, author, thumbnailUrl]);

  // ── File picker ──────────────────────────────────────────────────────────
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
      if (result && typeof result === "string") {
        setZipPath(result);
        const filename = result.split(/[/\\]/).pop() ?? "";
        const baseName = filename.replace(/\.(zip|unitypackage)$/i, "");

        const detected = detectAvatarVariants(filename);
        setDetection(detected);
        if (!name) setName(detected ? detected.productName : baseName);
      }
    } catch (e) {
      console.warn("File picker error:", e);
    }
  };

  // ── Booth lookup manual ──────────────────────────────────────────────────
  const lookupBooth = async () => {
    const boothId = extractBoothId(boothInput);
    if (!boothId) {
      setBoothError("URL o ID de Booth.pm inválido");
      return;
    }
    setFetchingBooth(true);
    setBoothError(null);
    setBoothDetail(null);
    try {
      const detail = await tauriGetBoothProductDetail(boothId);
      setBoothDetail(detail);
      setDetailImages(detail.images ?? []);
      if (!name) setName(detail.name);
      if (!author) setAuthor(detail.author);
      if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
    } catch (e) {
      setBoothError(`No se pudo obtener el producto: ${e}`);
    } finally {
      setFetchingBooth(false);
    }
  };

  // ── Booth picker modal callback ──────────────────────────────────────────
  const handleBoothPick = async (result: BoothPickerResult) => {
    setBoothInput(`https://booth.pm/items/${result.boothId}`);
    if (!name) setName(result.name);
    if (!author) setAuthor(result.author);
    if (!thumbnailUrl && result.thumbnailUrl) setThumbnailUrl(result.thumbnailUrl);
    try {
      const detail = await tauriGetBoothProductDetail(result.boothId);
      setBoothDetail(detail);
      setDetailImages(detail.images ?? []);
      if (!name) setName(detail.name);
      if (!author) setAuthor(detail.author);
      if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
    } catch { /* ignore */ }
  };

  // ── Duplicate check ─────────────────────────────────────────────────────
  const checkDuplicates = async () => {
    if (!name.trim() || !zipPath) return;
    try {
      const result = await tauriCheckDuplicateItems(name.trim(), zipPath);
      setDuplicateCheck(result);
    } catch (e) {
      console.error("Duplicate check failed", e);
      setDuplicateCheck({ exists: false, existing_item_ids: [] });
    }
  };

  // ── Import (normal, overwrite=false) ─────────────────────────────────────
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
        tags: tags.length > 0 ? tags : undefined,
        detected_avatars: avatars.length > 0 ? avatars : undefined,
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

  // ── Overwrite handler ────────────────────────────────────────────────────
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

  const canImport = zipPath.trim() !== "" && name.trim() !== "" && !importing;

  // ── Done state ───────────────────────────────────────────────────────────
  if (importedId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <div className="relative z-10 w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 text-center">
          <CheckCircle className="h-12 w-12 text-green-400" />
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{t("import_success")}</h3>
            <p className="text-sm text-zinc-400 mt-1">
              <span className="text-zinc-200 font-medium">{name}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-2 px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
          >
            {t("import_cancel")}
          </button>
        </div>
      </div>
    );
  }

  const handleImportClick = async () => {
    if (!zipPath || !name.trim()) return;
    setImportError(null);
    setDuplicateCheck(null);
    setImporting(true); // mostramos spinner mientras se verifica

    try {
      const result = await tauriCheckDuplicateItems(name.trim(), zipPath);
      if (result.exists) {
        setDuplicateCheck(result);
        setImporting(false); // detenemos spinner, esperamos decisión del usuario
      } else {
        // No hay duplicados → importar directamente
        await handleImport(false);
      }
    } catch (e) {
      setImportError(String(e));
      setImporting(false);
    }
  };

  // Thumbnail picker local
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

  return (
    <>
      {/* ── Duplicate conflict dialog ────────────────────────────────────────── */}
      {duplicateCheck?.exists && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-zinc-100">{t("import_duplicate_title")}</p>
                <p className="text-xs text-zinc-400 mt-1">
                  {t("import_duplicate_desc")}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDuplicateCheck(null)}
                className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                {t("import_duplicate_cancel")}
              </button>
              <button
                onClick={() => {
                  setDuplicateCheck(null);
                  handleImport(false);
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
              >
                {t("import_duplicate_keep")}
              </button>
              <button
                onClick={handleOverwrite}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                {t("import_duplicate_overwrite")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main import dialog ───────────────────────────────────────────────── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

        <div className="relative z-10 w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-zinc-800">
            <div className="flex items-center gap-2.5">
              <Package className="h-5 w-5 text-red-400" />
              <h2 className="text-base font-semibold text-zinc-100">{t("import_title")}</h2>
            </div>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 flex flex-col gap-5 overflow-y-auto">

            {/* ── File picker ── */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                {t("import_zip_label")} *
              </label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 font-mono truncate min-w-0">
                  {zipPath || <span className="text-zinc-600">{t("import_zip_placeholder")}</span>}
                </div>
                <button
                  onClick={pickFile}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("import_zip_browse")}
                </button>
              </div>
            </div>

            {/* ── Avatar variant detection panel ── */}
            {detection && (
              <div className="flex flex-col gap-2.5 p-3 rounded-lg bg-amber-950/30 border border-amber-800/40">
                <button
                  className="flex items-center gap-2 text-left w-full"
                  onClick={() => setShowVariants((v) => !v)}
                >
                  <Users className="h-4 w-4 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-300">
                      {t("import_detected_avatars")}
                    </p>
                    <p className="text-[10px] text-amber-500/80 mt-px leading-snug">
                      {t("import_detected_desc")}
                    </p>
                  </div>
                  {showVariants
                    ? <ChevronUp className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    : <ChevronDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                </button>

                {showVariants && (
                  <div className="flex flex-wrap gap-1.5">
                    {detection.variants.map((v) => (
                      <span
                        key={v.filename}
                        className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${v.isMaterials
                            ? "border-lime-700/50 bg-lime-950/40 text-lime-300"
                            : "border-amber-700/50 bg-amber-950/40 text-amber-200"
                          }`}
                      >
                        {v.isMaterials ? <Layers className="h-2.5 w-2.5" /> : <Users className="h-2.5 w-2.5" />}
                        {v.avatarName}
                      </span>
                    ))}
                  </div>
                )}

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={groupVariants}
                    onClick={() => setGroupVariants((g) => !g)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${groupVariants ? "bg-amber-600" : "bg-zinc-700"}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${groupVariants ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                  <span className="text-[11px] text-amber-300/80 select-none">
                    {t("import_group_as")}
                  </span>
                </label>
              </div>
            )}

            {/* ── Booth association con AUTO‑FILL y spinner ── */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Link className="h-3 w-3" />
                {t("import_booth_label")}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={boothInput}
                    onChange={(e) => { setBoothInput(e.target.value); setBoothError(null); setBoothDetail(null); }}
                    onKeyDown={(e) => e.key === "Enter" && boothInput && lookupBooth()}
                    placeholder="https://booth.pm/items/1234567"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors pr-8"
                  />
                  {fetchingBooth && (
                    <Search className="absolute right-2 top-2.5 w-3.5 h-3.5 text-violet-400 animate-pulse" />
                  )}
                </div>
                <button
                  onClick={() => setShowBoothPicker(true)}
                  title="Buscar en Booth"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-pink-400 hover:text-pink-300 text-xs transition-colors"
                >
                  <Store className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={lookupBooth}
                  disabled={!boothInput.trim() || fetchingBooth}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-zinc-300 text-xs transition-colors"
                >
                  {fetchingBooth ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("import_booth_lookup")}
                </button>
              </div>

              {boothError && (
                <div className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {boothError}
                </div>
              )}

              {boothDetail && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-green-900/50">
                  {boothDetail.images[0] && (
                    <img src={boothDetail.images[0]} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-200 truncate">{boothDetail.name}</p>
                    <p className="text-[10px] text-zinc-500">{boothDetail.author} · {boothDetail.price_display}</p>
                  </div>
                  <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
                </div>
              )}
            </div>

            {/* ── Name, Author ── */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                {t("import_name_label")} *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("import_name_label")}
                className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                <User className="h-3 w-3" />
                {t("import_author_label")}
                <span className="text-[10px] text-zinc-600 font-normal normal-case tracking-normal ml-1">(optional)</span>
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder={t("import_author_label")}
                className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
              />
            </div>

            {/* ── Thumbnail con previsualización y selector local ── */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                {t("import_thumbnail_label")}
              </label>

              {thumbnailUrl ? (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-700">
                  <img
                    src={thumbnailUrl}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover shrink-0 border border-zinc-700"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-zinc-500 truncate font-mono">{thumbnailUrl}</p>
                  </div>
                  <button
                    onClick={() => setThumbnailUrl("")}
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                  placeholder="https://…"
                  className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
                />
              )}

              <button
                onClick={pickLocalThumbnail}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors self-start"
              >
                <Upload className="h-3 w-3" />
                {t("import_thumbnail_pick_local")}
              </button>
            </div>

            {/* ── Product images gallery (from Booth) ── */}
            {detailImages.length > 1 && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Gallery images
                </label>
                <div className="flex gap-2 flex-wrap">
                  {detailImages.map((img, idx) => (
                    <img
                      key={idx}
                      src={img}
                      alt=""
                      className="w-12 h-12 rounded-md object-cover border border-zinc-700 hover:border-zinc-500 cursor-pointer"
                      onClick={() => setThumbnailUrl(img)}
                    />
                  ))}
                </div>
                <p className="text-[9px] text-zinc-600">Click any image to set as main thumbnail</p>
              </div>
            )}

            {/* ── Tags ── */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {t("import_tags_label")}
                <span className="text-[10px] text-zinc-600 font-normal normal-case tracking-normal ml-1">(optional)</span>
              </label>
              <TagInput tags={tags} onChange={setTags} placeholder={t("import_add_tag_placeholder")} />
            </div>

            {/* ── Avatars included ── */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                <Users className="h-3 w-3" />
                {t("import_avatars_label")}
                <span className="text-[10px] text-zinc-600 font-normal normal-case tracking-normal ml-1">(optional)</span>
              </label>

              {/* Chips de avatares añadidos */}
              {avatars.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {avatars.map((a) => (
                    <button
                      key={a}
                      onClick={() => setAvatars(avatars.filter((x) => x !== a))}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-700/50 hover:bg-red-900/40 hover:text-red-300 hover:border-red-700/50 transition-colors group"
                    >
                      {a} <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}

              {/* Sugerencias de detección (avatares no añadidos aún) */}
              {detection && detection.variants.filter(v => !v.isMaterials).map((v) => (
                !avatars.includes(v.avatarName) && (
                  <button
                    key={v.filename}
                    onClick={() => setAvatars([...avatars, v.avatarName])}
                    className="text-[10px] px-2 py-0.5 rounded-full text-zinc-500 border border-dashed border-zinc-700 hover:border-zinc-500 hover:text-zinc-300 transition-colors self-start"
                  >
                    + {v.avatarName}
                  </button>
                )
              ))}

              {/* Input con autocompletado */}
              <div className="relative">
                <div className="flex gap-1.5">
                  <input
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 transition-colors"
                    placeholder={t("import_add_avatar_placeholder")}
                    value={newAvatar}
                    onChange={(e) => { setNewAvatar(e.target.value); setShowAvatarSuggestions(true); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const a = newAvatar.trim();
                        if (a && !avatars.includes(a)) setAvatars([...avatars, a]);
                        setNewAvatar(""); setShowAvatarSuggestions(false);
                      }
                      if (e.key === "Escape") setShowAvatarSuggestions(false);
                    }}
                    onFocus={() => setShowAvatarSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowAvatarSuggestions(false), 150)}
                  />
                  <button
                    onClick={() => {
                      const a = newAvatar.trim();
                      if (a && !avatars.includes(a)) setAvatars([...avatars, a]);
                      setNewAvatar(""); setShowAvatarSuggestions(false);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                {showAvatarSuggestions && avatarSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden">
                    {avatarSuggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (!avatars.includes(item.name)) setAvatars([...avatars, item.name]);
                          setNewAvatar("");
                          setShowAvatarSuggestions(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-800 transition-colors text-left"
                      >
                        {item.thumbnail_url ? (
                          <img src={item.thumbnail_url} alt="" className="w-8 h-8 rounded-md object-cover shrink-0 border border-zinc-700" />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center">
                            <User className="h-3.5 w-3.5 text-zinc-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-zinc-200 truncate">{item.name}</p>
                          {item.source === "booth" && item.source_id && (
                            <p className="text-[10px] text-pink-400/70 truncate">booth.pm/items/{item.source_id}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {importError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-900/50 text-xs text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {importError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 p-5 border-t border-zinc-800">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm transition-colors"
            >
              {t("import_cancel")}
            </button>
            <button
              onClick={handleImportClick}
              disabled={!canImport || importing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {importing ? (
                <><Loader2 className="h-4 w-4 animate-spin" />{t("import_importing")}</>
              ) : (
                <><Package className="h-4 w-4" />{t("import_import")}</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* GlobalBoothPicker */}
      {showBoothPicker && (
        <GlobalBoothPickerModal
          title="Buscar en Booth"
          subtitle="Selecciona el producto para asociarlo al import"
          onClose={() => setShowBoothPicker(false)}
          onSelect={handleBoothPick}
        />
      )}
    </>
  );
}