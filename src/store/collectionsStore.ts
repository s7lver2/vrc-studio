import { create } from "zustand";
import {
  Collection,
  CollectionItem,
  ShopProduct,
  tauriCollectionsList,
  tauriCollectionCreate,
  tauriCollectionDelete,
  tauriCollectionRename,
  tauriCollectionSetCover,
  tauriCollectionAddItem,
  tauriCollectionRemoveItem,
  tauriCollectionGetItems,
  tauriCollectionGetItemCollections,
  tauriCollectionUpdateDescription,
  tauriCollectionMoveToParent,
  tauriCollectionsReorder,
  tauriCollectionItemsReorder,
  tauriCollectionItemMove,
} from "../lib/tauri";

interface CollectionsState {
  collections: Collection[];
  // picker modal state
  pickerOpen: boolean;
  pickerProduct: ShopProduct | null;

  load: () => Promise<void>;
  createCollection: (name: string) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  setCover: (id: string, coverUrl: string) => Promise<void>;
  addItemToCollection: (collectionId: string, product: ShopProduct) => Promise<void>;
  removeItemFromCollection: (collectionId: string, source: string, source_id: string) => Promise<void>;
  getCollectionItems: (collectionId: string) => Promise<CollectionItem[]>;
  getItemCollectionIds: (source: string, source_id: string) => Promise<string[]>;
  updateDescription: (id: string, description: string) => Promise<void>;
  moveCollectionToParent: (id: string, parentId: string | null) => Promise<void>;
  reorderCollections: (ids: string[]) => Promise<void>;
  reorderItems: (collectionId: string, ids: string[]) => Promise<void>;
  moveItem: (itemId: string, fromCollectionId: string, toCollectionId: string) => Promise<void>;

  openPicker: (product: ShopProduct) => void;
  closePicker: () => void;
}

export const useCollectionsStore = create<CollectionsState>((set, get) => ({
  collections: [],
  pickerOpen: false,
  pickerProduct: null,

  load: async () => {
    try {
      const collections = await tauriCollectionsList();
      set({ collections });
    } catch (e) {
      console.error("Collections load error:", e);
    }
  },

  createCollection: async (name) => {
    const col = await tauriCollectionCreate(name);
    set((s) => ({ collections: [col, ...s.collections] }));
    return col;
  },

  deleteCollection: async (id) => {
    await tauriCollectionDelete(id);
    set((s) => ({ collections: s.collections.filter((c) => c.id !== id) }));
  },

  renameCollection: async (id, name) => {
    await tauriCollectionRename(id, name);
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === id ? { ...c, name } : c
      ),
    }));
  },

  setCover: async (id, coverUrl) => {
    await tauriCollectionSetCover(id, coverUrl);
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === id ? { ...c, cover_url: coverUrl } : c
      ),
    }));
  },

  addItemToCollection: async (collectionId, product) => {
    await tauriCollectionAddItem(collectionId, {
      source: product.source,
      source_id: product.source_id,
      name: product.name,
      author: product.author,
      thumbnail_url: product.thumbnail_url,
      price_display: product.price_display,
      url: product.url,
    });
    // Incrementar item_count localmente
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, item_count: c.item_count + 1 }
          : c
      ),
    }));
  },

  removeItemFromCollection: async (collectionId, source, source_id) => {
    await tauriCollectionRemoveItem(collectionId, source, source_id);
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, item_count: Math.max(0, c.item_count - 1) }
          : c
      ),
    }));
  },

  getCollectionItems: (collectionId) =>
    tauriCollectionGetItems(collectionId),

  getItemCollectionIds: (source, source_id) =>
    tauriCollectionGetItemCollections(source, source_id),

  openPicker: (product) => set({ pickerOpen: true, pickerProduct: product }),
  closePicker: () => set({ pickerOpen: false, pickerProduct: null }),
  updateDescription: async (id, description) => {
    await tauriCollectionUpdateDescription(id, description);
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === id ? { ...c, description } : c
      ),
    }));
  },

  moveCollectionToParent: async (id, parentId) => {
    await tauriCollectionMoveToParent(id, parentId);
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === id ? { ...c, parent_id: parentId } : c
      ),
    }));
  },

  reorderCollections: async (ids) => {
    await tauriCollectionsReorder(ids);
    set((s) => {
      // Update sort_order values and re-sort the array so renderTree stays in sync
      const updated = s.collections.map((c) => {
        const idx = ids.indexOf(c.id);
        return idx !== -1 ? { ...c, sort_order: idx } : c;
      });
      updated.sort((a, b) => a.sort_order - b.sort_order);
      return { collections: updated };
    });
  },

  // items live in local modal state — only persists, does not update store
  reorderItems: async (collectionId, ids) => {
    await tauriCollectionItemsReorder(collectionId, ids);
  },

  moveItem: async (itemId, fromCollectionId, toCollectionId) => {
    await tauriCollectionItemMove(itemId, fromCollectionId, toCollectionId);
    // Refetch to get accurate item_counts (handles duplicate-in-target case)
    try {
      const updated = await tauriCollectionsList();
      set({ collections: updated });
    } catch {
      // Fallback to optimistic update if refetch fails
      set((s) => ({
        collections: s.collections.map((c) => {
          if (c.id === fromCollectionId) return { ...c, item_count: Math.max(0, c.item_count - 1) };
          if (c.id === toCollectionId)   return { ...c, item_count: c.item_count + 1 };
          return c;
        }),
      }));
    }
  },
}));