import { create } from "zustand";
import { useAppearanceStore } from "./appearanceStore";
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
  tauriSetItemProductImages,
  tauriCompressItem,
  tauriDecompressItem,
  tauriUpdateItemMetadata,
  tauriSetItemCustomCover,
  tauriReorderItems,
  tauriSetItemCustomImages,
  tauriUpdateFolder,
  tauriMoveFolderToParent,
  tauriDeleteInventoryFolder,
  tauriReorderFolders,
} from "../lib/tauri";

interface ImportLocalArgs {
  zip_path: string;
  name: string;
  author?: string;
  thumbnail_url?: string;
  booth_id?: string;
  product_images?: string[];
  overwrite?: boolean;   // ← añadido
}

interface UpdateItemMetadataPayload {
  item_id: string;
  display_name?: string;
  tags?: string[];
}

// ── Advanced search query parsing ─────────────────────────────
export interface ParsedQuery {
  tags: string[];
  authors: string[];
  names: string[];
  bare: string;
  types: string[];
  sources: string[];
  compressed: boolean | null;
  minSizeMb: number | null;
  maxSizeMb: number | null;
  folderName: string | null;
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = {
    tags: [], authors: [], names: [], bare: "",
    types: [], sources: [], compressed: null,
    minSizeMb: null, maxSizeMb: null, folderName: null,
  };
  const parts = raw.trim().split(/\s+/);
  const bareWords: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    const ci = part.indexOf(":");
    if (ci > 0) {
      const key = part.slice(0, ci).toLowerCase();
      const val = part.slice(ci + 1).toLowerCase();
      if (!val) { bareWords.push(part); continue; }
      if (key === "tag" || key === "tags")       result.tags.push(val);
      else if (key === "author")                  result.authors.push(val);
      else if (key === "name")                    result.names.push(val);
      else if (key === "type")                    result.types.push(val);
      else if (key === "source")                  result.sources.push(val);
      else if (key === "compressed")              result.compressed = val === "yes" || val === "true";
      else if (key === "folder")                  result.folderName = val;
      else if (key === "size") {
        if (val.startsWith(">"))      result.minSizeMb = parseFloat(val.slice(1)) || null;
        else if (val.startsWith("<")) result.maxSizeMb = parseFloat(val.slice(1)) || null;
        else                          result.minSizeMb = parseFloat(val) || null;
      } else { bareWords.push(part); }
    } else {
      bareWords.push(part);
    }
  }
  result.bare = bareWords.join(" ");
  return result;
}

export function matchesQuery(item: InventoryItem, parsed: ParsedQuery, folders: InventoryFolder[] = []): boolean {
  for (const tag of parsed.tags) {
    if (!item.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().includes(tag))) return false;
  }
  for (const author of parsed.authors) {
    if (!(item.author ?? "").toLowerCase().includes(author)) return false;
  }
  for (const name of parsed.names) {
    if (!item.name.toLowerCase().includes(name)) return false;
  }
  if (parsed.bare.trim()) {
    const q = parsed.bare.toLowerCase();
    const inName = item.name.toLowerCase().includes(q);
    const inAuthor = (item.author ?? "").toLowerCase().includes(q);
    if (!inName && !inAuthor) return false;
  }
  for (const type of parsed.types) {
    if (!item.tags.some((t) => t.toLowerCase().startsWith(type))) return false;
  }
  for (const src of parsed.sources) {
    if (item.source.toLowerCase() !== src) return false;
  }
  if (parsed.compressed !== null && item.is_compressed !== parsed.compressed) return false;
  if (parsed.minSizeMb !== null && (item.size_bytes ?? 0) < parsed.minSizeMb * 1024 * 1024) return false;
  if (parsed.maxSizeMb !== null && (item.size_bytes ?? Infinity) > parsed.maxSizeMb * 1024 * 1024) return false;
  return true;
}

// ── Store ──────────────────────────────────────────────────────
interface InventoryState {
  items: InventoryItem[];
  debugItems: InventoryItem[]; // ephemeral debug-only items, never fetched from DB
  folders: InventoryFolder[];
  selectedFolderId: string | null;
  selectedItem: InventoryItem | null;
  viewMode: "grid" | "list";
  searchQuery: string;
  loading: boolean;
  error: string | null;
  sortField: SortField;
  sortDir: SortDir;
  selectedItemIds: Set<string>;
  lastSelectedId: string | null;
  /** Set by the vrcstudio:import-package event to trigger the import flow from outside Inventory. */
  pendingImportSource: "scan" | "local" | "url" | null;

  fetchAll: () => Promise<void>;
  setViewMode: (m: "grid" | "list") => void;
  setSearchQuery: (q: string) => void;
  selectFolder: (id: string | null) => void;
  selectItem: (item: InventoryItem | null) => void;
  removeItem: (id: string, mode: DeleteMode) => Promise<void>;
  addFolder: (name: string, parentId?: string) => Promise<void>;
  moveItem: (itemId: string, folderId: string | null) => Promise<void>;
  updateTags: (itemId: string, tags: string[]) => Promise<void>;
  importLocalPackage: (args: ImportLocalArgs) => Promise<string>;
  compressItem: (id: string) => Promise<void>;
  decompressItem: (id: string) => Promise<void>;
  filteredItems: () => InventoryItem[];
  parsedQuery: () => ParsedQuery;
  hasActiveFilters: () => boolean;
  setSortField: (f: SortField) => void;
  setSortDir: (d: SortDir) => void;
  loadItems: () => Promise<void>;
  toggleSelectItem: (id: string) => void;
  selectAllItems: () => void;
  clearSelection: () => void;
  addDebugItems: (items: InventoryItem[]) => void;
  clearDebugItems: () => void;
  updateItemMetadata: (payload: UpdateItemMetadataPayload) => Promise<void>;
  setItemCustomCover: (itemId: string, sourcePath: string) => Promise<string>;
  reorderItems: (orderedIds: string[]) => Promise<void>;
  setItemCustomImages: (itemId: string, sourcePaths: string[]) => Promise<string[]>;
  updateFolder: (folderId: string, opts: { name?: string; color?: string; image_source_path?: string; clear_image?: boolean; image_fill?: "icon" | "cover"; }) => Promise<void>;
  moveFolderToParent: (folderId: string, parentId: string | null) => Promise<void>;
  removeFolder: (folderId: string) => Promise<void>;
  reorderFolders: (orderedIds: string[]) => Promise<void>;
  rangeSelectItems: (anchorId: string, targetId: string, orderedIds: string[]) => void;
  setPendingImportSource: (source: "scan" | "local" | "url" | null) => void;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  debugItems: [],
  folders: [],
  selectedFolderId: null,
  selectedItem: null,
  viewMode: (useAppearanceStore.getState().defaultView ?? "grid") as "grid" | "list",
  searchQuery: "",
  loading: false,
  error: null,
  sortField: "date" as SortField,
  sortDir: "desc" as SortDir,
  selectedItemIds: new Set<string>(),
  lastSelectedId: null,
  pendingImportSource: null,

  setPendingImportSource: (source) => set({ pendingImportSource: source }),

  fetchAll: async () => {
    // En modo expositor los datos ya están inyectados; no tocar el backend
    try {
      const { useAppearanceStore } = await import("./appearanceStore");
      if (useAppearanceStore.getState().expositorMode) { set({ loading: false }); return; }
    } catch { /* ignorar */ }

    set({ loading: true, error: null });
    const errors: string[] = [];

    let items: InventoryItem[] = get().items;
    try {
      items = await tauriListInventory();
    } catch (e) {
      errors.push(`Items: ${String(e)}`);
    }

    let folders: InventoryFolder[] = get().folders;
    try {
      folders = await tauriListInventoryFolders();
    } catch (e) {
      errors.push(`Folders: ${String(e)}`);
    }

    const currentFolderId = get().selectedFolderId;
    const folderStillExists = currentFolderId === null || folders.some((f) => f.id === currentFolderId);

    set({
      items,
      folders,
      loading: false,
      error: errors.length > 0 ? errors.join("; ") : null,
      ...(folderStillExists ? {} : { selectedFolderId: null }),
    });
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
      folders: [
        ...s.folders,
        { id, name, parent_id: parentId ?? null, color: null, custom_image_path: null, custom_image_fill: "icon", },
      ],
    }));
  },

  moveItem: async (itemId, folderId) => {
    const targetFolder = folderId === "__root__" ? null : folderId;
    await tauriMoveItemToFolder(itemId, targetFolder);
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, folder_id: targetFolder } : i)),
    }));
  },

  updateTags: async (itemId, tags) => {
    await tauriTagInventoryItem(itemId, tags);
    set((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, tags } : i)) }));
  },

  importLocalPackage: async (args) => {
    const newId = await tauriImportLocalPackage(args);
    if (args.product_images && args.product_images.length > 0) {
      await tauriSetItemProductImages(newId, args.product_images).catch(() => {});
    }
    const items = await tauriListInventory();
    set({ items });
    return newId;
  },

  compressItem: async (id) => {
    await tauriCompressItem(id);
    const items = await tauriListInventory();
    set({ items });
  },

  decompressItem: async (id) => {
    await tauriDecompressItem(id);
    const items = await tauriListInventory();
    set({ items });
  },

  parsedQuery: () => parseSearchQuery(get().searchQuery),

  hasActiveFilters: () => {
    const { searchQuery } = get();
    if (!searchQuery.trim()) return false;
    const parsed = parseSearchQuery(searchQuery);
    return parsed.tags.length > 0 || parsed.authors.length > 0 || parsed.names.length > 0 || parsed.bare.trim().length > 0;
  },

  filteredItems: () => {
    const { items, debugItems, searchQuery, selectedFolderId, folders, sortField, sortDir } = get();
    const allItems = [...items, ...debugItems];

    let result = searchQuery.trim()
      ? allItems.filter((i) => matchesQuery(i, parseSearchQuery(searchQuery), folders))
      : allItems;

    if (selectedFolderId) {
      result = result.filter((i) => i.folder_id === selectedFolderId);
    } else {
      result = result.filter((i) => !i.folder_id);   // ya corregido (acepta null, undefined, "")
    }

    if (sortField !== "custom") {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortField === "date")   cmp = a.download_date.localeCompare(b.download_date);
        if (sortField === "name")   cmp = (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name);
        if (sortField === "author") cmp = (a.author ?? "").localeCompare(b.author ?? "");
        if (sortField === "size")   cmp = (a.size_bytes ?? 0) - (b.size_bytes ?? 0);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  },
  loadItems: async () => {
    await get().fetchAll();
  },

  setSortField: (f) => set({ sortField: f }),
  setSortDir: (d) => set({ sortDir: d }),
  addDebugItems: (newItems) => set((s) => ({ debugItems: [...s.debugItems, ...newItems] })),
  clearDebugItems: () => set({ debugItems: [] }),

  toggleSelectItem: (id) => set((s) => {
    const next = new Set(s.selectedItemIds);
    if (next.has(id)) { next.delete(id); }
    else { next.add(id); }
    return { selectedItemIds: next, lastSelectedId: id };
  }),
  selectAllItems: () => set((s) => ({ selectedItemIds: new Set(s.items.map((i) => i.id)) })),
  clearSelection: () => set({ selectedItemIds: new Set(), lastSelectedId: null }),

  updateItemMetadata: async (payload) => {
    await tauriUpdateItemMetadata(payload);
    set((s) => ({
      items: s.items.map((i) =>
        i.id !== payload.item_id ? i : {
          ...i,
          ...(payload.display_name !== undefined ? { display_name: payload.display_name } : {}),
          ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
        }
      ),
    }));
  },

  setItemCustomCover: async (itemId, sourcePath) => {
    const savedPath = await tauriSetItemCustomCover(itemId, sourcePath);
    set((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, custom_cover_path: savedPath } : i)) }));
    return savedPath;
  },

  reorderItems: async (orderedIds) => {
    await tauriReorderItems(orderedIds);
    const idxMap = new Map(orderedIds.map((id, i) => [id, i]));
    set((s) => ({ items: [...s.items].sort((a, b) => (idxMap.get(a.id) ?? 9999) - (idxMap.get(b.id) ?? 9999)) }));
  },

  setItemCustomImages: async (itemId, sourcePaths) => {
    const saved = await tauriSetItemCustomImages(itemId, sourcePaths);
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, custom_images: saved, custom_cover_path: saved[0] ?? null } : i)),
    }));
    return saved;
  },

  updateFolder: async (folderId, opts) => {
    const updated = await tauriUpdateFolder(folderId, opts);
    set((s) => ({ folders: s.folders.map((f) => (f.id === folderId ? updated : f)) }));
  },

  moveFolderToParent: async (folderId, parentId) => {
    await tauriMoveFolderToParent(folderId, parentId);
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === folderId ? { ...f, parent_id: parentId } : f
      ),
    }));
  },

  rangeSelectItems: (anchorId, targetId, orderedIds) => set((s) => {
    const anchorIdx = orderedIds.indexOf(anchorId);
    const targetIdx = orderedIds.indexOf(targetId);
    if (anchorIdx === -1 || targetIdx === -1) return {};
    const [start, end] = anchorIdx < targetIdx
      ? [anchorIdx, targetIdx]
      : [targetIdx, anchorIdx];
    const rangeIds = orderedIds.slice(start, end + 1);
    const next = new Set(s.selectedItemIds);
    rangeIds.forEach((id) => next.add(id));
    return { selectedItemIds: next, lastSelectedId: targetId };
  }),

  removeFolder: async (folderId) => {
    await tauriDeleteInventoryFolder(folderId);
    set((s) => ({ folders: s.folders.filter((f) => f.id !== folderId) }));
  },
  reorderFolders: async (orderedIds) => {
  await tauriReorderFolders(orderedIds);
  // Optimistically update local folder order
  set((s) => {
    const idxMap = new Map(orderedIds.map((id, i) => [id, i]));
    const sorted = [...s.folders].sort(
      (a, b) => (idxMap.get(a.id) ?? 999) - (idxMap.get(b.id) ?? 999)
    );
    return { folders: sorted };
  });
},
}));

export type SortField = "date" | "name" | "author" | "size" | "custom";
export type SortDir = "asc" | "desc";