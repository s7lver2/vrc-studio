import { useState, useEffect } from "react";
import { vcs } from "@/lib/tauri";
import type { CommitDiffFile, FileDiff, DiffHunk } from "@/types/vcs";
import { ChevronLeft } from "lucide-react";
import { FileTypeIcon } from "./FileTypeIcon";
import { useT } from "@/i18n";

interface Props {
  projectPath: string;
  commitSha: string;
  file: CommitDiffFile;
  onBack: () => void;
}

function HunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="mb-0">
      <div className="sticky top-0 px-3 py-0.5 bg-blue-950/60 text-blue-300 text-[10px] font-mono border-y border-blue-900/40 z-10 backdrop-blur-sm">
        {hunk.header}
      </div>
      {hunk.lines.map((line, i) => {
        const isAdd = line.origin === "+";
        const isDel = line.origin === "-";
        const bg = isAdd
          ? "bg-green-950/50 hover:bg-green-950/80"
          : isDel
          ? "bg-red-950/50 hover:bg-red-950/80"
          : "hover:bg-zinc-800/30";
        const textColor = isAdd ? "text-green-300" : isDel ? "text-red-300" : "text-zinc-400";
        const gutterBg = isAdd ? "bg-green-950/80" : isDel ? "bg-red-950/80" : "bg-zinc-900/50";
        const signColor = isAdd ? "text-green-500" : isDel ? "text-red-500" : "text-zinc-600";

        return (
          <div key={i} className={`flex items-start ${bg} group select-text`}>
            <div className={`flex shrink-0 select-none ${gutterBg} border-r border-zinc-800`}>
              <span className="w-10 text-right pr-2 py-0.5 text-[10px] font-mono text-zinc-600">
                {line.old_lineno ?? ""}
              </span>
              <span className="w-10 text-right pr-2 py-0.5 text-[10px] font-mono text-zinc-600 border-l border-zinc-800/50">
                {line.new_lineno ?? ""}
              </span>
              <span className={`w-5 text-center py-0.5 text-[10px] font-mono shrink-0 ${signColor} border-l border-zinc-800/50`}>
                {line.origin === " " ? "" : line.origin}
              </span>
            </div>
            <span className={`flex-1 py-0.5 pl-2 text-[11px] font-mono whitespace-pre-wrap break-all leading-[1.6] ${textColor}`}>
              {line.content.replace(/\n$/, "")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function FileDiffView({ projectPath, commitSha, file, onBack }: Props) {
  const t = useT();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    vcs.getFileDiff(projectPath, commitSha, file.path)
      .then(setDiff)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectPath, commitSha, file.path]);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-zinc-800 shrink-0 bg-zinc-900/60">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors shrink-0"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("vcs_back")}
        </button>
        <span className="text-zinc-700 text-xs shrink-0">|</span>
        <FileTypeIcon path={file.path} className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-mono text-zinc-200 truncate flex-1">{file.path}</span>
        <div className="flex items-center gap-2 shrink-0">
          {diff && (
            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 rounded px-1.5 py-0.5">
              {t("vcs_diff_lines", { count: diff.hunks.reduce((acc, h) => acc + h.lines.length, 0) })}
            </span>
          )}
          <span className="text-[10px] font-mono text-red-400 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5">
            {commitSha.slice(0, 7)}
          </span>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        {loading && (
          <div className="p-6 text-xs text-zinc-500 animate-pulse">{t("vcs_loading_diff")}</div>
        )}
        {error && (
          <div className="p-6 text-xs text-red-400">{t("vcs_error", { error })}</div>
        )}
        {!loading && !error && diff && diff.hunks.length === 0 && (
          <div className="p-6 text-xs text-zinc-600">{t("vcs_diff_empty_file")}</div>
        )}
        {!loading && !error && diff && diff.hunks.map((hunk, i) => (
          <HunkView key={i} hunk={hunk} />
        ))}
      </div>
    </div>
  );
}