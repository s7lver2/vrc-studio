/**
 * FileTreePicker — modal de selección de archivo con árbol colapsable.
 *
 * Usa tauriGetFileTree para leer el disco real.
 * Filtra por filterExts y solo muestra archivos compatibles (+ las carpetas que los contienen).
 * Estilo: similar al FileTreeViewver.tsx del inventario pero adaptado para Sandbox.
 */
import { useState, useEffect } from "react";
import {
  X, ChevronRight, ChevronDown, Folder, FolderOpen,
  FileText, Loader2, LayoutGrid, List
} from "lucide-react";
import { tauriGetFileTree, FileNode } from "@/lib/tauri";

// Extension → color accent (hereda de FileIcon.tsx del inventario)
const EXT_COLORS: Record<string, string> = {
  fbx: "text-amber-400", glb: "text-blue-400", gltf: "text-blue-300",
  vrm: "text-pink-400", png: "text-green-400", jpg: "text-green-300",
  jpeg: "text-green-300", anim: "text-cyan-400", bmp: "text-orange-300",
};

function extColor(ext: string | null): string {
  if (!ext) return "text-zinc-500";
  return EXT_COLORS[ext.toLowerCase()] ?? "text-zinc-500";
}

/** Filtrar árbol: mantener solo nodos cuya descendencia tiene archivos con filterExts */
function filterNode(node: FileNode, exts: Set<string>): FileNode | null {
  if (!node.is_dir) {
    const ext = node.extension?.toLowerCase() ?? "";
    return exts.has(ext) ? node : null;
  }
  if (!node.children) return null;
  const filteredChildren = node.children
    .map((c) => filterNode(c, exts))
    .filter((c): c is FileNode => c !== null);
  if (filteredChildren.length === 0) return null;
  return { ...node, children: filteredChildren };
}

// ── TreeNode ─────────────────────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  onSelect: (node: FileNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

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
          {open
            ? <FolderOpen className="h-3.5 w-3.5 text-amber-400/70 shrink-0" />
            : <Folder className="h-3.5 w-3.5 text-amber-400/50 shrink-0" />}
          <span className="text-[11px] text-zinc-300 truncate ml-0.5 font-medium">{node.name}</span>
          <span className="text-[9px] text-zinc-700 ml-auto pr-1">
            {node.children?.length ?? 0}
          </span>
        </button>
        {open && node.children?.map((child, i) => (
          <TreeNode key={i} node={child} depth={depth + 1} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const ext = node.extension?.toLowerCase() ?? "";
  const color = extColor(node.extension ?? null);

  return (
    <button
      className="flex items-center gap-1.5 w-full text-left hover:bg-zinc-800 rounded px-1 py-0.5 group"
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      onClick={() => onSelect(node)}
    >
      <span className="w-3 shrink-0" />
      <FileText className={`h-3.5 w-3.5 shrink-0 ${color}`} />
      <span className="text-[11px] text-zinc-300 group-hover:text-zinc-100 truncate ml-0.5 flex-1">
        {node.name}
      </span>
      <span className={`text-[9px] uppercase font-mono pr-1 ${color}`}>{ext}</span>
    </button>
  );
}

// ── ExplorerView (vista tipo explorador de archivos) ────────────────────────

function ExplorerView({
  root,
  filterExts,
  onSelect,
}: {
  root: FileNode;
  filterExts: Set<string>;
  onSelect: (node: FileNode) => void;
}) {
  const [currentNode, setCurrentNode] = useState<FileNode>(root);
  const [breadcrumb, setBreadcrumb] = useState<FileNode[]>([root]);

  const enterFolder = (node: FileNode) => {
    setCurrentNode(node);
    setBreadcrumb((prev) => [...prev, node]);
  };

  const goTo = (index: number) => {
    const node = breadcrumb[index];
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    setCurrentNode(node);
  };

  const children = currentNode.children ?? [];
  const folders = children.filter((c) => c.is_dir && hasCompatibleFiles(c, filterExts));
  const files = children.filter((c) => !c.is_dir && filterExts.has(c.extension?.toLowerCase() ?? ""));

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800 overflow-x-auto shrink-0">
        {breadcrumb.map((node, i) => (
          <span key={i} className="flex items-center gap-1 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-700" />}
            <button
              onClick={() => goTo(i)}
              className={`text-[10px] transition-colors ${i === breadcrumb.length - 1 ? "text-zinc-300 font-medium" : "text-zinc-600 hover:text-zinc-400"}`}
            >
              {node.name}
            </button>
          </span>
        ))}
      </div>

      {/* Grid de items */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-2">
          {folders.map((folder, i) => (
            <button
              key={i}
              onClick={() => enterFolder(folder)}
              className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-zinc-800/60 border border-transparent hover:border-zinc-700 transition-all"
            >
              <FolderOpen className="h-8 w-8 text-amber-400/70" />
              <span className="text-[9px] text-zinc-400 text-center truncate w-full">{folder.name}</span>
            </button>
          ))}
          {files.map((file, i) => {
            const ext = file.extension?.toLowerCase() ?? "";
            return (
              <button
                key={i}
                onClick={() => onSelect(file)}
                className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-zinc-800/60 border border-transparent hover:border-zinc-700 transition-all"
              >
                <FileText className={`h-8 w-8 ${extColor(ext)}`} />
                <span className="text-[9px] text-zinc-400 text-center truncate w-full">{file.name}</span>
                <span className={`text-[8px] uppercase font-mono ${extColor(ext)}`}>{ext}</span>
              </button>
            );
          })}
          {folders.length === 0 && files.length === 0 && (
            <p className="col-span-3 text-center text-[10px] text-zinc-700 py-6">Empty folder</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Verifica si un nodo (o sus descendientes) contiene archivos compatibles */
function hasCompatibleFiles(node: FileNode, exts: Set<string>): boolean {
  if (!node.is_dir) return exts.has(node.extension?.toLowerCase() ?? "");
  return (node.children ?? []).some((c) => hasCompatibleFiles(c, exts));
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface FileTreePickerProps {
  rootPath: string;
  filterExts: Set<string>;
  title: string;
  onSelect: (node: FileNode) => void;
  onClose: () => void;
}

export function FileTreePicker({ rootPath, filterExts, title, onSelect, onClose }: FileTreePickerProps) {
  type ViewMode = "tree" | "explorer";

  const [rawTree, setRawTree] = useState<FileNode | null>(null);
  const [filteredTree, setFilteredTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  // explorerPath se usa solo si se necesita un estado adicional; aquí se deja para futuras expansiones
  const [explorerPath, setExplorerPath] = useState<FileNode | null>(null);

  useEffect(() => {
    setLoading(true);
    tauriGetFileTree(rootPath)
      .then((raw) => {
        setRawTree(raw);
        const filtered = filterNode(raw, filterExts);
        setFilteredTree(filtered);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [rootPath, filterExts]);

  const handleSelect = (node: FileNode) => {
    onSelect(node);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-[460px] max-h-[70vh] flex flex-col rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-medium text-zinc-200">{title}</span>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center gap-1 mr-2 border border-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode("tree")}
                title="Tree view"
                className={`p-1.5 rounded-md transition-colors ${viewMode === "tree" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                <List className="h-3 w-3" />
              </button>
              <button
                onClick={() => { setViewMode("explorer"); setExplorerPath(null); }}
                title="Explorer view"
                className={`p-1.5 rounded-md transition-colors ${viewMode === "explorer" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                <LayoutGrid className="h-3 w-3" />
              </button>
            </div>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Root path breadcrumb */}
        <div className="px-4 py-1.5 border-b border-zinc-900">
          <p className="text-[9px] text-zinc-700 font-mono truncate">{rootPath}</p>
        </div>

        {/* Contenido principal */}
        <div className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
              <span className="text-xs text-zinc-600">Reading file tree…</span>
            </div>
          )}
          {error && (
            <p className="text-xs text-red-400 text-center py-8 px-4">{error}</p>
          )}
          {!loading && !error && viewMode === "tree" && (
            <div className="overflow-y-auto h-full py-1">
              {filteredTree ? (
                <TreeNode node={filteredTree} depth={0} onSelect={handleSelect} />
              ) : (
                <p className="text-center text-xs text-zinc-700 py-8">
                  No compatible files found
                  <br />
                  <span className="text-[10px] text-zinc-700">
                    ({Array.from(filterExts).join(", ")})
                  </span>
                </p>
              )}
            </div>
          )}
          {!loading && !error && viewMode === "explorer" && rawTree && (
            <ExplorerView root={rawTree} filterExts={filterExts} onSelect={handleSelect} />
          )}
          {!loading && !error && viewMode === "explorer" && !rawTree && (
            <p className="text-center text-xs text-zinc-700 py-8">Unable to load file system.</p>
          )}
        </div>
      </div>
    </div>
  );
}