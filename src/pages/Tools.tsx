// src/pages/Tools.tsx
import { useEffect, useState } from "react";
import { Wrench, Store } from "lucide-react";
import { useToolsStore } from "../store/toolsStore";
import { ToolCard } from "../components/tools/ToolCard";
import { Marketplace } from "../components/tools/Marketplace";
import { AvatarPerf } from "../components/tools/runners/AvatarPerf";
import type { InstalledTool } from "../lib/tauri";

type View = "installed" | "marketplace";

const RUNNERS: Record<
  string,
  React.ComponentType<{
    toolId: string;
    onBack: () => void;
    onInteractive: (method: string, args: Record<string, unknown>) => Promise<unknown>;
    bypassSdk?: boolean;
  }>
> = {
  "avatar-performance-analyzer": AvatarPerf,
};

export default function ToolsPage() {
  const { installed, load, uninstall } = useToolsStore();
  const [view, setView] = useState<View>("installed");
  const [activeTool, setActiveTool] = useState<InstalledTool | null>(null);

  useEffect(() => { load(); }, [load]);

  if (activeTool) {
    const Runner = RUNNERS[activeTool.id];
    if (Runner) {
      return (
        <Runner
          toolId={activeTool.id}
          onBack={() => setActiveTool(null)}
          onInteractive={() => Promise.resolve(null)}
          bypassSdk
        />
      );
    }
    // Tool sin runner implementado
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800">
          <button
            onClick={() => setActiveTool(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >← Volver</button>
          <span className="text-sm font-semibold text-zinc-100">{activeTool.name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
          Runner no implementado para "{activeTool.id}"
        </div>
      </div>
    );
  }

  if (view === "marketplace") {
    return <Marketplace onBack={() => setView("installed")} />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-8 py-5 border-b border-zinc-800 shrink-0">
        <Wrench className="h-5 w-5 text-zinc-500" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-zinc-100">Tools</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            {installed.length} tool{installed.length !== 1 ? "s" : ""} instalada{installed.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setView("marketplace")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
        >
          <Store className="h-3.5 w-3.5" /> Marketplace
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {installed.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 select-none">
            <div className="h-14 w-14 rounded-2xl bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center">
              <Wrench className="h-6 w-6 text-zinc-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-zinc-400">No hay tools instaladas</p>
              <p className="text-xs text-zinc-600 mt-1">Abre el Marketplace para instalar la primera</p>
            </div>
            <button
              onClick={() => setView("marketplace")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
            >
              <Store className="h-3.5 w-3.5" /> Abrir Marketplace
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {installed.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                onRun={setActiveTool}
                onUninstall={uninstall}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}