// src/components/git/tree/CommitNode.tsx
import React from "react";
import type { CommitEntry } from "@/types/vcs";
import { shortSha, fmtShort } from "./utils";
import { NODE_W, NODE_H } from "./constants";

interface CommitNodeProps {
  commit: CommitEntry;
  x: number;
  y: number;
  color: string;          // color de la rama que posee este commit
  isHead: boolean;
  branchNames: string[];
  selected: boolean;
  isToolSource: boolean;  // está siendo referenciado por un tool node
  isCurrentBranch: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

export function CommitNode({
  commit, x, y, color, isHead, isCurrentBranch, branchNames,
  selected, isToolSource, onPointerDown, onClick,
}: CommitNodeProps) {
  const short = shortSha(commit.id);
  const date = fmtShort(commit.timestamp);

  // Estilo borde exterior según estado
  const borderStyle = isToolSource
    ? `2px dashed ${color}`
    : selected
    ? `2px solid #fff`
    : `1.5px solid ${color}55`;

  const shadow = isToolSource
    ? `0 0 0 3px ${color}33, 0 4px 24px rgba(0,0,0,0.7)`
    : selected
    ? `0 0 0 3px rgba(255,255,255,0.15), 0 4px 24px rgba(0,0,0,0.7)`
    : `0 2px 16px rgba(0,0,0,0.6)`;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: NODE_W,
        height: NODE_H,
        borderRadius: 10,
        border: borderStyle,
        boxShadow: shadow,
        cursor: "pointer",
        userSelect: "none",
        overflow: "hidden",
        zIndex: selected ? 20 : 5,
        transition: "box-shadow 0.15s ease, border 0.15s ease",
      }}
      onPointerDown={onPointerDown}
      onClick={onClick}
    > {/* <── Move the closing bracket HERE */}
      
      {/* ── Current branch indicator: thin left bar ── */}
      {isCurrentBranch && !isToolSource && (
        <div style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          borderRadius: "10px 0 0 10px",
          background: color,
          opacity: 0.9,
          zIndex: 2,
        }} />
      )}
      {/* <── REMOVE the bracket from here ── */}

      {/* ── Header: color de rama ── */}
      <div style={{
        height: 28,
        background: `linear-gradient(90deg, ${color}cc, ${color}66)`,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 10px",
        borderBottom: `1px solid ${color}44`,
      }}>
        {/* Indicador HEAD animado */}
        {isHead && (
          <span style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: "0.1em",
            background: "rgba(0,0,0,0.35)",
            color: "#fff",
            borderRadius: 3,
            padding: "1px 5px",
          }}>
            HEAD
          </span>
        )}
        {/* Branch badges */}
        {branchNames.map((bn) => (
          <span key={bn} style={{
            fontSize: 8,
            fontWeight: 700,
            background: "rgba(0,0,0,0.35)",
            color: "rgba(255,255,255,0.9)",
            borderRadius: 3,
            padding: "1px 5px",
            maxWidth: 90,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {bn}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        {/* SHA */}
        <span style={{
          fontFamily: "monospace",
          fontSize: 9,
          color: "rgba(255,255,255,0.7)",
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}>
          {short}
        </span>
      </div>

      {/* ── Body ── */}
      <div style={{
        height: NODE_H - 28,
        background: "linear-gradient(145deg, #1c1c20, #141416)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "6px 10px",
        boxSizing: "border-box",
      }}>
        {/* Commit message */}
        <p style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#e4e4e7",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          lineHeight: 1.3,
          margin: 0,
        }}>
          {commit.message}
        </p>
        {/* Author + date */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#71717a", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {commit.author}
          </span>
          <span style={{ fontSize: 9, color: "#52525b" }}>{date}</span>
        </div>
      </div>
    </div>
  );
}