// src/components/shared/WallpaperBackground.tsx
import { useRef, useEffect, useState } from "react";
import { useAppearanceStore } from "@/store/appearanceStore";
import { useAppStore } from "@/store/app";
import { toAssetUrl } from "@/lib/utils";

const FADE_DURATION = 500; // ms

export function WallpaperBackground() {
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  const activeSection = useAppStore((s) => s.activeSection);
  const videoRef = useRef<HTMLVideoElement>(null);

  // `path` que se está mostrando actualmente — se mantiene durante el fade-out
  // para que la imagen no desaparezca abruptamente mientras aún es visible.
  const [displayPath, setDisplayPath] = useState<string | null>(
    wallpaper.enabled ? wallpaper.path : null
  );
  const [displayMediaType, setDisplayMediaType] = useState(wallpaper.mediaType);
  const [opacity, setOpacity] = useState(wallpaper.enabled && !!wallpaper.path ? 1 : 0);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldBeVisible =
    wallpaper.enabled &&
    !!wallpaper.path &&
    wallpaper.visibleSections.includes(activeSection as any);

  useEffect(() => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);

    if (shouldBeVisible && wallpaper.path) {
      // Fade in: primero asegurarnos de que el path está en el DOM, luego subir opacity
      setDisplayPath(wallpaper.path);
      setDisplayMediaType(wallpaper.mediaType);
      // Pequeño delay para que el navegador procese el cambio de src antes del fade
      fadeTimer.current = setTimeout(() => setOpacity(1), 16);
    } else {
      // Fade out: bajar opacity, luego quitar el path del DOM
      setOpacity(0);
      fadeTimer.current = setTimeout(() => {
        setDisplayPath(null);
      }, FADE_DURATION + 50);
    }

    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [shouldBeVisible, wallpaper.path, wallpaper.mediaType]);

  // Forzar reload del vídeo cuando cambia su path
  useEffect(() => {
    if (videoRef.current && displayMediaType === "video" && displayPath) {
      videoRef.current.load();
    }
  }, [displayPath, displayMediaType]);

  // Nada que mostrar ni en fade
  if (!displayPath) return null;

  const assetUrl = toAssetUrl(displayPath);
  if (!assetUrl) return null;

  const mediaStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: wallpaper.fit === "tile" ? "cover" : wallpaper.fit,
    filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined,
    transform: wallpaper.blur > 0 ? "scale(1.05)" : undefined,
  };

  return (
    <>
      {/* Wallpaper media */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -2,
          overflow: "hidden",
          opacity,
          transition: `opacity ${FADE_DURATION}ms ease`,
        }}
      >
        {displayMediaType === "video" ? (
          <video
            ref={videoRef}
            style={mediaStyle}
            autoPlay
            loop
            muted
            playsInline
            disablePictureInPicture
          >
            <source src={assetUrl} />
          </video>
        ) : wallpaper.fit === "tile" ? (
          <div
            style={{
              ...mediaStyle,
              backgroundImage: `url(${assetUrl})`,
              backgroundSize: "auto",
              backgroundRepeat: "repeat",
              objectFit: undefined,
            }}
          />
        ) : (
          <img src={assetUrl} alt="" style={mediaStyle} draggable={false} />
        )}
      </div>

      {/* Dark overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -1,
          background: `rgba(0,0,0,${wallpaper.overlayOpacity})`,
          opacity,
          transition: `opacity ${FADE_DURATION}ms ease`,
        }}
      />
    </>
  );
}