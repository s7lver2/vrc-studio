import { useEffect, useState } from "react";
import { Bell, Plus, AlertCircle, RefreshCw  } from "lucide-react";
import { useTrackerStore } from "@/store/trackerStore";
import { TrackerItemCard } from "@/components/tracker/TrackerItemCard";
import { TrackerDetailModal } from "@/components/tracker/TrackerDetailModal";
import { AddTrackerModal } from "@/components/tracker/AddTrackerModal";
import { listen } from "@tauri-apps/api/event";
import type { TrackerItem } from "@/lib/tauri";

export default function TrackerPage() {
  const { items, events, unreadCount, load, loadEvents, markRead, runNow, scanning } = useTrackerStore();
  const [showAdd, setShowAdd] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "items" | "authors">("all");
  const [selectedItem, setSelectedItem] = useState<TrackerItem | null>(null);

  useEffect(() => {
    load();
    loadEvents();
    const unlisten = listen("tracker:update", () => {
      load();
      loadEvents();
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const unreadEventIds = events.filter((e) => !e.is_read).map((e) => e.id);

  const filteredItems = items.filter((item) => {
    if (activeTab === "items") return item.kind === "item";
    if (activeTab === "authors") return item.kind === "author";
    return true;
  });

  const eventCountByItem = events.reduce<Record<string, number>>((acc, e) => {
    if (!e.is_read) acc[e.tracker_item_id] = (acc[e.tracker_item_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-zinc-800 px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Tracker</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {items.length > 0 ? `${items.length} item${items.length !== 1 ? "s" : ""} monitored` : "No items tracked yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={() => markRead(unreadEventIds)}
              className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await runNow();
              } catch (e) {
                console.error("Scan all failed:", e)
                }
            }}
            disabled={scanning}
            className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors disabled:opacity-50"
            title="Scan all tracked items now"
          >
            <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning…" : "Scan All"}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      <div className="flex items-center gap-0.5 px-8 pt-4 border-b border-zinc-800">
        {(["all", "items", "authors"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-sm capitalize font-medium border-b-2 transition-all duration-150 -mb-px ${
              activeTab === tab
                ? "border-red-500 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="rounded-2xl bg-zinc-800/50 border border-zinc-700/30 p-5">
              <AlertCircle className="w-8 h-8 text-zinc-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-400">No items tracked yet</p>
              <p className="text-xs text-zinc-600 mt-1">Add your first tracker to start monitoring prices and availability.</p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add tracker
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredItems.map((item) => (
              <TrackerItemCard
                key={item.id}
                item={item}
                eventCount={eventCountByItem[item.id] ?? 0}
                onDetail={() => setSelectedItem(item)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddTrackerModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { load(); loadEvents(); }}
        />
      )}
      {selectedItem && (
        <TrackerDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}