// src/lib/colorExtract.ts
// Extrae el color accent dominante de una imagen usando Canvas.
// Devuelve HSL. No usa dependencias externas.

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    : max === gn ? ((bn - rn) / d + 2) / 6
    : ((rn - gn) / d + 4) / 6;
  return [Math.round(h * 360), s, l];
}

export interface ExtractedAccent {
  h: string; // "0"–"360"
  s: string; // "0%"–"100%"
  l: string; // "0%"–"100%"
}

/**
 * Extrae el color más saturado y representativo de la imagen en `url`.
 * Devuelve null si Canvas no puede leer la imagen (CORS u otro error).
 */
export async function extractDominantAccent(url: string): Promise<ExtractedAccent | null> {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const SIZE = 32;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }

        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

        // Recolectar todos los pixeles en HSL
        interface Pixel { h: number; s: number; l: number }
        const pixels: Pixel[] = [];
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          pixels.push({ h, s, l });
        }

        // Filtrar grises/neutros (baja saturación)
        const colorful = pixels.filter((p) => p.s > 0.15 && p.l > 0.1 && p.l < 0.9);
        const pool = colorful.length > 10 ? colorful : pixels;

        // Tomar el percentil 80 de saturación (evita picos de 1 pixel)
        const sorted = [...pool].sort((a, b) => b.s - a.s);
        const pick = sorted[Math.floor(sorted.length * 0.1)]; // top 10%

        if (!pick) { resolve(null); return; }

        // Ajustar luminosidad para que sea legible como accent (rango 45%–65%)
        const rawL = Math.round(pick.l * 100);
        const l = Math.max(45, Math.min(65, rawL < 45 ? rawL + 15 : rawL > 65 ? rawL - 10 : rawL));

        resolve({
          h: String(pick.h),
          s: `${Math.round(pick.s * 80)}%`,  // bajar saturación un 20% para que sea más sutil
          l: `${l}%`,
        });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = url;
    // NO poner crossOrigin para assets locales Tauri (asset:// no tiene CORS)
  });
}