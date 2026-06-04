import { Bell, BellOff, Package } from "lucide-react";
import type { TrackerItem } from "@/lib/tauri";
import { useT } from "@/i18n";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  item: TrackerItem;
  eventCount: number;
  isSelected: boolean;
  onSelect: () => void;
}

export function TrackerItemCard({ item, eventCount, isSelected, onSelect }: Props) {
  const t = useT();
  const thumbnail = item.item_thumbnail_url;
  const title = item.item_name ?? item.author_name ?? item.search_keyword ?? "Unknown";
  const subtitle = item.kind === "item" ? item.item_author : item.kind === "keyword" ? t("tracker_modal_tab_keyword") : t("tracker_modal_tab_author");

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${
        isSelected
          ? "border-red-500/40 bg-zinc-800/70"
          : item.is_active
            ? "border-transparent hover:border-zinc-700 hover:bg-zinc-800/40"
            : "border-transparent opacity-50 hover:opacity-70 hover:bg-zinc-800/20"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative shrink-0">
        {thumbnail ? (
          <img src={thumbnail} className="w-9 h-9 rounded-lg object-cover bg-zinc-700" alt="" />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center">
            <Package className="w-4 h-4 text-zinc-600" />
          </div>
        )}
        {!item.is_active && (
          <div className="absolute inset-0 rounded-lg flex items-center justify-center bg-zinc-900/60">
            <BellOff className="w-3 h-3 text-zinc-500" />
          </div>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-zinc-100 truncate leading-tight">{title}</p>
        <p className="text-[10px] text-zinc-600 truncate mt-0.5">{subtitle}</p>
        {item.last_known_price && (
          <p className="text-[10px] font-mono font-bold text-emerald-400 mt-0.5">{item.last_known_price}</p>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {eventCount > 0 && (
          <span className="bg-violet-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {eventCount}
          </span>
        )}
        {item.last_checked_at && (
          <span className="text-[9px] text-zinc-700 tabular-nums">
            {formatRelative(item.last_checked_at)}
          </span>
        )}
      </div>
    </button>
  );
}
