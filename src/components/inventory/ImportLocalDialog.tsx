import { useState, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  X, FolderOpen, Link, User, Package, Loader2,
  CheckCircle, AlertTriangle, Users, Layers, ChevronDown, ChevronUp,
  Search, Store,
} from "lucide-react";
import { useInventoryStore } from "../../store/inventoryStore";
import {
  tauriGetBoothProductDetail,
  BoothProductDetail,
} from "../../lib/tauri";
import { useT } from "../../i18n";
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
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ImportLocalDialog({ onClose, onImported }: Props) {
  const t = useT();
  const { importLocalPackage } = useInventoryStore();

  const [zipPath, setZipPath] = useState("");
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

  // ── AUTO‑FETCH: cuando el usuario escribe un Booth ID/URL ────────────────────
  useEffect(() => {
    const boothId = extractBoothId(boothInput);
    if (!boothId) return;

    const timer = setTimeout(async () => {
      setFetchingBooth(true);
      try {
        const detail = await tauriGetBoothProductDetail(boothId);
        // Solo rellenar si el campo está vacío (no sobreescribir lo que el usuario ya escribió)
        if (!name) setName(detail.name);
        if (!author) setAuthor(detail.author);
        if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
        setBoothDetail(detail);
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

  // ── Booth lookup manual (botón) ──────────────────────────────────────────
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
      if (!name) setName(detail.name);
      if (!author) setAuthor(detail.author);
      if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
    } catch (e) {
      setBoothError(`No se pudo obtener el producto: ${e}`);
    } finally {
      setFetchingBooth(false);
    }
  };

  // ── Booth picker callback ─────────────────────────────────────────────────
  const handleBoothPick = async (result: BoothPickerResult) => {
    setBoothInput(`https://booth.pm/items/${result.boothId}`);
    if (!name) setName(result.name);
    if (!author) setAuthor(result.author);
    if (!thumbnailUrl && result.thumbnailUrl) setThumbnailUrl(result.thumbnailUrl);
    // Fetch full detail to get all images
    try {
      const detail = await tauriGetBoothProductDetail(result.boothId);
      setBoothDetail(detail);
      if (!name) setName(detail.name);
      if (!author) setAuthor(detail.author);
      if (!thumbnailUrl && detail.images[0]) setThumbnailUrl(detail.images[0]);
    } catch { /* ignore */ }
  };

  // ── Import ───────────────────────────────────────────────────────────────
  const handleImport = async () => {
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
        // Guardar todas las imágenes de Booth (saltando la primera que ya es thumbnail)
        product_images: boothDetail?.images ?? [],
      });
      setImportedId(newId);
      onImported?.(newId);
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

  return (
  <>
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
              {/* Collapsible header */}
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

              {/* Variant chips */}
              {showVariants && (
                <div className="flex flex-wrap gap-1.5">
                  {detection.variants.map((v) => (
                    <span
                      key={v.filename}
                      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                        v.isMaterials
                          ? "border-lime-700/50 bg-lime-950/40 text-lime-300"
                          : "border-amber-700/50 bg-amber-950/40 text-amber-200"
                      }`}
                    >
                      {v.isMaterials
                        ? <Layers className="h-2.5 w-2.5" />
                        : <Users className="h-2.5 w-2.5" />}
                      {v.avatarName}
                    </span>
                  ))}
                </div>
              )}

              {/* Group toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={groupVariants}
                  onClick={() => setGroupVariants((g) => !g)}
                  className={`relative w-8 h-4 rounded-full transition-colors ${groupVariants ? "bg-amber-600" : "bg-zinc-700"}`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${groupVariants ? "translate-x-4" : "translate-x-0.5"}`}
                  />
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
              {/* Buscar en catálogo Booth */}
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
                {fetchingBooth
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : t("import_booth_lookup")}
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

          {/* ── Name, Author, Thumbnail ── */}
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

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              {t("import_thumbnail_label")}
            </label>
            <input
              type="text"
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
              placeholder="https://…"
              className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
            />
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
            onClick={handleImport}
            disabled={!canImport}
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