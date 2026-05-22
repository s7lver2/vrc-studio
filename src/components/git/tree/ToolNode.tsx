// src/components/git/tree/ToolNode.tsx
import React from "react";
import type { ToolNodeInstance } from "./types";
import { TOOL_ICONS, TOOL_NODE_W, TOOL_NODE_H, TOOL_PROPS_SCHEMA, TOOL_SOURCE_COUNT } from "./constants";

interface ToolNodeProps {
  node: ToolNodeInstance;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onPropsChange: (key: string, value: string) => void;
  onWireStart: (e: React.PointerEvent, toolNodeId: string) => void; // ← pointer event
}

// Paleta grisácea fija para tool nodes — no usar colores de rama
const TOOL_BG       = "#1a1a1f";
const TOOL_BORDER   = "#3f3f46";
const TOOL_ACCENT   = "#52525b";
const TOOL_ICON_BG  = "#111114";
const TOOL_TEXT     = "#a1a1aa";
const TOOL_SEL_BORDER = "#71717a";

export function ToolNode({ node, selected, onPointerDown, onClick, onPropsChange, onWireStart }: ToolNodeProps) {
  const IconComp = TOOL_ICONS[node.tool];
  const schema = TOOL_PROPS_SCHEMA[node.tool] ?? [];
  const needed = TOOL_SOURCE_COUNT[node.tool] ?? 1;
  const connected = node.connectedCommitIds.length;
  const ready = connected >= needed;

  return (
    <div
      style={{
        position: "absolute",
        animation: "nodeDropIn 0.2s ease-out",
        left: node.x,
        top: node.y,
        width: TOOL_NODE_W,
        borderRadius: 8,
        border: `1.5px solid ${selected ? TOOL_SEL_BORDER : TOOL_BORDER}`,
        boxShadow: selected
          ? "0 0 0 2px rgba(113,113,122,0.3), 0 6px 24px rgba(0,0,0,0.7)"
          : "0 4px 20px rgba(0,0,0,0.6)",
        cursor: "grab",
        userSelect: "none",
        overflow: "hidden",
        zIndex: selected ? 25 : 10,
        transition: "box-shadow 0.15s ease",
      }}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {/* ── Header ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: TOOL_ICON_BG,
        padding: "6px 10px",
        borderBottom: `1px solid ${TOOL_BORDER}`,
      }}>
        {/* Icono en la esquina superior */}
        <div style={{
          width: 22,
          height: 22,
          borderRadius: 5,
          background: "#222228",
          border: `1px solid ${TOOL_BORDER}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          {IconComp && <IconComp style={{ width: 12, height: 12, color: TOOL_TEXT }} />}
        </div>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#d4d4d8",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          flex: 1,
        }}>
          {node.tool}
        </span>
        {/* Badge: cuántos commits conectados / cuántos se necesitan */}
        <span style={{
          fontSize: 8,
          fontWeight: 700,
          color: ready ? "#6ee7b7" : "#a1a1aa",
          background: ready ? "#064e3b44" : "#27272a",
          borderRadius: 3,
          padding: "1px 5px",
          border: `1px solid ${ready ? "#065f4644" : "#3f3f46"}`,
        }}>
          {connected}/{needed}
        </span>
      </div>

      {/* ── Body: editable props ── */}
      <div style={{ background: TOOL_BG, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        {schema.length === 0 ? (
          <p style={{ fontSize: 9, color: "#3f3f46", margin: 0 }}>No parameters</p>
        ) : (
          schema.map((field) => (
            <div key={field.key}>
              <div style={{ fontSize: 8, color: TOOL_ACCENT, marginBottom: 2, fontWeight: 600 }}>
                {field.label}
              </div>
              <input
                value={node.props[field.key] ?? ""}
                onChange={(e) => onPropsChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  background: "#111114",
                  border: `1px solid ${TOOL_BORDER}`,
                  borderRadius: 5,
                  padding: "3px 7px",
                  fontSize: 10,
                  color: "#e4e4e7",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          ))
        )}
      </div>
      {/* ── Output port (drag from here to connect to a CommitNode) ── */}
      <div
        title="Drag to connect to a commit"
        onPointerDown={(e) => {
          e.stopPropagation();
          onWireStart(e, node.id);
        }}
        style={{
          position: "absolute",
          right: -7,
          top: "50%",
          transform: "translateY(-50%)",
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#27272a",
          border: "2px solid #52525b",
          cursor: "crosshair",
          zIndex: 30,
          transition: "border-color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "#3f3f46";
          (e.currentTarget as HTMLDivElement).style.borderColor = "#a78bfa";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "#27272a";
          (e.currentTarget as HTMLDivElement).style.borderColor = "#52525b";
        }}
      />
    </div>
  );
}