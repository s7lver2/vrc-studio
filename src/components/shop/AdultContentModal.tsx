import { Lock } from "lucide-react";
import { useAppStore } from "@/store/app";

interface Props {
  onClose: () => void;
}

export function AdultContentModal({ onClose }: Props) {
  const setShowAdultContent = useAppStore((s) => s.setShowAdultContent);

  const handleActivate = () => {
    setShowAdultContent(true);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <Lock className="h-6 w-6 text-zinc-400" />
          </div>
          <h2 className="text-base font-semibold text-zinc-100">Contenido para adultos</h2>
          <p className="text-sm text-zinc-400">
            Este contenido está marcado como solo para adultos (+18).
            ¿Deseas activar la visualización de contenido adulto?
          </p>
        </div>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleActivate}
            className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
          >
            Activar
          </button>
        </div>
      </div>
    </div>
  );
}
