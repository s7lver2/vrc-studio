/**
 * BoothLinkPanel — panel reutilizable para vincular/buscar un producto de Booth.
 * Usado en ScanDriveWizard, AddTrackerModal, y cualquier otro sitio que necesite.
 */
import { useState } from "react";
import { Globe, Search, Loader2, ExternalLink, X, CheckCircle2 } from "lucide-react";
import { tauriGetBoothProductDetail } from "@/lib/tauri";
import { GlobalBoothPickerModal } from "@/components/shared/GlobalBoothPickerModal";

export interface LinkedBoothProduct {
  boothId: string;
  name: string;
  author: string;
  thumbnailUrl: string;
  url: string;
}

interface BoothLinkPanelProps {
  /** ID de Booth ya conocido (para pre-poblar el campo) */
  initialBoothId?: string;
  /** Producto ya resuelto (para mostrar el estado "vinculado") */
  linkedProduct?: LinkedBoothProduct | null;
  /** Callback cuando el usuario vincula o cambia el producto */
  onLink: (product: LinkedBoothProduct | null) => void;
  /** Texto de placeholder del input de ID */
  placeholder?: string;
}

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function BoothLinkPanel({
  initialBoothId = "",
  linkedProduct,
  onLink,
  placeholder = "Booth product ID or URL",
}: BoothLinkPanelProps) {
  const [boothId, setBoothId] = useState(initialBoothId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleLookup = async () => {
    const id = boothId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await tauriGetBoothProductDetail(id);
      onLink({
        boothId: detail.source_id,
        name: detail.name,
        author: detail.author ?? "",
        thumbnailUrl: detail.images[0] ?? "",
        url: detail.url ?? "",
      });
    } catch {
      setError("Product not found. Check the ID or try searching.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    onLink(null);
    setBoothId("");
    setError(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Linked product preview */}
      {linkedProduct ? (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800 border border-zinc-700">
          {linkedProduct.thumbnailUrl && (
            <img
              src={linkedProduct.thumbnailUrl}
              alt=""
              className="w-10 h-10 rounded object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 truncate">{linkedProduct.name}</p>
            <p className="text-[10px] text-zinc-500 truncate">{linkedProduct.author}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            {linkedProduct.url && (
              <a
                href={linkedProduct.url}
                target="_blank"
                rel="noreferrer"
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                title="Open in Booth"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <button
              onClick={handleClear}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400"
              title="Unlink"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : (
        /* ID input + actions */
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 focus-within:border-red-500/60">
              <Globe className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <input
                className="flex-1 min-w-0 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
                placeholder={placeholder}
                value={boothId}
                onChange={(e) => setBoothId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLookup(); }}
              />
            </div>
            <button
              onClick={handleLookup}
              disabled={!boothId.trim() || loading}
              className={cn(
                "px-3 rounded-lg text-xs font-medium transition-colors",
                boothId.trim() && !loading
                  ? "bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              )}
              title="Look up by ID"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Lookup"}
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              className="px-3 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors flex items-center gap-1.5"
              title="Search Booth"
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
          </div>
          {error && <p className="text-[10px] text-red-400 px-1">{error}</p>}
        </div>
      )}

      {pickerOpen && (
        <GlobalBoothPickerModal
          onClose={() => setPickerOpen(false)}
          onSelect={(p) => {
            onLink({
              boothId: p.boothId,
              name: p.name,
              author: p.author,
              thumbnailUrl: p.thumbnailUrl,
              url: p.url,
            });
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}