import { useTrackerStore } from "@/store/trackerStore";
import { Bell, BellOff, CheckCheck, Package, ExternalLink } from "lucide-react";
import type { TrackerEvent, TrackerItem } from "@/lib/tauri";

const EVENT_LABELS: Record<string, string> = {
  price_drop: "Price drop",
  price_change: "Price change",
  back_in_stock: "Back in stock",
  new_item: "New item",
};

const EVENT_ACCENT: Record<string, string> = {
  price_drop: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  price_change: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  back_in_stock: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  new_item: "text-violet-400 bg-violet-500/10 border-violet-500/20",
};

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
  items: TrackerItem[];
  onSelectItem: (item: TrackerItem) => void;
}

export function NotificationsPanel({ items, onSelectItem }: Props) {
  const { events, markRead } = useTrackerStore();

  // Solo eventos no leídos, más recientes primero
  const unread = events
    .filter((e) => !e.is_read)
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));

  const markAll = () => {
    const ids = unread.map((e) => e.id);
    if (ids.length > 0) markRead(ids);
  };

  if (unread.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-24">
        <div className="p-5 rounded-2xl bg-zinc-800/40 border border-zinc-700/30">
          <BellOff className="w-7 h-7 text-zinc-600" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-400">All caught up</p>
          <p className="text-xs text-zinc-600 mt-1">No unread notifications</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-100">Notifications</span>
          <span className="text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded-full">
            {unread.length}
          </span>
        </div>
        <button
          onClick={markAll}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <CheckCheck className="w-3.5 h-3.5" />
          Mark all read
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {unread.map((ev) => {
          const trackerItem = itemMap[ev.tracker_item_id];
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(ev.payload); } catch { }

          const accent = EVENT_ACCENT[ev.event_type] ?? "text-zinc-400 bg-zinc-800 border-zinc-700";

          return (
            <button
              key={ev.id}
              onClick={() => {
                markRead([ev.id]);
                if (trackerItem) onSelectItem(trackerItem);
              }}
              className="w-full flex items-start gap-3 p-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 hover:bg-zinc-800/40 transition-colors text-left group"
            >
              {/* Thumbnail */}
              <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700/40">
                {trackerItem?.item_thumbnail_url ? (
                  <img
                    src={trackerItem.item_thumbnail_url}
                    className="w-full h-full object-cover"
                    alt=""
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package className="w-4 h-4 text-zinc-600" />
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${accent}`}>
                    {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    {formatRelative(ev.detected_at)}
                  </span>
                </div>
                <p className="text-xs font-medium text-zinc-200 truncate mt-0.5">
                  {trackerItem?.item_name ?? trackerItem?.author_name ?? trackerItem?.search_keyword ?? "Unknown"}
                </p>
                {ev.event_type === "price_drop" || ev.event_type === "price_change" ? (
                  <p className="text-xs text-emerald-400 mt-0.5">
                    ¥{(payload.new_price as string | number) ?? "—"}
                  </p>
                ) : ev.event_type === "new_item" && payload.url ? (
                  <a
                    href={payload.url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-violet-400 hover:text-violet-300 mt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="w-2.5 h-2.5" /> View on Booth
                  </a>
                ) : null}
              </div>

              {/* Unread dot */}
              <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0 mt-1.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}