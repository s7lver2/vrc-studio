import { Bell, BellOff, Trash2, ExternalLink, TrendingDown, Package } from "lucide-react";
import { useTrackerStore } from "@/store/trackerStore";
import type { TrackerItem } from "@/lib/tauri";

interface TrackerItemCardProps {
  item: TrackerItem;
  eventCount: number;
  onDetail: () => void;  // añadido
}

export function TrackerItemCard({ item, eventCount, onDetail }: TrackerItemCardProps) {
  const { updateItem, deleteItem } = useTrackerStore();

  const toggleActive = () => updateItem(item.id, { is_active: !item.is_active });

  const thumbnail = item.kind === "item" ? item.item_thumbnail_url : null;
  const title = item.kind === "item" ? item.item_name ?? "Unknown item" : item.author_name ?? "Unknown author";
  const subtitle = item.kind === "item" ? item.item_author : "Author tracker";

  return (
    <div className="relative">
      <button
        onClick={onDetail}
        className={`w-full flex gap-3 p-3 rounded-xl border transition-colors text-left ${
          item.is_active
            ? "bg-zinc-800/60 border-zinc-700 hover:border-zinc-600"
            : "bg-zinc-900/40 border-zinc-800 opacity-60"
        }`}
      >
        {thumbnail ? (
          <img src={thumbnail} className="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-zinc-700" />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-zinc-700 flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-zinc-500" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-zinc-100 truncate">{title}</p>
              {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
            </div>
            {eventCount > 0 && (
              <span className="flex-shrink-0 bg-violet-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {eventCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            {item.last_known_price && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <TrendingDown className="w-3 h-3" />
                {item.last_known_price}
              </span>
            )}
            <span className="text-xs text-zinc-600">
              every {item.check_interval_minutes >= 60
                ? `${item.check_interval_minutes / 60}h`
                : `${item.check_interval_minutes}m`}
            </span>
            {item.item_url && (
              <a
                href={item.item_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-500 hover:text-violet-400 flex items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </button>
      {/* Botones de acción superpuestos */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); toggleActive(); }}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 bg-zinc-900/80"
          title={item.is_active ? "Pause tracking" : "Resume tracking"}
        >
          {item.is_active ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-700 bg-zinc-900/80"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}