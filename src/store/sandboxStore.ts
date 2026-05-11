import { create } from "zustand";
import type { InventoryItem } from "@/lib/tauri";
import type { PrefabScene } from "@/types/prefab";
export type AssetType = "model" | "avatar" | "texture" | "animation" | "clothing";

export interface SandboxFile {
  path: string;
  name: string;
  type: AssetType;
  ext: string;
}

export interface MaterialSlot {
  index: number;
  name: string;
  colorHex: string;
  hasMap: boolean;
}

export interface SandboxTransform {
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
}

export interface TrackedObjectInfo {
  name: string;
  meshName: string;
  position: { x: number; y: number; z: number };
  materialName: string;
  boneLinked: string | null;
}

export type VrcMenuControlType = "Button" | "Toggle" | "SubMenu" | "RadialPuppet" | "TwoAxisPuppet" | "FourAxisPuppet";

export interface VrcMenuControl {
  name: string;
  type: VrcMenuControlType;
  parameter?: string;
  value?: number;
  subMenu?: VrcMenuControl[];
  icon?: string;
}

export interface VrcMenuTree {
  name: string;
  controls: VrcMenuControl[];
}

export type ViewportMode = "normal" | "skeleton" | "wireframe" | "bone";

interface SandboxState {
  baseItem: InventoryItem | null;
  selectedFile: SandboxFile | null;
  materialSlots: MaterialSlot[];
  transform: SandboxTransform;
  animFile: SandboxFile | null;
  animClipIndex: number;
  isPlaying: boolean;
  clothingFile: SandboxFile | null;
  clothingLinked: boolean;
  appliedTexture: SandboxFile | null;
  selectedMeshName: string | null;
  modelClips: string[];
  activeModelClip: number;

  trackedObjectInfo: TrackedObjectInfo | null;
  vrcMenuTree: VrcMenuTree | null;
  vrcMenuPath: string[];
  viewportMode: ViewportMode;
  prefabScene: PrefabScene | null;
  /** fileID → visible. undefined = usa is_active del prefab */
  hierarchyVisibility: Record<number, boolean>;

  setBaseItem: (item: InventoryItem | null) => void;
  setSelectedFile: (file: SandboxFile | null) => void;
  setMaterialSlots: (slots: MaterialSlot[]) => void;
  setTransform: (t: Partial<SandboxTransform>) => void;
  setAnimFile: (file: SandboxFile | null) => void;
  setAnimClipIndex: (i: number) => void;
  setIsPlaying: (v: boolean) => void;
  setClothingFile: (file: SandboxFile | null) => void;
  setClothingLinked: (v: boolean) => void;
  setAppliedTexture: (file: SandboxFile | null) => void;
  setSelectedMeshName: (name: string | null) => void;
  setModelClips: (clips: string[]) => void;
  setActiveModelClip: (i: number) => void;
  reset: () => void;

  setTrackedObjectInfo: (info: TrackedObjectInfo | null) => void;
  setVrcMenuTree: (tree: VrcMenuTree | null) => void;
  setVrcMenuPath: (path: string[]) => void;
  setViewportMode: (mode: ViewportMode) => void;
  setPrefabScene: (scene: PrefabScene | null) => void;
  setNodeVisibility: (fileId: number, visible: boolean) => void;
  resetHierarchyVisibility: () => void;
}

const DEFAULT_TRANSFORM: SandboxTransform = {
  px: 0, py: 0, pz: 0,
  rx: 0, ry: 0, rz: 0,
  sx: 1, sy: 1, sz: 1,
};

export const useSandboxStore = create<SandboxState>((set) => ({
  baseItem: null,
  selectedFile: null,
  materialSlots: [],
  transform: { ...DEFAULT_TRANSFORM },
  animFile: null,
  animClipIndex: 0,
  isPlaying: false,
  clothingFile: null,
  clothingLinked: false,
  appliedTexture: null,
  selectedMeshName: null,
  modelClips: [],
  activeModelClip: -1,

  trackedObjectInfo: null,
  vrcMenuTree: null,
  vrcMenuPath: [],
  viewportMode: "normal",
  prefabScene: null,
  hierarchyVisibility: {},

  setBaseItem: (baseItem) => set({ baseItem, selectedFile: null, materialSlots: [], animFile: null, clothingFile: null, appliedTexture: null, selectedMeshName: null, modelClips: [], activeModelClip: -1 }),
  setSelectedFile: (selectedFile) => set({ selectedFile, materialSlots: [], transform: { ...DEFAULT_TRANSFORM }, appliedTexture: null, selectedMeshName: null, modelClips: [], activeModelClip: -1 }),
  setMaterialSlots: (materialSlots) => set({ materialSlots }),
  setTransform: (t) => set((s) => {
    const safe: Partial<SandboxTransform> = {};
    for (const k in t) {
      const v = (t as any)[k];
      (safe as any)[k] = isFinite(v) ? v : 0;
    }
    return { transform: { ...s.transform, ...safe } };
  }),
  setAnimFile: (animFile) => set({ animFile, isPlaying: false, animClipIndex: 0 }),
  setAnimClipIndex: (animClipIndex) => set({ animClipIndex }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setClothingFile: (clothingFile) => set({ clothingFile, clothingLinked: false }),
  setClothingLinked: (clothingLinked) => set({ clothingLinked }),
  setAppliedTexture: (appliedTexture) => set({ appliedTexture }),
  setSelectedMeshName: (selectedMeshName) => set({ selectedMeshName }),
  setModelClips: (modelClips) => set({ modelClips, activeModelClip: -1 }),
  setActiveModelClip: (activeModelClip) => set({ activeModelClip }),
  reset: () => set({ baseItem: null, selectedFile: null, materialSlots: [], transform: { ...DEFAULT_TRANSFORM }, animFile: null, animClipIndex: 0, isPlaying: false, clothingFile: null, clothingLinked: false, appliedTexture: null, selectedMeshName: null, modelClips: [], activeModelClip: -1 }),

  setTrackedObjectInfo: (trackedObjectInfo) => set({ trackedObjectInfo }),
  setVrcMenuTree: (vrcMenuTree) => set({ vrcMenuTree, vrcMenuPath: [] }),
  setVrcMenuPath: (vrcMenuPath) => set({ vrcMenuPath }),
  setViewportMode: (viewportMode) => set({ viewportMode }),
  setPrefabScene: (prefabScene) => set({ prefabScene, hierarchyVisibility: {} }),
  setNodeVisibility: (fileId, visible) =>
    set((s) => ({ hierarchyVisibility: { ...s.hierarchyVisibility, [fileId]: visible } })),
  resetHierarchyVisibility: () => set({ hierarchyVisibility: {} }),
}));