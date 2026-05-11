// src/store/materialEditorStore.ts
import { create } from "zustand";
import type { VrcSmatNode, VrcSmatConnection } from "@/types/vrcsmat";

interface MaterialEditorState {
  /** Índice del slot que se está editando */
  slotIndex: number | null;
  slotName: string;
  nodes: VrcSmatNode[];
  connections: VrcSmatConnection[];
  /** Nodo seleccionado en el editor */
  selectedNodeId: string | null;
  /** Si hay cambios sin guardar */
  dirty: boolean;

  open: (slotIndex: number, slotName: string) => void;
  close: () => void;
  setNodes: (nodes: VrcSmatNode[]) => void;
  setConnections: (connections: VrcSmatConnection[]) => void;
  addNode: (node: VrcSmatNode) => void;
  updateNode: (id: string, data: Partial<VrcSmatNode>) => void;
  removeNode: (id: string) => void;
  addConnection: (conn: VrcSmatConnection) => void;
  removeConnection: (fromNodeId: string, fromOutput: string, toNodeId: string, toInput: string) => void;
  selectNode: (id: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
}

const DEFAULT_NODES = (slotName: string): VrcSmatNode[] => [
  {
    id: "output",
    type: "output",
    pos: { x: 500, y: 200 },
    data: {},
  },
  {
    id: "color-1",
    type: "color",
    pos: { x: 100, y: 200 },
    data: { hex: "#888888" },
  },
];

export const useMaterialEditorStore = create<MaterialEditorState>((set) => ({
  slotIndex: null,
  slotName: "",
  nodes: [],
  connections: [],
  selectedNodeId: null,
  dirty: false,

  open: (slotIndex, slotName) =>
    set({
      slotIndex,
      slotName,
      nodes: DEFAULT_NODES(slotName),
      connections: [
        {
          fromNodeId: "color-1",
          fromOutput: "color",
          toNodeId: "output",
          toInput: "albedo",
        },
      ],
      selectedNodeId: null,
      dirty: false,
    }),

  close: () => set({ slotIndex: null, slotName: "", nodes: [], connections: [], dirty: false }),
  setNodes: (nodes) => set({ nodes }),
  setConnections: (connections) => set({ connections }),
  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node], dirty: true })),
  updateNode: (id, data) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...data } : n)),
      dirty: true,
    })),
  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      connections: s.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id),
      dirty: true,
    })),
  addConnection: (conn) => set((s) => ({ connections: [...s.connections, conn], dirty: true })),
  removeConnection: (fromNodeId, fromOutput, toNodeId, toInput) =>
    set((s) => ({
      connections: s.connections.filter(
        (c) =>
          !(c.fromNodeId === fromNodeId && c.fromOutput === fromOutput &&
            c.toNodeId === toNodeId && c.toInput === toInput)
      ),
      dirty: true,
    })),
  selectNode: (id) => set({ selectedNodeId: id }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
}));