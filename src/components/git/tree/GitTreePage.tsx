// src/components/git/tree/GitTreePage.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Loader2, Check, X as XIcon } from "lucide-react";
import type { Project } from "@/lib/tauri";
import { vcs } from "@/lib/tauri";
import type { CommitEntry, BranchInfo, GitStatus } from "@/types/vcs";
import { useVcsStore } from "@/store/vcsStore";

import { Toolbar } from "./Toolbar";
import { CommitNode } from "./CommitNode";
import { ToolNode } from "./ToolNode";
import { SimulationNode } from "./SimulationNode";
import { NodeEdge } from "./NodeEdge";
import { PropertiesPanel } from "./PropertiesPanel";

import { useTreeState } from "./useTreeState";
import type { ToolNodeInstance, SimulationCommit, EdgeDef, PropsPanelTarget } from "./types";
import { TOOL_SOURCE_COUNT, TOOL_ICONS } from "./constants"; // ← Añadido TOOL_ICONS
import {
    buildCommitLane, buildNodePositions, shortSha, fmtShort,
} from "./utils";
import { NODE_W, NODE_H, TOOL_NODE_W, TOOL_NODE_H, GAP_Y, SIMULATION_BUILD_DELAY_MS } from "./constants";

export function GitTreePage({ project }: { project: Project }) {
    const { branchColors } = useVcsStore();

    // ── Remote data ──────────────────────────────────────────────────────────
    const [commits, setCommits] = useState<CommitEntry[]>([]);
    const [branches, setBranches] = useState<BranchInfo[]>([]);
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [log, branchList, gitStatus] = await Promise.all([
                vcs.getLog(project.path, 500),
                vcs.listBranches(project.path),
                vcs.getStatus(project.path),
            ]);
            setCommits(log);
            setBranches(branchList);
            setStatus(gitStatus);
        } catch (e: any) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [project.path]);

    useEffect(() => { refresh(); }, [refresh]);

    // ── Canvas state ─────────────────────────────────────────────────────────
    const state = useTreeState();
    const canvasRef = useRef<HTMLDivElement>(null);

    // ── Trash zone state ─────────────────────────────────────────────────────────
    const trashRef = useRef<HTMLDivElement>(null);
    const [isDraggingToolNode, setIsDraggingToolNode] = useState(false);
    const [trashHover, setTrashHover] = useState(false);
    // Ref para saber si el drag actual es de un tool node (para mostrar papelera)
    const draggingToolNodeId = useRef<string | null>(null);

    // ── Layout: commit lanes + positions ────────────────────────────────────
    const commitLane = useMemo(
        () => buildCommitLane(commits, branches),
        [commits, branches]
    );

    const nodePositions = useMemo(
        () => buildNodePositions(
            commits, branches, commitLane,
            branchColors, status?.branch ?? "",
            state.nodeDeltaMap,
            state.layoutMode
        ),
        [commits, branches, commitLane, branchColors, status, state.nodeDeltaMap, state.layoutMode]
    );

    // ── Edges between commit nodes ────────────────────────────────────────────
    const commitEdges = useMemo<EdgeDef[]>(() => {
        const edges: EdgeDef[] = [];
        commits.forEach((c) => {
            const fromPos = nodePositions[c.id];
            if (!fromPos) return;
            c.parent_ids?.forEach((parentId) => {
                const toPos = nodePositions[parentId];
                if (!toPos) return;
                edges.push({
                    fromId: c.id,
                    toId: parentId,
                    color: fromPos.color,
                    isToolEdge: false,
                });
            });
        });
        return edges;
    }, [commits, nodePositions]);

    // Edges entre tool nodes y sus commits conectados (blancas)
    const toolEdges = useMemo<EdgeDef[]>(() => {
        const edges: EdgeDef[] = [];
        state.toolNodes.forEach((tn) => {
            tn.connectedCommitIds.forEach((cid) => {
                edges.push({
                    fromId: tn.id,
                    toId: cid,
                    color: "#ffffff",
                    isToolEdge: true,
                });
            });
        });
        return edges;
    }, [state.toolNodes]);

    // Sim edges: desde el tool node que las generó hasta los sim commits
    const simEdges = useMemo<EdgeDef[]>(() => {
        return state.simCommits.map((sc) => ({
            fromId: sc.toolNodeId,
            toId: sc.id,
            color: sc.color,
            isToolEdge: false,
            dashed: true,
        }));
    }, [state.simCommits]);

    // ── Global mouse handlers (window) for drag ──────────────────────────────
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            state.moveNodeDrag(e);
            state.moveToolbarDrag(e);
            // ── Wire drag ──
            if (state.wireState && canvasRef.current) {
                const rect = canvasRef.current.getBoundingClientRect();
                const canvasX = (e.clientX - rect.left - state.offset.x) / state.zoom;
                const canvasY = (e.clientY - rect.top - state.offset.y) / state.zoom;
                state.moveWire(canvasX, canvasY);
            }
        };
        const onUp = (e: MouseEvent) => {
            state.stopNodeDrag();
            if (state.dragTool && canvasRef.current) {
                state.dropToolOnCanvas(canvasRef.current.getBoundingClientRect(), state.addToolNode);
            }
            state.stopPan(e.button);
            // ── Wire drop: si soltamos cerca de un commit, conectar ──
            if (state.wireState && canvasRef.current) {
                const rect = canvasRef.current.getBoundingClientRect();
                const dropX = (e.clientX - rect.left - state.offset.x) / state.zoom;
                const dropY = (e.clientY - rect.top - state.offset.y) / state.zoom;
                // Buscar el commit más cercano al punto de drop (dentro de NODE_W x NODE_H)
                const hit = Object.entries(nodePositions).find(([, pos]) =>
                    dropX >= pos.x && dropX <= pos.x + NODE_W &&
                    dropY >= pos.y && dropY <= pos.y + NODE_H
                );
                if (hit) {
                    state.connectCommitToTool(state.wireState.toolNodeId, hit[0]);
                }
                state.endWire();
            }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [state, nodePositions]);   // ← añadir nodePositions a deps

    // ── anyToolReady: al menos 1 tool node tiene suficientes commits conectados ──
    const anyToolReady = state.toolNodes.some((tn) => {
        const needed = TOOL_SOURCE_COUNT[tn.tool] ?? 1;
        return tn.connectedCommitIds.length >= needed;
    });

    // ── Simulation ───────────────────────────────────────────────────────────
    const handlePlay = useCallback(() => {
        const simBatch: SimulationCommit[] = [];
        state.toolNodes.forEach((tn) => {
            const needed = TOOL_SOURCE_COUNT[tn.tool] ?? 1;
            if (tn.connectedCommitIds.length < needed) return;

            const firstSrcPos = nodePositions[tn.connectedCommitIds[0]];
            if (!firstSrcPos) return;

            const simX = firstSrcPos.x + NODE_W + 60;
            const simY = firstSrcPos.y;
            const msg = tn.props["commit_name"] || tn.props["branch_name"] || `${tn.tool} result`;

            simBatch.push({
                id: `sim-${tn.id}`,
                message: msg,
                x: simX,
                y: simY,
                color: firstSrcPos.color,
                toolNodeId: tn.id,
                sourceCommitId: tn.connectedCommitIds[0], // nuevo campo
            });
        });

        state.startSimulationWith(simBatch, () => { });
    }, [state, nodePositions]);

    // ── Confirm: ejecutar la operación real ──────────────────────────────────
    const handleConfirm = useCallback(async () => {
        const readyNodes = state.toolNodes.filter((tn) => {
            const needed = TOOL_SOURCE_COUNT[tn.tool] ?? 1;
            return tn.connectedCommitIds.length >= needed;
        });

        state.setApplying(true);
        try {
            for (const tn of readyNodes) {
                await executeTool(tn, project.path, branches, state.setOpMsg);
                state.removeToolNode(tn.id);
            }
            state.stopSimulation();
            await refresh();
            state.setOpMsg({ ok: true, text: "Operation completed" });
        } catch (e: any) {
            state.setOpMsg({ ok: false, text: String(e) });
        } finally {
            state.setApplying(false);
        }
    }, [state, project.path, branches, refresh]);

    // ── Handle commit node click ─────────────────────────────────────────────
    const handleCommitClick = useCallback((commitId: string) => {
        if (state.navTool === "pan") return;

        if (state.selectedToolNodeId) {
            state.connectCommitToTool(state.selectedToolNodeId, commitId);
            return;
        }

        const pos = nodePositions[commitId];
        const commit = commits.find((c) => c.id === commitId);
        state.selectCommit(commitId);
        state.openCommitProps({
            kind: "commit",
            commitId,
            commit,
            color: pos?.color ?? "#a78bfa",
            branchNames: pos?.branchNames ?? [],
            files: [],
            filesLoading: !!commit,
        });

        if (commit) {
            // Guardar una referencia al target actual para actualizarlo después
            const currentTarget = state.propsTarget; // en este momento es el que acabamos de abrir
            vcs.getCommitDiff(project.path, commitId)
                .then((files) => {
                    // Verificar que el panel sigue mostrando el mismo commit
                    if (
                        currentTarget &&
                        currentTarget.kind === "commit" &&
                        currentTarget.commitId === commitId
                    ) {
                        state.openCommitProps({
                            ...currentTarget,
                            files,
                            filesLoading: false,
                        });
                    }
                })
                .catch(() => {
                    if (
                        currentTarget &&
                        currentTarget.kind === "commit" &&
                        currentTarget.commitId === commitId
                    ) {
                        state.openCommitProps({
                            ...currentTarget,
                            filesLoading: false,
                        });
                    }
                });
        }
    }, [state, nodePositions, commits, project.path]);

    // ── Quick actions from PropertiesPanel ───────────────────────────────────
    const handleQuickAction = useCallback((
        action: "branch" | "cherry-pick",
        commitId: string,
    ) => {
        const pos = nodePositions[commitId];
        const x = pos ? pos.x + NODE_W + 40 : 200;
        const y = pos ? pos.y : 200;
        const newTool: ToolNodeInstance = {
            id: `tool-${action}-${Date.now()}`,
            tool: action,
            x, y,
            connectedCommitIds: [commitId],
            props: {},
        };
        state.addToolNode(newTool);
        state.selectToolNode(newTool.id);
        state.closeProps();
    }, [state, nodePositions]);

    // ── Canvas mouse handlers ────────────────────────────────────────────────
    const handleCanvasMouseDown = (e: React.MouseEvent) => {
        if (e.button === 1) { state.startMmPan(e); e.preventDefault(); return; }
        if (e.button === 0 && state.navTool === "pan") { state.startPan(e); }
        else { state.clearSelection(); state.closeProps(); }
    };

    // ── Rendering ────────────────────────────────────────────────────────────
    if (loading) return (
        <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
    );
    if (error) return (
        <div className="flex flex-1 items-center justify-center text-red-400 text-sm">{error}</div>
    );

    return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <Toolbar
                navTool={state.navTool}
                onNavTool={state.setNavTool}
                onStartToolDrag={state.startToolbarDrag}
                anyToolReady={anyToolReady}
                simPhase={state.simPhase}
                applying={state.applying}
                onPlay={handlePlay}
                onStop={state.stopSimulation}
                onConfirm={handleConfirm}
                zoom={state.zoom}
                onZoomIn={state.zoomIn}
                onZoomOut={state.zoomOut}
                onResetView={state.resetView}
                onCancelAll={() => { state.toolNodes.forEach((t) => state.removeToolNode(t.id)); state.stopSimulation(); }}
                layoutMode={state.layoutMode}
                onLayoutChange={state.setLayoutMode}
            />

            {state.opMsg && (
                <div className={`px-4 py-1.5 text-xs flex items-center gap-2 border-b border-zinc-800 shrink-0 ${state.opMsg.ok ? "text-emerald-300 bg-emerald-950/30" : "text-red-300 bg-red-950/30"}`}>
                    {state.opMsg.ok ? <Check className="h-3 w-3" /> : <XIcon className="h-3 w-3" />}
                    {state.opMsg.text}
                    <button onClick={() => state.setOpMsg(null)} className="ml-auto text-zinc-600 hover:text-zinc-400">
                        <XIcon className="h-3 w-3" />
                    </button>
                </div>
            )}

            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div
                    ref={canvasRef}
                    className="flex-1 overflow-hidden relative select-none"
                    style={{
                        background: "#09090b",
                        cursor: state.mmPanCursor ? "grabbing" : state.navTool === "pan" ? "grab" : "default",
                    }}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={state.movePan}
                    onMouseUp={(e) => state.stopPan(e.button)}
                    onWheel={state.handleWheel}
                >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                        <defs>
                            <pattern
                                id="dotgrid"
                                x={state.offset.x % 24} y={state.offset.y % 24}
                                width="24" height="24"
                                patternUnits="userSpaceOnUse"
                            >
                                <circle cx="12" cy="12" r="0.8" fill="#27272a" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#dotgrid)" />
                    </svg>

                    <div style={{
                        transform: `translate(${state.offset.x}px, ${state.offset.y}px) scale(${state.zoom})`,
                        transformOrigin: "0 0",
                        position: "absolute",
                        top: 0, left: 0,
                    }}>
                        <svg style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }} width="1" height="1">
                            {commitEdges.map((e) => {
                                const fp = nodePositions[e.fromId];
                                const tp = nodePositions[e.toId];
                                if (!fp || !tp) return null;
                                return (
                                    <NodeEdge
                                        key={`${e.fromId}-${e.toId}`}
                                        edge={e}
                                        fromPos={fp}
                                        toPos={tp}
                                    />
                                );
                            })}

                            {/* Wire en curso (drag desde port de ToolNode) */}
                            {state.wireState && (() => {
                                const tn = state.toolNodes.find((t) => t.id === state.wireState!.toolNodeId);
                                if (!tn) return null;
                                // El fromX/fromY son coordenadas de canvas (no viewport)
                                const { fromX, fromY, toX, toY } = state.wireState;
                                const cx1 = fromX + (toX - fromX) * 0.5;
                                const cy1 = fromY;
                                const cx2 = fromX + (toX - fromX) * 0.5;
                                const cy2 = toY;
                                return (
                                    <path
                                        d={`M ${fromX} ${fromY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${toX} ${toY}`}
                                        stroke="#a78bfa"
                                        strokeWidth={1.5}
                                        strokeDasharray="5 3"
                                        fill="none"
                                        opacity={0.7}
                                        style={{ pointerEvents: "none" }}
                                    />
                                );
                            })()}

                            {toolEdges.map((e) => {
                                const tn = state.toolNodes.find((t) => t.id === e.fromId);
                                const cp = nodePositions[e.toId];
                                if (!tn || !cp) return null;
                                return (
                                    <NodeEdge
                                        key={`${e.fromId}-${e.toId}`}
                                        edge={e}
                                        fromPos={{ x: tn.x, y: tn.y, w: TOOL_NODE_W, h: TOOL_NODE_H }}
                                        toPos={cp}
                                    />
                                );
                            })}

                            {simEdges.map((e) => {
                                const tn = state.toolNodes.find((t) => t.id === e.fromId);
                                const sc = state.simCommits.find((s) => s.id === e.toId);
                                if (!tn || !sc) return null;
                                return (
                                    <NodeEdge
                                        key={`sim-${e.fromId}-${e.toId}`}
                                        edge={e}
                                        fromPos={{ x: tn.x, y: tn.y, w: TOOL_NODE_W, h: TOOL_NODE_H }}
                                        toPos={{ x: sc.x, y: sc.y }}
                                    />
                                );
                            })}
                            {/* Aristas desde commit fuente hasta SimulationNode (línea horizontal punteada) */}
                            {state.simCommits.map((sc) => {
                                if (!sc.sourceCommitId) return null;
                                const srcPos = nodePositions[sc.sourceCommitId];
                                if (!srcPos) return null;
                                const fromX = srcPos.x + NODE_W;
                                const fromY = srcPos.y + NODE_H / 2;
                                const toX = sc.x;
                                const toY = sc.y + NODE_H / 2;
                                return (
                                    <line
                                        key={`src-sim-${sc.id}`}
                                        x1={fromX} y1={fromY}
                                        x2={toX} y2={toY}
                                        stroke={sc.color}
                                        strokeWidth={1.5}
                                        strokeDasharray="6 3"
                                        opacity={0.5}
                                        style={{ pointerEvents: "none" }}
                                    />
                                );
                            })}
                        </svg>

                        {commits.map((c) => {
                            const pos = nodePositions[c.id];
                            if (!pos) return null;
                            const isSource = state.toolNodes.some((tn) => tn.connectedCommitIds.includes(c.id));
                            return (
                                <CommitNode
                                    key={c.id}
                                    commit={c}
                                    x={pos.x} y={pos.y}
                                    color={pos.color}
                                    isHead={pos.isHead}
                                    branchNames={pos.branchNames}
                                    selected={state.selectedCommitId === c.id}
                                    isToolSource={isSource}
                                    isCurrentBranch={pos.isCurrentBranch}   // ← nuevo
                                    onPointerDown={(e) => {
                                        if (e.button !== 0 || state.navTool === "pan") return;
                                        e.stopPropagation();
                                        const delta = state.nodeDeltaMap[c.id] ?? { dx: 0, dy: 0 };
                                        state.startNodeDrag(c.id, e as unknown as React.MouseEvent, delta);
                                    }}
                                    onClick={(e) => { e.stopPropagation(); handleCommitClick(c.id); }}
                                />
                            );
                        })}

                        {state.toolNodes.map((tn) => (
                            <ToolNode
                                key={tn.id}
                                node={tn}
                                selected={state.selectedToolNodeId === tn.id}
                                onPointerDown={(e) => {
                                    if (e.button !== 0) return;
                                    e.stopPropagation();
                                    const startX = e.clientX;
                                    const startY = e.clientY;
                                    const origX = tn.x;
                                    const origY = tn.y;
                                    draggingToolNodeId.current = tn.id;
                                    setIsDraggingToolNode(true);

                                    // Registrar que estamos arrastrando este tool node (para mostrar papelera)

                                    const onMove = (ev: MouseEvent) => {
                                        state.updateToolNode(tn.id, {
                                            x: origX + (ev.clientX - startX) / state.zoom,
                                            y: origY + (ev.clientY - startY) / state.zoom,
                                        });
                                        // Detectar hover sobre la papelera
                                        if (trashRef.current) {
                                            const tr = trashRef.current.getBoundingClientRect();
                                            const over =
                                                ev.clientX >= tr.left && ev.clientX <= tr.right &&
                                                ev.clientY >= tr.top && ev.clientY <= tr.bottom;
                                            setTrashHover(over);
                                        }
                                    };

                                    const onUp = (ev: MouseEvent) => {
                                        draggingToolNodeId.current = null;
                                        setIsDraggingToolNode(false);
                                        setTrashHover(false);

                                        window.removeEventListener("mousemove", onMove);
                                        window.removeEventListener("mouseup", onUp);

                                        // Soltar sobre la papelera → eliminar
                                        if (trashRef.current) {
                                            const tr = trashRef.current.getBoundingClientRect();
                                            const over =
                                                ev.clientX >= tr.left && ev.clientX <= tr.right &&
                                                ev.clientY >= tr.top && ev.clientY <= tr.bottom;
                                            if (over) {
                                                state.removeToolNode(tn.id);
                                            }
                                        }

                                        draggingToolNodeId.current = null;
                                        setTrashHover(false);
                                    };

                                    window.addEventListener("mousemove", onMove);
                                    window.addEventListener("mouseup", onUp);
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    state.selectToolNode(tn.id);
                                    state.openCommitProps({ kind: "tool", toolNodeId: tn.id });
                                }}
                                onPropsChange={(key, value) => state.updateToolNode(tn.id, { props: { ...tn.props, [key]: value } })}
                                onWireStart={(e, toolNodeId) => {
                                    // Calcular posición del puerto en coordenadas de canvas
                                    const rect = canvasRef.current?.getBoundingClientRect();
                                    if (!rect) return;
                                    const tnData = state.toolNodes.find((t) => t.id === toolNodeId);
                                    if (!tnData) return;
                                    // El puerto está en el borde derecho, mitad de la altura del header+body
                                    const portCanvasX = tnData.x + TOOL_NODE_W;
                                    const portCanvasY = tnData.y + TOOL_NODE_H / 2;
                                    state.startWire(toolNodeId, portCanvasX, portCanvasY);
                                    e.stopPropagation();
                                }}
                            />
                        ))}

                        {state.simCommits.map((sc) => (
                            <SimulationNode key={sc.id} sim={sc} />
                        ))}
                    </div>

                    {/* ── Trash zone: visible solo cuando se arrastra un tool node ── */}
                    {isDraggingToolNode && (
                        <div
                            ref={trashRef}
                            style={{
                                position: "absolute",
                                bottom: 24,
                                right: 24,
                                width: 64,
                                height: 64,
                                borderRadius: 14,
                                border: `2px solid ${trashHover ? "#ef4444" : "#3f3f46"}`,
                                background: trashHover ? "rgba(239,68,68,0.12)" : "rgba(24,24,27,0.85)",
                                backdropFilter: "blur(8px)",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                                zIndex: 200,
                                transition: "border-color 0.15s, background 0.15s, transform 0.15s",
                                transform: trashHover ? "scale(1.12)" : "scale(1)",
                                cursor: "default",
                                pointerEvents: "none",   // la detección de hover es manual via getBoundingClientRect
                            }}
                        >
                            {/* Tapa de la papelera — se "abre" (rota) cuando trashHover */}
                            <svg
                                width="28"
                                height="28"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={trashHover ? "#ef4444" : "#52525b"}
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ transition: "stroke 0.15s" }}
                            >
                                {/* Tapa */}
                                <g
                                    style={{
                                        transformOrigin: "6px 3px",
                                        transform: trashHover ? "rotate(-30deg)" : "rotate(0deg)",
                                        transition: "transform 0.2s ease",
                                    }}
                                >
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4h8v2" />
                                </g>
                                {/* Cuerpo */}
                                <path d="M19 6l-1 14H6L5 6" />
                                {/* Líneas internas */}
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                            <span
                                style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    color: trashHover ? "#ef4444" : "#52525b",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    transition: "color 0.15s",
                                }}
                            >
                                Eliminar
                            </span>
                        </div>
                    )}

                    {state.dragTool && (
                        <div
                            style={{
                                position: "fixed",
                                left: state.dragTool.ghostX - TOOL_NODE_W / 2,
                                top: state.dragTool.ghostY - TOOL_NODE_H / 2,
                                width: TOOL_NODE_W,
                                height: TOOL_NODE_H,
                                background: "#1a1a1f",
                                border: "1.5px dashed #52525b",
                                borderRadius: 8,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                                pointerEvents: "none",
                                zIndex: 9999,
                                opacity: 0.85,
                            }}
                        >
                            {(() => { const Icon = TOOL_ICONS[state.dragTool.tool]; return Icon ? <Icon style={{ width: 16, height: 16, color: "#71717a" }} /> : null; })()}
                            <span style={{ fontSize: 10, color: "#71717a", fontWeight: 700, textTransform: "uppercase" }}>
                                {state.dragTool.tool}
                            </span>
                        </div>
                    )}
                </div>

                {state.propsTarget && (
                    <PropertiesPanel
                        target={state.propsTarget}
                        toolNodes={state.toolNodes}
                        onClose={state.closeProps}
                        onQuickAction={handleQuickAction}
                    />
                )}
            </div>
        </div>
    );
}

// ── Ejecutar operación real en Tauri ─────────────────────────────────────────
async function executeTool(
    tn: ToolNodeInstance,
    projectPath: string,
    branches: BranchInfo[],
    setMsg: (m: { ok: boolean; text: string }) => void,
) {
    const [rawId] = tn.connectedCommitIds;
    const id = rawId;

    switch (tn.tool) {
        case "merge": {
            // Intentar con nombre de branch si el commit conectado es un tip conocido.
            // Si no, mergear directamente por SHA (más robusto).
            const commitSha = tn.connectedCommitIds[0];
            const targetBranch = branches.find(
                (b) => b.tip_sha === tn.connectedCommitIds[0] || b.tip_sha === tn.connectedCommitIds[1]
            )?.name;
            if (targetBranch) {
                await vcs.mergeBranch(projectPath, targetBranch);
            } else {
                // Fallback: merge por SHA directamente
                await vcs.mergeBySha(projectPath, commitSha);
            }
            break;
        }
        case "branch": {
            const branchName = tn.props["branch_name"]?.trim() || `branch-from-${id.slice(0, 7)}`;
            await vcs.createBranchWithInit(projectPath, branchName, id);
            break;
        }
        case "cherry-pick":
            // vcs.cherryPick no existe en el código actual — añadir en Rust cuando se implemente
            break;
        default:
            setMsg({ ok: true, text: `${tn.tool} applied (stub)` });
    }
}