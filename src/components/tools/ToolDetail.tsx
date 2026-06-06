// src/components/tools/ToolDetail.tsx
import { useState } from "react";
import { ArrowLeft, Download, CheckCircle } from "lucide-react";
import { ToolRegistryEntry } from "../../lib/tauri";
import { useToolsStore } from "../../store/toolsStore";
import { InstallProgress } from "./InstallProgress";
import { DependencyConfirmModal } from "./DependencyConfirmModal";

interface Props {
  entry: ToolRegistryEntry;
  onBack: () => void;
}

export function ToolDetail({ entry, onBack }: Props) {
  const { installed, install, installing, installingStep } = useToolsStore();
  const [showDepModal, setShowDepModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInstalled = installed.some((t) => t.id === entry.id);
  const isInstalling = entry.id in installing;
  const progress = installing[entry.id] ?? 0;
  const step = installingStep[entry.id] ?? "";

  const handleInstallClick = () => {
    if (entry.dependencies.length > 0) {
      setShowDepModal(true);
    } else {
      doInstall();
    }
  };

  const doInstall = async () => {
    setShowDepModal(false);
    setError(null);
    try {
      await install(entry);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showDepModal && (
        <DependencyConfirmModal
          toolName={entry.name}
          dependencies={entry.dependencies}
          onConfirm={doInstall}
          onCancel={() => setShowDepModal(false)}
        />
      )}

      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Marketplace
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Banner */}
        <div className="h-40 bg-zinc-800 relative overflow-hidden">
          {entry.banner_url && (
            <img src={entry.banner_url} alt="" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 to-transparent" />
        </div>

        <div className="px-8 py-6 flex flex-col gap-6 max-w-3xl">
          {/* Header row */}
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-3xl flex-shrink-0 -mt-10 relative z-10">
              {entry.icon_url ? (
                <img src={entry.icon_url} alt="" className="w-10 h-10 object-contain" />
              ) : "🛠"}
            </div>
            <div className="flex-1 min-w-0 mt-1">
              <h1 className="text-lg font-bold text-zinc-100">{entry.name}</h1>
              <p className="text-xs text-zinc-500">v{entry.version} · por {entry.author}</p>
            </div>
            <div className="flex-shrink-0">
              {isInstalled ? (
                <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-xs font-semibold">
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" /> Instalada
                </div>
              ) : (
                <button
                  onClick={handleInstallClick}
                  disabled={isInstalling}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isInstalling ? "Instalando…" : "Instalar"}
                </button>
              )}
            </div>
          </div>

          {/* Progress bar (while installing) */}
          {isInstalling && (
            <InstallProgress progress={progress} step={step} />
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
              Error: {error}
            </p>
          )}

          {/* Description */}
          <div>
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Descripción</h2>
            <p className="text-sm text-zinc-300 leading-relaxed">{entry.description}</p>
          </div>

          {/* Requirements */}
          {(entry.requires_unity || entry.dependencies.length > 0) && (
            <div>
              <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Requisitos</h2>
              <ul className="flex flex-col gap-1">
                {entry.requires_unity && (
                  <li className="text-xs text-zinc-400">
                    Unity {entry.min_unity_version || "2022.3"}+
                  </li>
                )}
                {entry.dependencies.map((dep) => (
                  <li key={dep} className="text-xs text-zinc-400">{dep}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Screenshots */}
          {entry.screenshots.length > 0 && (
            <div>
              <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Screenshots</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {entry.screenshots.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Screenshot ${i + 1}`}
                    className="h-40 rounded-xl border border-zinc-700 object-cover flex-shrink-0"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
