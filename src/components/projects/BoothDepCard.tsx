import { useState } from "react";
import { BoothDepEntry } from "../../lib/tauri";
import { CheckCircle2, ExternalLink, FolderOpen, Loader2, Package } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

interface Props {
  dep: BoothDepEntry;
  owned: boolean; // whether the current user owns this item in Booth
  onResolved: (sourceId: string) => void;
}

export function BoothDepCard({ dep, owned, onResolved }: Props) {
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleOpenInBooth = () => {
    const url = `https://booth.pm/en/items/${dep.source_id}`;
    window.open(url, "_blank");
  };

  const handleImportLocal = async () => {
    try {
      const selected = await openDialog({
        filters: [{ name: "Unity Package", extensions: ["unitypackage", "zip"] }],
        multiple: false,
      });
      if (selected) {
        // Mark as resolved — actual import handled by existing inventory flow
        onResolved(dep.source_id);
      }
    } catch (e) {
      console.error("File picker error:", e);
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/60">
      <div className="flex-shrink-0 mt-0.5">
        {status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : status === "downloading" ? (
          <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
        ) : (
          <Package className="h-4 w-4 text-zinc-500" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100 truncate">{dep.name}</p>
        <p className="text-xs text-zinc-500 truncate">{dep.author}</p>
        {dep.modified && (
          <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25">
            ⚠ Customized — tracked in git
          </span>
        )}
        {errorMsg && (
          <p className="text-xs text-red-400 mt-1">{errorMsg}</p>
        )}
      </div>

      {status !== "done" && (
        <div className="flex flex-col gap-1 flex-shrink-0">
          {!owned ? (
            <>
              <button
                onClick={handleOpenInBooth}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-pink-500/15 text-pink-300 border border-pink-500/25 hover:bg-pink-500/25 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Open in Booth
              </button>
              <button
                onClick={handleImportLocal}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 border border-zinc-600 hover:bg-zinc-600 transition-colors"
              >
                <FolderOpen className="h-3 w-3" />
                Import local file
              </button>
            </>
          ) : (
            <span className="text-[11px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              ✓ Owned
            </span>
          )}
        </div>
      )}
    </div>
  );
}
