import { useState, useEffect, useCallback } from "react";
import { vcs, type ConflictFile, type ConflictStrategy } from "@/lib/tauri";
import { FileTypeIcon } from "./FileTypeIcon";
import {
  AlertTriangle, CheckCircle2, RefreshCw,
  ArrowLeftRight, Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import { useT } from "@/i18n";

interface Props {
  projectPath: string;
  onResolved?: () => void;
}

interface ConflictState {
  file: ConflictFile;
  status: "pending" | "resolving" | "resolved" | "error";
  error?: string;
  expanded: boolean;
}

export function ConflictResolverTab({ projectPath, onResolved }: Props) {
  const t = useT();
  const [conflicts, setConflicts] = useState<ConflictState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    vcs.getConflicts(projectPath)
      .then((files) => {
        setConflicts(files.map((f) => ({
          file: f,
          status: "pending",
          expanded: false,
        })));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectPath]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (index: number, strategy: ConflictStrategy) => {
    setConflicts((prev) =>
      prev.map((c, i) => i === index ? { ...c, status: "resolving" } : c)
    );
    try {
      await vcs.resolveConflict(projectPath, conflicts[index].file.path, strategy);
      const updated = conflicts.map((c, i) =>
        i === index ? { ...c, status: "resolved" as const } : c
      );
      setConflicts(updated);
      if (updated.every((c) => c.status === "resolved")) {
        onResolved?.();
      }
    } catch (e) {
      setConflicts((prev) =>
        prev.map((c, i) => i === index ? { ...c, status: "error", error: String(e) } : c)
      );
    }
  };

  const toggleExpand = (index: number) => {
    setConflicts((prev) =>
      prev.map((c, i) => i === index ? { ...c, expanded: !c.expanded } : c)
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 gap-2 text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">{t("vcs_loading_conflicts")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-red-400">{t("vcs_error", { error })}</div>
    );
  }

  const pending = conflicts.filter((c) => c.status !== "resolved");
  const resolved = conflicts.filter((c) => c.status === "resolved");

  if (conflicts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 text-zinc-600">
        <CheckCircle2 className="h-8 w-8 text-green-500/70" />
        <p className="text-sm">{t("vcs_no_conflicts")}</p>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> {t("vcs_refresh")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 shrink-0">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold text-zinc-200">
          {t("vcs_conflicts_pending", { count: pending.length })}
        </span>
        {resolved.length > 0 && (
          <span className="text-[10px] text-green-400 ml-1">
            · {t("vcs_conflicts_resolved", { count: resolved.length })}
          </span>
        )}
        <button
          onClick={load}
          className="ml-auto text-zinc-600 hover:text-zinc-400 transition-colors"
          title={t("vcs_refresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Info banner */}
      <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-900/30 shrink-0">
        <p className="text-[10px] text-amber-300/80 leading-relaxed">
          {t("vcs_conflict_info")}
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conflicts.map((c, i) => (
          <div
            key={c.file.path}
            className={`border-b border-zinc-800/60 ${
              c.status === "resolved" ? "opacity-50" : ""
            }`}
          >
            {/* File row */}
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <button
                onClick={() => toggleExpand(i)}
                className="text-zinc-600 hover:text-zinc-400 shrink-0"
              >
                {c.expanded
                  ? <ChevronDown className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />
                }
              </button>
              <FileTypeIcon path={c.file.path} />
              <span className="flex-1 text-xs font-mono text-zinc-200 truncate">
                {c.file.path}
              </span>

              {/* Status / actions */}
              {c.status === "resolved" ? (
                <span className="flex items-center gap-1 text-[10px] text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("vcs_resolved")}
                </span>
              ) : c.status === "resolving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => resolve(i, "ours")}
                    className="text-[10px] px-2 py-1 rounded border border-blue-700/60 text-blue-400 hover:bg-blue-950/40 transition-colors font-medium"
                  >
                    {t("vcs_conflict_resolve_ours")}
                  </button>
                  <ArrowLeftRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <button
                    onClick={() => resolve(i, "theirs")}
                    className="text-[10px] px-2 py-1 rounded border border-orange-700/60 text-orange-400 hover:bg-orange-950/40 transition-colors font-medium"
                  >
                    {t("vcs_conflict_resolve_theirs")}
                  </button>
                  <button
                    onClick={() => resolve(i, "manual")}
                    className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
                  >
                    {t("vcs_conflict_resolve_manual")}
                  </button>
                </div>
              )}
            </div>

            {/* Snippet preview */}
            {c.expanded && c.status !== "resolved" && (
              <div className="mx-4 mb-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-blue-400 mb-1">
                    {t("vcs_conflict_ours_header")}
                  </p>
                  <pre className="text-[10px] font-mono bg-blue-950/20 border border-blue-900/30 rounded p-2 text-blue-200 overflow-x-auto whitespace-pre leading-relaxed max-h-28 overflow-y-auto">
                    {c.file.ours_snippet || t("vcs_no_content")}
                  </pre>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-orange-400 mb-1">
                    {t("vcs_conflict_theirs_header")}
                  </p>
                  <pre className="text-[10px] font-mono bg-orange-950/20 border border-orange-900/30 rounded p-2 text-orange-200 overflow-x-auto whitespace-pre leading-relaxed max-h-28 overflow-y-auto">
                    {c.file.theirs_snippet || t("vcs_no_content")}
                  </pre>
                </div>
              </div>
            )}

            {c.status === "error" && (
              <p className="px-4 pb-2 text-[10px] text-red-400">{c.error}</p>
            )}
          </div>
        ))}
      </div>

      {/* Footer — commit reminder */}
      {resolved.length > 0 && pending.length === 0 && (
        <div className="px-4 py-3 border-t border-zinc-800 bg-green-950/20 shrink-0">
          <p className="text-[10px] text-green-400">
            {t("vcs_all_conflicts_resolved_hint")}
          </p>
        </div>
      )}
    </div>
  );
}