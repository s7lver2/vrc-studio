import { useState } from "react";
import { X, Download, FileArchive } from "lucide-react";
import { BoothDownloadable } from "@/lib/tauri";

interface Props {
  productName: string;
  downloadables: BoothDownloadable[];
  onSelect: (downloadable: BoothDownloadable) => void;
  onClose: () => void;
}

export function BoothDownloadPickerModal({ productName, downloadables, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<BoothDownloadable | null>(
    downloadables.length === 1 ? downloadables[0] : null
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Seleccionar archivo</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[300px]">{productName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
          {downloadables.map((dl) => (
            <button
              key={dl.id}
              onClick={() => setSelected(dl)}
              className={[
                "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
                selected?.id === dl.id
                  ? "border-violet-600 bg-violet-600/10"
                  : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50",
              ].join(" ")}
            >
              <FileArchive className="h-4 w-4 text-zinc-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate">{dl.name}</p>
                {dl.size_label && (
                  <p className="text-[10px] text-zinc-500 mt-0.5">{dl.size_label}</p>
                )}
              </div>
              {selected?.id === dl.id && (
                <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar
          </button>
        </div>
      </div>
    </div>
  );
}
