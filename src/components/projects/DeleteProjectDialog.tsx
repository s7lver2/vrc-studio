import { useState } from "react";
import { Trash2, FolderX, HardDrive, AlertTriangle } from "lucide-react";
import { Project } from "@/lib/tauri";

interface DeleteProjectDialogProps {
  project: Project;
  onConfirm: (alsoDeleteFiles: boolean) => void;
  onCancel: () => void;
  isDeleting: boolean;
}

export function DeleteProjectDialog({
  project,
  onConfirm,
  onCancel,
  isDeleting,
}: DeleteProjectDialogProps) {
  const [alsoDeleteFiles, setAlsoDeleteFiles] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <div className="h-9 w-9 rounded-full bg-red-950/60 border border-red-900/40 flex items-center justify-center shrink-0">
            <Trash2 className="h-4 w-4 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Delete project?</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[220px]">{project.name}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 pb-4 flex flex-col gap-3">
          <p className="text-xs text-zinc-400 leading-relaxed">
            <span className="font-medium text-zinc-200">{project.name}</span> will be removed from VRC Studio.
          </p>

          {/* Delete files toggle */}
          <button
            onClick={() => setAlsoDeleteFiles((v) => !v)}
            className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors w-full ${
              alsoDeleteFiles
                ? "border-red-600/60 bg-red-950/25"
                : "border-zinc-700/60 bg-zinc-800/30 hover:border-zinc-600"
            }`}
          >
            {/* Checkbox */}
            <div className={`mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
              alsoDeleteFiles ? "bg-red-600 border-red-600" : "border-zinc-600 bg-zinc-800"
            }`}>
              {alsoDeleteFiles && (
                <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <FolderX className="h-3.5 w-3.5 text-red-400 shrink-0" />
                <p className="text-xs font-medium text-zinc-200">Also delete files from disk</p>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1 font-mono truncate leading-relaxed">
                {project.path}
              </p>
            </div>
          </button>

          {/* Warning when files deletion is checked */}
          {alsoDeleteFiles && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-950/30 border border-amber-900/40 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-px" />
              <p className="text-[10px] text-amber-300 leading-relaxed">
                <span className="font-semibold">This cannot be undone.</span> All Unity project files,
                assets, and packages inside <span className="font-mono">{project.path}</span> will be permanently deleted.
              </p>
            </div>
          )}

          {!alsoDeleteFiles && (
            <div className="flex items-center gap-2 text-[10px] text-zinc-600">
              <HardDrive className="h-3 w-3 shrink-0" />
              <span>Files on disk are kept. You can re-import the project later.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-800">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-md px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(alsoDeleteFiles)}
            disabled={isDeleting}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              alsoDeleteFiles
                ? "bg-red-700 hover:bg-red-800"
                : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {isDeleting ? "Deleting…" : alsoDeleteFiles ? "Delete project & files" : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}