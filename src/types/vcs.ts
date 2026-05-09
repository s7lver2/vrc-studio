export interface GitStatus {
  branch: string;
  has_upstream: boolean;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface CommitEntry {
  id: string;
  message: string;
  author: string;
  timestamp: number; // Unix seconds
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
}

// Archivo cambiado dentro de un commit (con estadísticas)
export interface CommitDiffFile {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  old_path: string | null; // solo si renamed
  insertions: number;
  deletions: number;
}

// Una línea en un diff
export interface DiffLine {
  origin: "+" | "-" | " " | "\\"; // added, deleted, context, no-newline
  content: string;
  old_lineno: number | null;
  new_lineno: number | null;
}

// Un hunk (bloque contiguo de cambios) en un diff
export interface DiffHunk {
  header: string; // @@ -10,7 +10,8 @@ fn example()
  lines: DiffLine[];
}

// Diff completo de un archivo en un commit
export interface FileDiff {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  hunks: DiffHunk[];
}