import { X, ShoppingCart, Download, Trash2, Package, ExternalLink, AlertCircle } from "lucide-react";
import { useCartStore } from "../../store/cartStore";
import { useShopStore } from "../../store/shopStore";
import { tauriStartDownload } from "../../lib/tauri";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useState } from "react";

export function CartDrawer() {
  const { items, open, setOpen, removeItem, clear } = useCartStore();
  const { boothOwnedIds } = useShopStore();
  const [downloading, setDownloading] = useState(false);

  const unpurchasedItems = items.filter(
    (item) => item.source === "booth" && !boothOwnedIds.has(item.source_id)
  );
  const hasUnpurchased = unpurchasedItems.length > 0;

  if (!open) return null;

  const handleDownloadAll = async () => {
    if (downloading || items.length === 0) return;
    setDownloading(true);
    for (const item of items) {
      try {
        await tauriStartDownload({
          source: item.source,
          source_id: item.source_id,
          name: item.name,
          author: item.author,
          thumbnail_url: item.thumbnail_url,
        });
      } catch (e) {
        console.error(`Failed to download ${item.name}:`, e);
      }
    }
    setDownloading(false);
    await clear();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-zinc-950/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[440px] bg-zinc-900 border-l border-zinc-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-zinc-300" />
            <span className="text-sm font-semibold text-zinc-100">
              Cart ({items.length})
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Items list */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500">
              <ShoppingCart className="h-8 w-8 opacity-30" />
              <p className="text-sm">Your cart is empty</p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {items.map((item) => (
                <li
                  key={`${item.source}-${item.source_id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors"
                >
                  {item.thumbnail_url ? (
                    <img
                      src={item.thumbnail_url}
                      alt={item.name}
                      className="w-10 h-10 rounded object-cover bg-zinc-800 shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-zinc-800 shrink-0 flex items-center justify-center">
                      <Package className="h-4 w-4 text-zinc-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-100 truncate">{item.name}</p>
                    <p className="text-[10px] text-zinc-500 truncate">{item.author}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-red-400 font-semibold">{item.price_display}</p>
                      {item.source === "booth" && !boothOwnedIds.has(item.source_id) && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                          <AlertCircle className="h-2.5 w-2.5" />
                          Not purchased
                        </span>
                      )}
                    </div>
                    {item.source === "booth" && !boothOwnedIds.has(item.source_id) && (
                      <button
                        onClick={async () => {
                          try { await openUrl(item.url); } catch { window.open(item.url, "_blank"); }
                        }}
                        className="mt-1 flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        Buy on Booth
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => removeItem(item.source, item.source_id)}
                    className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    title="Remove from cart"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer actions */}
        {items.length > 0 && (
          <div className="border-t border-zinc-800 p-4 flex flex-col gap-2">
            {hasUnpurchased && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {unpurchasedItems.length === 1
                    ? "1 item hasn't been purchased yet. Buy it on Booth before downloading."
                    : `${unpurchasedItems.length} items haven't been purchased yet. Buy them on Booth before downloading.`}
                </span>
              </div>
            )}
            <button
              onClick={handleDownloadAll}
              disabled={downloading || hasUnpurchased}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
            >
              <Download className="h-4 w-4" />
              {downloading ? "Downloading…" : `Download all (${items.length})`}
            </button>
            <button
              onClick={clear}
              disabled={downloading}
              className="w-full py-2 rounded-md border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-50 transition-colors"
            >
              Clear cart
            </button>
          </div>
        )}
      </div>
    </>
  );
}