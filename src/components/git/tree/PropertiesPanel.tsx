// src/components/git/tree/PropertiesPanel.tsx
import React from "react";
import { X, Loader2, GitFork, Star } from "lucide-react";
import type { PropsPanelTarget, ToolNodeInstance } from "./types";
import { TOOL_ICONS } from "./constants";
import { fmtShort, shortSha } from "./utils";

interface PropsPanelProps {
  target: PropsPanelTarget;
  toolNodes: ToolNodeInstance[];
  onClose: () => void;
  onQuickAction: (action: "branch" | "cherry-pick", commitId: string) => void;
}

const STATUS_BG: Record<string, string> = {
  added:    "#064e3b",
  deleted:  "#450a0a",
  modified: "#451a03",
  renamed:  "#1e3a5f",
};
const STATUS_FG: Record<string, string> = {
  added:    "#6ee7b7",
  deleted:  "#fca5a5",
  modified: "#fcd34d",
  renamed:  "#93c5fd",
};

export function PropertiesPanel({ target, toolNodes, onClose, onQuickAction }: PropsPanelProps) {
  return (
    <div style={{
      width: 272,
      flexShrink: 0,
      background: "#111113",
      borderLeft: "1px solid #27272a",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderBottom: "1px solid #27272a",
        background: "#18181b",
        flexShrink: 0,
      }}>
        {target.kind === "commit" ? (
          <>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: target.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e4e4e7", fontWeight: 700, flex: 1 }}>
              {shortSha(target.commitId)}
            </span>
          </>
        ) : (
          <>
            {(() => { const Icon = TOOL_ICONS[toolNodes.find(t => t.id === target.toolNodeId)?.tool ?? "checkout"]; return Icon ? <Icon style={{ width: 14, height: 14, color: "#71717a" }} /> : null; })()}
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e4e4e7", fontWeight: 700, flex: 1 }}>
              {toolNodes.find(t => t.id === target.toolNodeId)?.tool ?? "tool"}
            </span>
          </>
        )}
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", padding: 2, display: "flex" }}>
          <X style={{ width: 13, height: 13 }} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {target.kind === "commit" ? (
          <CommitPanelBody target={target} onQuickAction={onQuickAction} />
        ) : (
          <ToolPanelBody
            toolNode={toolNodes.find(t => t.id === target.toolNodeId) ?? null}
          />
        )}
      </div>
    </div>
  );
}

function CommitPanelBody({
  target,
  onQuickAction,
}: {
  target: Extract<PropsPanelTarget, { kind: "commit" }>;
  onQuickAction: PropsPanelProps["onQuickAction"];
}) {
  const { commit, color, branchNames, files, filesLoading, commitId } = target;

  return (
    <>
      {/* Branch badges */}
      {branchNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {branchNames.map((bn) => (
            <span key={bn} style={{
              fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
              background: color + "22", color, border: `1px solid ${color}44`,
            }}>
              {bn}
            </span>
          ))}
        </div>
      )}

      {/* Message + meta */}
      {commit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#e4e4e7", lineHeight: 1.4, margin: 0 }}>
            {commit.message}
          </p>
          <p style={{ fontSize: 10, color: "#71717a", margin: 0 }}>
            {commit.author} · {fmtShort(commit.timestamp)}
          </p>
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <button onClick={() => onQuickAction("branch", commitId)} style={btnStyle("#18181b", "#a1a1aa", "#3f3f46")}>
          <GitFork style={{ width: 11, height: 11 }} /> New Branch from here
        </button>
        <button onClick={() => onQuickAction("cherry-pick", commitId)} style={btnStyle("#18181b", "#a1a1aa", "#3f3f46")}>
          <Star style={{ width: 11, height: 11 }} /> Cherry-pick
        </button>
      </div>

      {/* Changed files */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Changed files ({files.length})
        </p>
        {filesLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
            <Loader2 style={{ width: 12, height: 12, color: "#52525b" }} className="animate-spin" />
            <span style={{ fontSize: 10, color: "#52525b" }}>Loading…</span>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {files.map((f) => (
            <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{
                fontSize: 8, fontWeight: 800, borderRadius: 3, padding: "1px 4px", flexShrink: 0,
                background: STATUS_BG[f.status] ?? "#27272a",
                color: STATUS_FG[f.status] ?? "#a1a1aa",
              }}>
                {f.status[0].toUpperCase()}
              </span>
              <span style={{ fontSize: 10, color: "#71717a", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.path.split("/").pop()}
              </span>
            </div>
          ))}
          {!filesLoading && files.length === 0 && (
            <p style={{ fontSize: 10, color: "#3f3f46", margin: 0 }}>No file changes</p>
          )}
        </div>
      </div>
    </>
  );
}

function ToolPanelBody({ toolNode }: { toolNode: ToolNodeInstance | null }) {
  if (!toolNode) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ fontSize: 10, color: "#71717a", margin: 0 }}>
        Connect commit nodes to this tool by clicking them on the canvas while the tool node is selected. Once all required inputs are connected, use Play to preview.
      </p>
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
          Connected commits ({toolNode.connectedCommitIds.length})
        </p>
        {toolNode.connectedCommitIds.map((id) => (
          <div key={id} style={{ fontSize: 10, color: "#a1a1aa", fontFamily: "monospace", padding: "2px 0" }}>
            {id.slice(0, 7)}
          </div>
        ))}
      </div>
    </div>
  );
}

function btnStyle(bg: string, color: string, borderColor?: string): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 6,
    background: bg, color, border: borderColor ? `1px solid ${borderColor}` : "none",
    borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600,
    width: "100%", boxSizing: "border-box",
  };
}