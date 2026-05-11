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
  tauriSetItemProductImages,
  tauriCompressItem,
  tauriDecompressItem,
  tauriUpdateItemMetadata,
  tauriSetItemCustomCover,
  tauriReorderItems,
  tauriSetItemCustomImages,
  tauriUpdateFolder,
  tauriDeleteInventoryFolder,
} from "../lib/tauri";

interface ImportLocalArgs {
  zip_path: string;
  name: string;
  author?: string;
  thumbnail_url?: string;
  booth_id?: string;
  /** URLs de imágenes adicionales de Booth — se guardan como product_images */
  product_images?: string[];
}

interface UpdateItemMetadataPayload {
  item_id: string;
  display_name?: string;
  tags?: string[];
}

// ── Advanced search query parsing ─────────────────────────────────────────────
// Supported syntax:
//   tags:base          → item must have tag "base"
//   tag:base           → alias for tags:
//   author:yoshino     → author contains "yoshino"
//   name:shadowveil    → name contains "shadowveil"
//   <bare text>        → searches name and author

export interface ParsedQuery {
  tags: string[];
  authors: string[];
  names: string[];
  bare: string;
  types: string[];          // type:avatar, type:outfit, etc.
  sources: string[];        // source:booth | source:local | source:riperstore
  compressed: boolean | null; // compressed:yes / compressed:no
  minSizeMb: number | null;   // size:>10
  maxSizeMb: number | null;   // size:<100
  folderName: string | null;  // folder:outfits
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

export function matchesQuery(
    item: InventoryItem,
    parsed: ParsedQuery,
    folders: InventoryFolder[] = [],
  ): boolean {
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
  sortField: SortField;
  sortDir:   SortDir;
  selectedItemIds: Set<string>;
  



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
  setSortDir:   (d: SortDir)   => void;
  toggleSelectItem:  (id: string) => void;
  selectAllItems:    () => void;
  clearSelection:    () => void;
  updateItemMetadata: (payload: UpdateItemMetadataPayload) => Promise<void>;
  setItemCustomCover: (itemId: string, sourcePath: string) => Promise<string>;
  reorderItems:       (orderedIds: string[]) => Promise<void>;
  setItemCustomImages: (itemId: string, sourcePaths: string[]) => Promise<string[]>;
  updateFolder: (folderId: string, opts: { name?: string; color?: string; image_source_path?: string; clear_image?: boolean }) => Promise<void>;
  removeFolder: (folderId: string) => Promise<void>;
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
  sortField: "date" as SortField,
  sortDir:   "desc" as SortDir,
  selectedItemIds: new Set<string>(),

    fetchAll: async () => {
    set({ loading: true, error: null });
    const errors: string[] = [];

    // Cargar items y carpetas de forma independiente
    // para que el fallo de uno no afecte al otro
    let items: InventoryItem[] = get().items;
    try {
      items = await tauriListInventory();
      console.log("[fetchAll] items cargados:", items);
    } catch (e) {
      errors.push(`Items: ${String(e)}`);
    }

    let folders: InventoryFolder[] = get().folders;
    try {
      folders = await tauriListInventoryFolders();
    } catch (e) {
      errors.push(`Folders: ${String(e)}`);
    }

    // Sanity check: si selectedFolderId apunta a una carpeta que ya no existe, resetear a root
    const currentFolderId = get().selectedFolderId;
    const folderStillExists =
      currentFolderId === null || folders.some((f) => f.id === currentFolderId);

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
        {
          id,
          name,
          parent_id: parentId ?? null,
          color: null,               // ← añadido
          custom_image_path: null,   // ← añadido
        },
      ],
    }));
  },

  moveItem: async (itemId: string, folderId: string | null) => {
    // Normalizar: "__root__" → null (sacar de carpeta)
    const targetFolder = folderId === "__root__" ? null : folderId;
    await tauriMoveItemToFolder(itemId, targetFolder);
    // Actualizar folder_id en el estado local sin necesidad de re-fetch
    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId ? { ...i, folder_id: targetFolder } : i
      ),
    }));
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
    // Guardar product_images si vinieron de Booth
    if (args.product_images && args.product_images.length > 0) {
      await tauriSetItemProductImages(newId, args.product_images).catch(() => {});
    }
    const items = await tauriListInventory();
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
    const { items, searchQuery, selectedFolderId, folders, sortField, sortDir } = get();

    let result = searchQuery.trim()
      ? items.filter((i) => matchesQuery(i, parseSearchQuery(searchQuery), folders))
      : items;

    // Filtro por carpeta usando folder_id en cada item
    if (selectedFolderId) {
      result = result.filter((i) => i.folder_id === selectedFolderId);
    } else {
      // En la raíz solo mostramos items sin carpeta asignada
      result = result.filter((i) => !i.folder_id);
    }

    console.log("[filteredItems]", { selectedFolderId, total: result.length, ids: result.map(i => i.id) });

    // Sort (no aplicar si sortField === "custom" — el orden viene de sort_order en DB)
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
  setSortField: (f) => set({ sortField: f }),
  setSortDir:   (d) => set({ sortDir:   d }),
  toggleSelectItem: (id) => set((s) => {
    const next = new Set(s.selectedItemIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selectedItemIds: next };
  }),
  selectAllItems: () => set((s) => ({
    selectedItemIds: new Set(s.items.map((i) => i.id)),
  })),
  clearSelection: () => set({ selectedItemIds: new Set() }),

  // Mutations
  updateItemMetadata: async (payload) => {
    await tauriUpdateItemMetadata(payload);
    set((s) => ({
      items: s.items.map((i) =>
        i.id !== payload.item_id ? i : {
          ...i,
          ...(payload.display_name !== undefined ? { display_name: payload.display_name } : {}),
          ...(payload.tags          !== undefined ? { tags:         payload.tags         } : {}),
        }
      ),
    }));
  },
  setItemCustomCover: async (itemId, sourcePath) => {
    const savedPath = await tauriSetItemCustomCover(itemId, sourcePath);
    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId ? { ...i, custom_cover_path: savedPath } : i
      ),
    }));
    return savedPath;
  },
  reorderItems: async (orderedIds) => {
    await tauriReorderItems(orderedIds);
    const idxMap = new Map(orderedIds.map((id, i) => [id, i]));
    set((s) => ({
      items: [...s.items].sort(
        (a, b) => (idxMap.get(a.id) ?? 9999) - (idxMap.get(b.id) ?? 9999)
      ),
    }));
  },
  setItemCustomImages: async (itemId, sourcePaths) => {
    const saved = await tauriSetItemCustomImages(itemId, sourcePaths);
    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId
          ? { ...i, custom_images: saved, custom_cover_path: saved[0] ?? null }
          : i
      ),
    }));
    return saved;
  },
  updateFolder: async (folderId, opts) => {
    const updated = await tauriUpdateFolder(folderId, opts);
    set((s) => ({ folders: s.folders.map((f) => (f.id === folderId ? updated : f)) }));
  },
  removeFolder: async (folderId) => {
    await tauriDeleteInventoryFolder(folderId);
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== folderId),
    }));
  },
  
}));

export type SortField = "date" | "name" | "author" | "size" | "custom";
export type SortDir   = "asc" | "desc";