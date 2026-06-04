// src/components/SplashScreenCarousel.tsx
/**
 * SplashScreenCarousel — Loading screen BETA con carrusel de imágenes.
 *
 * Layout:
 * - Fondo: imagen del carrusel (fade entre imágenes si hay varias)
 * - Esquina inferior izquierda: info de la foto (artista + título) — solo si no es custom
 * - Lado derecho: barra de carga vertical + logo + nombre de la app
 * - Colores: completamente dinámicos via CSS vars / palette de la imagen
 */

import { useEffect, useState, useRef } from "react";
import { useAppearanceStore, CarouselImageEntry } from "@/store/appearanceStore";
import { BUILT_IN_SPLASH_IMAGES, SplashImageMeta, getSplashImageById } from "@/lib/splashImages";
import { toAssetUrl } from "@/lib/utils";
interface Props {
  onDone: () => void;
  /** Pre-scanned VRChat photo paths from App.tsx — avoids scan timing race on first frame */
  preloadedVrchatPhotos?: string[];
}

/** Resuelve la URL de una entrada de carrusel */
function resolveImageUrl(entry: CarouselImageEntry): string | null {
  if (entry.builtInId) {
    return getSplashImageById(entry.builtInId)?.url ?? null;
  }
  if (entry.path) {
    return toAssetUrl(entry.path);
  }
  return null;
}

/** Resuelve la paleta de una entrada */
function resolvePalette(entry: CarouselImageEntry): SplashImageMeta["palette"] {
  if (entry.builtInId) {
    return getSplashImageById(entry.builtInId)?.palette ?? DEFAULT_PALETTE;
  }
  // Custom image: paleta neutra
  return DEFAULT_PALETTE;
}

const DEFAULT_PALETTE: SplashImageMeta["palette"] = {
  fg: "#e4e4e7",
  accent: "hsl(var(--accent-h, 0) var(--accent-s, 72%) var(--accent-l, 51%))",
  barBg: "rgba(255,255,255,0.12)",
};

const BAR_DURATION = 2000; // ms

export function SplashScreenCarousel({ onDone, preloadedVrchatPhotos = [] }: Props) {
  const { carouselImages, vrchatGallery } = useAppearanceStore();
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  const [barProgress, setBarProgress] = useState(0);
  const barRafRef = useRef<number>(0);
  const barStartRef = useRef<number>(0);
  // Use pre-loaded photos (from App.tsx) so they're available on frame 1
  const vrchatPhotoPaths = preloadedVrchatPhotos;

  // Build the pool of available images
  const imageList: CarouselImageEntry[] = (() => {
    // When VRChat gallery is active, use ONLY VRChat photos
    if (vrchatGallery.consented && vrchatGallery.enabled) {
      if (vrchatPhotoPaths.length > 0) {
        return vrchatPhotoPaths.map((p) => ({
          id: `vrchat:${p}`,
          path: p,
          builtInId: null,
        }));
      }
      // VRChat photos not loaded yet or empty → fall back to built-in
      return BUILT_IN_SPLASH_IMAGES.map((img) => ({ id: img.id, path: null, builtInId: img.id }));
    }
    // Normal mode: custom images → built-in
    const custom = carouselImages;
    return custom.length > 0
      ? custom
      : BUILT_IN_SPLASH_IMAGES.map((img) => ({ id: img.id, path: null, builtInId: img.id }));
  })();

  // Slideshow state
  const [activeIdx, setActiveIdx] = useState(() => Math.floor(Math.random() * imageList.length));
  const [imgVisible, setImgVisible] = useState(true);

  // Ciclo de fade cada 3s (solo si hay más de 1 imagen)
  useEffect(() => {
    if (imageList.length <= 1) return;
    const interval = setInterval(() => {
      // Fade out
      setImgVisible(false);
      // Tras fade out (500ms), cambiar imagen y fade in
      setTimeout(() => {
        setActiveIdx((prev) => (prev + 1) % imageList.length);
        setImgVisible(true);
      }, 500);
    }, 3000);
    return () => clearInterval(interval);
  }, [imageList.length]);

  // Resolver la entrada activa y sus metadatos
  const activeEntry = imageList[activeIdx];
  const imageUrl = resolveImageUrl(activeEntry);
  const palette = resolvePalette(activeEntry);
  const isBuiltIn = !!activeEntry.builtInId;
  const meta = isBuiltIn ? getSplashImageById(activeEntry.builtInId!) : null;

  // Fases de animación (entrada/salida del splash)
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("show"), 80);
    const t2 = setTimeout(() => setPhase("exit"), 2500);
    const t3 = setTimeout(onDone, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  // Barra de progreso vertical con rAF
  useEffect(() => {
    if (phase !== "show") return;
    barStartRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - barStartRef.current;
      const t = Math.min(elapsed / BAR_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 2.5);
      setBarProgress(eased * 100);
      if (t < 1) barRafRef.current = requestAnimationFrame(tick);
    };
    barRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(barRafRef.current);
  }, [phase]);

  const visible = phase !== "enter";
  const exiting = phase === "exit";

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden select-none"
      style={{
        opacity: exiting ? 0 : 1,
        transition: exiting ? "opacity 0.5s ease-in" : "opacity 0.3s ease-out",
        pointerEvents: exiting ? "none" : "all",
        background: "#09090b",
      }}
    >
      {/* ── Imagen de fondo ── */}
      {imageUrl && (
        <div
          className="absolute inset-0"
          style={{
            opacity: visible && imgVisible ? 1 : 0,
            transition: imgVisible
              ? "opacity 0.5s ease-in"   // fade in de nueva imagen
              : "opacity 0.5s ease-out", // fade out de imagen actual
          }}
        >
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(to right, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.7) 100%)",
            }}
          />
        </div>
      )}

      {/* ── Info de la foto — esquina inferior izquierda ── */}
      {isBuiltIn && meta && (
        <div
          className="absolute bottom-8 left-8 flex flex-col gap-1"
          style={{
            opacity: visible && imgVisible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.4s ease, transform 0.6s ease-out 0.4s",
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {meta.title}
          </p>
          <p
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.35)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            Photo by {meta.artist}
          </p>
        </div>
      )}

      {/* ── Panel derecho: logo + nombre + barra de carga ── */}
      <div
        className="absolute right-0 top-0 bottom-0 flex flex-col items-center justify-center"
        style={{
          width: 120,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderLeft: `1px solid ${palette.barBg}`,
          opacity: visible ? 1 : 0,
          transform: visible ? "translateX(0)" : "translateX(20px)",
          transition: "opacity 0.5s ease-out 0.1s, transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s",
          gap: 24,
          padding: "24px 0",
        }}
      >
        {/* Logo mark */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <img
            src="/logo-mark-256.png"
            alt="VRC Studio"
            style={{
              width: 40,
              height: 40,
              objectFit: "contain",
              filter: "drop-shadow(0 0 10px rgba(220,38,38,0.6))",
              transform: visible ? "scale(1)" : "scale(0.7)",
              transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: palette.fg,
              fontFamily: "system-ui, -apple-system, sans-serif",
              lineHeight: 1,
            }}>VRC</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              background: "linear-gradient(135deg, #ef4444 0%, #f87171 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              fontFamily: "system-ui, -apple-system, sans-serif",
              lineHeight: 1,
            }}>Studio</span>
          </div>
        </div>

        {/* Barra de carga vertical */}
        <div
          style={{
            width: 3,
            height: 120,
            borderRadius: 99,
            background: palette.barBg,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Relleno de la barra (de abajo hacia arriba) */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: `${barProgress}%`,
              borderRadius: 99,
              background: `linear-gradient(0deg, ${palette.accent}, ${palette.fg})`,
              boxShadow: `0 0 8px ${palette.accent}`,
              transition: "none",
            }}
          />
        </div>

        {/* Subtítulo debajo de la barra */}
        <p
          style={{
            fontSize: 8,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAlign: "center",
            padding: "0 12px",
          }}
        >
          Loading…
        </p>
      </div>
    </div>
  );
}