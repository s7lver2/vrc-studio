import { useState, useEffect } from "react";
import { X, Github, FlaskConical, FolderOpen, Loader2 } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { tauriProjectCloneFromGithub, CloneResult } from "../../lib/tauri";

interface Props {
  onClose: () => void;
  onCloned: (result: CloneResult) => void;
}

export function CloneFromGithubModal({ onClose, onCloned }: Props) {
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");
  const [status, setStatus] = useState<"idle" | "cloning" | "done" | "error">("idle");
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<string>("booth-deps:clone-progress", (e) => {
      setProgressLines((prev) => [...prev.slice(-20), e.payload]);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handlePickDest = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) setDest(selected as string);
  };

  const handleClone = async () => {
    if (!url.trim() || !dest.trim()) return;
    setStatus("cloning");
    setErrorMsg(null);
    setProgressLines([]);
    try {
      const result = await tauriProjectCloneFromGithub({ url: url.trim(), dest: dest.trim() });
      setStatus("done");
      onCloned(result);
    } catch (e) {
      setStatus("error");
      setErrorMsg(String(e));
    }
  };

  const isCloning = status === "cloning";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-zinc-400" />
            <h2 className="text-base font-semibold text-zinc-100">Clone from GitHub</h2>
            <span
              className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
              style={{
                background: "rgba(251,191,36,0.12)",
                border: "1px solid rgba(251,191,36,0.4)",
                color: "#fbbf24",
              }}
            >
              <FlaskConical className="h-2 w-2" />β
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isCloning}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Repository URL</label>
            <input
              type="text"
              placeholder="https://github.com/user/repo"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isCloning}
              className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Destination folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="C:\Users\you\Projects"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                disabled={isCloning}
                className="flex-1 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
              />
              <button
                onClick={handlePickDest}
                disabled={isCloning}
                className="px-2.5 py-2 rounded-md bg-zinc-700 border border-zinc-600 text-zinc-300 hover:bg-zinc-600 transition-colors disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </div>

          {progressLines.length > 0 && (
            <div className="rounded-md bg-zinc-950 border border-zinc-800 p-2 max-h-28 overflow-y-auto">
              {progressLines.map((line, i) => (
                <p key={i} className="text-[11px] text-zinc-400 font-mono leading-snug">
                  {line}
                </p>
              ))}
            </div>
          )}

          {errorMsg && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            disabled={isCloning}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleClone}
            disabled={isCloning || !url.trim() || !dest.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isCloning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isCloning ? "Cloning…" : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
}
