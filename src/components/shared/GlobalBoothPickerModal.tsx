// src/components/shared/GlobalBoothPickerModal.tsx
/**
 * GlobalBoothPickerModal — modal de búsqueda Booth reutilizable.
 * Sustituye BoothProductPickerModal (tracker) y el inline search de ScanDriveWizard.
 */
import { useState, useRef, useEffect } from "react";
import { Search, X, Loader2, Package, ExternalLink } from "lucide-react";
import { tauriSearchShop } from "@/lib/tauri";
import type { ShopProduct } from "@/lib/tauri";

export interface BoothPickerResult {
  boothId: string;
  name: string;
  author: string;
  thumbnailUrl: string;
  url: string;
}

interface Props {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (result: BoothPickerResult) => void;
}

export function GlobalBoothPickerModal({
  title = "Search Booth",
  subtitle = "Find a product on Booth",
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const all = await tauriSearchShop(query.trim(), 1);
      setResults(all.filter((p) => p.source === "booth").slice(0, 24));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
    if (e.key === "Escape") onClose();
  };

  const handleSelect = (p: ShopProduct) => {
    onSelect({
      boothId: p.source_id,
      name: p.name,
      author: p.author,
      thumbnailUrl: p.thumbnail_url ?? "",
      url: p.url ?? `https://booth.pm/items/${p.source_id}`,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[75vh]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search by name or ID…"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-zinc-600 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs transition-colors"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
            </button>
          </div>
          {error && <p className="text-[10px] text-red-400 mt-2">{error}</p>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-3">
          {!searched && (
            <p className="text-center text-xs text-zinc-700 py-8">Type something to search</p>
          )}
          {searched && results.length === 0 && !loading && (
            <p className="text-center text-xs text-zinc-600 py-8">No results found</p>
          )}
          <div className="flex flex-col gap-1">
            {results.map((p) => (
              <button
                key={p.source_id}
                onClick={() => handleSelect(p)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all text-left group"
              >
                {p.thumbnail_url ? (
                  <img src={p.thumbnail_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                    <Package className="h-4 w-4 text-zinc-700" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-200 truncate">{p.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{p.author}</p>
                </div>
                <ExternalLink className="h-3 w-3 text-zinc-700 group-hover:text-zinc-500 shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}