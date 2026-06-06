// src/components/tools/ToolCard.tsx
import { InstalledTool } from "../../lib/tauri";
import { Play, Trash2 } from "lucide-react";

interface Props {
  tool: InstalledTool;
  onRun: (tool: InstalledTool) => void;
  onUninstall: (id: string) => void;
}

export function ToolCard({ tool, onRun, onUninstall }: Props) {
  return (
    <div className="group relative flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors">
      {/* Banner / icon area */}
      <div className="h-24 bg-zinc-800 flex items-center justify-center relative overflow-hidden">
        {tool.metadata.banner_url ? (
          <img
            src={tool.metadata.banner_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
        ) : null}
        <div className="relative z-10 w-12 h-12 rounded-xl bg-zinc-700 border border-zinc-600 flex items-center justify-center text-2xl">
          {tool.metadata.icon_url ? (
            <img src={tool.metadata.icon_url} alt="" className="w-8 h-8 object-contain" />
          ) : (
            "🛠"
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-100 leading-tight">{tool.name}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            v{tool.version} · {tool.metadata.author}
          </p>
        </div>
        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-snug flex-1">
          {tool.metadata.description}
        </p>
        <div className="flex items-center gap-2 mt-auto">
          <button
            onClick={() => onRun(tool)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors"
          >
            <Play className="h-3 w-3" /> Run
          </button>
          <button
            onClick={() => onUninstall(tool.id)}
            className="p-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 text-zinc-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
