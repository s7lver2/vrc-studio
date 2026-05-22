import { useState } from "react";
import { ShopProduct, tauriStartDownload } from "../../lib/tauri";
import { useShopStore } from "../../store/shopStore";
import { useInventoryStore } from "../../store/inventoryStore";
import { useAppStore } from "../../store/app";
import { useDownloadProgress } from "../../hooks/useDownloadProgress";
import { useCollectionsStore } from "../../store/collectionsStore";
import { Bookmark } from "lucide-react";
import { useCartStore } from "../../store/cartStore";
import { Download, CheckCircle2, Package, Loader2, ShoppingCart, BookmarkPlus } from "lucide-react";
import { useT } from "@/i18n";

interface Props {
  product: ShopProduct;
}

const SOURCE_STYLES: Record<string, string> = {
  booth: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  riperstore: "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

export function ProductCard({ product }: Props) {
  const t = useT();
  const { selectProduct, boothOwnedIds } = useShopStore();
  const { items: inventoryItems } = useInventoryStore();
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const { downloads } = useDownloadProgress();
  const { addItem: addToCart, isInCart, setOpen: setCartOpen } = useCartStore();
  const alreadyInCart = isInCart(product.source, product.source_id);
  const { openPicker } = useCollectionsStore();
  const [imgError, setImgError] = useState(false);

  const isPurchased =
    product.source === "booth" && boothOwnedIds.has(product.source_id);

  const isInInventory = inventoryItems.some(
    (i) => i.source === product.source && i.source_id === product.source_id
  );

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(product);
  };

  const handleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    openPicker(product);
  };

  const dl = downloads[product.source_id] ?? null;
  const isDownloading =
    dl !== null && (dl.status === "downloading" || dl.status === "extracting");
  const isDone = dl?.status === "done";

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInInventory || isDownloading) return;
    try {
      await tauriStartDownload({
        source: product.source,
        source_id: product.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
      });
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  const handleRipperDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ripperSource = product.extra_sources?.find(
      (s) => s.source === "riperstore"
    );
    if (!ripperSource) return;
    try {
      await tauriStartDownload({
        source: ripperSource.source,
        source_id: ripperSource.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
      });
    } catch (err) {
      console.error("Riperstore download failed:", err);
    }
  };

  const handleGoToInventory = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveSection("inventory");
  };

  const ripperExtra =
    product.extra_sources?.find((s) => s.source === "riperstore") ?? null;
  const allSources: Array<{ source: string }> = [
    { source: product.source },
    ...(product.extra_sources ?? []),
  ];

  const showImage = product.thumbnail_url && !imgError;

  return (
    <div
      className="group relative flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 cursor-pointer hover:border-zinc-600 transition-all duration-150 overflow-hidden"
      onClick={() => selectProduct(product)}
    >
      <div className="relative aspect-square overflow-hidden bg-zinc-800">
        {showImage ? (
          <img
            src={product.thumbnail_url}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
            {t("shop_card_no_image")}
          </div>
        )}

        {isInInventory ? (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-violet-950/90 text-violet-300 border border-violet-700/50 shadow">
            <Package className="h-2.5 w-2.5" />
            {t("shop_card_inventory")}
          </span>
        ) : isPurchased ? (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-950/90 text-emerald-400 border border-emerald-700/50 shadow">
            <CheckCircle2 className="h-2.5 w-2.5" />
            {t("shop_card_purchased")}
          </span>
        ) : null}

        {/* ── Bookmark button (bottom‑right of image) ── */}
        <button
          className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded bg-zinc-900/80 border border-zinc-700/50 text-zinc-400 hover:text-amber-400 hover:border-amber-500/50 transition-all"
          onClick={handleBookmark}
          title="Save to collection"
        >
          <Bookmark className="h-3 w-3" />
        </button>
      </div>

      {(isDownloading || isDone) && (
        <div className="relative h-1 w-full bg-zinc-800 overflow-hidden">
          <div
            className={[
              "absolute inset-y-0 left-0 transition-all duration-150 ease-out",
              isDone
                ? "bg-emerald-500"
                : dl?.status === "extracting"
                ? "bg-violet-500"
                : "bg-blue-500",
            ].join(" ")}
            style={{ width: `${isDone ? 100 : dl?.percentage ?? 0}%` }}
          />
          {isDownloading && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse" />
          )}
        </div>
      )}

      <div className="p-2.5 flex flex-col gap-1 flex-1">
        <p className="font-medium text-sm text-zinc-100 leading-tight line-clamp-2">
          {product.name}
        </p>
        <p className="text-xs text-zinc-500 truncate">{product.author}</p>

        {product.supported_avatars && product.supported_avatars.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {product.supported_avatars.slice(0, 3).map((av) => (
              <span
                key={av}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 font-medium leading-none"
              >
                {av}
              </span>
            ))}
            {product.supported_avatars.length > 3 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400 border border-zinc-600 font-medium leading-none">
                +{product.supported_avatars.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-auto pt-1.5 gap-1 flex-wrap">
          <span className="text-xs font-semibold text-red-400">
            {product.price_display}
          </span>
          <div className="flex items-center gap-1">
            {allSources.map(({ source }) => (
              <span
                key={source}
                className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                  SOURCE_STYLES[source] ?? "bg-zinc-700 text-zinc-300 border-zinc-600"
                }`}
              >
                {source === "booth" ? t("shop_source_booth") : source === "riperstore" ? t("shop_source_ripper") : source}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Top-right action buttons (cart + download) ─── */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isInInventory ? (
          <button
            className="flex items-center gap-1 bg-violet-900/80 hover:bg-violet-800 border border-violet-500/50 rounded-md px-2 py-1.5 text-[10px] font-semibold text-violet-200 whitespace-nowrap"
            onClick={handleGoToInventory}
            title={t("shop_card_view_in_inventory")}
          >
            <Package className="h-3 w-3" />
            {t("shop_card_view_in_inventory")}
          </button>
        ) : isDownloading ? (
          <div
            className="flex items-center gap-1 bg-zinc-800/90 border border-zinc-700 rounded-md px-2 py-1.5 text-[10px] font-semibold text-zinc-300"
            title={`${dl?.status} ${Math.round(dl?.percentage ?? 0)}%`}
          >
            <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
            {dl?.status === "extracting" ? t("shop_card_extracting") : `${Math.round(dl?.percentage ?? 0)}%`}
          </div>
        ) : (
          <>
            {/* ── Add to cart button ── */}
            <button
              className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold border transition-colors ${
                alreadyInCart
                  ? "bg-amber-900/80 border-amber-500/50 text-amber-300 hover:bg-amber-800/80"
                  : "bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300"
              }`}
              onClick={
                alreadyInCart
                  ? (e) => {
                      e.stopPropagation();
                      setCartOpen(true);
                    }
                  : handleAddToCart
              }
              title={alreadyInCart ? "View in cart" : "Add to cart"}
            >
              <ShoppingCart className="h-3 w-3" />
              {alreadyInCart ? "In cart" : "Add to cart"}
            </button>

            {/* ── Download button (Booth / original source) ── */}
            <button
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md p-1.5"
              onClick={handleDownload}
              title={
                product.source === "booth"
                  ? isPurchased
                    ? t("shop_card_download")
                    : t("shop_card_open_booth")
                  : t("shop_card_download")
              }
            >
              <Download className="h-3.5 w-3.5 text-zinc-300" />
            </button>

            {/* ── Ripper alternative download button ── */}
            {ripperExtra && (
              <button
                className="bg-blue-900/70 hover:bg-blue-800/80 border border-blue-500/40 rounded-md p-1.5"
                onClick={handleRipperDownload}
                title={`${t("shop_card_download")} (${t("shop_card_free")})`}
              >
                <Download className="h-3.5 w-3.5 text-blue-300" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}