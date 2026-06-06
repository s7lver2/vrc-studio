// src/components/tools/DependencyConfirmModal.tsx
import { X } from "lucide-react";

interface Props {
  toolName: string;
  dependencies: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DependencyConfirmModal({ toolName, dependencies, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-zinc-100">Instalar "{toolName}"</h2>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-400 mb-3">Esta tool requiere las siguientes dependencias:</p>
        <ul className="flex flex-col gap-1.5 mb-5">
          {dependencies.map((dep) => (
            <li key={dep} className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
              {dep}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-xs font-medium hover:border-zinc-500 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors"
          >
            Instalar todo
          </button>
        </div>
      </div>
    </div>
  );
}
