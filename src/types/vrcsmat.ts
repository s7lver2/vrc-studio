// src/types/vrcsmat.ts
/**
 * Formato VRC Studio Material (.vrcsmat)
 * JSON serializado que describe los parámetros de un material.
 */

export type VrcSmatNodeType =
  | "output"          // nodo de salida — siempre presente
  | "color"           // color base (diffuse)
  | "texture"         // textura (png/jpg)
  | "roughness"       // valor escalar 0-1
  | "metalness"       // valor escalar 0-1
  | "normal_map"      // textura de normales
  | "emission"        // color de emisión
  | "opacity"         // valor escalar 0-1
  | "mix";            // mezcla de dos entradas

export interface VrcSmatNodePos { x: number; y: number; }

export interface VrcSmatNode {
  id: string;
  type: VrcSmatNodeType;
  pos: VrcSmatNodePos;
  /** Valores propios del nodo según su type */
  data: Record<string, unknown>;
}

export interface VrcSmatConnection {
  fromNodeId: string;
  fromOutput: string;  // "color", "value", "texture", etc.
  toNodeId: string;
  toInput: string;     // "albedo", "roughness", "normal", etc.
}

export interface VrcSmatFile {
  version: 1;
  name: string;
  /** Nombre del material original del modelo (para referencia) */
  sourceSlotName?: string;
  nodes: VrcSmatNode[];
  connections: VrcSmatConnection[];
  /** Texturas embebidas como base64 (key = node id) — solo si son <500KB */
  embeddedTextures?: Record<string, string>;
  /** Rutas relativas a texturas del inventario (key = node id) */
  textureRefs?: Record<string, string>;
  createdAt: string; // ISO date
  updatedAt: string;
}