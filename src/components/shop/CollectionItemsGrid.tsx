// src/components/shop/CollectionItemsGrid.tsx
import { useState } from "react";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Package2, Image, BookmarkX, ShoppingCart, Download, Loader2 } from "lucide-react";
import type { CollectionItem, BoothDownloadable } from "../../lib/tauri";
import { tauriStartDownload, tauriBoothListDownloadables } from "../../lib/tauri";
import { useCartStore } from "../../store/cartStore";
import { useShopStore } from "../../store/shopStore";
import type { ShopProduct } from "../../lib/tauri";
import { BoothDownloadPickerModal } from "./BoothDownloadPickerModal";

// ── SortableItemCard ─────────────────────────────────────────────────────────

interface CardProps {
  item: CollectionItem;
  onSetCover: (url: string) => void;
  onRemove: (item: CollectionItem) => void;
}

function SortableItemCard({ item, onSetCover, onRemove }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `item:${item.id}` });

  const { isInCart, addItem, removeItem } = useCartStore();
  const { boothOwnedIds, selectProduct } = useShopStore();

  const [isStarting, setIsStarting] = useState(false);
  const [downloadables, setDownloadables] = useState<BoothDownloadable[] | null>(null);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    cursor: "grab",
    touchAction: "none",
  };

  const inCart = isInCart(item.source, item.source_id);
  const isPurchased = item.source === "booth" && boothOwnedIds.has(item.source_id);

  const handleOpenProduct = () => {
    selectProduct({
      source: item.source as ShopProduct["source"],
      source_id: item.source_id,
      name: item.name,
      author: item.author,
      thumbnail_url: item.thumbnail_url,
      price_display: item.price_display,
      url: item.url,
    });
  };

  const handleCartToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inCart) {
      await removeItem(item.source, item.source_id);
    } else {
      await addItem({
        source: item.source as "booth",
        source_id: item.source_id,
        name: item.name,
        author: item.author,
        thumbnail_url: item.thumbnail_url,
        price_display: item.price_display,
        url: item.url,
      });
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isStarting) return;
    if (item.source !== "booth") {
      setIsStarting(true);
      try {
        await tauriStartDownload({ source: item.source, source_id: item.source_id, name: item.name, author: item.author, thumbnail_url: item.thumbnail_url });
      } finally { setIsStarting(false); }
      return;
    }
    setIsStarting(true);
    try {
      const files = await tauriBoothListDownloadables(item.source_id);
      if (files.length > 1) {
        setDownloadables(files);
      } else {
        await tauriStartDownload({ source: item.source, source_id: item.source_id, name: item.name, author: item.author, thumbnail_url: item.thumbnail_url });
      }
    } catch {
      // fallback: direct download
      try { await tauriStartDownload({ source: item.source, source_id: item.source_id, name: item.name, author: item.author, thumbnail_url: item.thumbnail_url }); } catch { /* ignore */ }
    } finally { setIsStarting(false); }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleOpenProduct}
      className="group relative bg-zinc-900 border border-zinc-800 rounded-[10px] overflow-hidden hover:border-zinc-600 transition-colors select-none"
    >
      {/* Thumbnail */}
      {item.thumbnail_url ? (
        <img
          src={item.thumbnail_url}
          alt=""
          className="w-full aspect-square object-cover bg-zinc-800"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      ) : (
        <div className="w-full aspect-square bg-zinc-800 flex items-center justify-center">
          <Package2 className="h-6 w-6 text-zinc-700" />
        </div>
      )}

      {/* Info */}
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-semibold text-zinc-300 truncate leading-tight">{item.name}</p>
        <p className="text-[9px] text-red-400 font-bold mt-0.5">{item.price_display}</p>
        <p className="text-[8px] text-zinc-600 truncate mt-0.5">{item.author}</p>
      </div>

      {/* Hover actions — stopPropagation prevents drag activation AND card click */}
      <div
        className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {item.thumbnail_url && (
          <button
            onClick={(e) => { e.stopPropagation(); onSetCover(item.thumbnail_url); }}
            className="w-6 h-6 rounded-md bg-zinc-950/80 border border-zinc-700 text-zinc-400 hover:text-zinc-200 flex items-center justify-center backdrop-blur-sm"
            title="Set as collection cover"
          >
            <Image className="h-3 w-3" />
          </button>
        )}
        {isPurchased ? (
          <button
            onClick={handleDownload}
            disabled={isStarting}
            className="w-6 h-6 rounded-md bg-zinc-950/80 border border-zinc-700 text-emerald-400 hover:text-emerald-300 flex items-center justify-center backdrop-blur-sm disabled:opacity-50"
            title="Download"
          >
            {isStarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          </button>
        ) : (
          <button
            onClick={handleCartToggle}
            className={`w-6 h-6 rounded-md bg-zinc-950/80 border border-zinc-700 flex items-center justify-center backdrop-blur-sm ${
              inCart ? "text-red-400 hover:text-red-300" : "text-zinc-400 hover:text-emerald-400"
            }`}
            title={inCart ? "Remove from cart" : "Add to cart"}
          >
            <ShoppingCart className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(item); }}
          className="w-6 h-6 rounded-md bg-zinc-950/80 border border-zinc-700 text-zinc-400 hover:text-red-400 flex items-center justify-center backdrop-blur-sm"
          title="Remove from collection"
        >
          <BookmarkX className="h-3 w-3" />
        </button>
      </div>

      {/* Downloadables picker — shown when item has multiple files */}
      {downloadables && (
        <BoothDownloadPickerModal
          productName={item.name}
          downloadables={downloadables}
          onSelect={async () => {
            setDownloadables(null);
            setIsStarting(true);
            try {
              await tauriStartDownload({ source: item.source, source_id: item.source_id, name: item.name, author: item.author, thumbnail_url: item.thumbnail_url });
            } finally { setIsStarting(false); }
          }}
          onClose={() => setDownloadables(null)}
        />
      )}
    </div>
  );
}

// ── Ghost card (used by DragOverlay in CollectionsModal) ─────────────────────

export function ItemDragGhost({ item }: { item: CollectionItem }) {
  return (
    <div
      className="bg-zinc-900 border border-zinc-600 rounded-[10px] overflow-hidden shadow-2xl"
      style={{ width: 130, transform: "rotate(2deg) scale(1.05)", opacity: 0.93 }}
    >
      {item.thumbnail_url ? (
        <img src={item.thumbnail_url} alt="" className="w-full aspect-square object-cover bg-zinc-800" draggable={false} />
      ) : (
        <div className="w-full aspect-square bg-zinc-800 flex items-center justify-center">
          <Package2 className="h-6 w-6 text-zinc-700" />
        </div>
      )}
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-semibold text-zinc-300 truncate">{item.name}</p>
        <p className="text-[9px] text-red-400 font-bold mt-0.5">{item.price_display}</p>
      </div>
    </div>
  );
}

// ── CollectionItemsGrid ──────────────────────────────────────────────────────

interface Props {
  collectionId: string | null;
  items: CollectionItem[];
  loading: boolean;
  localOrder: string[];          // array of "item:<uuid>" in current display order
  onSetCover: (url: string) => void;
  onRemove: (item: CollectionItem) => void;
}

export function CollectionItemsGrid({ collectionId, items, loading, localOrder, onSetCover, onRemove }: Props) {
  if (!collectionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600 select-none">
        <Package2 className="h-12 w-12 opacity-20" />
        <p className="text-sm">Selecciona una colección</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600 select-none">
        <Package2 className="h-12 w-12 opacity-20" />
        <p className="text-sm font-medium text-zinc-500">Sin items</p>
        <p className="text-xs text-center px-6">Guarda productos desde la tienda para añadirlos aquí</p>
      </div>
    );
  }

  // Re-sort items according to localOrder
  const itemById = new Map(items.map((i) => [i.id, i]));
  const sortedItems = localOrder
    .map((dndId) => itemById.get(dndId.replace("item:", "")))
    .filter(Boolean) as CollectionItem[];

  return (
    <div
      className="flex-1 overflow-y-auto p-3"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
        gap: "8px",
        alignContent: "start",
      }}
    >
      <SortableContext items={localOrder} strategy={rectSortingStrategy}>
        {sortedItems.map((item) => (
          <SortableItemCard
            key={item.id}
            item={item}
            onSetCover={onSetCover}
            onRemove={onRemove}
          />
        ))}
      </SortableContext>
    </div>
  );
}
