import { create } from "zustand";
import type { VrcAnimTree, VrcAnimLayerName } from "@/types/vrcAnimTree";

export interface MorphTarget {
  name: string;
  index: number;
  value: number;
  enabled: boolean;
  category: "face" | "body" | "clothing" | "other";
}

export interface AvatarBone {
  name: string;
  humanoidRole: string | null;
  path: string;
}

export interface ExpressionParam {
  name: string;
  type: "int" | "float" | "bool";
  value: number;
  linkedMorphs: string[];
}

interface PhysicsState {
  active: boolean;
  radialOpen: boolean;
  morphTargets: MorphTarget[];
  activeCategory: MorphTarget["category"];
  bones: AvatarBone[];
  expressionParams: ExpressionParam[];

  animTree: VrcAnimTree;

  setActive: (v: boolean) => void;
  setRadialOpen: (v: boolean) => void;
  setMorphTargets: (targets: MorphTarget[]) => void;
  setMorphValue: (name: string, value: number) => void;
  toggleMorph: (name: string) => void;
  setActiveCategory: (c: MorphTarget["category"]) => void;
  setBones: (bones: AvatarBone[]) => void;
  setExpressionParams: (params: ExpressionParam[]) => void;
  setExpressionParamValue: (name: string, value: number) => void;

  setAnimLayerState: (layer: VrcAnimLayerName, stateName: string | null) => void;
  setAnimLayerWeight: (layer: VrcAnimLayerName, weight: number) => void;
  setAnimTree: (tree: VrcAnimTree) => void;
}

export const usePhysicsStore = create<PhysicsState>((set) => ({
  active: false,
  radialOpen: false,
  morphTargets: [],
  activeCategory: "face",
  bones: [],
  expressionParams: [],

  animTree: {
    layers: [
      {
        name: "Base",
        weight: 1,
        activeState: "Idle",
        states: [
          { name: "Idle", clipName: null, isBlendTree: true, isDefault: true },
          { name: "Walk", clipName: null, isBlendTree: true },
          { name: "Run", clipName: null, isBlendTree: true },
          { name: "Crouch", clipName: null, isBlendTree: true },
          { name: "Prone", clipName: null, isBlendTree: true },
          { name: "Jump", clipName: "Jump", isBlendTree: false },
          { name: "Fall", clipName: "Fall", isBlendTree: false },
        ],
      },
      {
        name: "Action",
        weight: 1,
        activeState: null,
        states: [
          { name: "AFK", clipName: "AFK", isBlendTree: false },
          { name: "Seated", clipName: "Seated", isBlendTree: false },
          { name: "Emote 1", clipName: null, isBlendTree: false },
          { name: "Emote 2", clipName: null, isBlendTree: false },
          { name: "Emote 3", clipName: null, isBlendTree: false },
          { name: "Emote 4", clipName: null, isBlendTree: false },
          { name: "Emote 5", clipName: null, isBlendTree: false },
          { name: "Emote 6", clipName: null, isBlendTree: false },
          { name: "Emote 7", clipName: null, isBlendTree: false },
          { name: "Emote 8", clipName: null, isBlendTree: false },
        ],
      },
      {
        name: "FX",
        weight: 1,
        activeState: null,
        states: [
          { name: "Face Default", clipName: "FaceDefault", isBlendTree: false, isDefault: true },
          { name: "HandsOpen", clipName: "HandsOpen", isBlendTree: false },
          { name: "HandsFist", clipName: "HandsFist", isBlendTree: false },
        ],
      },
      {
        name: "Gesture",
        weight: 1,
        activeState: null,
        states: [
          { name: "Neutral", clipName: null, isBlendTree: false, isDefault: true },
          { name: "Fist", clipName: "Fist", isBlendTree: false },
          { name: "Open Hand", clipName: "OpenHand", isBlendTree: false },
          { name: "Point", clipName: "Point", isBlendTree: false },
          { name: "Peace", clipName: "Peace", isBlendTree: false },
          { name: "RocknRoll", clipName: "RocknRoll", isBlendTree: false },
          { name: "Gun", clipName: "Gun", isBlendTree: false },
          { name: "Thumbs Up", clipName: "ThumbsUp", isBlendTree: false },
        ],
      },
      {
        name: "Additive",
        weight: 1,
        activeState: "Breathing",
        states: [
          { name: "Breathing", clipName: "Breathing", isBlendTree: false, isDefault: true },
        ],
      },
    ],
  },

  setActive: (active) => set({ active, radialOpen: false }),
  setRadialOpen: (radialOpen) => set({ radialOpen }),
  setMorphTargets: (morphTargets) => set({ morphTargets }),
  setMorphValue: (name, value) => set((s) => ({
    morphTargets: s.morphTargets.map((t) => t.name === name ? { ...t, value, enabled: value > 0 } : t),
  })),
  toggleMorph: (name) => set((s) => ({
    morphTargets: s.morphTargets.map((t) => t.name === name ? { ...t, enabled: !t.enabled, value: t.enabled ? 0 : 1 } : t),
  })),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  setBones: (bones) => set({ bones }),
  setExpressionParams: (expressionParams) => set({ expressionParams }),
  setExpressionParamValue: (name, value) => set((s) => ({
    expressionParams: s.expressionParams.map((p) => p.name === name ? { ...p, value } : p),
  })),

  setAnimLayerState: (layer, stateName) => set((s) => ({
    animTree: { ...s.animTree, layers: s.animTree.layers.map((l) => l.name === layer ? { ...l, activeState: stateName } : l) },
  })),
  setAnimLayerWeight: (layer, weight) => set((s) => ({
    animTree: { ...s.animTree, layers: s.animTree.layers.map((l) => l.name === layer ? { ...l, weight } : l) },
  })),
  setAnimTree: (animTree) => set({ animTree }),
}));