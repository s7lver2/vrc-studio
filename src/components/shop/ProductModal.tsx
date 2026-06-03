import { useEffect, useRef, useState } from "react";
import {
  X, ExternalLink, Download, Loader2, ShoppingCart,
  CheckCircle2, AlertCircle, Store,
  ChevronRight, Package, Bookmark
} from "lucide-react";
import { useShopStore } from "../../store/shopStore";
import { useInventoryStore } from "../../store/inventoryStore";
import { useCartStore } from "../../store/cartStore";
import { useCollectionsStore } from "../../store/collectionsStore";
import { useAppStore } from "../../store/app";
import { useDownloadProgress } from "../../hooks/useDownloadProgress";
import { AddTrackerModal } from "@/components/tracker/AddTrackerModal";
import {
  ShopProduct, BoothProductDetail,
  tauriStartDownload, tauriGetBoothProductDetail, tauriBoothDownloadFreeItem,
} from "../../lib/tauri";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useT } from "@/i18n";

// ── Gallery ────────────────────────────────────────────────────────────────────

function Gallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [images[0]]);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-zinc-800/60 border border-white/5 group">
        {images[active] ? (
          <img key={images[active]} src={images[active]} alt={name} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">No image</div>
        )}
        {images.length > 1 && (
          <>
            <button onClick={() => setActive(i => (i - 1 + images.length) % images.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">‹</button>
            <button onClick={() => setActive(i => (i + 1) % images.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">›</button>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button key={i} onClick={() => setActive(i)}
              className={["shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all",
                i === active ? "border-zinc-300 opacity-100" : "border-zinc-700 opacity-40 hover:opacity-70"].join(" ")}>
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GallerySkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square rounded-xl bg-zinc-800 animate-pulse" />
      <div className="flex gap-2">
        {[0,1,2,3].map(i => <div key={i} className="w-20 h-20 rounded-lg bg-zinc-800 animate-pulse shrink-0" />)}
      </div>
    </div>
  );
}

function SimilarCard({ product, onClick }: { product: ShopProduct; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="group flex flex-col rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 bg-zinc-900/60 transition-all text-left">
      <div className="aspect-square overflow-hidden bg-zinc-800">
        {product.thumbnail_url
          ? <img src={product.thumbnail_url} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs">—</div>
        }
      </div>
      <div className="p-2 flex flex-col gap-0.5">
        <p className="text-[11px] font-medium text-zinc-200 leading-tight line-clamp-2">{product.name}</p>
        <p className="text-[10px] text-zinc-500 truncate">{product.author}</p>
        <p className="text-[10px] font-bold text-zinc-300 mt-0.5">{product.price_display}</p>
      </div>
    </button>
  );
}

// ── Purchase panel ─────────────────────────────────────────────────────────────

interface PanelProps {
  p: ShopProduct;
  detail: BoothProductDetail | null;
  loading: boolean;
  isPurchased: boolean;
  isFreeBoothItem: boolean;
  isInInventory: boolean;
  onFreeDownload: () => void;
  onDownload: () => void;
  onOpenUrl: (url: string) => void;
  onGoToInventory: () => void;
  downloading: boolean;
  downloadDone: boolean;
  downloadError: string | null;
  dlPercentage: number;
  dlStatus: string | null;
}

function PurchasePanel({ p, detail, loading, isPurchased, isFreeBoothItem, isInInventory, onDownload, onFreeDownload, onOpenUrl, onGoToInventory, downloading, downloadDone, downloadError, dlPercentage, dlStatus }: PanelProps) {
  const t = useT();
  const name = detail?.name || p.name;
  const author = detail?.author || p.author;
  const price = detail?.price_display || p.price_display;

  const { openPicker, getItemCollectionIds } = useCollectionsStore();
  const [isInAnyCollection, setIsInAnyCollection] = useState(false);
  const { addItem: addToCart, isInCart, setOpen: setCartOpen } = useCartStore();
  const alreadyInCart = isInCart(p.source, p.source_id);

  useEffect(() => {
    getItemCollectionIds(p.source, p.source_id).then(ids => setIsInAnyCollection(ids.length > 0)).catch(() => {});
  }, [p.source_id]);

  return (
    <div className="flex flex-col gap-5">
      {/* Author */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center shrink-0">
          <Store className="h-3.5 w-3.5 text-zinc-400" />
        </div>
        <button onClick={() => onOpenUrl(p.url)} className="text-sm text-zinc-300 hover:text-zinc-100 truncate font-medium transition-colors">
          {author || "Unknown shop"}
        </button>
      </div>

      {/* Title */}
      {loading
        ? <div className="space-y-2"><div className="h-6 bg-zinc-800 rounded animate-pulse" /><div className="h-6 bg-zinc-800 rounded animate-pulse w-3/4" /></div>
        : <h2 className="text-xl font-bold text-zinc-50 leading-snug break-words">{name}</h2>
      }

      {/* Status badges */}
      {isInInventory ? (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-semibold">
          <Package className="h-3.5 w-3.5 shrink-0" />{t("shop_modal_already_in_inventory")}
        </div>
      ) : isPurchased ? (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{t("shop_modal_purchased")}
        </div>
      ) : null}

      {/* Avatar compatibility */}
      {p.supported_avatars && p.supported_avatars.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Avatars</span>
          {p.supported_avatars.map(av => (
            <span key={av} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 font-medium">{av}</span>
          ))}
        </div>
      )}

      {/* Collection bookmark */}
      <button
        onClick={() => openPicker(p)}
        className={["flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-sm font-medium transition-all",
          isInAnyCollection
            ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
            : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
        ].join(" ")}
      >
        <Bookmark className={`h-4 w-4 ${isInAnyCollection ? "fill-current text-amber-400" : ""}`} />
        {isInAnyCollection ? "In a collection · Manage" : "Save to collection"}
      </button>

      {/* Avatar base link */}
      {p.avatar_booth_id && (
        <button onClick={() => onOpenUrl(`https://booth.pm/en/items/${p.avatar_booth_id}`)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 hover:border-zinc-500 transition-colors text-left w-full">
          <span className="text-sm">🎭</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-zinc-300">{t("shop_modal_view_avatar_base")}</p>
            <p className="text-[10px] text-zinc-500">booth.pm/en/items/{p.avatar_booth_id}</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        </button>
      )}

      {/* Download/buy block */}
      <div className="rounded-xl border border-zinc-700/50 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 bg-zinc-800/50 border-b border-zinc-700/50">
          <div className="min-w-0 mr-3">
            <p className="text-sm font-semibold text-zinc-100 truncate">{name}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">Digital</p>
          </div>
          <div className="shrink-0 text-right">
            <span className={["text-lg font-black tracking-tight", price === "Free" ? "text-emerald-400" : "text-zinc-100"].join(" ")}>
              {price}
            </span>
            {price !== "Free" && price !== "—" && <span className="text-[10px] text-zinc-500 ml-1">JPY</span>}
          </div>
        </div>

        {downloadError && (
          <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{downloadError}
          </div>
        )}

        <div className="p-3 flex flex-col gap-2">
          {(downloading || (dlStatus && dlStatus !== "done")) && (
            <div className="flex flex-col gap-1.5 px-1">
              <div className="relative h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-200 ease-out bg-blue-500" style={{ width: `${dlPercentage}%` }} />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse" />
              </div>
              <p className="text-[10px] text-zinc-400 text-center font-mono">
                {dlStatus === "extracting" ? t("shop_card_extracting") : `${Math.round(dlPercentage)}%`}
              </p>
            </div>
          )}

          {isInInventory ? (
            <button onClick={onGoToInventory}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all bg-violet-700 hover:bg-violet-600 active:scale-[0.98] text-white">
              <Package className="h-4 w-4" />{t("shop_card_view_in_inventory")}
            </button>
          ) : (
            <div className="flex gap-2">
              {isFreeBoothItem ? (
                <button onClick={downloadDone ? undefined : onFreeDownload} disabled={downloading}
                  className={["flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all text-white",
                    downloadDone ? "bg-emerald-600 cursor-default" : downloading ? "opacity-60 cursor-not-allowed bg-emerald-700" : "bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98]"].join(" ")}>
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : downloadDone ? <CheckCircle2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  {downloadDone ? t("shop_download_done") : t("shop_card_download")}
                </button>
              ) : (
                <button onClick={isPurchased ? onDownload : () => onOpenUrl(p.url)} disabled={downloading}
                  className={["flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all text-white",
                    downloading ? "opacity-60 cursor-not-allowed bg-red-600" : "bg-red-600 hover:bg-red-500 active:scale-[0.98]"].join(" ")}>
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : isPurchased ? <Download className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
                  {downloadDone ? t("shop_download_done") : isPurchased ? t("shop_card_download") : "Buy on Booth"}
                  {!isPurchased && !downloading && <ExternalLink className="h-3.5 w-3.5 opacity-60" />}
                </button>
              )}
              <button onClick={() => { if (alreadyInCart) { setCartOpen(true); } else { addToCart(p); } }}
                className={["flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-sm font-bold border transition-all",
                  alreadyInCart ? "bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25" : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-amber-500/50 hover:text-amber-400"].join(" ")}
                title={alreadyInCart ? "View cart" : "Add to cart"}>
                <ShoppingCart className="h-4 w-4" />
              </button>
            </div>
          )}

          <button onClick={() => onOpenUrl(p.url)}
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 hover:border-zinc-600 transition-colors">
            {t("shop_modal_open_booth")} <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-700/50 overflow-hidden text-xs text-zinc-500">
        <div className="px-4 py-3.5 flex items-start gap-2.5 border-b border-zinc-700/50">
          <Download className="h-3.5 w-3.5 mt-0.5 shrink-0 text-zinc-500" />
          <div>
            <p className="text-zinc-300 font-semibold mb-0.5">{t("shop_modal_download_hint")}</p>
            <p className="leading-snug">{t("shop_modal_download_hint_booth")}</p>
          </div>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span>{t("shop_modal_source_id")}</span>
          <span className="text-zinc-400 font-mono text-[11px]">{p.source_id}</span>
        </div>
      </div>

      <p className="text-[10px] text-zinc-600 leading-relaxed text-center px-2">
        {isFreeBoothItem
          ? "This item is free. It will be downloaded directly from Booth and added to your Inventory."
          : !isPurchased
            ? t("shop_modal_footer_booth_purchase")
            : t("shop_modal_footer_booth_redownload")}
      </p>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

export function ProductModal() {
  const t = useT();
  const { selectedProduct, selectProduct } = useShopStore();
  const { items: inventoryItems } = useInventoryStore();

  const [detail, setDetail] = useState<BoothProductDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const leftRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const p = selectedProduct;
  const boothOwnedIds = useShopStore(s => s.boothOwnedIds);
  const { loadBoothOwnedIds } = useShopStore();
  useEffect(() => { loadBoothOwnedIds(); }, []);
  const setActiveSection = useAppStore(s => s.setActiveSection);
  const { downloads } = useDownloadProgress();

  const isPurchased = p ? (p.source === "booth" && boothOwnedIds.has(p.source_id)) : false;
  const isInInventory = p ? inventoryItems.some(i => i.source === p.source && i.source_id === p.source_id) : false;
  const isFreeBoothItem = p ? p.source === "booth" && (p.price_display === "Free" || p.price_display === "¥0") : false;

  const dl = p ? (downloads[p.source_id] ?? null) : null;
  const dlPercentage = dl?.percentage ?? 0;
  const dlStatus = dl?.status ?? null;

  const handleTrackerCreated = () => { setShowTracker(false); setActiveSection("tracker"); };

  useEffect(() => {
    if (!p) { setDetail(null); setDetailError(null); return; }
    setDownloading(false); setDownloadDone(false); setDownloadError(null); setDetailError(null);
    leftRef.current?.scrollTo({ top: 0 });
    let cancelled = false;
    setLoadingDetail(true); setDetail(null);
    tauriGetBoothProductDetail(p.source_id)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) setDetailError(String(e)); })
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [p?.source_id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") selectProduct(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectProduct]);

  const handleDownload = async () => {
    if (!p) return;
    setDownloadError(null); setDownloading(true);
    try {
      await tauriStartDownload({ source: p.source, source_id: p.source_id, name: p.name, author: p.author, thumbnail_url: p.thumbnail_url });
      setDownloadDone(true);
    } catch (err) { setDownloadError(String(err)); }
    finally { setDownloading(false); }
  };

  const handleFreeDownload = async () => {
    if (!p) return;
    setDownloadError(null); setDownloading(true);
    try {
      await tauriBoothDownloadFreeItem({ source_id: p.source_id, name: p.name, author: p.author, thumbnail_url: p.thumbnail_url });
      setDownloadDone(true);
    } catch (err) { setDownloadError(String(err)); }
    finally { setDownloading(false); }
  };

  const handleOpenUrl = async (url: string) => {
    try { await openUrl(url); } catch { window.open(url, "_blank"); }
  };

  if (!p) return null;

  const images = (detail?.images?.length ? detail.images : [p.thumbnail_url].filter(Boolean)) as string[];
  const description = detail?.description ?? "";
  const similar = detail?.similar ?? [];

  return (
    <div ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === backdropRef.current) selectProduct(null); }}>
      <div className="relative w-full rounded-2xl border border-white/8 shadow-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: 1300, maxHeight: "96vh", background: "linear-gradient(175deg,#19191c 0%,#111113 100%)" }}>

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/80 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 min-w-0">
            <span className="shrink-0">Shop</span>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="shrink-0 font-medium text-red-400">Booth.pm</span>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-zinc-400 truncate">{p.name}</span>
          </div>
          <button onClick={() => selectProduct(null)}
            className="ml-4 shrink-0 p-1.5 rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* LEFT — gallery + description */}
          <div ref={leftRef} className="w-[540px] shrink-0 overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "#3f3f46 transparent" }}>
            <div className="p-8 md:p-10 flex flex-col gap-10">
              {loadingDetail ? <GallerySkeleton /> : <Gallery images={images} name={p.name} />}
              <section>
                <div className="h-px bg-zinc-800 mb-5" />
                {detailError && !loadingDetail && (
                  <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="break-all">{detailError}</span>
                  </div>
                )}
                {loadingDetail ? (
                  <div className="space-y-2">
                    {[100, 88, 94, 72, 85, 60].map((w, i) => (
                      <div key={i} className="h-3 rounded bg-zinc-800 animate-pulse" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : description ? (
                  <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{description}</p>
                ) : (
                  <p className="text-sm text-zinc-600 italic">{t("shop_modal_no_description")}</p>
                )}
              </section>
              {(similar.length > 0 || loadingDetail) && (
                <section className="flex flex-col gap-4">
                  <div className="h-px bg-zinc-800" />
                  <h3 className="text-xs font-bold tracking-widest text-zinc-500 uppercase">{t("shop_modal_similar")}</h3>
                  {loadingDetail ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="rounded-lg overflow-hidden border border-zinc-800">
                          <div className="aspect-square bg-zinc-800 animate-pulse" />
                          <div className="p-2 space-y-1.5">
                            <div className="h-2.5 bg-zinc-800 rounded animate-pulse w-4/5" />
                            <div className="h-2 bg-zinc-800 rounded animate-pulse w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {similar.map(s => (
                        <SimilarCard key={`${s.source}-${s.source_id}`} product={s} onClick={() => selectProduct(s)} />
                      ))}
                    </div>
                  )}
                </section>
              )}
              <div className="h-4" />
            </div>
          </div>

          {/* RIGHT — purchase panel */}
          <div className="flex-1 min-w-0 border-l border-zinc-800/80 overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "#3f3f46 transparent" }}>
            <div className="p-8">
              <PurchasePanel
                p={p} detail={detail} loading={loadingDetail}
                isPurchased={isPurchased} isInInventory={isInInventory} isFreeBoothItem={isFreeBoothItem}
                onDownload={handleDownload} onFreeDownload={handleFreeDownload}
                onOpenUrl={handleOpenUrl}
                onGoToInventory={() => { selectProduct(null); setActiveSection("inventory"); }}
                downloading={downloading} downloadDone={downloadDone} downloadError={downloadError}
                dlPercentage={dlPercentage} dlStatus={dlStatus}
              />
            </div>
          </div>
        </div>

        {showTracker && p && (
          <AddTrackerModal
            onClose={() => setShowTracker(false)}
            prefill={{ kind: "item", boothId: p.source_id, itemName: p.name, itemAuthor: p.author, itemThumbnailUrl: p.thumbnail_url, itemUrl: p.url }}
            onCreated={handleTrackerCreated}
          />
        )}
      </div>
    </div>
  );
}
