// src/components/git/tree/useTreeState.ts
import { useState, useRef, useCallback } from "react";
import type { Tool, ToolNodeInstance, SimulationCommit, SimulationPhase, PropsPanelTarget } from "./types";
import { DRAGGABLE_TOOLS } from "./types";

export type TreeCanvasState = ReturnType<typeof useTreeState>;

export function useTreeState() {
    // ── Pan / Zoom ──────────────────────────────────────────────────────────
    const [offset, setOffset] = useState({ x: 80, y: 220 });
    const [zoom, setZoom] = useState(1);
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
    const isMmPanning = useRef(false);
    const mmStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
    const [mmPanCursor, setMmPanCursor] = useState(false);

    const startPan = useCallback((e: React.MouseEvent) => {
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }, [offset]);

    const startMmPan = useCallback((e: React.MouseEvent) => {
        isMmPanning.current = true;
        setMmPanCursor(true);
        mmStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }, [offset]);

    const movePan = useCallback((e: React.MouseEvent) => {
        if (isMmPanning.current) {
            setOffset({
                x: mmStart.current.ox + (e.clientX - mmStart.current.x),
                y: mmStart.current.oy + (e.clientY - mmStart.current.y),
            });
            return;
        }
        if (!isPanning.current) return;
        setOffset({
            x: panStart.current.ox + (e.clientX - panStart.current.x),
            y: panStart.current.oy + (e.clientY - panStart.current.y),
        });
    }, []);

    const stopPan = useCallback((button: number) => {
        if (button === 1) { isMmPanning.current = false; setMmPanCursor(false); }
        isPanning.current = false;
    }, []);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        setZoom((z) => Math.max(0.3, Math.min(2.5, z - e.deltaY * 0.001)));
    }, []);

    const resetView = useCallback(() => {
        setZoom(1);
        setOffset({ x: 80, y: 220 });
    }, []);

    // ── Node drag deltas (commit nodes repositioned by user) ─────────────────
    const [nodeDeltaMap, setNodeDeltaMap] = useState<Record<string, { dx: number; dy: number }>>({});
    const nodeDragRef = useRef<{ id: string; sx: number; sy: number; odx: number; ody: number } | null>(null);

    const startNodeDrag = useCallback((id: string, e: React.MouseEvent, origDelta: { dx: number; dy: number }) => {
        nodeDragRef.current = { id, sx: e.clientX, sy: e.clientY, odx: origDelta.dx, ody: origDelta.dy };
    }, []);

    const moveNodeDrag = useCallback((e: MouseEvent) => {
        if (!nodeDragRef.current) return;
        const { id, sx, sy, odx, ody } = nodeDragRef.current;
        setNodeDeltaMap((prev) => ({
            ...prev,
            [id]: { dx: odx + (e.clientX - sx) / zoom, dy: ody + (e.clientY - sy) / zoom },
        }));
    }, [zoom]);

    const stopNodeDrag = useCallback(() => { nodeDragRef.current = null; }, []);

    // ── Toolbar drag-to-canvas ───────────────────────────────────────────────
    // El usuario arrastra un ícono de la toolbar al canvas. Mientras arrastra,
    // se muestra un "fantasma" del futuro ToolNode siguiendo el cursor.
    const [dragTool, setDragTool] = useState<{
        tool: Tool;
        ghostX: number; // viewport coords
        ghostY: number;
    } | null>(null);

    const startToolbarDrag = useCallback((tool: Tool, e: React.MouseEvent) => {
        e.preventDefault();
        setDragTool({ tool, ghostX: e.clientX, ghostY: e.clientY });
    }, []);

    const moveToolbarDrag = useCallback((e: MouseEvent) => {
        if (!dragTool) return;
        setDragTool((prev) => prev ? { ...prev, ghostX: e.clientX, ghostY: e.clientY } : null);
    }, [dragTool]);

    // Al soltar en el canvas: convertir coordenadas viewport → canvas y crear ToolNodeInstance
    const dropToolOnCanvas = useCallback((
        canvasRect: DOMRect,
        onDrop: (inst: ToolNodeInstance) => void
    ) => {
        if (!dragTool) return;
        const canvasX = (dragTool.ghostX - canvasRect.left - offset.x) / zoom;
        const canvasY = (dragTool.ghostY - canvasRect.top - offset.y) / zoom;
        const inst: ToolNodeInstance = {
            id: `tool-${dragTool.tool}-${Date.now()}`,
            tool: dragTool.tool,
            x: canvasX,
            y: canvasY,
            connectedCommitIds: [],
            props: {},
        };
        onDrop(inst);
        setDragTool(null);
    }, [dragTool, offset, zoom]);

    const cancelToolbarDrag = useCallback(() => setDragTool(null), []);

    // ── Tool node instances on canvas ────────────────────────────────────────
    const [toolNodes, setToolNodes] = useState<ToolNodeInstance[]>([]);

    const addToolNode = useCallback((inst: ToolNodeInstance) => {
        setToolNodes((prev) => [...prev, inst]);
    }, []);

    const updateToolNode = useCallback((id: string, patch: Partial<ToolNodeInstance>) => {
        setToolNodes((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
    }, []);

    const removeToolNode = useCallback((id: string) => {
        setToolNodes((prev) => prev.filter((t) => t.id !== id));
    }, []);

    // Cuando un commit node se suelta encima de un tool node, se conecta
    const connectCommitToTool = useCallback((toolId: string, commitId: string) => {
        setToolNodes((prev) => prev.map((t) => {
            if (t.id !== toolId) return t;
            const already = t.connectedCommitIds.includes(commitId);
            if (already) return { ...t, connectedCommitIds: t.connectedCommitIds.filter((id) => id !== commitId) };
            return { ...t, connectedCommitIds: [...t.connectedCommitIds, commitId] };
        }));
    }, []);

    // ── Selection ────────────────────────────────────────────────────────────
    const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
    const [selectedToolNodeId, setSelectedToolNodeId] = useState<string | null>(null);

    const selectCommit = useCallback((id: string | null) => {
        setSelectedCommitId(id);
        setSelectedToolNodeId(null);
    }, []);

    const selectToolNode = useCallback((id: string | null) => {
        setSelectedToolNodeId(id);
        setSelectedCommitId(null);
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedCommitId(null);
        setSelectedToolNodeId(null);
    }, []);

    // ── Active nav tool (select vs pan) ─────────────────────────────────────
    const [navTool, setNavTool] = useState<"select" | "pan">("select");

    // ── Properties panel ────────────────────────────────────────────────────
    const [propsTarget, setPropsTarget] = useState<PropsPanelTarget | null>(null);

    const openCommitProps = useCallback((target: PropsPanelTarget) => setPropsTarget(target), []);
    const closeProps = useCallback(() => setPropsTarget(null), []);

    const zoomIn = useCallback(() => setZoom((z) => Math.min(2.5, z + 0.1)), []);
    const zoomOut = useCallback(() => setZoom((z) => Math.max(0.3, z - 0.1)), []);

    // ── Simulation ───────────────────────────────────────────────────────────
    const [simPhase, setSimPhase] = useState<SimulationPhase>("idle");
    const [simCommits, setSimCommits] = useState<SimulationCommit[]>([]);
    const simAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [layoutMode, setLayoutMode] = useState<import("./types").LayoutMode>("vertical-tree");

    const stopSimulation = useCallback(() => {
        if (simAnimRef.current) clearTimeout(simAnimRef.current);
        setSimPhase("idle");
        setSimCommits([]);
    }, []);

    // La lógica de construcción de simCommits vive en GitTreePage donde se
    // conocen nodePositions. El hook expone solo la interfaz de control.
    const startSimulationWith = useCallback((commits: SimulationCommit[], onDone: () => void) => {
        setSimCommits([]);
        setSimPhase("running");
        let i = 0;
        function scheduleNext() {
            if (i >= commits.length) { setSimPhase("paused"); onDone(); return; }
            const batch = commits[i++];
            setSimCommits((prev) => [...prev, batch]);
            simAnimRef.current = setTimeout(scheduleNext, 420);
        }
        scheduleNext();
    }, []);

    // ── Op feedback ─────────────────────────────────────────────────────────
    const [opMsg, setOpMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [applying, setApplying] = useState(false);

    // ── Wire drag (port → commit) ────────────────────────────────────────────────
    const [wireState, setWireState] = useState<import("./types").WireState>(null);

    const startWire = useCallback((toolNodeId: string, fromX: number, fromY: number) => {
        setWireState({ toolNodeId, fromX, fromY, toX: fromX, toY: fromY });
    }, []);

    const moveWire = useCallback((toX: number, toY: number) => {
        setWireState((prev) => prev ? { ...prev, toX, toY } : null);
    }, []);

    const endWire = useCallback(() => {
        setWireState(null);
    }, []);

    return {
        // pan/zoom
        offset, zoom, mmPanCursor, setZoom, zoomIn, zoomOut,
        startPan, startMmPan, movePan, stopPan, handleWheel, resetView,
        // node drag
        nodeDeltaMap, setNodeDeltaMap,
        nodeDragRef, startNodeDrag, moveNodeDrag, stopNodeDrag,
        // toolbar drag
        dragTool, startToolbarDrag, moveToolbarDrag, dropToolOnCanvas, cancelToolbarDrag,
        // tool nodes
        toolNodes, addToolNode, updateToolNode, removeToolNode, connectCommitToTool,
        // selection
        selectedCommitId, selectedToolNodeId,
        selectCommit, selectToolNode, clearSelection, navTool, setNavTool,
        // props
        propsTarget, openCommitProps, closeProps,
        // simulation
        simPhase, simCommits, startSimulationWith, stopSimulation,
        // op feedback
        opMsg, setOpMsg, applying, setApplying,

        layoutMode, setLayoutMode,
        
        wireState, startWire, moveWire, endWire,
    };
}
