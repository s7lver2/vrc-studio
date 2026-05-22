// src/components/shop/ShopHome.tsx
import { Shuffle, ShoppingCart, Library, Folder, ArrowRight } from "lucide-react";
import { useCartStore } from "../../store/cartStore";
import { useCollectionsStore } from "../../store/collectionsStore";
import { Collection } from "../../lib/tauri";

// Logo SVG de VRC Studio (simplificado — usar el que ya existe en assets)
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
  onOpenCollections: () => void;
  recentSearches: string[];
  onSearchSuggestion: (q: string) => void;
}

export function ShopHome({
  onSurpriseMe,
  onOpenCollections,
  recentSearches,
  onSearchSuggestion,
}: ShopHomeProps) {
  const { items: cartItems, setOpen: setCartOpen } = useCartStore();
  const { collections } = useCollectionsStore();

  return (
    <div className="flex flex-col items-center gap-8 pt-6 pb-10 px-2 w-full max-w-lg mx-auto">
      {/* Logo */}
      <VrcStudioLogo />

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3 w-full">
        {/* Surprise me */}
        <button
          onClick={onSurpriseMe}
          className="flex flex-col items-center gap-2 p-4 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:border-red-500/50 hover:bg-red-500/5 transition-all group"
        >
          <Shuffle className="h-5 w-5 text-red-400 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium text-zinc-300">Surprise me</span>
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