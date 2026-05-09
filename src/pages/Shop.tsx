import { Search, Lock, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { DownloadProgress } from "../components/shop/DownloadProgress";
import { ProductGrid } from "../components/shop/ProductGrid";
import { ProductModal } from "../components/shop/ProductModal";
import { ShopFilters } from "../components/shop/ShopFilters";
import { useShopSearch } from "../hooks/useShopSearch";
import { useRipperStatus } from "../hooks/useRipperStatus";
import { useAppStore } from "@/store/app";
import { useT } from "../i18n/index";

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

// ── Shop page ─────────────────────────────────────────────────────────────────

const SHOP_WARNING_KEY = "shop:warningAccepted";

export default function Shop() {
  const { query, handleQueryChange } = useShopSearch();
  const { status: ripperStatus } = useRipperStatus();
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const [warningAccepted, setWarningAccepted] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOP_WARNING_KEY) === "true"; } catch { return false; }
  });

  if (!warningAccepted) {
    return (
      <ShopWarning
        onConfirm={() => {
          try { localStorage.setItem(SHOP_WARNING_KEY, "true"); } catch {}
          setWarningAccepted(true);
        }}
        onCancel={() => setActiveSection("projects")}
      />
    );
  }

  return (
    <div className="flex flex-col h-full gap-4 p-6 overflow-auto">
      <h1 className="text-xl font-semibold text-zinc-100">Shop</h1>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
        <input
          className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors"
          placeholder="Search assets, or paste a Booth URL / item ID…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />
      </div>

      {/* Filters */}
      <ShopFilters />

      {/* Ripper.store status banners */}
      {ripperStatus === "disconnected" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800/60 border border-zinc-700/50 text-xs text-zinc-400">
          <span>Ripper.store not connected — showing Booth results only.</span>
          <button
            className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
            onClick={() => setActiveSection("settings")}
          >
            Connect in Settings
          </button>
        </div>
      )}

      {ripperStatus === "expired" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-yellow-900/20 border border-yellow-500/30 text-xs text-yellow-400">
          <span>Ripper.store session expired.</span>
          <button
            className="underline underline-offset-2 hover:text-yellow-200"
            onClick={() => setActiveSection("settings")}
          >
            Reconnect in Settings
          </button>
        </div>
      )}

      {/* Results */}
      <ProductGrid />

      {/* Floating download toasts */}
      <DownloadProgress />

      {/* Product detail modal — rendered at root of page so it sits above everything */}
      <ProductModal />
    </div>
  );
}