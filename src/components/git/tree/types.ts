// src/components/git/tree/types.ts
import type { CommitEntry, BranchInfo, CommitDiffFile } from "@/types/vcs";

export type Tool =
  | "select" | "pan"
  | "merge" | "cherry-pick" | "rebase" | "squash"
  | "branch" | "tag"
  | "soft-reset" | "hard-reset" | "revert" | "amend"
  | "stash" | "pop-stash"
  | "compare";

export const DRAGGABLE_TOOLS: Tool[] = [
  "merge", "cherry-pick", "rebase", "squash",
  "branch", "tag", "soft-reset", "hard-reset", "revert",
  "amend", "stash", "pop-stash", "compare",
];

export type LayoutMode =
  | "vertical-tree"
  | "horizontal-tree"
  | "vertical-master-center"
  | "horizontal-master-center"
  | "timeline"
  | "compact";

export type NodePosition = {
  x: number;
  y: number;
  color: string;
  isHead: boolean;
  isCurrentBranch: boolean;
  branchNames: string[];
};

export type ToolNodeInstance = {
  id: string;
  tool: Tool;
  x: number;
  y: number;
  connectedCommitIds: string[];
  props: Record<string, string>;
};

export type SimulationCommit = {
  id: string;
  message: string;
  x: number;
  y: number;
  color: string;
  toolNodeId: string;
  sourceCommitId?: string;
};

export type SimulationPhase =
  | "idle"
  | "running"
  | "paused";

export type EdgeDef = {
  fromId: string;
  toId: string;
  color: string;
  isToolEdge: boolean;
  dashed?: boolean;
};

export type PropsPanelTarget =
  | { kind: "commit"; commitId: string; commit: CommitEntry | undefined; color: string; branchNames: string[]; files: CommitDiffFile[]; filesLoading: boolean }
  | { kind: "tool"; toolNodeId: string };

export type WireState = {
  toolNodeId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
} | null;