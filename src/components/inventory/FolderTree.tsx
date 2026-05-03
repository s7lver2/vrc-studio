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
        className={`w-full flex items-center gap-2 py-1.5 pr-2 rounded text-sm text-left transition-colors ${
          isSelected
            ? "bg-zinc-700 text-zinc-100 font-medium"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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
  const rootFolders = folders.filter((f) => f.parent_id === null);
  const t = useT();

  const handleCreate = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await addFolder(name);
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
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => setCreating(true)}
          title={t("folders_new")}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {creating && (
        <div className="px-2 mb-1">
          <input
            autoFocus
            className="w-full text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200 outline-none focus:border-red-500"
            placeholder={t("folders_placeholder")}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            onBlur={() => {
              if (!newFolderName.trim()) setCreating(false);
            }}
          />
        </div>
      )}

      <button
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
          selectedFolderId === null
            ? "bg-zinc-700 text-zinc-100 font-medium"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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