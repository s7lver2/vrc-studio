import { create } from "zustand";
import {
  CartItem,
  ShopProduct,
  tauriCartGetItems,
  tauriCartAddItem,
  tauriCartRemoveItem,
  tauriCartClear,
} from "../lib/tauri";

interface CartState {
  items: CartItem[];
  open: boolean;
  loading: boolean;

  load: () => Promise<void>;
  addItem: (product: ShopProduct) => Promise<void>;
  removeItem: (source: string, source_id: string) => Promise<void>;
  clear: () => Promise<void>;
  setOpen: (open: boolean) => void;
  isInCart: (source: string, source_id: string) => boolean;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  open: false,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const items = await tauriCartGetItems();
      set({ items, loading: false });
    } catch (e) {
      console.error("Cart load error:", e);
      set({ loading: false });
    }
  },

  addItem: async (product: ShopProduct) => {
    try {
      const item = await tauriCartAddItem({
        source: product.source,
        source_id: product.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
        price_display: product.price_display,
        url: product.url,
      });
      set((s) => {
        const exists = s.items.some(
          (i) => i.source === item.source && i.source_id === item.source_id
        );
        return exists ? {} : { items: [item, ...s.items] };
      });
    } catch (e) {
      console.error("Cart add error:", e);
    }
  },

  removeItem: async (source, source_id) => {
    try {
      await tauriCartRemoveItem(source, source_id);
      set((s) => ({
        items: s.items.filter(
          (i) => !(i.source === source && i.source_id === source_id)
        ),
      }));
    } catch (e) {
      console.error("Cart remove error:", e);
    }
  },

  clear: async () => {
    try {
      await tauriCartClear();
      set({ items: [] });
    } catch (e) {
      console.error("Cart clear error:", e);
    }
  },

  setOpen: (open) => set({ open }),

  isInCart: (source, source_id) =>
    get().items.some((i) => i.source === source && i.source_id === source_id),
}));