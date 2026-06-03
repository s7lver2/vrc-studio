import { Shuffle, ShoppingCart, Library, Folder, ArrowRight, Loader2, Search } from "lucide-react";
import { useCartStore } from "../../store/cartStore";
import { useCollectionsStore } from "../../store/collectionsStore";
import { useEffect, useState } from "react";
import { tauriSearchShop, ShopProduct, Collection } from "../../lib/tauri";
import { useShopStore } from "../../store/shopStore";

const EXPLORE_TERMS = [
  "avatar clothing", "hair accessory", "outfit", "prop",
  "shader", "particle effect", "wings", "ears tail",
  "eye texture", "face accessory", "vrchat avatar",
];

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Logo SVG de VRC Studio
function VrcStudioLogo() {
  return (
    <div className="flex flex-col items-center gap-1">
      <img
        src="/icons/icon.png"
        alt="VRC Studio"
        className="w-16 h-16 opacity-90"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <div className="text-center">
        <p className="text-xl font-bold text-zinc-100 tracking-tight">VRC Studio</p>
        <p className="text-xs text-zinc-500 uppercase tracking-widest">Shop</p>
      </div>
    </div>
  );
}

interface ShopHomeProps {
  onSurpriseMe: () => void;
  surpriseLoading?: boolean;
  onOpenCollections: () => void;
  recentSearches: string[];
  onSearchSuggestion: (q: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function ShopHome({
  onSurpriseMe,
  surpriseLoading,
  onOpenCollections,
  recentSearches,
  onSearchSuggestion,
  searchQuery,
  onSearchChange,
}: ShopHomeProps) {
  const { items: cartItems, setOpen: setCartOpen } = useCartStore();
  const { collections } = useCollectionsStore();
  const [recommended, setRecommended] = useState<ShopProduct[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const { selectProduct } = useShopStore();
  const [localQuery, setLocalQuery] = useState(searchQuery);

  // Sync if parent clears/changes the query externally (e.g. suggestion click)
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setLoadingRec(true);
    const term = pickRandom(EXPLORE_TERMS, 1)[0];
    tauriSearchShop(term, 1)
      .then((products) => {
        setRecommended(pickRandom(products, 6));
      })
      .catch(() => { })
      .finally(() => setLoadingRec(false));
  }, []); // solo al montar

  return (
    <div className="flex flex-col items-center gap-8 pt-6 pb-10 px-2 w-full max-w-2xl mx-auto">
      {/* Logo */}
      <VrcStudioLogo />

      {/* ── Barra de búsqueda centrada ── */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
        <input
          autoFocus
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors"
          placeholder="Search assets, or paste a Booth URL / item ID…"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && localQuery.trim()) {
              onSearchChange(localQuery.trim());
            }
          }}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3 w-full">
        {/* Surprise me */}
        <button
          onClick={onSurpriseMe}
          className="flex flex-col items-center gap-2 p-4 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:border-red-500/50 hover:bg-red-500/5 transition-all group"
        >
          {surpriseLoading
            ? <Loader2 className="h-5 w-5 text-red-400 animate-spin" />
            : <Shuffle className="h-5 w-5 text-red-400 group-hover:scale-110 transition-transform" />
          }
          <span className="text-xs font-medium text-zinc-300">
            {surpriseLoading ? "Finding…" : "Surprise me"}
          </span>
        </button>

        {/* Cart */}
        <button
          onClick={() => setCartOpen(true)}
          className="relative flex flex-col items-center gap-2 p-4 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:border-amber-500/50 hover:bg-amber-500/5 transition-all group"
        >
          <ShoppingCart className="h-5 w-5 text-amber-400 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium text-zinc-300">Cart</span>
          {cartItems.length > 0 && (
            <span className="absolute top-2 right-2 w-4 h-4 flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-zinc-900">
              {cartItems.length > 9 ? "9+" : cartItems.length}
            </span>
          )}
        </button>

        {/* Collections */}
        <button
          onClick={onOpenCollections}
          className="flex flex-col items-center gap-2 p-4 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all group"
        >
          <Library className="h-5 w-5 text-violet-400 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium text-zinc-300">Collections</span>
        </button>
      </div>

      {/* Recent collections preview */}
      {collections.length > 0 && (
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Collections</p>
            <button
              onClick={onOpenCollections}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              See all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {collections.slice(0, 4).map((col) => (
              <CollectionCard key={col.id} collection={col} onClick={onOpenCollections} />
            ))}
          </div>
        </div>
      )}

      {/* Recent searches / suggestions */}
      {recentSearches.length > 0 && (
        <div className="w-full">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Recent searches
          </p>
          <div className="flex flex-wrap gap-2">
            {recentSearches.slice(0, 8).map((q) => (
              <button
                key={q}
                onClick={() => onSearchSuggestion(q)}
                className="px-3 py-1.5 text-xs rounded-full border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Explore / Recommended ── */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Explore
          </p>
          {loadingRec && <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />}
        </div>

        {loadingRec ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-zinc-800/60 animate-pulse" />
            ))}
          </div>
        ) : recommended.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {recommended.map((product) => (
              <button
                key={`${product.source}-${product.source_id}`}
                onClick={() => selectProduct(product)}
                className="group flex flex-col rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 bg-zinc-900/60 transition-all text-left"
              >
                <div className="aspect-square overflow-hidden bg-zinc-800">
                  {product.thumbnail_url ? (
                    <img
                      src={product.thumbnail_url}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs">—</div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-[10px] font-medium text-zinc-300 leading-tight line-clamp-2">{product.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate mt-0.5">{product.author}</p>
                  <p className="text-[10px] font-bold text-red-400 mt-0.5">{product.price_display}</p>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CollectionCard({ collection, onClick }: { collection: Collection; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 p-2.5 rounded-lg border border-zinc-700 bg-zinc-800/40 hover:border-zinc-600 transition-colors text-left"
    >
      {collection.cover_url ? (
        <img src={collection.cover_url} alt="" className="w-10 h-10 rounded object-cover bg-zinc-700 shrink-0" referrerPolicy="no-referrer" />
      ) : (
        <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center shrink-0">
          <Folder className="h-4 w-4 text-zinc-500" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-200 truncate">{collection.name}</p>
        <p className="text-[10px] text-zinc-500">{collection.item_count} items</p>
      </div>
    </button>
  );
}