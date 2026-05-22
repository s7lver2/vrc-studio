import type { EdgeDef } from "./types";
import { NODE_W, NODE_H, GAP_Y } from "./constants";

interface NodeEdgeProps {
  edge: EdgeDef;
  fromPos: { x: number; y: number; w?: number; h?: number };
  toPos:   { x: number; y: number; w?: number; h?: number };
}

/**
 * Bezier curve entre dos nodos. El punto de salida es el centro-inferior del origen
 * y el punto de entrada es el centro-superior del destino.
 */
export function NodeEdge({ edge, fromPos, toPos }: NodeEdgeProps) {
  const fw = fromPos.w ?? NODE_W;
  const fh = fromPos.h ?? NODE_H;
  const tw = toPos.w ?? NODE_W;

  const x1 = fromPos.x + fw / 2;
  const y1 = fromPos.y + fh;
  const x2 = toPos.x + tw / 2;
  const y2 = toPos.y;

  const cpOffset = Math.abs(y2 - y1) * 0.4 + GAP_Y;

  const d = `M${x1},${y1} C${x1},${y1 + cpOffset} ${x2},${y2 - cpOffset} ${x2},${y2}`;

  const color = edge.isToolEdge ? "#ffffff" : edge.color;
  const opacity = edge.isToolEdge ? 0.5 : 0.65;

  return (
    <path
      d={d}
      stroke={color}
      strokeWidth={edge.isToolEdge ? 1.5 : 2}
      strokeDasharray={edge.dashed ? "6 4" : undefined}
      fill="none"
      opacity={opacity}
      style={edge.dashed ? { animation: "marchingAnts 0.8s linear infinite" } : undefined}
    />
  );
}