// src/lib/splashImages.ts
// Imágenes built-in del carrusel de loading screen.
// Todas son imágenes libres de uso / con atribución a artistas ficticios de ejemplo.
// En producción, reemplazar con imágenes reales con permisos.

export interface SplashImageMeta {
  id: string;
  url: string;          // URL de la imagen (picsum para dev, imágenes reales en prod)
  artist: string;       // Nombre del artista
  artistUrl?: string;   // Link al perfil del artista (opcional)
  title: string;        // Título de la obra
  palette: {            // Paleta de colores dominante (para adaptar el UI)
    fg: string;         // Color de texto (claro u oscuro)
    accent: string;     // Color de acento sugerido
    barBg: string;      // Color de la barra de carga
  };
}

export const BUILT_IN_SPLASH_IMAGES: SplashImageMeta[] = [
  {
    id: "aurora-night",
    url: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1920&q=80",
    artist: "Stein Egil Liland",
    title: "Aurora Borealis",
    palette: { fg: "#e4e4e7", accent: "#60a5fa", barBg: "rgba(255,255,255,0.15)" },
  },
  {
    id: "cyber-city",
    url: "https://images.unsplash.com/photo-1555680202-c86f0e12f086?w=1920&q=80",
    artist: "Maximalfocus",
    title: "Neon City",
    palette: { fg: "#f0f9ff", accent: "#38bdf8", barBg: "rgba(56,189,248,0.2)" },
  },
  {
    id: "sakura-path",
    url: "https://images.unsplash.com/photo-1522383225653-ed111181a951?w=1920&q=80",
    artist: "David Edelstein",
    title: "Cherry Blossom Path",
    palette: { fg: "#fdf2f8", accent: "#f472b6", barBg: "rgba(244,114,182,0.2)" },
  },
  {
    id: "void-space",
    url: "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80",
    artist: "Jeremy Thomas",
    title: "Deep Space",
    palette: { fg: "#bae6fd", accent: "#38bdf8", barBg: "rgba(56,189,248,0.15)" },
  },
  {
    id: "forest-fog",
    url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=80",
    artist: "Lukasz Szmigiel",
    title: "Misty Forest",
    palette: { fg: "#f0fdf4", accent: "#4ade80", barBg: "rgba(74,222,128,0.15)" },
  },
  {
    id: "mountain-lake",
    url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80",
    artist: "Kalen Emsley",
    title: "Mountain Reflection",
    palette: { fg: "#f0f9ff", accent: "#7dd3fc", barBg: "rgba(125,211,252,0.15)" },
  },
  {
    id: "neon-tunnel",
    url: "https://images.unsplash.com/photo-1520034475321-cbe63696469a?w=1920&q=80",
    artist: "Aleks Dahlberg",
    title: "Neon Tunnel",
    palette: { fg: "#fdf4ff", accent: "#c084fc", barBg: "rgba(192,132,252,0.2)" },
  },
  {
    id: "desert-dunes",
    url: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1920&q=80",
    artist: "Wolfgang Hasselmann",
    title: "Golden Dunes",
    palette: { fg: "#fffbeb", accent: "#fbbf24", barBg: "rgba(251,191,36,0.2)" },
  },
];

export function getSplashImageById(id: string): SplashImageMeta | undefined {
  return BUILT_IN_SPLASH_IMAGES.find((img) => img.id === id);
}