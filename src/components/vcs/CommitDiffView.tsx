import { useState, useEffect } from "react";
import { vcs } from "@/lib/tauri";
import type { CommitDiffFile } from "@/types/vcs";
import { FileDiffView } from "./FileDiffView";
import { FileTypeIcon } from "./FileTypeIcon";
import { ChevronLeft } from "lucide-react";
import { useT } from "@/i18n";

interface Props {
  projectPath: string;
  commitSha: string;
  commitMessage: string;
  onBack: () => void;
}

function StatusBadge({ file }: { file: CommitDiffFile }) {
  const colorMap = {
    added:    "text-green-400 bg-green-950/40 border-green-900/40",
    deleted:  "text-red-400 bg-red-950/40 border-red-900/40",
    renamed:  "text-blue-400 bg-blue-950/40 border-blue-900/40",
    modified: "text-yellow-400 bg-yellow-950/40 border-yellow-900/40",
  };
  const letterMap = { added: "A", deleted: "D", renamed: "R", modified: "M" };
  return (
    <span
      className={`shrink-0 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded border ${colorMap[file.status]}`}
      title={file.status}
    >
      {letterMap[file.status]}
    </span>
  );
}

export function CommitDiffView({ projectPath, commitSha, commitMessage, onBack }: Props) {
  const t = useT();
  const [files, setFiles] = useState<CommitDiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<CommitDiffFile | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    vcs.getCommitDiff(projectPath, commitSha)
      .then(setFiles)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectPath, commitSha]);

  if (selectedFile) {
    return (
      <FileDiffView
        projectPath={projectPath}
        commitSha={commitSha}
        file={selectedFile}
        onBack={() => setSelectedFile(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("vcs_back")}
        </button>
        <span className="text-zinc-700 text-xs">|</span>
        <span className="text-xs font-mono text-red-400">{commitSha.slice(0, 7)}</span>
        <span className="text-xs text-zinc-400 truncate">{commitMessage}</span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-xs text-zinc-500 animate-pulse">{t("vcs_loading_diff")}</div>
        )}
        {error && (
          <div className="p-4 text-xs text-red-400">{t("vcs_error", { error })}</div>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="p-4 text-xs text-zinc-500">{t("vcs_diff_empty")}</div>
        )}
        {!loading && !error && files.map((file) => (
          <button
            key={file.path}
            onClick={() => setSelectedFile(file)}
            className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-800/60 transition-colors text-left group border-b border-zinc-800/40 last:border-0"
          >
            <FileTypeIcon path={file.path} />
            <span className="flex-1 text-xs font-mono text-zinc-300 truncate group-hover:text-zinc-100 min-w-0">
              {file.old_path ? (
                <>
                  <span className="text-zinc-600">{file.old_path}</span>
                  <span className="text-zinc-600 mx-1">→</span>
                </>
              ) : null}
              {file.path}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 text-[10px] font-mono">
                {file.insertions > 0 && (
                  <span className="text-green-400">+{file.insertions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-400">-{file.deletions}</span>
                )}
              </div>
              <StatusBadge file={file} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}