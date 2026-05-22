// src/components/git/tree/utils.ts
import type { CommitEntry, BranchInfo } from "@/types/vcs";
import type { NodePosition, LayoutMode } from "./types";
import { BRANCH_PALETTE, NODE_W, NODE_H, GAP_Y, LANE_W, LANE_OFFSET_X } from "./constants";

export function shortSha(id: string): string {
  return id.slice(0, 7);
}

export function fmtShort(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function branchColorFor(
  branchName: string,
  allBranches: BranchInfo[],
  customColors: Record<string, string> = {}
): string {
  if (customColors[branchName]) return customColors[branchName];
  const idx = allBranches.findIndex((b) => b.name === branchName);
  return BRANCH_PALETTE[(idx < 0 ? 0 : idx) % BRANCH_PALETTE.length];
}

/**
 * Asigna a cada commit SHA el índice de lane (rama) que lo "posee".
 * La rama actual siempre va en lane 0.
 */
export function buildCommitLane(
  commits: CommitEntry[],
  branches: BranchInfo[]
): Record<string, number> {
  const laneMap: Record<string, number> = {};

  // Rama actual en lane 0, resto ordenadas
  const orderedBranches = [
    ...branches.filter((b) => b.is_current),
    ...branches.filter((b) => !b.is_current),
  ];

  orderedBranches.forEach((branch, laneIdx) => {
    let sha: string | undefined = branch.tip_sha;
    const visited = new Set<string>();
    while (sha) {
      if (laneMap[sha] !== undefined || visited.has(sha)) break;
      visited.add(sha);
      laneMap[sha] = laneIdx;
      const commit = commits.find((c) => c.id === sha);
      sha = commit?.parent_ids?.[0];
    }
  });

  // Fallback: commits sin lane asignado → lane 0
  commits.forEach((c) => {
    if (laneMap[c.id] === undefined) laneMap[c.id] = 0;
  });

  return laneMap;
}

/**
 * Retorna un mapa id → NodePosition con las coordenadas de canvas de cada commit.
 * Los nodos más recientes aparecen más arriba.
 */
export function buildNodePositions(
  commits: CommitEntry[],
  branches: BranchInfo[],
  laneMap: Record<string, number>,
  customColors: Record<string, string>,
  currentBranch: string,
  nodeDeltaMap: Record<string, { dx: number; dy: number }>,
  layoutMode: LayoutMode = "vertical-tree"   // ← nuevo parámetro con default
): Record<string, NodePosition> {
  const map: Record<string, NodePosition> = {};
  const laneRowCount: Record<number, number> = {};

  // Separación compacta para modo "compact"
  const gapY  = layoutMode === "compact" ? 16 : GAP_Y;
  const laneW = layoutMode === "compact" ? 240 : LANE_W;

  // Más reciente arriba
  const sorted = [...commits].sort((a, b) => b.timestamp - a.timestamp);

  // Para "vertical-master-center": el lane 0 (master) arranca en el centro.
  // Añadimos un offset horizontal basado en el número de lanes totales.
  const maxLane = Math.max(0, ...Object.values(laneMap));

  sorted.forEach((c) => {
    const lane = laneMap[c.id] ?? 0;
    const row = laneRowCount[lane] ?? 0;
    laneRowCount[lane] = row + 1;

    let baseX: number;
    let baseY: number;

    switch (layoutMode) {
      case "horizontal-tree": {
        baseX = LANE_OFFSET_X + row * (NODE_W + gapY);
        baseY = LANE_OFFSET_X + lane * (NODE_H + gapY);
        break;
      }
      case "horizontal-master-center": {
        // Master (lane 0) en el centro vertical; lanes alternados arriba y abajo
        const totalLanes = Math.max(1, maxLane + 1);
        const centerLane = Math.floor(totalLanes / 2);
        const col = laneToColumn(lane);
        baseX = LANE_OFFSET_X + row * (NODE_W + gapY);
        baseY = LANE_OFFSET_X + (centerLane + col) * (NODE_H + gapY);
        break;
      }
      case "timeline": {
        // Un único "carril" cronológico, de izquierda a derecha
        const globalRow = sorted.indexOf(c);
        baseX = LANE_OFFSET_X + globalRow * (NODE_W + gapY);
        baseY = LANE_OFFSET_X;
        break;
      }
      case "vertical-master-center": {
  // Master (lane 0) en la columna central; lanes alternados izquierda y derecha
  const totalLanes = Math.max(1, maxLane + 1);
  const centerLane = Math.floor(totalLanes / 2);
  const col = laneToColumn(lane);
  baseX = LANE_OFFSET_X + (centerLane + col) * laneW;
  baseY = row * (NODE_H + gapY);
  break;
}
case "vertical-tree":
case "compact":
default: {
  baseX = LANE_OFFSET_X + lane * laneW;
  baseY = row * (NODE_H + gapY);
  break;
}
    }

    const delta = nodeDeltaMap[c.id] ?? { dx: 0, dy: 0 };

    const laneOwner = orderedBranchAt(branches, lane);
    const color = branchColorFor(laneOwner ?? currentBranch, branches, customColors);

    // Commits que pertenecen a la rama actual
    const currentBranchInfo = branches.find((b) => b.is_current);
    const isCurrentBranch = !!currentBranchInfo && laneOwner === currentBranchInfo.name;

    map[c.id] = {
      x: baseX + delta.dx,
      y: baseY + delta.dy,
      color,
      isHead: c.id === sorted[0]?.id && lane === 0,
      isCurrentBranch,   // ← nuevo campo
      branchNames: branches.filter((b) => b.tip_sha === c.id).map((b) => b.name),
    };
  });

  return map;
}

function orderedBranchAt(branches: BranchInfo[], laneIdx: number): string | undefined {
  const ordered = [
    ...branches.filter((b) => b.is_current),
    ...branches.filter((b) => !b.is_current),
  ];
  return ordered[laneIdx]?.name;
}

/**
 * Convierte un índice de lane al offset de columna para los modos "master center".
 * Lane 0 → 0 (centro), Lane 1 → +1, Lane 2 → -1, Lane 3 → +2, Lane 4 → -2, …
 */
function laneToColumn(lane: number): number {
  if (lane === 0) return 0;
  const half = Math.ceil(lane / 2);
  return lane % 2 === 1 ? half : -half;
}