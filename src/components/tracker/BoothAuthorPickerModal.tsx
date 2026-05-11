import { useState, useRef, useEffect } from "react";
import { Search, X, Loader2, User } from "lucide-react";
import { tauriSearchShop } from "@/lib/tauri";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

interface AuthorResult {
  name: string;
  shopId: string | null;
}

interface BoothAuthorPickerModalProps {
  onClose: () => void;
  onSelect: (author: { name: string; shopId: string | null }) => void;
}

export function BoothAuthorPickerModal({ onClose, onSelect }: BoothAuthorPickerModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AuthorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const all = await tauriSearchShop(query.trim(), 1);
      const seen = new Map<string, AuthorResult>();
      for (const p of all.filter((p) => p.source === "booth")) {
        if (p.author && !seen.has(p.author)) {
          seen.set(p.author, {
            name: p.author,
            shopId: null, // author_id no existe en ShopProduct
          });
        }
      }
      setResults(Array.from(seen.values()).slice(0, 20));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[65vh]">
        <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Search Booth Authors</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">Find an author or shop to track</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors ml-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-600" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                placeholder="Author name…"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!query.trim() || loading}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm text-zinc-200 transition-colors disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && <div className="px-5 py-4 text-xs text-red-400">{error}</div>}

          {!searched && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-700">
              <User className="h-7 w-7" />
              <p className="text-xs">Search an author name above</p>
            </div>
          )}

          {searched && !loading && results.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-700">
              <User className="h-7 w-7" />
              <p className="text-xs">No authors found</p>
            </div>
          )}

          {results.map((author) => (
            <button
              key={author.name}
              onClick={() => { onSelect(author); onClose(); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-zinc-900 transition-colors border-b border-zinc-800/50 text-left"
            >
              <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                <User className="h-3.5 w-3.5 text-zinc-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200">{author.name}</p>
                {author.shopId && (
                  <p className="text-[10px] text-zinc-600 font-mono mt-0.5">@{author.shopId}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}