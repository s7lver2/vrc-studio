import { create } from "zustand";
import {
  InventoryItem,
  InventoryFolder,
  DeleteMode,
  tauriListInventory,
  tauriListInventoryFolders,
  tauriDeleteInventoryItem,
  tauriCreateInventoryFolder,
  tauriMoveItemToFolder,
  tauriTagInventoryItem,
  tauriImportLocalPackage,
  tauriCompressItem,
  tauriDecompressItem
} from "../lib/tauri";

interface ImportLocalArgs {
  zip_path: string;
  name: string;
  author?: string;
  thumbnail_url?: string;
  booth_id?: string;
}

// ── Advanced search query parsing ─────────────────────────────────────────────
// Supported syntax:
//   tags:base          → item must have tag "base"
//   tag:base           → alias for tags:
//   author:yoshino     → author contains "yoshino"
//   name:shadowveil    → name contains "shadowveil"
//   <bare text>        → searches name and author

export interface ParsedQuery {
  tags: string[];      // tags: or tag: tokens
  authors: string[];   // author: tokens
  names: string[];     // name: tokens
  bare: string;        // leftover free text
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = { tags: [], authors: [], names: [], bare: "" };
  const parts = raw.trim().split(/\s+/);
  const bareWords: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).toLowerCase();
      const val = part.slice(colonIdx + 1).toLowerCase();
      if (!val) { bareWords.push(part); continue; }
      if (key === "tag" || key === "tags") {
        result.tags.push(val);
      } else if (key === "author") {
        result.authors.push(val);
      } else if (key === "name") {
        result.names.push(val);
      } else {
        bareWords.push(part);
      }
    } else {
      bareWords.push(part);
    }
  }

  result.bare = bareWords.join(" ");
  return result;
}

export function matchesQuery(item: InventoryItem, parsed: ParsedQuery): boolean {
  // All tag filters must match
  for (const tag of parsed.tags) {
    if (!item.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().includes(tag))) return false;
  }
  // All author filters must match
  for (const author of parsed.authors) {
    if (!(item.author ?? "").toLowerCase().includes(author)) return false;
  }
  // All name filters must match
  for (const name of parsed.names) {
    if (!item.name.toLowerCase().includes(name)) return false;
  }
  // Bare text must match name or author
  if (parsed.bare.trim()) {
    const q = parsed.bare.toLowerCase();
    const inName = item.name.toLowerCase().includes(q);
    const inAuthor = (item.author ?? "").toLowerCase().includes(q);
    if (!inName && !inAuthor) return false;
  }
  return true;
}

// ── Store ──────────────────────────────────────────────────────────────────────

interface InventoryState {
  items: InventoryItem[];
  folders: InventoryFolder[];
  selectedFolderId: string | null;
  selectedItem: InventoryItem | null;
  viewMode: "grid" | "list";
  searchQuery: string;
  loading: boolean;
  error: string | null;

  fetchAll: () => Promise<void>;
  setViewMode: (m: "grid" | "list") => void;
  setSearchQuery: (q: string) => void;
  selectFolder: (id: string | null) => void;
  selectItem: (item: InventoryItem | null) => void;
  removeItem: (id: string, mode: DeleteMode) => Promise<void>;
  addFolder: (name: string, parentId?: string) => Promise<void>;
  moveItem: (itemId: string, folderId: string) => Promise<void>;
  updateTags: (itemId: string, tags: string[]) => Promise<void>;
  importLocalPackage: (args: ImportLocalArgs) => Promise<string>;
  compressItem: (id: string) => Promise<void>;
  decompressItem: (id: string) => Promise<void>;
  filteredItems: () => InventoryItem[];
  parsedQuery: () => ParsedQuery;
  hasActiveFilters: () => boolean;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  folders: [],
  selectedFolderId: null,
  selectedItem: null,
  viewMode: "grid",
  searchQuery: "",
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [items, folders] = await Promise.all([
        tauriListInventory(),
        tauriListInventoryFolders(),
      ]);
      set({ items, folders, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setViewMode: (m) => set({ viewMode: m }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  selectFolder: (id) => set({ selectedFolderId: id }),
  selectItem: (item) => set({ selectedItem: item }),

  removeItem: async (id, mode) => {
    await tauriDeleteInventoryItem(id, mode);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },

  addFolder: async (name, parentId) => {
    const id = await tauriCreateInventoryFolder(name, parentId);
    set((s) => ({
      folders: [...s.folders, { id, name, parent_id: parentId ?? null }],
    }));
  },

  moveItem: async (itemId, folderId) => {
    await tauriMoveItemToFolder(itemId, folderId);
  },

  updateTags: async (itemId, tags) => {
    await tauriTagInventoryItem(itemId, tags);
    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId ? { ...i, tags } : i
      ),
    }));
  },

  importLocalPackage: async (args) => {
    const newId = await tauriImportLocalPackage(args);
    const [items] = await Promise.all([tauriListInventory()]);
    set({ items });
    return newId;
  },

  compressItem: async (id) => {
    await tauriCompressItem(id);
    const [items] = await Promise.all([tauriListInventory()]);
    set({ items });
  },

  decompressItem: async (id) => {
    await tauriDecompressItem(id);
    const [items] = await Promise.all([tauriListInventory()]);
    set({ items });
  },

  parsedQuery: () => {
    return parseSearchQuery(get().searchQuery);
  },

  hasActiveFilters: () => {
    const { searchQuery } = get();
    if (!searchQuery.trim()) return false;
    const parsed = parseSearchQuery(searchQuery);
    return parsed.tags.length > 0 || parsed.authors.length > 0 || parsed.names.length > 0 || parsed.bare.trim().length > 0;
  },

  filteredItems: () => {
    const { items, searchQuery } = get();
    if (!searchQuery.trim()) return items;
    const parsed = parseSearchQuery(searchQuery);
    return items.filter((i) => matchesQuery(i, parsed));
  },
}));