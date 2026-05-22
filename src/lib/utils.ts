import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cachedConvertFileSrc } from "./imageCache";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convierte un path absoluto del sistema de archivos a una URL asset://
 * que Tauri puede servir. Usa la caché en memoria cuando está habilitada
 * para evitar llamadas IPC repetidas al mismo path.
 */
export function toAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return cachedConvertFileSrc(path);
  } catch {
    // Fallback sin caché
    try { return convertFileSrc(path); } catch { return null; }
  }
}