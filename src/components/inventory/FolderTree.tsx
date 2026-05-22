import { useState } from "react";
import { Folder, FolderOpen, Plus } from "lucide-react";
import { InventoryFolder } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { TagSidebar } from "./TagSidebar";
import { useT } from "../../i18n";

function FolderNode({
  folder,
  depth,
  allFolders,
}: {
  folder: InventoryFolder;
  depth: number;
  allFolders: InventoryFolder[];
}) {
  const { selectedFolderId, selectFolder } = useInventoryStore();
  const children = allFolders.filter((f) => f.parent_id === folder.id);
  const isSelected = selectedFolderId === folder.id;

  return (
    <div>
      <button
        className={`w-full flex items-center gap-2 py-1.5 pr-2 rounded-lg text-sm text-left transition-colors ${
          isSelected
            ? "bg-zinc-800 text-zinc-100 font-medium"
            : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => selectFolder(folder.id)}
      >
        {isSelected ? (
          <FolderOpen className="h-3.5 w-3.5 text-red-400 shrink-0" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{folder.name}</span>
      </button>
      {children.map((child) => (
        <FolderNode
          key={child.id}
          folder={child}
          depth={depth + 1}
          allFolders={allFolders}
        />
      ))}
    </div>
  );
}

export function FolderTree() {
  const { folders, selectedFolderId, selectFolder, addFolder } =
    useInventoryStore();
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootFolders = folders.filter((f) => f.parent_id === null);
  const t = useT();

  const handleCreate = async () => {
    const name = newFolderName.trim();
    if (!name || loading) return;
    setLoading(true);
    try {
      await addFolder(name);
      setNewFolderName("");
      setCreating(false);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setNewFolderName("");
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-0.5 w-52 shrink-0 pr-2">
      <div className="flex items-center justify-between px-2 py-2 mb-1">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          {t("folders_title")}
        </span>
        <button
          className="h-5 w-5 flex items-center justify-center rounded-lg hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => setCreating(true)}
          title={t("folders_new")}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {creating && (
        <div className="px-2 mb-1 flex flex-col gap-1">
          <input
            autoFocus
            className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
            placeholder={t("folders_placeholder")}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")  handleCreate();
              if (e.key === "Escape") handleCancel();
            }}
          />
          <div className="flex gap-1">
            {/* onMouseDown + preventDefault prevents input blur before action fires */}
            <button
              onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
              className="flex-1 py-1 rounded-md text-[10px] text-zinc-500 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              {t("grid_ctx_cancel")}
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); handleCreate(); }}
              disabled={!newFolderName.trim() || loading}
              className="flex-1 py-1 rounded-md text-[10px] text-white bg-red-600 hover:bg-red-500 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "…" : t("grid_ctx_create")}
            </button>
          </div>
        </div>
      )}

      <button
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
          selectedFolderId === null
            ? "bg-zinc-800 text-zinc-100 font-medium"
            : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
        }`}
        onClick={() => selectFolder(null)}
      >
        <Folder className="h-3.5 w-3.5 shrink-0" />
        {t("folders_all")}
      </button>

      {rootFolders.map((f) => (
        <FolderNode key={f.id} folder={f} depth={0} allFolders={folders} />
      ))}

      <TagSidebar />
    </div>
  );
}