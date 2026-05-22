// src/components/git/tree/constants.ts
import {
  GitMerge, Star, CornerUpRight, Layers,
  GitFork, Tag, RotateCcw, AlertTriangle, Undo2,
  Pencil, PackagePlus, PackageMinus, ArrowLeftRight,
} from "lucide-react";
import type { Tool } from "./types";

export const NODE_W = 224;
export const NODE_H = 80;
export const GAP_Y  = 40;
export const LANE_W = 264;
export const LANE_OFFSET_X = 48;
export const TOOL_NODE_W = 180;
export const TOOL_NODE_H = 64;
export const SIMULATION_BUILD_DELAY_MS = 420;

export const BRANCH_PALETTE = [
  "#a78bfa",
  "#34d399",
  "#60a5fa",
  "#f97316",
  "#f472b6",
  "#facc15",
  "#22d3ee",
  "#fb7185",
] as const;

export const TOOL_ICONS: Partial<Record<Tool, React.ElementType>> = {
  merge:        GitMerge,
  "cherry-pick": Star,
  rebase:       CornerUpRight,
  squash:       Layers,
  branch:       GitFork,
  tag:          Tag,
  "soft-reset": RotateCcw,
  "hard-reset": AlertTriangle,
  revert:       Undo2,
  amend:        Pencil,
  stash:        PackagePlus,
  "pop-stash":  PackageMinus,
  compare:      ArrowLeftRight,
};

export const TOOL_PROPS_SCHEMA: Partial<Record<Tool, { key: string; label: string; placeholder: string }[]>> = {
  merge:   [{ key: "commit_name", label: "Merge commit message", placeholder: "Merge branch 'feature'" }],
  squash:  [{ key: "commit_name", label: "Squash commit message", placeholder: "squash: combined commits" }],
  branch:  [{ key: "branch_name", label: "New branch name", placeholder: "feature/my-branch" }],
  tag:     [
    { key: "tag_name", label: "Tag name", placeholder: "v1.0.0" },
    { key: "tag_message", label: "Tag message", placeholder: "Release v1.0.0" },
  ],
  amend:   [{ key: "commit_message", label: "New commit message", placeholder: "Updated commit message" }],
};

export const TOOL_SOURCE_COUNT: Partial<Record<Tool, number>> = {
  merge:   2,
  compare: 2,
};