import { create } from "zustand";
import {
  TrackerItem,
  TrackerEvent,
  CreateTrackerItemPayload,
  UpdateTrackerItemPayload,
  tauriTrackerList,
  tauriTrackerCreate,
  tauriTrackerUpdate,
  tauriTrackerDelete,
  tauriTrackerListEvents,
  tauriTrackerMarkEventsRead,
  tauriTrackerUnreadCount,
} from "@/lib/tauri";

interface TrackerState {
  items: TrackerItem[];
  events: TrackerEvent[];
  unreadCount: number;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  createItem: (payload: CreateTrackerItemPayload) => Promise<TrackerItem>;
  updateItem: (id: string, payload: UpdateTrackerItemPayload) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  loadEvents: (trackerItemId?: string) => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
}

export const useTrackerStore = create<TrackerState>((set, get) => ({
  items: [],
  events: [],
  unreadCount: 0,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [items, count] = await Promise.all([
        tauriTrackerList(),
        tauriTrackerUnreadCount(),
      ]);
      set({ items, unreadCount: count, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createItem: async (payload) => {
    const item = await tauriTrackerCreate(payload);
    set((s) => ({ items: [item, ...s.items] }));
    return item;
  },

  updateItem: async (id, payload) => {
    const updated = await tauriTrackerUpdate(id, payload);
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? updated : i)),
    }));
  },

  deleteItem: async (id) => {
    await tauriTrackerDelete(id);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },

  loadEvents: async (trackerItemId) => {
    const events = await tauriTrackerListEvents({ trackerItemId });
    set({ events });
  },

  markRead: async (ids) => {
    await tauriTrackerMarkEventsRead(ids);
    set((s) => ({
      events: s.events.map((e) =>
        ids.includes(e.id) ? { ...e, is_read: true } : e
      ),
    }));
    get().refreshUnreadCount();
  },

  refreshUnreadCount: async () => {
    const count = await tauriTrackerUnreadCount();
    set({ unreadCount: count });
  },
}));