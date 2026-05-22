// src/components/git/tree/Toolbar.tsx
import React from "react";
import {
  MousePointer2, Hand, Minus, Plus, RotateCcw,
  Play, Square, Check, Loader2, X,
} from "lucide-react";
import type { Tool, SimulationPhase, LayoutMode } from "./types";
import { TOOL_ICONS } from "./constants";
import { CanvasMenu } from "./CanvasMenu";

interface ToolbarProps {
  navTool: "select" | "pan";
  onNavTool: (t: "select" | "pan") => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onStartToolDrag: (tool: Tool, e: React.MouseEvent) => void;
  // Simulation controls — visible cuando toolNodes tiene ≥1 nodo ready
  anyToolReady: boolean;
  simPhase: SimulationPhase;
  applying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onConfirm: () => void;
  onCancelAll: () => void;

  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
}

function cn(...c: (string | false | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// Tool groups para separar visualmente con divisor
const TOOL_GROUPS: Tool[][] = [
  ["merge", "cherry-pick", "rebase", "squash"],
  ["branch", "tag"],
  ["soft-reset", "hard-reset", "revert", "amend"],
  ["stash", "pop-stash"],
  ["compare"],
];

export function Toolbar({
  navTool, onNavTool, zoom, onZoomIn, onZoomOut, onResetView,
  onStartToolDrag, anyToolReady, simPhase, applying,
  onPlay, onStop, onConfirm, onCancelAll, layoutMode, onLayoutChange,
}: ToolbarProps) {
  return (
    <div
      className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800 shrink-0 bg-zinc-950"
      style={{ userSelect: "none" }}
    >
      {/* ── Draggable tool palette ── */}
      {TOOL_GROUPS.map((group, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <div className="w-px h-5 bg-zinc-800 mx-0.5" />}
          {group.map((tool) => {
            const Icon = TOOL_ICONS[tool];
            return (
              <div
                key={tool}
                draggable={false}           // usamos custom drag para mayor control
                title={tool}
                onMouseDown={(e) => onStartToolDrag(tool, e)}
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 cursor-grab active:cursor-grabbing transition-colors select-none"
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
              </div>
            );
          })}
        </React.Fragment>
      ))}

      <div className="flex-1" />

      {/* ── Simulation buttons (visible when a ready tool node exists) ── */}
      {anyToolReady && (
        <>
          <div className="w-px h-5 bg-zinc-800 mx-1" />

          {/* Play */}
          {simPhase === "idle" && (
            <button
              title="Preview simulation"
              onClick={onPlay}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 font-medium transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
              Preview
            </button>
          )}

          {/* Stop (during running or paused) */}
          {(simPhase === "running" || simPhase === "paused") && (
            <button
              title="Stop simulation"
              onClick={onStop}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-900/40 hover:bg-amber-800/50 border border-amber-700/40 text-xs text-amber-300 font-medium transition-colors"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          )}

          {/* Confirm (only when paused = simulation fully shown) */}
          {simPhase === "paused" && (
            <button
              title="Confirm — execute operation"
              onClick={onConfirm}
              disabled={applying}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-emerald-100 text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {applying
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />
              }
              Confirm
            </button>
          )}

          {/* Cancel all tool nodes */}
          <button
            title="Discard all tool nodes"
            onClick={onCancelAll}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-5 bg-zinc-800 mx-1" />
        </>
      )}

      {/* ── Format/Layout menu ── */}
      <CanvasMenu layoutMode={layoutMode} onLayoutChange={onLayoutChange} />

      <div className="w-px h-5 bg-zinc-800 mx-1" />

      {/* ── Nav tools ── */}
      {(["select", "pan"] as const).map((t) => {
        const Icon = t === "select" ? MousePointer2 : Hand;
        return (
          <button
            key={t}
            title={t === "select" ? "Select" : "Pan canvas"}
            onClick={() => onNavTool(t)}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              navTool === t
                ? "bg-violet-900/50 text-violet-300 border border-violet-600"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}

      <div className="w-px h-5 bg-zinc-800 mx-1" />

      {/* ── Zoom ── */}
      <div className="flex items-center gap-0.5 text-zinc-500">
        <button onClick={onZoomOut} className="p-1.5 hover:text-zinc-200 rounded-md hover:bg-zinc-800" title="Zoom out">
          <Minus className="h-3 w-3" />
        </button>
        <span className="text-[10px] w-8 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={onZoomIn} className="p-1.5 hover:text-zinc-200 rounded-md hover:bg-zinc-800" title="Zoom in">
          <Plus className="h-3 w-3" />
        </button>
        <button onClick={onResetView} className="p-1.5 hover:text-zinc-200 rounded-md hover:bg-zinc-800" title="Reset view">
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}