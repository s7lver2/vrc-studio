import { useState, useEffect } from "react";
import { X, Search, Bell, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrackerStore } from "@/store/trackerStore";
import { tauriGetBoothProductDetail } from "@/lib/tauri";
import type { CreateTrackerItemPayload, TrackerKind } from "@/lib/tauri";
import { BoothProductPickerModal } from "./BoothProductPickerModal";
import { BoothAuthorPickerModal } from "./BoothAuthorPickerModal";

interface AddTrackerModalProps {
  onClose: () => void;
  prefill?: {
    kind: TrackerKind;
    boothId?: string;
    itemName?: string;
    itemAuthor?: string;
    itemThumbnailUrl?: string;
    itemUrl?: string;
    authorName?: string;
    authorBoothShopId?: string;
  };
  onCreated?: () => void;
}

export function AddTrackerModal({ onClose, prefill, onCreated }: AddTrackerModalProps) {
  const { createItem } = useTrackerStore();
  const [kind, setKind] = useState<TrackerKind>(prefill?.kind ?? "item");
  const [boothId, setBoothId] = useState(prefill?.boothId ?? "");
  const [itemName, setItemName] = useState(prefill?.itemName ?? "");
  const [itemAuthor, setItemAuthor] = useState(prefill?.itemAuthor ?? "");
  const [boothItemPickerOpen, setBoothItemPickerOpen] = useState(false);
  const [boothAuthorPickerOpen, setBoothAuthorPickerOpen] = useState(false);
  const [itemThumbnail, setItemThumbnail] = useState(prefill?.itemThumbnailUrl ?? "");
  const [itemUrl, setItemUrl] = useState(prefill?.itemUrl ?? "");
  const [authorName, setAuthorName] = useState(prefill?.authorName ?? "");
  const [authorShopId, setAuthorShopId] = useState(prefill?.authorBoothShopId ?? "");
  const [trackPriceDrops, setTrackPriceDrops] = useState(true);
  const [trackAvailability, setTrackAvailability] = useState(true);
  const [trackNewItems, setTrackNewItems] = useState(true);
  const [interval, setInterval] = useState(60);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefill || kind !== "item" || !boothId.trim()) return;
    const timer = setTimeout(async () => {
      if (!/^\d{5,8}$/.test(boothId.trim())) return;
      setFetching(true);
      try {
        const detail = await tauriGetBoothProductDetail(boothId.trim());
        setItemName(detail.name);
        setItemAuthor(detail.author);
        setItemThumbnail(detail.images[0] ?? "");
        setItemUrl(detail.url);
      } catch { /* ignorar */ }
      setFetching(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [boothId, kind, prefill]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload: CreateTrackerItemPayload = {
        kind,
        check_interval_minutes: interval,
        ...(kind === "item"
          ? {
              booth_id: boothId || undefined,
              item_name: itemName || undefined,
              item_author: itemAuthor || undefined,
              item_thumbnail_url: itemThumbnail || undefined,
              item_url: itemUrl || undefined,
              track_price_drops: trackPriceDrops,
              track_availability: trackAvailability,
            }
          : {
              author_name: authorName || undefined,
              author_booth_shop_id: authorShopId || undefined,
              track_new_items: trackNewItems,
            }),
      };
      await createItem(payload);
      onCreated?.();
      onClose();
    } catch (e) {
      setError(String(e));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      {boothItemPickerOpen && (
        <BoothProductPickerModal
          onClose={() => setBoothItemPickerOpen(false)}
          onSelect={(p) => {
            setBoothId(p.boothId);
            setItemName(p.name);
            setItemAuthor(p.author);
            setItemThumbnail(p.thumbnailUrl);
            setItemUrl(p.url);
          }}
        />
      )}
      {boothAuthorPickerOpen && (
        <BoothAuthorPickerModal
          onClose={() => setBoothAuthorPickerOpen(false)}
          onSelect={(a) => {
            setAuthorName(a.name);
            setAuthorShopId(a.shopId ?? "");
          }}
        />
      )}
      <div className="w-full max-w-[520px] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-zinc-800 border border-zinc-700/50">
              <Bell className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Add to Tracker</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">Monitor price drops, availability and new releases</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors ml-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!prefill && (
          <div className="px-6 pt-5 shrink-0">
            <div className="flex gap-2 p-1 rounded-xl bg-zinc-900 border border-zinc-800">
              {(["item", "author"] as TrackerKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-xs font-semibold transition-all capitalize",
                    kind === k
                      ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {k === "item" ? "Booth Item" : "Author / Shop"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {kind === "item" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Booth ID</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      value={boothId}
                      onChange={(e) => setBoothId(e.target.value)}
                      placeholder="e.g. 6082686"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors pr-8"
                    />
                    {fetching && (
                      <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-violet-400 animate-pulse" />
                    )}
                  </div>
                  <button
                    onClick={() => setBoothItemPickerOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
                    title="Search Booth"
                  >
                    <Search className="h-3.5 w-3.5" /> Search
                  </button>
                </div>
              </div>

              {itemName && (
                <div className="flex gap-3 p-3.5 bg-zinc-900 rounded-xl border border-zinc-800">
                  {itemThumbnail && (
                    <img src={itemThumbnail} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">{itemName}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{itemAuthor}</p>
                  </div>
                </div>
              )}

              {!itemName && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Name (manual)</label>
                  <input
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="Item name"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                </div>
              )}

              <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
                {[
                  { key: "trackPriceDrops" as const, label: "Price changes", setter: setTrackPriceDrops, value: trackPriceDrops },
                  { key: "trackAvailability" as const, label: "Availability / back in stock", setter: setTrackAvailability, value: trackAvailability },
                ].map(({ key, label, setter, value }) => (
                  <label key={key} className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
                    <span className="text-sm text-zinc-300">{label}</span>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => setter(e.target.checked)}
                      className="accent-violet-500 w-4 h-4"
                    />
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Author Name</label>
                <div className="flex gap-2">
                  <input
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="e.g. Karin Lena"
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                  <button
                    onClick={() => setBoothAuthorPickerOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
                    title="Search Booth author"
                  >
                    <Search className="h-3.5 w-3.5" /> Search
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Booth Shop ID <span className="text-zinc-700 normal-case">(optional)</span>
                </label>
                <input
                  value={authorShopId}
                  onChange={(e) => setAuthorShopId(e.target.value)}
                  placeholder="e.g. karin-lena"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
                />
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900">
                <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
                  <span className="text-sm text-zinc-300">Track new items by this author</span>
                  <input
                    type="checkbox"
                    checked={trackNewItems}
                    onChange={(e) => setTrackNewItems(e.target.checked)}
                    className="accent-violet-500 w-4 h-4"
                  />
                </label>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Check Every</label>
            <select
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={180}>3 hours</option>
              <option value={360}>6 hours</option>
              <option value={720}>12 hours</option>
              <option value={1440}>24 hours</option>
            </select>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-950/40 border border-red-900/50 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-zinc-800 px-6 py-4 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add to Tracker"}
          </button>
        </div>
      </div>
    </div>
  );
}