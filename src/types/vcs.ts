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