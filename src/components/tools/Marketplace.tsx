// src/components/tools/Marketplace.tsx
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ToolRegistryEntry } from "../../lib/tauri";
import { useToolsStore } from "../../store/toolsStore";
import { ToolDetail } from "./ToolDetail";

interface Props {
  onBack: () => void;
}

export function Marketplace({ onBack }: Props) {
  const { registry, registryLoading, fetchRegistry, installed } = useToolsStore();
  const [selected, setSelected] = useState<ToolRegistryEntry | null>(null);

  useEffect(() => { fetchRegistry(); }, [fetchRegistry]);

  if (selected) {
    return <ToolDetail entry={selected} onBack={() => setSelected(null)} />;
  }

  const featured = registry.filter((t) => t.featured);
  const all = registry;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-8 py-5 border-b border-zinc-800 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Tools
        </button>
        <span className="text-sm font-bold text-zinc-100 ml-1">Marketplace</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {registryLoading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-zinc-600 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando marketplace…
          </div>
        ) : registry.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
            No se pudo cargar el marketplace. Comprueba tu conexión.
          </div>
        ) : (
          <>
            {/* Carousel / featured */}
            {featured.length > 0 && (
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Destacadas</p>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {featured.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => setSelected(tool)}
                      className="flex-shrink-0 w-64 h-32 rounded-2xl bg-zinc-800 border border-zinc-700 hover:border-zinc-500 overflow-hidden relative transition-colors text-left"
                    >
                      {tool.banner_url && (
                        <img src={tool.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
                      )}
                      <div className="absolute inset-0 p-4 flex flex-col justify-end bg-gradient-to-t from-zinc-900/90 to-transparent">
                        <p className="text-sm font-bold text-zinc-100">{tool.name}</p>
                        <p className="text-[10px] text-zinc-400">{tool.author}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* All tools grid */}
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Todas</p>
              <div className="grid grid-cols-2 gap-3">
                {all.map((tool) => {
                  const isInstalled = installed.some((t) => t.id === tool.id);
                  return (
                    <button
                      key={tool.id}
                      onClick={() => setSelected(tool)}
                      className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-3 text-left transition-colors"
                    >
                      <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xl flex-shrink-0">
                        {tool.icon_url ? (
                          <img src={tool.icon_url} alt="" className="w-6 h-6 object-contain" />
                        ) : "🛠"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-100 truncate">{tool.name}</p>
                        <p className="text-[10px] text-zinc-500">{tool.author}</p>
                        <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5">{tool.description}</p>
                      </div>
                      {isInstalled && (
                        <span className="text-[9px] font-bold text-green-500 flex-shrink-0">✓ instalada</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
