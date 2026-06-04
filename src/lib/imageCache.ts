/**
 * imageCache.ts — Caché en memoria de URLs de imágenes para el inventario.
 *
 * Dos niveles:
 *  1. assetUrlCache: caché de resultados de convertFileSrc() (paths locales → asset://).
 *     Evita llamadas IPC repetidas para el mismo path.
 *  2. preloadCache: preload de imágenes remotas (http/https) via el objeto Image nativo.
 *     Fuerza al browser a meterlas en su caché HTTP antes de que el componente las necesite.
 *
 * Ambas capas son controlables desde Settings (enable/disable + tamaño máximo).
 */

import { convertFileSrc } from "@tauri-apps/api/core";

// ── Estado interno ────────────────────────────────────────────────────────────

const assetUrlCache = new Map<string, string>();
const preloadCache  = new Set<string>();

let _enabled    = true;
let _maxCount   = 300; // número máximo de entradas en assetUrlCache

// ── Configuración (llamada desde Settings al arrancar/cambiar) ────────────────

export function setImageCacheEnabled(enabled: boolean): void {
  _enabled = enabled;
  if (!enabled) clearImageCache();
}

export function setImageCacheMaxCount(max: number): void {
  _maxCount = Math.max(10, max);
  // Si ya sobrepasamos el nuevo límite, purgamos las más antiguas
  while (assetUrlCache.size > _maxCount) {
    const firstKey = assetUrlCache.keys().next().value;
    if (firstKey !== undefined) assetUrlCache.delete(firstKey);
  }
}

// ── API principal ─────────────────────────────────────────────────────────────

/**
 * Versión cacheada de convertFileSrc.
 * Úsala en lugar de llamar convertFileSrc() directamente.
 */
export function cachedConvertFileSrc(path: string): string {
  // HTTP/HTTPS URLs must never go through Tauri's asset protocol
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  if (!_enabled) return convertFileSrc(path);

  const hit = assetUrlCache.get(path);
  if (hit) return hit;

  const url = convertFileSrc(path);
  if (assetUrlCache.size < _maxCount) {
    assetUrlCache.set(path, url);
  }
  return url;
}

/**
 * Pre-carga una imagen remota (http/https) para que el browser la almacene
 * en su caché HTTP. No hace nada para paths locales (asset://).
 * Es seguro llamarlo en un useEffect o durante el render de una lista.
 */
export function preloadImage(url: string): void {
  if (!_enabled || !url) return;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (preloadCache.has(url)) return;
  if (preloadCache.size >= _maxCount) return;

  preloadCache.add(url);
  const img = new Image();
  img.src = url;
}

/** Limpia toda la caché. */
export function clearImageCache(): void {
  assetUrlCache.clear();
  preloadCache.clear();
}

/** Estadísticas para mostrar en Settings. */
export function getImageCacheStats(): { assetUrls: number; preloaded: number; maxCount: number; enabled: boolean } {
  return {
    assetUrls: assetUrlCache.size,
    preloaded: preloadCache.size,
    maxCount:  _maxCount,
    enabled:   _enabled,
  };
}