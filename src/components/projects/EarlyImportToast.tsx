// src/components/projects/EarlyImportToast.tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { EarlyImportProgressEvent } from "@/lib/tauri";
import { Zap, CheckCircle2, X } from "lucide-react";

interface ToastState {
  visible: boolean;
  done: boolean;
  itemName: string;
  current: number;
  total: number;
  errorCount: number;
}

const INITIAL: ToastState = {
  visible: false, done: false, itemName: "", current: 0, total: 0, errorCount: 0,
};

export function EarlyImportToast() {
  const [state, setState] = useState<ToastState>(INITIAL);
  const [dismissTimer, setDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<EarlyImportProgressEvent>("early_import_progress", (ev) => {
      const p = ev.payload;
      if (p.status === "complete") {
        setState((prev) => ({ ...prev, done: true, visible: true }));
        const t = setTimeout(() => setState(INITIAL), 5000);
        setDismissTimer(t);
      } else if (p.status === "extracting") {
        setState({
          visible: true, done: false,
          itemName: p.item_name,
          current: p.current, total: p.total,
          errorCount: 0,
        });
      } else if (p.status === "error") {
        setState((prev) => ({ ...prev, errorCount: prev.errorCount + 1 }));
      }
    }).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    setState(INITIAL);
  };

  if (!state.visible) return null;

  const progress = state.total > 0 ? (state.current / state.total) * 100 : 0;

  return (
    <div
      className="fixed bottom-5 right-5 z-[9998] w-72 rounded-2xl border border-zinc-700/60 bg-zinc-900/95 backdrop-blur-sm shadow-2xl overflow-hidden"
      style={{ animation: "slideUp 0.25s ease-out" }}
    >
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <div className="flex items-start gap-3 p-4">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${state.done ? "bg-emerald-900/40 border border-emerald-700/40" : "bg-red-900/30 border border-red-700/30"}`}>
          {state.done
            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            : <Zap className="h-4 w-4 text-red-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100">Early Import</p>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">
            {state.done
              ? `${state.total} item${state.total !== 1 ? "s" : ""} extraído${state.total !== 1 ? "s" : ""} correctamente`
              : `Extrayendo ${state.itemName}… (${state.current} de ${state.total})`}
          </p>
          {!state.done && (
            <div className="mt-2 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-red-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        {state.done && (
          <button onClick={dismiss} className="shrink-0 p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
