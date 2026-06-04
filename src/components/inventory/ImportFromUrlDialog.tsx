import { useState, useEffect } from "react";
import {
  X, Link, Download, Loader2, CheckCircle, AlertTriangle,
  FolderOpen, User, Package,
} from "lucide-react";
import { useT } from "@/i18n";
import { tauriDownloadToTemp } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { listen } from "@tauri-apps/api/event";

interface Props {
  onClose: () => void;
  onImported?: (itemId: string) => void;
}

type Phase = "form" | "downloading" | "fillDetails" | "importing" | "done";

// Resolve a user-pasted URL to a display label
function labelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

export function ImportFromUrlDialog({ onClose, onImported }: Props) {
  const t = useT();
  const { importLocalPackage } = useInventoryStore();

  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [localPath, setLocalPath] = useState("");

  // Metadata fields (filled after download)
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [importedId, setImportedId] = useState<string | null>(null);

  // Listen to download progress events
  useEffect(() => {
    const unlisten = listen<{ item_id: string; percentage: number; status: string }>(
      "download://progress",
      (ev) => {
        if (ev.payload.item_id === "url-import") {
          setDownloadProgress(Math.round(ev.payload.percentage));
        }
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleDownload = async () => {
    if (!url.trim()) return;
    setError(null);
    setPhase("downloading");
    setDownloadProgress(0);
    try {
      const path = await tauriDownloadToTemp(url.trim());
      setLocalPath(path);
      // Pre-fill name from filename
      const filename = path.split(/[/\\]/).pop() ?? "";
      setName(filename.replace(/\.(zip|unitypackage)$/i, ""));
      setPhase("fillDetails");
    } catch (e) {
      setError(String(e));
      setPhase("form");
    }
  };

  const handleImport = async () => {
    if (!localPath || !name.trim()) return;
    setPhase("importing");
    setError(null);
    try {
      const id = await importLocalPackage({
        zip_path: localPath,
        name: name.trim(),
        author: author.trim() || undefined,
        thumbnail_url: thumbnailUrl.trim() || undefined,
        booth_id: undefined,
        product_images: [],
        overwrite: false,
      });
      setImportedId(id);
      setPhase("done");
      onImported?.(id);
    } catch (e) {
      setError(String(e));
      setPhase("fillDetails");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Link className="h-5 w-5 text-red-400" />
            <h2 className="text-base font-semibold text-zinc-100">{t("import_url_title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">

          {/* ── Phase: form ── */}
          {phase === "form" && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  {t("import_url_label")}
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleDownload()}
                  placeholder={t("import_url_placeholder")}
                  className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500
                             text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
                  autoFocus
                />
                <p className="text-[10px] text-zinc-600">
                  Supports Pixeldrain (/l/ and /u/ links), direct .zip / .unitypackage URLs
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-900/50 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {error}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleDownload}
                  disabled={!url.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500
                             disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <Download className="h-4 w-4" />
                  {t("import_url_start")}
                </button>
              </div>
            </>
          )}

          {/* ── Phase: downloading ── */}
          {phase === "downloading" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="h-8 w-8 text-red-400 animate-spin" />
              <div className="w-full flex flex-col gap-1.5">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Downloading from {labelFromUrl(url)}</span>
                  <span>{downloadProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Phase: fillDetails ── */}
          {phase === "fillDetails" && (
            <>
              <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-2">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-green-400" />
                <span className="truncate font-mono">{localPath.split(/[/\\]/).pop()}</span>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  {t("import_url_name_label")} *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500
                             text-xs text-zinc-200 outline-none transition-colors"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                  <User className="h-3 w-3" /> {t("import_url_author_label")}
                  <span className="text-[10px] text-zinc-600 font-normal normal-case tracking-normal ml-1">{t("import_url_author_optional")}</span>
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500
                             text-xs text-zinc-200 outline-none transition-colors"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  {t("import_url_thumbnail_label")}
                </label>
                <input
                  type="text"
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                  placeholder="https://…"
                  className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500
                             text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-900/50 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700
                             text-zinc-300 text-sm transition-colors"
                >
                  {t("import_url_cancel")}
                </button>
                <button
                  onClick={handleImport}
                  disabled={!name.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500
                             disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <Package className="h-4 w-4" />
                  {t("import_url_import_btn")}
                </button>
              </div>
            </>
          )}

          {/* ── Phase: importing ── */}
          {phase === "importing" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 text-red-400 animate-spin" />
              <p className="text-sm text-zinc-400">{t("import_url_importing")}</p>
            </div>
          )}

          {/* ── Phase: done ── */}
          {phase === "done" && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <CheckCircle className="h-12 w-12 text-green-400" />
              <div>
                <h3 className="text-base font-semibold text-zinc-100">{t("import_url_done_title")}</h3>
                <p className="text-sm text-zinc-400 mt-1">{name}</p>
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                {t("import_url_close")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}