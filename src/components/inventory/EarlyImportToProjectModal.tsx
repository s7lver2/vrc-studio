// src/components/inventory/EarlyImportToProjectModal.tsx
import { useState, useEffect, useCallback } from "react";
import { X, Zap, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { tauriImportInventoryItemsEarly } from "@/lib/tauri";
import type { InventoryItem, Project, EarlyImportProgressEvent } from "@/lib/tauri";
import { GlobalProjectPickerModal } from "@/components/shared/GlobalProjectPickerModal";

interface Props {
  items: InventoryItem[];
  onClose: () => void;
}

type Phase = "pick-project" | "importing" | "done" | "error";

interface RowState {
  id: string;
  name: string;
  status: "pending" | "extracting" | "done" | "error";
  error?: string;
}

export function EarlyImportToProjectModal({ items, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("pick-project");
  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSelectProject = useCallback(async (p: Project) => {
    setProject(p);
    setPhase("importing");

    const initial: RowState[] = items.map((i) => ({
      id: i.id,
      name: i.display_name ?? i.name,
      status: "pending",
    }));
    setRows(initial);

    try {
      await tauriImportInventoryItemsEarly(p.id, items.map((i) => i.id));
    } catch (e) {
      setErrorMsg(String(e));
      setPhase("error");
    }
  }, [items]);

  // Listen to progress events
  useEffect(() => {
    const unlisten = listen<EarlyImportProgressEvent>("early_import_progress", (ev) => {
      const { item_id, status, error, item_name } = ev.payload;

      if (status === "complete") {
        setPhase("done");
        return;
      }

      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === item_id);
        if (idx === -1) {
          // Row might not exist if item_name is empty (complete signal)
          return prev;
        }
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          name: item_name || updated[idx].name,
          status: status as RowState["status"],
          error: error ?? undefined,
        };
        return updated;
      });
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const allDone = rows.length > 0 && rows.every((r) => r.status === "done" || r.status === "error");
  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  if (phase === "pick-project") {
    return (
      <GlobalProjectPickerModal
        title="Early Import to Project"
        subtitle="Select the project to import these assets into"
        showAllProjects
        onClose={onClose}
        onSelect={handleSelectProject}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[440px] rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl flex flex-col overflow-hidden max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-900/40 border border-amber-700/40 flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Early Import</p>
              {project && <p className="text-[10px] text-zinc-500 truncate max-w-[240px]">{project.name}</p>}
            </div>
          </div>
          {(phase === "done" || phase === "error") && (
            <button onClick={onClose} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Progress list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-zinc-800/40">
              <div className="shrink-0">
                {row.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {row.status === "error" && <AlertTriangle className="h-4 w-4 text-red-400" />}
                {row.status === "extracting" && <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />}
                {row.status === "pending" && <div className="h-4 w-4 rounded-full border-2 border-zinc-700" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-200 truncate">{row.name}</p>
                {row.error && <p className="text-[10px] text-red-400 truncate mt-0.5">{row.error}</p>}
              </div>
              <span className="text-[10px] text-zinc-600 shrink-0">
                {row.status === "done" ? "Done" : row.status === "error" ? "Error" : row.status === "extracting" ? "Extracting…" : "Pending"}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-800 shrink-0">
          <p className="text-xs text-zinc-500">
            {phase === "importing" && !allDone && "Importing…"}
            {(phase === "done" || allDone) && (
              <span>
                {doneCount > 0 && <span className="text-emerald-400">{doneCount} imported</span>}
                {doneCount > 0 && errorCount > 0 && " · "}
                {errorCount > 0 && <span className="text-red-400">{errorCount} failed</span>}
              </span>
            )}
            {phase === "error" && <span className="text-red-400">{errorMsg}</span>}
          </p>
          {(phase === "done" || allDone || phase === "error") ? (
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white transition-colors"
            >
              Close
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-600" />
              <span className="text-xs text-zinc-600">Please wait…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
