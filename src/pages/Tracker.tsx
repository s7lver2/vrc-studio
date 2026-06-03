import { useEffect, useState } from "react";
import { Bell, Plus, AlertCircle, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useTrackerStore } from "@/store/trackerStore";
import { TrackerItemCard } from "@/components/tracker/TrackerItemCard";
import { TrackerDetailPanel } from "@/components/tracker/TrackerDetailPanel";
import { NotificationsPanel } from "@/components/tracker/NotificationsPanel";
import { AddTrackerModal } from "@/components/tracker/AddTrackerModal";
import { listen } from "@tauri-apps/api/event";
import type { TrackerItem } from "@/lib/tauri";
import { useT } from "../i18n";

type RightView = "notifications" | "detail";

export default function TrackerPage() {
  const t = useT();
  const { items, events, unreadCount, load, loadEvents, markRead, runNow, scanning } = useTrackerStore();
  const [showAdd, setShowAdd] = useState(false);
  const [filterKind, setFilterKind] = useState<"all" | "item" | "author" | "keyword">("all");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<TrackerItem | null>(null);
  const [rightView, setRightView] = useState<RightView>("notifications");

  useEffect(() => {
    load();
    loadEvents();
    const unlisten = listen("tracker:update", () => { load(); loadEvents(); });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const unreadEventIds = events.filter((e) => !e.is_read).map((e) => e.id);

  const filteredItems = items.filter((item) => {
    if (filterKind !== "all" && item.kind !== filterKind) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const haystack = [
        item.item_name, item.item_author, item.author_name, item.search_keyword,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const eventCountByItem = events.reduce<Record<string, number>>((acc, e) => {
    if (!e.is_read) acc[e.tracker_item_id] = (acc[e.tracker_item_id] ?? 0) + 1;
    return acc;
  }, {});

  const handleSelectItem = (item: TrackerItem) => {
    setSelectedItem(item);
    setRightView("detail");
  };

  const handleBack = () => {
    setSelectedItem(null);
    setRightView("notifications");
  };

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── LEFT PANEL: list ───────────────────────────────── */}
      <div className="w-80 shrink-0 flex flex-col border-r border-zinc-800/60 bg-zinc-950">

        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-zinc-800/60 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-sm font-semibold text-zinc-100">Tracker</h1>
              <p className="text-[10px] text-zinc-600 mt-0.5">
                {items.length} monitored
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={async () => { try { await runNow(); } catch (e) { console.error(e); } }}
                disabled={scanning}
                title="Scan all"
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-medium text-white transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 placeholder-zinc-600"
            />
          </div>

          {/* Kind filter pills */}
          <div className="flex gap-1 flex-wrap">
            {(["all", "item", "author", "keyword"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilterKind(k)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all capitalize ${
                  filterKind === k
                    ? "bg-zinc-700 text-zinc-100 border border-zinc-600"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {k === "all" ? `All (${items.length})` : k}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertCircle className="w-6 h-6 text-zinc-700" />
              <div className="text-center">
                <p className="text-xs font-medium text-zinc-500">
                  {items.length === 0 ? "Nothing tracked yet" : "No results"}
                </p>
                {items.length === 0 && (
                  <button
                    onClick={() => setShowAdd(true)}
                    className="mt-3 flex items-center gap-1.5 mx-auto text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add first item
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filteredItems.map((item) => (
                <TrackerItemCard
                  key={item.id}
                  item={item}
                  eventCount={eventCountByItem[item.id] ?? 0}
                  isSelected={selectedItem?.id === item.id}
                  onSelect={() => handleSelectItem(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-950">

        {/* Right header — visible cuando no hay item seleccionado */}
        {rightView === "notifications" && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-semibold text-zinc-100">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markRead(unreadEventIds)}
                className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {rightView === "detail" && selectedItem ? (
            <TrackerDetailPanel item={selectedItem} onBack={handleBack} />
          ) : (
            <NotificationsPanel items={items} onSelectItem={handleSelectItem} />
          )}
        </div>
      </div>

      {showAdd && (
        <AddTrackerModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { load(); loadEvents(); }}
        />
      )}
    </div>
  );
}