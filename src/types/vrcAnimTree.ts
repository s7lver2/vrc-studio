export type VrcAnimLayerName =
  | "Base"       // locomotion (idle, walk, run, crouch, prone)
  | "Additive"   // additive breathing, etc.
  | "Gesture"    // manos y dedos
  | "Action"     // AFK, emotes, dances
  | "FX";        // toggles, expresiones de cara

export interface VrcAnimState {
  name: string;
  clipName: string | null;
  isBlendTree: boolean;
  children?: VrcAnimState[];
  speed?: number;
  isDefault?: boolean;
}

export interface VrcAnimLayer {
  name: VrcAnimLayerName;
  weight: number; // 0-1
  states: VrcAnimState[];
  activeState: string | null;
}

export interface VrcAnimTree {
  layers: VrcAnimLayer[];
}