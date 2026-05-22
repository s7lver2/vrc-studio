// src/components/sandbox/MaterialNodeEditor.tsx
import { useRef, useState, useCallback, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useMaterialEditorStore } from "@/store/materialEditorStore";
import type { VrcSmatNode, VrcSmatNodeType } from "@/types/vrcsmat";
import { SpherePreview } from "./SpherePreview";

// ── Constantes de layout de nodos ────────────────────────────────────────────
const NODE_W = 160;
const PIN_COLORS: Record<string, string> = {
  color:   "#a78bfa",
  texture: "#34d399",
  value:   "#fbbf24",
  normal:  "#60a5fa",
};
function pinColor(type: string) { return PIN_COLORS[type] ?? "#6b7280"; }

interface PinRef { nodeId: string; pinName: string; side: "out" | "in"; }

// ── NodeCard (sin cambios internos relevantes) ─────────────────────────────
function NodeCard({
  node, onDrag, onPinClick, selectedNodeId, onSelect, onRemove, pendingPin,
}: {
  node: VrcSmatNode;
  onDrag: (id: string, dx: number, dy: number) => void;
  onPinClick: (ref: PinRef, el: HTMLElement) => void;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  pendingPin: PinRef | null;
}) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  // Keep a ref to onDrag so the window mousemove listener always calls the latest version
  const onDragRef = useRef(onDrag);
  useEffect(() => { onDragRef.current = onDrag; });

  const isSelected = selectedNodeId === node.id;
  const isOutput = node.type === "output";

  const INPUTS: Record<VrcSmatNodeType, string[]> = {
    output:     ["albedo", "roughness", "metalness", "normal", "emission", "opacity"],
    color:      [],
    texture:    [],
    roughness:  [],
    metalness:  [],
    normal_map: [],
    emission:   [],
    opacity:    [],
    mix:        ["a", "b", "factor"],
  };
  const OUTPUTS: Record<VrcSmatNodeType, string[]> = {
    output:     [],
    color:      ["color"],
    texture:    ["texture", "alpha"],
    roughness:  ["value"],
    metalness:  ["value"],
    normal_map: ["normal"],
    emission:   ["color"],
    opacity:    ["value"],
    mix:        ["result"],
  };

  const inputs = INPUTS[node.type] ?? [];
  const outputs = OUTPUTS[node.type] ?? [];

  return (
    <div
      className={`absolute select-none rounded-xl border shadow-xl overflow-hidden ${isSelected ? "border-zinc-500" : "border-zinc-800"}`}
      style={{ left: node.pos.x, top: node.pos.y, width: NODE_W, background: "#18181b", cursor: "grab", zIndex: isSelected ? 10 : 1 }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).dataset.pin) return;
        e.preventDefault();
        e.stopPropagation(); // prevent canvas from receiving this event and calling selectNode(null)
        dragStart.current = { x: e.clientX, y: e.clientY };
        onSelect(node.id);
        const move = (me: MouseEvent) => {
          if (!dragStart.current) return;
          onDragRef.current(node.id, me.clientX - dragStart.current.x, me.clientY - dragStart.current.y);
          dragStart.current = { x: me.clientX, y: me.clientY };
        };
        const up = () => {
          dragStart.current = null;
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">
          {node.type.replace("_", " ")}
        </span>
        {!isOutput && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onRemove(node.id)}
            className="text-zinc-700 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="px-2.5 py-2">
        {node.type === "color" && (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={(node.data.hex as string) ?? "#888888"}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={() => {}}
              className="w-6 h-6 rounded border-0 cursor-pointer bg-transparent"
            />
            <span className="text-[10px] text-zinc-500">{(node.data.hex as string) ?? "#888888"}</span>
          </div>
        )}
        {(node.type === "roughness" || node.type === "metalness" || node.type === "opacity") && (
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={1} step={0.01}
              value={(node.data.value as number) ?? 0.5}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={() => {}}
              className="w-full h-1 accent-zinc-400"
            />
            <span className="text-[10px] text-zinc-500 w-7 text-right font-mono">
              {((node.data.value as number) ?? 0.5).toFixed(2)}
            </span>
          </div>
        )}
        {node.type === "texture" && (
          <p className="text-[10px] text-zinc-600 italic truncate">
            {(node.data.filename as string) || "No texture"}
          </p>
        )}
        {node.type === "output" && <p className="text-[10px] text-zinc-700">Material Output</p>}
      </div>
      <div className="flex justify-between pb-2 px-0">
        <div className="flex flex-col gap-1.5">
          {inputs.map((pin) => (
            <div key={pin} className="flex items-center gap-1">
              <button
                data-pin="in"
                style={{ background: pinColor(pin) }}
                className="w-2.5 h-2.5 rounded-full -ml-1.5 border-2 border-zinc-950 hover:scale-125 transition-transform"
                onMouseDown={(e) => { e.stopPropagation(); onPinClick({ nodeId: node.id, pinName: pin, side: "in" }, e.currentTarget as HTMLElement); }}
              />
              <span className="text-[9px] text-zinc-600">{pin}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          {outputs.map((pin) => (
            <div key={pin} className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-600">{pin}</span>
              <button
                data-pin="out"
                style={{ background: pinColor(pin) }}
                className="w-2.5 h-2.5 rounded-full -mr-1.5 border-2 border-zinc-950 hover:scale-125 transition-transform"
                onMouseDown={(e) => { e.stopPropagation(); onPinClick({ nodeId: node.id, pinName: pin, side: "out" }, e.currentTarget as HTMLElement); }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Panel de propiedades del nodo seleccionado ────────────────────────────
function NodePropertiesPanel({
  node,
  onChange,
}: {
  node: VrcSmatNode | null;
  onChange: (id: string, data: Record<string, unknown>) => void;
}) {
  if (!node) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[10px] text-zinc-700 italic">Select a node</p>
    </div>
  );

  const update = (key: string, val: unknown) => onChange(node.id, { ...node.data, [key]: val });

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Type</span>
        <p className="text-[11px] text-zinc-200 capitalize mt-0.5">{node.type.replace("_", " ")}</p>
      </div>
      {node.type === "color" && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={(node.data.hex as string) ?? "#ffffff"}
              onChange={(e) => update("hex", e.target.value)}
              className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
            />
            <span className="text-[10px] text-zinc-400 font-mono">{(node.data.hex as string) ?? "#ffffff"}</span>
          </div>
        </div>
      )}
      {(node.type === "roughness" || node.type === "metalness" || node.type === "opacity") && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Value</span>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={1} step={0.01}
              value={(node.data.value as number) ?? 0.5}
              onChange={(e) => update("value", parseFloat(e.target.value))}
              className="flex-1 h-1 accent-zinc-500"
            />
            <span className="text-[10px] text-zinc-400 font-mono w-8 text-right">
              {((node.data.value as number) ?? 0.5).toFixed(2)}
            </span>
          </div>
        </div>
      )}
      {node.type === "emission" && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Emission Color</span>
            <input
              type="color"
              value={(node.data.hex as string) ?? "#ffffff"}
              onChange={(e) => update("hex", e.target.value)}
              className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Intensity</span>
            <input
              type="range" min={0} max={5} step={0.1}
              value={(node.data.intensity as number) ?? 1}
              onChange={(e) => update("intensity", parseFloat(e.target.value))}
              className="w-full h-1 accent-zinc-500"
            />
          </div>
        </>
      )}
      {node.type === "mix" && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Factor</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={(node.data.factor as number) ?? 0.5}
            onChange={(e) => update("factor", parseFloat(e.target.value))}
            className="w-full h-1 accent-zinc-500"
          />
        </div>
      )}
      {(node.type === "texture" || node.type === "normal_map") && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Texture Path</span>
          <p className="text-[10px] text-zinc-500 italic">
            {(node.data.texturePath as string) ?? "No texture assigned"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────
const ADDABLE_NODES: { type: VrcSmatNodeType; label: string }[] = [
  { type: "color",      label: "Color" },
  { type: "texture",    label: "Texture" },
  { type: "roughness",  label: "Roughness" },
  { type: "metalness",  label: "Metalness" },
  { type: "normal_map", label: "Normal Map" },
  { type: "emission",   label: "Emission" },
  { type: "opacity",    label: "Opacity" },
  { type: "mix",        label: "Mix" },
];

export function MaterialNodeEditor() {
  const {
    nodes, connections, selectedNodeId,
    addNode, updateNode, removeNode,
    addConnection, removeConnection,
    selectNode,
  } = useMaterialEditorStore();

  const [canvasOffset, setCanvasOffset] = useState({ x: 40, y: 40 });
  const [pendingPin, setPendingPin] = useState<PinRef | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pinEls = useRef<Map<string, DOMRect>>(new Map());
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const spaceHeld = useRef(false);

  // Detectar espacio para pan
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.code === "Space") { spaceHeld.current = true; e.preventDefault(); } };
    const onUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false; };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  const handleDrag = useCallback((id: string, dx: number, dy: number) => {
    // Read fresh position from the store to avoid stale closure bugs when nodes update mid-drag
    const fresh = useMaterialEditorStore.getState().nodes.find(n => n.id === id);
    if (!fresh) return;
    updateNode(id, { pos: { x: fresh.pos.x + dx, y: fresh.pos.y + dy } });
  }, [updateNode]);

  const handlePinClick = useCallback((ref: PinRef, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    pinEls.current.set(`${ref.nodeId}:${ref.pinName}:${ref.side}`, rect);
    if (!pendingPin) {
      setPendingPin(ref);
      return;
    }
    const from = pendingPin.side === "out" ? pendingPin : ref;
    const to   = pendingPin.side === "in"  ? pendingPin : ref;
    if (from.side === "out" && to.side === "in" && from.nodeId !== to.nodeId) {
      addConnection({ fromNodeId: from.nodeId, fromOutput: from.pinName, toNodeId: to.nodeId, toInput: to.pinName });
    }
    setPendingPin(null);
  }, [pendingPin, addConnection]);

  const handleAddNode = (type: VrcSmatNodeType) => {
    const id = `${type}-${Date.now()}`;
    addNode({
      id,
      type,
      pos: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: type === "color" ? { hex: "#888888" } : type === "roughness" ? { value: 0.5 } : type === "metalness" ? { value: 0 } : type === "opacity" ? { value: 1 } : {},
    });
    setShowAddMenu(false);
  };

  // Pan del canvas con middle click o space+left drag
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y };
      e.preventDefault();
    } else if (e.button === 0) {
      selectNode(null);
    }
  };

  // Material properties para preview
  const colorNode = nodes.find(n => n.type === "color");
  const roughNode = nodes.find(n => n.type === "roughness");
  const metalNode = nodes.find(n => n.type === "metalness");
  const emissionNode = nodes.find(n => n.type === "emission");

  return (
    <div className="flex h-full">
      {/* Canvas principal */}
      <div
        className="flex-1 relative overflow-hidden bg-[#0f0f0f]"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={(e) => {
          if (isPanning.current) {
            setCanvasOffset({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
            return;
          }
        }}
        onMouseUp={(e) => {
          if (e.button === 1 || isPanning.current) {
            isPanning.current = false;
            return;
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Grid */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse" x={canvasOffset.x % 24} y={canvasOffset.y % 24}>
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1f1f1f" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Conexiones */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }}>
          {connections.map((conn, i) => {
            const fromNode = nodes.find((n) => n.id === conn.fromNodeId);
            const toNode   = nodes.find((n) => n.id === conn.toNodeId);
            if (!fromNode || !toNode) return null;
            const x1 = fromNode.pos.x + canvasOffset.x + NODE_W;
            const y1 = fromNode.pos.y + canvasOffset.y + 60;
            const x2 = toNode.pos.x + canvasOffset.x;
            const y2 = toNode.pos.y + canvasOffset.y + 60;
            const cx = (x1 + x2) / 2;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#52525b"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>

        {/* Nodes */}
        <div className="absolute inset-0" style={{ transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px)` }} ref={canvasRef}>
          {nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              onDrag={handleDrag}
              onPinClick={handlePinClick}
              selectedNodeId={selectedNodeId}
              onSelect={selectNode}
              onRemove={removeNode}
              pendingPin={pendingPin}
            />
          ))}
        </div>

        {/* Indicador de pin pendiente */}
        {pendingPin && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[10px] text-zinc-400 z-20">
            Click another pin to connect —{" "}
            <button className="text-zinc-600 underline" onClick={() => setPendingPin(null)}>Cancel</button>
          </div>
        )}

        {/* Botón añadir nodo */}
        <div className="absolute bottom-3 left-3 z-20">
          {showAddMenu && (
            <div className="mb-2 flex flex-col gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-2 shadow-xl">
              {ADDABLE_NODES.map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => handleAddNode(type)}
                  className="text-left text-[11px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowAddMenu((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300 transition-colors shadow-lg"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Node
          </button>
        </div>
      </div>

      {/* Panel derecho: propiedades + preview esfera */}
      <div className="w-[200px] shrink-0 border-l border-zinc-900 flex flex-col bg-zinc-950">
        <div className="flex-1 overflow-y-auto border-b border-zinc-900">
          <NodePropertiesPanel
            node={selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null}
            onChange={(id, data) => updateNode(id, { data })}
          />
        </div>
        <div className="p-3 flex justify-center">
          <SpherePreview
            colorHex={colorNode?.data.hex as string ?? "#888888"}
            roughness={roughNode?.data.value as number ?? 0.5}
            metalness={metalNode?.data.value as number ?? 0}
            emissiveHex={emissionNode?.data.hex as string | undefined}
          />
        </div>
      </div>
    </div>
  );
}