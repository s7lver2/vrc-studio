// src/components/sandbox/AssetSourcePicker.tsx
/**
 * AssetSourcePicker — selección de fuente de asset con 3 iconos grandes.
 *
 * Opciones:
 *   1. Propio item (baseItem del sandbox) → FileTreePicker filtrado al item
 *   2. Otro item del inventario → InventoryPickerModal sin cambiar baseItem
 *   3. Desde el disco → dialog nativo de Tauri
 */
import { useState } from "react";
import { Package, LayoutGrid, HardDrive, X } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { FileTreePicker } from "./FileTreePicker";
import { useInventoryStore } from "@/store/inventoryStore";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import type { FileNode, InventoryItem } from "@/lib/tauri";
import type { SandboxFile } from "@/store/sandboxStore";

type AssetTypeLocal = "model" | "avatar" | "texture" | "animation" | "clothing";
function classifyExt(ext: string): AssetTypeLocal {
  if (["vrm"].includes(ext)) return "avatar";
  if (["glb", "gltf", "fbx"].includes(ext)) return "model";
  if (["png", "jpg", "jpeg", "bmp"].includes(ext)) return "texture";
  if (["anim"].includes(ext)) return "animation";
  return "clothing";
}

interface Props {
  title: string;
  filterExts: string[];       // e.g. ["fbx", "glb", "anim"]
  diskFilterExts: string[];   // para el dialog nativo
  onSelect: (file: SandboxFile) => void;
  onClose: () => void;
}

type Step = "source" | "ownItem" | "inventory" | "inventoryFile";

export function AssetSourcePicker({ title, filterExts, diskFilterExts, onSelect, onClose }: Props) {
  const { baseItem } = useSandboxStore();
  const { items } = useInventoryStore();
  const [step, setStep] = useState<Step>("source");
  const [inventoryItem, setInventoryItem] = useState<InventoryItem | null>(null);
  const [search, setSearch] = useState("");
  const extsSet = new Set(filterExts);

  const handleNodeSelect = (node: FileNode, item: InventoryItem) => {
    const ext = node.extension?.toLowerCase() ?? "";
    onSelect({ path: node.path, name: node.name, type: classifyExt(ext), ext });
    onClose();
  };

  const handleDisk = async () => {
    try {
      const selected = await tauriOpen({
        multiple: false,
        filters: [{ name: "Asset files", extensions: diskFilterExts }],
      });
      if (!selected || typeof selected !== "string") return;
      const parts = selected.split(/[\\/]/);
      const name = parts[parts.length - 1];
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      onSelect({ path: selected, name, type: classifyExt(ext), ext });
      onClose();
    } catch (e) { console.error(e); }
  };

  // ── Source selector ───────────────────────────────────────────────
  if (step === "source") {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-8 flex flex-col items-center gap-6">
          <div className="flex items-center justify-between w-full">
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-zinc-500 -mt-2">Select where to find the file</p>

          <div className="flex gap-4 w-full">
            {/* Propio item */}
            <button
              onClick={() => setStep("ownItem")}
              disabled={!baseItem}
              className="flex-1 flex flex-col items-center gap-4 p-5 rounded-2xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed transition-all group"
            >
              {baseItem?.thumbnail_url ? (
                <img src={baseItem.thumbnail_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <Package className="h-12 w-12 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
              )}
              <div className="text-center">
                <p className="text-xs font-medium text-zinc-300">This Item</p>
                <p className="text-[9px] text-zinc-600 mt-0.5 truncate max-w-[90px]">{baseItem?.name ?? "No item loaded"}</p>
              </div>
            </button>

            {/* Otro item del inventario */}
            <button
              onClick={() => setStep("inventory")}
              className="flex-1 flex flex-col items-center gap-4 p-5 rounded-2xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-all group"
            >
              <LayoutGrid className="h-12 w-12 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
              <div className="text-center">
                <p className="text-xs font-medium text-zinc-300">Inventory</p>
                <p className="text-[9px] text-zinc-600 mt-0.5">Other assets</p>
              </div>
            </button>

            {/* Disco */}
            <button
              onClick={handleDisk}
              className="flex-1 flex flex-col items-center gap-4 p-5 rounded-2xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-all group"
            >
              <HardDrive className="h-12 w-12 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
              <div className="text-center">
                <p className="text-xs font-medium text-zinc-300">Computer</p>
                <p className="text-[9px] text-zinc-600 mt-0.5">Browse files</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Own item → FileTreePicker filtrado ───────────────────────────
  if (step === "ownItem" && baseItem) {
    return (
      <FileTreePicker
        rootPath={baseItem.local_path}
        filterExts={extsSet}
        title={`Files in: ${baseItem.name}`}
        onSelect={(node) => handleNodeSelect(node, baseItem)}
        onClose={onClose}
      />
    );
  }

  // ── Inventory list ────────────────────────────────────────────────
  if (step === "inventory") {
    const filtered = items.filter(
      (i) => !search || i.name.toLowerCase().includes(search.toLowerCase())
    );
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[75vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={() => setStep("source")} className="text-zinc-600 hover:text-zinc-300 transition-colors text-xs">← Back</button>
              <h3 className="text-sm font-semibold text-zinc-100">Select Item</h3>
            </div>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter items…"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-zinc-600 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => { setInventoryItem(item); setStep("inventoryFile"); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all text-left"
              >
                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-200 truncate">{item.name}</p>
                  <p className="text-[10px] text-zinc-600 truncate">{item.author}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Inventory item → FileTreePicker ──────────────────────────────
  if (step === "inventoryFile" && inventoryItem) {
    return (
      <FileTreePicker
        rootPath={inventoryItem.local_path}
        filterExts={extsSet}
        title={`Files in: ${inventoryItem.name}`}
        onSelect={(node) => handleNodeSelect(node, inventoryItem)}
        onClose={onClose}
      />
    );
  }

  return null;
}