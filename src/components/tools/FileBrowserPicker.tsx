import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { tauriListDir, FileEntry } from "../../lib/tauri";

interface Props {
  callId: number;
  root: string;
  title: string;
  onResolve: (callId: number, result: unknown) => void;
  onCancel: () => void;
}

function fileIcon(entry: FileEntry): string {
  if (entry.is_dir) return "📁";
  switch (entry.extension?.toLowerCase()) {
    case "unity":      return "🎬";
    case "anim":       return "🎞️";
    case "controller": return "⚙️";
    case "mat":        return "🎨";
    case "png": case "jpg": case "jpeg": return "🖼️";
    case "fbx": case "obj": return "📦";
    case "cs":         return "📝";
    case "prefab":     return "🧩";
    default:           return "📄";
  }
}

export function FileBrowserPicker({ callId, root, title, onResolve, onCancel }: Props) {
  const [subPath, setSubPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    tauriListDir(root, subPath)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [root, subPath]);

  const navigate = (entry: FileEntry) => {
    if (entry.is_dir) {
      setSubPath(entry.path);
      setSelected(null);
    } else {
      setSelected(entry.path);
    }
  };

  const breadcrumbs = subPath ? subPath.split("/") : [];

  const navigateTo = (index: number) => {
    setSubPath(index < 0 ? "" : breadcrumbs.slice(0, index + 1).join("/"));
    setSelected(null);
  };

  const confirm = () => {
    if (selected) onResolve(callId, `${root}/${selected}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
      <div className="w-[420px] bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <p className="text-sm font-semibold text-zinc-100">{title}</p>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-3 py-2 bg-zinc-800/50 text-xs text-zinc-500 flex-wrap min-h-[32px]">
          <button onClick={() => navigateTo(-1)} className="hover:text-zinc-200 transition-colors">
            Root
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-zinc-700">›</span>
              <button
                onClick={() => navigateTo(i)}
                className={`hover:text-zinc-200 transition-colors ${
                  i === breadcrumbs.length - 1 ? "text-zinc-200" : ""
                }`}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>

        {/* File grid */}
        <div className="p-3 min-h-[200px] max-h-[280px] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-zinc-500 py-6 text-center">Cargando…</p>
          ) : error ? (
            <p className="text-sm text-red-400 py-3 px-2">{error}</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">Carpeta vacía</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigate(entry)}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border text-center transition-colors ${
                    selected === entry.path
                      ? "border-zinc-500 bg-zinc-700"
                      : "border-zinc-700 bg-zinc-800 hover:border-zinc-600 hover:bg-zinc-700/50"
                  }`}
                >
                  <span className="text-lg leading-none">{fileIcon(entry)}</span>
                  <span className="text-[9px] text-zinc-400 leading-tight break-all line-clamp-2">
                    {entry.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
          <p className="text-[10px] text-zinc-600 truncate flex-1 mr-2">
            {selected ? selected : "Haz clic en un archivo para seleccionarlo"}
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={confirm}
              disabled={!selected}
              className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 rounded-lg transition-colors"
            >
              Seleccionar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
