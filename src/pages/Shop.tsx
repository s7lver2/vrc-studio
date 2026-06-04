import { Search, Lock, AlertTriangle, ShoppingCart, Home } from "lucide-react";
import { useState, useEffect } from "react";
import { DownloadProgress } from "../components/shop/DownloadProgress";
import { ProductGrid } from "../components/shop/ProductGrid";
import { ProductModal } from "../components/shop/ProductModal";
import { ShopFilters } from "../components/shop/ShopFilters";
import { tauriSearchShop } from "../lib/tauri";
import { useShopSearch } from "../hooks/useShopSearch";
import { ShopHome } from "../components/shop/ShopHome";
import { useInventoryStore } from "../store/inventoryStore";
import { CollectionsView } from "../components/shop/CollectionsView";
import { useAppStore } from "@/store/app";
import { CollectionPickerModal } from "../components/shop/CollectionPickerModal";
import { useT } from "../i18n";
import { AuthorModal } from "@/components/shop/AuthorModal";
import { useShopStore } from "@/store/shopStore";
import { CartDrawer } from "../components/shop/CartDrawer";
import { useCartStore } from "../store/cartStore";
import { CatalogView } from "../components/shop/CatalogView";

// ── Shop Warning Dialog ───────────────────────────────────────────────────────

function ShopWarning({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const t = useT();

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
      <div className="relative flex flex-col items-center gap-5 w-full max-w-sm mx-4 p-6 rounded-lg border border-zinc-800 bg-zinc-900">
        {/* Lock icon */}
        <div className="flex items-center justify-center w-12 h-12 rounded-full border border-red-500/30 bg-red-500/10">
          <Lock className="h-5 w-5 text-red-400" strokeWidth={1.5} />
        </div>

        {/* Texto */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <p className="text-sm font-semibold text-red-400 uppercase tracking-wide">
              {t("shop_warning_title")}
            </p>
          </div>
          <p className="text-sm text-zinc-200 leading-relaxed">
            {t("shop_warning_desc")}
          </p>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {t("shop_warning_detail")}
          </p>
        </div>

        {/* Botones */}
        <div className="flex gap-3 w-full">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-md border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            {t("shop_warning_cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-md bg-red-600 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            {t("shop_warning_continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── VRChat-specific Surprise Me terms ─────────────────────────────────────────
// These queries reliably return VRChat-related items on Booth.

const VRCHAT_SURPRISE_TERMS = [
  "vrchat avatar",
  "vrc avatar base",
  "vrchat outfit",
  "vrchat clothing wearable",
  "vrchat hair accessory",
  "vrchat ears tail",
  "vrchat wings",
  "vrchat props",
  "vrchat face accessory",
  "vrchat eye texture",
  "vrchat boots shoes",
  "vrchat dress",
  "vrchat jacket",
  "vrchat shader liltoon",
];

// ── Shop page ─────────────────────────────────────────────────────────────────

const SHOP_WARNING_KEY = "shop:warningAccepted";

export default function Shop() {
  const { filters, authorResults, selectedAuthor, setSelectedAuthor } = useShopStore();
  const { query, handleQueryChange } = useShopSearch();
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const { items: inventoryItems, loadItems } = useInventoryStore();
  const { selectProduct } = useShopStore();
  const { items: cartItems, setOpen: setCartOpen } = useCartStore();
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const { recentSearches } = useShopStore();
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  const [warningAccepted, setWarningAccepted] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOP_WARNING_KEY) === "true"; } catch { return false; }
  });

  // Surprise Me: searches VRChat-specific terms, picks a random result — no more random IDs
  const handleSurpriseMe = async () => {
    if (surpriseLoading) return;
    setSurpriseLoading(true);
    try {
      const term = VRCHAT_SURPRISE_TERMS[Math.floor(Math.random() * VRCHAT_SURPRISE_TERMS.length)];
      const page = Math.floor(Math.random() * 4) + 1;
      const results = await tauriSearchShop(term, page, false);
      if (results.length > 0) {
        const pick = results[Math.floor(Math.random() * results.length)];
        selectProduct(pick);
      }
    } catch {
      // silent — user can retry
    } finally {
      setSurpriseLoading(false);
    }
  };

  useEffect(() => {
    if (inventoryItems.length === 0) {
      loadItems();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!warningAccepted) {
    return (
      <ShopWarning
        onConfirm={() => {
          try { localStorage.setItem(SHOP_WARNING_KEY, "true"); } catch { }
          setWarningAccepted(true);
        }}
        onCancel={() => setActiveSection("projects")}
      />
    );
  }

  const isSearching = !!query.trim();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Fixed header ── */}
      <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4">
        <h1 className="text-xl font-semibold text-zinc-100">Shop</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleQueryChange("")}
            className="p-2 rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            title="Shop Home"
          >
            <Home className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCartOpen(true)}
            className="relative p-2 rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            title="Shopping Cart"
          >
            <ShoppingCart className="h-4 w-4" />
            {cartItems.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-600 text-[9px] font-bold text-white">
                {cartItems.length > 9 ? "9+" : cartItems.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Sticky search + filters bar (only in search mode) ── */}
      {isSearching && (
        <div className="shrink-0 sticky top-0 z-20 px-6 pb-3 bg-zinc-950/98 backdrop-blur-sm border-b border-zinc-800/60">
          <div className="relative mb-2.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
            <input
              autoFocus
              className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors"
              placeholder="Search assets, or paste a Booth URL / item ID…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
            />
          </div>
          <ShopFilters />
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Author search results */}
        {isSearching && filters.searchMode === "authors" && authorResults.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {authorResults.map((a) => (
              <button
                key={a.name}
                onClick={() => setSelectedAuthor(a)}
                className="flex flex-col gap-2 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700 hover:border-violet-500/50 text-left"
              >
                <div className="flex items-center gap-2">
                  <img
                    src={a.sample_thumbnail}
                    className="w-8 h-8 rounded-full object-cover bg-zinc-700"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{a.name}</p>
                    <p className="text-xs text-zinc-500">{a.product_count} items</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Main content */}
        {!isSearching ? (
          <ShopHome
            onSurpriseMe={handleSurpriseMe}
            surpriseLoading={surpriseLoading}
            onOpenCollections={() => setCollectionsOpen(true)}
            onOpenCatalog={() => setCatalogOpen(true)}
            recentSearches={recentSearches}
            onSearchSuggestion={(q) => handleQueryChange(q)}
            searchQuery={query}
            onSearchChange={handleQueryChange}
          />
        ) : (
          <ProductGrid />
        )}
      </div>

      {/* ── Modals & overlays ── */}
      {selectedAuthor && (
        <AuthorModal author={selectedAuthor} onClose={() => setSelectedAuthor(null)} />
      )}

      <DownloadProgress />
      <ProductModal />
      <CartDrawer />

      {collectionsOpen && <CollectionsView onClose={() => setCollectionsOpen(false)} />}
      {catalogOpen && <CatalogView onClose={() => setCatalogOpen(false)} />}

      <CollectionPickerModal />
    </div>
  );
}
