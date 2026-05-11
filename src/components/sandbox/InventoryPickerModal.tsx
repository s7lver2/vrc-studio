// src/components/sandbox/InventoryPickerModal.tsx
import { useState, useEffect } from "react";
import { X, LayoutGrid, List, Tag, Package, ChevronRight, FileText } from "lucide-react";
import { useInventoryStore } from "@/store/inventoryStore";
import { useTagStore, SYSTEM_TAGS } from "@/store/tagStore";
import { useSandboxStore, SandboxFile } from "@/store/sandboxStore";
import type { InventoryItem, FileNode } from "@/lib/tauri";
import { FileTreePicker } from "./FileTreePicker";
import { ItemCardSkeleton, ItemRowSkeleton } from "./LoadingSkeleton";

const COMPATIBLE_EXTS = new Set(["fbx", "glb", "gltf", "vrm", "prefab", "png", "jpg", "jpeg", "bmp", "anim"]);

type AssetTypeLocal = "model" | "avatar" | "texture" | "animation" | "clothing";
function classifyExt(ext: string): AssetTypeLocal {
  if (["vrm"].includes(ext)) return "avatar";
  if (["glb", "gltf", "fbx"].includes(ext)) return "model";
  if (["png", "jpg", "jpeg", "bmp"].includes(ext)) return "texture";
  if (["anim"].includes(ext)) return "animation";
  return "clothing";
}

type ViewMode = "grid" | "list";

interface Props {
  onClose: () => void;
}

export function InventoryPickerModal({ onClose }: Props) {
  const { items, loading } = useInventoryStore();
  const { allKnownTags } = useTagStore();
  const { setBaseItem, setSelectedFile } = useSandboxStore();

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"item" | "file">("item");
  const [chosenItem, setChosenItem] = useState<InventoryItem | null>(null);

  const filtered = items.filter((item) => {
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
    const matchTag = !activeTag || item.tags.includes(activeTag);
    return matchSearch && matchTag;
  });

  const tags = allKnownTags().filter((t) => items.some((i) => i.tags.includes(t.id)));

  const handleSelectItem = (item: InventoryItem) => {
    setChosenItem(item);
    setStep("file");
  };

  const handleSelectFile = (node: FileNode) => {
    if (!chosenItem) return;
    const ext = node.extension?.toLowerCase() ?? "";
    const file: SandboxFile = {
      path: node.path,
      name: node.name,
      type: classifyExt(ext),
      ext,
    };
    setBaseItem(chosenItem);
    setSelectedFile(file);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-[760px] h-[600px] max-h-[78vh] flex flex-col rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            {step === "file" && (
              <button onClick={() => setStep("item")} className="text-zinc-500 hover:text-zinc-300 text-xs">
                ← back
              </button>
            )}
            <span className="text-sm font-medium text-zinc-200">
              {step === "item" ? "Select inventory item" : `Files in "${chosenItem?.name}"`}
            </span>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1: Item picker - two columns */}
        {step === "item" && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left sidebar: tags */}
            <div className="w-40 shrink-0 border-r border-zinc-900 overflow-y-auto py-3 flex flex-col gap-0.5">
              <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-semibold px-3 pb-1">Tags</p>
              <button
                onClick={() => setActiveTag(null)}
                className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                  !activeTag ? "text-zinc-100 bg-zinc-800" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                All items
                <span className="ml-1 text-zinc-600 text-[9px]">{items.length}</span>
              </button>
              {tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTag(activeTag === t.id ? null : t.id)}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] transition-colors ${
                    activeTag === t.id
                      ? "text-zinc-100 bg-zinc-800"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.color}`} />
                  <span className="truncate flex-1">{t.label ?? t.id}</span>
                </button>
              ))}
            </div>

            {/* Right area: search + grid/list */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-900 shrink-0">
                <input
                  autoFocus
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
                  placeholder="Search items…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${viewMode === "grid" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${viewMode === "list" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Items */}
              <div className="flex-1 overflow-y-auto p-3">
                {loading ? (
                  viewMode === "grid" ? (
                    <div className="grid grid-cols-3 gap-3">
                      {Array.from({ length: 9 }).map((_, i) => <ItemCardSkeleton key={i} />)}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {Array.from({ length: 6 }).map((_, i) => <ItemRowSkeleton key={i} />)}
                    </div>
                  )
                ) : filtered.length === 0 ? (
                  <p className="text-center text-xs text-zinc-600 py-10">No items match</p>
                ) : viewMode === "grid" ? (
                  <div className="grid grid-cols-3 gap-3">
                    {filtered.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleSelectItem(item)}
                        className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden hover:border-zinc-600 transition-all group text-left"
                      >
                        <div className="aspect-square bg-zinc-800 overflow-hidden">
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt=""
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package className="h-6 w-6 text-zinc-600" />
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-[11px] font-medium text-zinc-200 truncate">{item.name}</p>
                          <p className="text-[9px] text-zinc-600 truncate">{item.author ?? "Unknown"}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {filtered.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleSelectItem(item)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-900 transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded bg-zinc-800 shrink-0 overflow-hidden">
                          {item.thumbnail_url ? (
                            <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package className="h-4 w-4 text-zinc-600" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-zinc-200 truncate">{item.name}</p>
                          <p className="text-[10px] text-zinc-600 truncate">{item.author ?? "Unknown"}</p>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-700 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: File tree picker (sin cambios) */}
        {step === "file" && chosenItem && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-3 py-1.5 border-b border-zinc-900 shrink-0">
              <p className="text-[9px] text-zinc-700 font-mono truncate">{chosenItem.local_path}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <InlineFileTree
                rootPath={chosenItem.local_path}
                filterExts={COMPATIBLE_EXTS}
                onSelect={handleSelectFile}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** FileTree inline (sin modal wrapper) para embeber dentro del picker */
function InlineFileTree({
  rootPath, filterExts, onSelect,
}: {
  rootPath: string; filterExts: Set<string>; onSelect: (n: FileNode) => void;
}) {
  const [tree, setTree] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Importar tauriGetFileTree dinámicamente para evitar import circular
  useEffect(() => {
    import("@/lib/tauri").then(({ tauriGetFileTree }) => {
      tauriGetFileTree(rootPath)
        .then((raw) => {
          const filtered = filterNodeLocal(raw, filterExts);
          setTree(filtered);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    });
  }, [rootPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <div className="h-4 w-4 rounded-full border-2 border-zinc-800 border-t-zinc-500 animate-spin" />
        <span className="text-xs text-zinc-600">Reading files…</span>
      </div>
    );
  }

  if (!tree) return <p className="text-center text-xs text-zinc-600 py-8">No compatible files found</p>;

  // Usar el mismo TreeNode de FileTreePicker.tsx — importar los mismos helpers
  return <InlineTreeNode node={tree} depth={0} onSelect={onSelect} filterExts={filterExts} />;
}

function filterNodeLocal(node: FileNode, exts: Set<string>): FileNode | null {
  if (!node.is_dir) {
    return exts.has(node.extension?.toLowerCase() ?? "") ? node : null;
  }
  if (!node.children) return null;
  const kids = node.children.map((c) => filterNodeLocal(c, exts)).filter((c): c is FileNode => c !== null);
  return kids.length ? { ...node, children: kids } : null;
}

function InlineTreeNode({
  node, depth, onSelect, filterExts,
}: {
  node: FileNode; depth: number; onSelect: (n: FileNode) => void; filterExts: Set<string>;
}) {
  const [open, setOpen] = useState(depth < 2);
  const EXT_COLORS: Record<string, string> = {
    fbx: "text-amber-400", glb: "text-blue-400", gltf: "text-blue-300",
    vrm: "text-pink-400", prefab: "text-violet-400",
    png: "text-green-400", jpg: "text-green-300",
    jpeg: "text-green-300", anim: "text-cyan-400",
  };

  if (node.is_dir) {
    return (
      <div>
        <button
          className="flex items-center gap-1.5 w-full text-left hover:bg-zinc-800/60 rounded px-1 py-0.5"
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="text-zinc-600 shrink-0 w-3">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          {open ? <FolderOpen className="h-3.5 w-3.5 text-amber-400/70 shrink-0" /> : <Folder className="h-3.5 w-3.5 text-amber-400/50 shrink-0" />}
          <span className="text-[11px] text-zinc-300 truncate ml-0.5 font-medium">{node.name}</span>
        </button>
        {open && node.children?.map((c, i) => (
          <InlineTreeNode key={i} node={c} depth={depth + 1} onSelect={onSelect} filterExts={filterExts} />
        ))}
      </div>
    );
  }

  const ext = node.extension?.toLowerCase() ?? "";
  const color = EXT_COLORS[ext] ?? "text-zinc-500";
  return (
    <button
      className="flex items-center gap-1.5 w-full text-left hover:bg-zinc-800 rounded px-1 py-0.5 group"
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      onClick={() => onSelect(node)}
    >
      <span className="w-3 shrink-0" />
      <FileText className={`h-3.5 w-3.5 shrink-0 ${color}`} />
      <span className="text-[11px] text-zinc-300 group-hover:text-zinc-100 truncate ml-0.5 flex-1">{node.name}</span>
      <span className={`text-[9px] uppercase font-mono pr-1 ${color}`}>{ext}</span>
    </button>
  );
}

// Imports faltantes (se añaden aquí para que el bloque sea autónomo)
import { ChevronDown } from "lucide-react";
import { Folder, FolderOpen } from "lucide-react";