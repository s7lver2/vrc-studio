// src/types/prefab.ts
// Espejo exacto de los structs Rust en src-tauri/src/models/mod.rs

export interface PrefabNode {
  file_id: number;
  name: string;
  is_active: boolean;
  children: PrefabNode[];
}

export interface AnimStateInfo {
  name: string;
  clip_name: string | null;
  is_blend_tree: boolean;
  is_default: boolean;
}

export interface AnimLayerInfo {
  name: string;   // "Base" | "Additive" | "Gesture" | "Action" | "FX"
  states: AnimStateInfo[];
}

export interface AvatarInfo {
  view_position: [number, number, number] | null;
  lip_sync_mode: number | null;
  has_vrc_descriptor: boolean;
}

export interface PrefabScene {
  root_nodes: PrefabNode[];
  anim_layers: AnimLayerInfo[];
  avatar_info: AvatarInfo;
  suggested_mesh_file: string | null;
}