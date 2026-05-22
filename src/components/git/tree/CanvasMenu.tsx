// src/components/git/tree/CanvasMenu.tsx
import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Check } from "lucide-react";
import type { LayoutMode } from "./types";

interface CanvasMenuProps {
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
}

const LAYOUT_OPTIONS: { mode: LayoutMode; label: string; description: string }[] = [
  {
    mode: "vertical-tree",
    label: "Vertical Tree",
    description: "Branches as columns, newest commit at top",
  },
  {
    mode: "horizontal-tree",
    label: "Horizontal Tree",
    description: "Branches as rows, newest commit at left",
  },
  {
    mode: "vertical-master-center",
    label: "Vertical — Master Center",
    description: "Main branch in center column, feature branches on sides",
  },
  {
    mode: "horizontal-master-center",
    label: "Horizontal — Master Center",
    description: "Main branch in center row, feature branches above/below",
  },
  {
    mode: "timeline",
    label: "Timeline",
    description: "All commits arranged by date, left to right",
  },
  {
    mode: "compact",
    label: "Compact",
    description: "Tighter spacing, more commits visible at once",
  },
];

export function CanvasMenu({ layoutMode, onLayoutChange }: CanvasMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        title="Format options"
        onClick={() => setOpen((v) => !v)}
        className={`p-1.5 rounded-md transition-colors ${
          open
            ? "bg-zinc-700 text-zinc-200"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        }`}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 256,
            background: "#18181b",
            border: "1px solid #27272a",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
            zIndex: 999,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #27272a",
              fontSize: 9,
              fontWeight: 700,
              color: "#52525b",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Format / Layout
          </div>

          {/* Options */}
          {LAYOUT_OPTIONS.map((opt) => {
            const active = layoutMode === opt.mode;
            return (
              <button
                key={opt.mode}
                onClick={() => {
                  onLayoutChange(opt.mode);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  width: "100%",
                  background: active ? "#27272a" : "transparent",
                  border: "none",
                  borderBottom: "1px solid #1f1f23",
                  padding: "9px 12px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                className="hover:bg-zinc-800/60 transition-colors"
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    marginTop: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {active && <Check style={{ width: 11, height: 11, color: "#a78bfa" }} />}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: active ? "#e4e4e7" : "#a1a1aa",
                      marginBottom: 2,
                    }}
                  >
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 9, color: "#52525b" }}>{opt.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}