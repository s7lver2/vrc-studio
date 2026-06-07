// src/components/SplashScreenCarousel.tsx

import { useEffect, useState, useRef, useMemo } from "react";
import { useAppearanceStore, CarouselImageEntry } from "@/store/appearanceStore";
import { BUILT_IN_SPLASH_IMAGES, getSplashImageById } from "@/lib/splashImages";
import { toAssetUrl } from "@/lib/utils";

/** Extracts date and time from a VRChat screenshot filename.
 *  Format: VRChat_YYYY-MM-DD_HH-MM-SS.mmm_WxH.png */
function parseDateFromVrchatFilename(path: string): { date: string; time: string } | null {
  const filename = path.split(/[\\/]/).pop() ?? "";
  const m = filename.match(/VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, year, month, day, hh, mm, ss] = m;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return { date, time: `${hh}:${mm}:${ss}` };
}

interface DisplayMeta {
  titleLine: string;
  subtitleLine: string | null;
}

function resolveDisplayMeta(entry: CarouselImageEntry): DisplayMeta {
  if (entry.builtInId) {
    const meta = getSplashImageById(entry.builtInId);
    return {
      titleLine: meta?.title ?? "",
      subtitleLine: meta ? `Photo by ${meta.artist}` : null,
    };
  }
  if (entry.path) {
    const parsed = parseDateFromVrchatFilename(entry.path);
    if (parsed) return { titleLine: parsed.date, subtitleLine: `${parsed.time} · VRChat` };
    const filename = entry.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
    return { titleLine: filename, subtitleLine: null };
  }
  return { titleLine: "", subtitleLine: null };
}

interface Props {
  onDone: () => void;
  /** Pre-scanned VRChat photo paths from App.tsx */
  preloadedVrchatPhotos?: string[];
  /** 0–100: loading progress driven by page preloads in App.tsx */
  progress: number;
}

function resolveImageUrl(entry: CarouselImageEntry): string | null {
  if (entry.builtInId) return getSplashImageById(entry.builtInId)?.url ?? null;
  if (entry.path) return toAssetUrl(entry.path);
  return null;
}

export function SplashScreenCarousel({ onDone, preloadedVrchatPhotos = [], progress }: Props) {
  const { carouselImages, vrchatGallery } = useAppearanceStore();
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  const [canExit, setCanExit] = useState(false);
  const exitStartedRef = useRef(false);

  const vrchatPhotoPaths = preloadedVrchatPhotos;

  // Build the pool of available images — memoized so re-renders don't restart the interval
  const imageList = useMemo<CarouselImageEntry[]>(() => {
    if (vrchatGallery.consented && vrchatGallery.enabled) {
      if (vrchatPhotoPaths.length > 0) {
        return vrchatPhotoPaths.map((p) => ({ id: `vrchat:${p}`, path: p, builtInId: null }));
      }
      return BUILT_IN_SPLASH_IMAGES.map((img) => ({ id: img.id, path: null, builtInId: img.id }));
    }
    const custom = carouselImages;
    return custom.length > 0
      ? custom
      : BUILT_IN_SPLASH_IMAGES.map((img) => ({ id: img.id, path: null, builtInId: img.id }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrchatGallery.consented, vrchatGallery.enabled, vrchatPhotoPaths.length, carouselImages.length]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initIdx = useRef(Math.floor(Math.random() * imageList.length)).current;
  // Two-slot crossfade: "front" is visible, "back" is pre-rendered (invisible) for instant swap
  const [frontIdx, setFrontIdx] = useState(initIdx);
  const [backIdx, setBackIdx] = useState((initIdx + 1) % Math.max(imageList.length, 1));
  const [swapped, setSwapped] = useState(false); // true = back is on top during crossfade
  const crossfadingRef = useRef(false);
  // Ref keeps the interval callback reading the latest frontIdx without re-registering
  const frontIdxRef = useRef(frontIdx);
  frontIdxRef.current = frontIdx;

  // Advance slides every 4s using a crossfade so the next image is already loaded
  useEffect(() => {
    if (imageList.length <= 1) return;
    const len = imageList.length;
    const interval = setInterval(() => {
      if (crossfadingRef.current) return;
      crossfadingRef.current = true;
      setSwapped(true); // back layer rises to top (it was already rendering = loaded)
      setTimeout(() => {
        // Crossfade complete: promote back→front, start fading the back out.
        // We do NOT change backIdx here — the back still shows the same image as the
        // new front, both rendering the same src. Changing backIdx simultaneously with
        // swapped=false would make the back layer (still near opacity-1) flash a new
        // image for one frame before it begins fading. Instead we wait for the back
        // to fully fade out before swapping its source.
        const next = (frontIdxRef.current + 1) % len;
        setFrontIdx(next);
        setSwapped(false);
        // Only update the back source once the back layer is fully invisible (≥ 0.6s fade).
        setTimeout(() => {
          setBackIdx((next + 1) % len);
          crossfadingRef.current = false;
        }, 700);
      }, 650); // slightly > 0.6s CSS transition so the transition is truly done
    }, 4000);
    return () => clearInterval(interval);
  }, [imageList.length]);

  const activeIdx = frontIdx;
  const activeEntry = imageList[frontIdx];
  const backEntry = imageList[backIdx];
  const imageUrl = resolveImageUrl(activeEntry);
  const backImageUrl = resolveImageUrl(backEntry);
  const displayMeta = resolveDisplayMeta(activeEntry);

  const triggerExit = () => {
    if (exitStartedRef.current) return;
    exitStartedRef.current = true;
    setPhase("exit");
    setTimeout(onDone, 500);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("show");
      setTimeout(() => setCanExit(true), 500);
    }, 80);
    const fallback = setTimeout(() => triggerExit(), 30_000);
    return () => { clearTimeout(t); clearTimeout(fallback); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (progress >= 100 && canExit) {
      triggerExit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, canExit]);

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
      {/* Background image — two layers crossfade so the next image is pre-loaded */}
      {/* Back layer: next image, rendered invisible for preloading, rises during swap */}
      {backImageUrl && (
        <div
          className="absolute inset-0"
          style={{
            opacity: visible && swapped ? 1 : 0,
            transition: "opacity 0.6s ease-in-out",
          }}
        >
          <img src={backImageUrl} alt="" className="w-full h-full object-cover" draggable={false} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(0,0,0,.65) 0%, rgba(0,0,0,.1) 55%, rgba(0,0,0,.05) 100%),linear-gradient(to bottom, transparent 35%, rgba(0,0,0,.92) 100%)" }} />
        </div>
      )}
      {/* Front layer: current image, fades out during swap */}
      {imageUrl && (
        <div
          className="absolute inset-0"
          style={{
            opacity: visible && !swapped ? 1 : 0,
            transition: "opacity 0.6s ease-in-out",
          }}
        >
          <img src={imageUrl} alt="" className="w-full h-full object-cover" draggable={false} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(0,0,0,.65) 0%, rgba(0,0,0,.1) 55%, rgba(0,0,0,.05) 100%),linear-gradient(to bottom, transparent 35%, rgba(0,0,0,.92) 100%)" }} />
        </div>
      )}

      {/* Bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-4 px-8 pb-8"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(14px)",
          transition: "opacity 0.45s ease-out 0.1s, transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s",
        }}
      >
        {/* Left: title + subtitle + bar + dots */}
        <div className="flex flex-col gap-2 min-w-0">
          {displayMeta.titleLine && (
            <p
              style={{
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: "#ffffff",
                fontFamily: "system-ui, -apple-system, sans-serif",
                textShadow: "0 2px 12px rgba(0,0,0,0.5)",
              }}
            >
              {displayMeta.titleLine}
            </p>
          )}
          {displayMeta.subtitleLine && (
            <p
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.5)",
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
            >
              {displayMeta.subtitleLine}
            </p>
          )}
          {/* Progress bar + dots */}
          <div className="flex items-center gap-8 mt-1">
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ width: 100, height: 2, borderRadius: 99, background: "rgba(255,255,255,.18)", overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, width: `${progress}%`, borderRadius: 99, background: "#fff", transition: "width 0.35s ease-out" }} />
              </div>
              <p style={{ fontSize: 7, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,.3)", fontFamily: "system-ui" }}>
                Loading…
              </p>
            </div>
            {imageList.length > 1 && (
              <div className="flex items-center gap-1">
                {imageList.slice(0, 8).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      height: 3,
                      borderRadius: 99,
                      background: i === activeIdx ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.28)",
                      width: i === activeIdx ? 14 : 4,
                      transition: "width 0.3s ease, background 0.3s ease",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, textAlign: "right" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", fontFamily: "system-ui" }}>VRC</span>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "-0.02em", color: "rgba(255,255,255,.55)", fontFamily: "system-ui" }}>Studio</span>
          </div>
          <img
            src="/logo-mark-256.png"
            alt="VRC Studio"
            style={{ width: 28, height: 28, objectFit: "contain", filter: "brightness(0) invert(1)" }}
          />
        </div>
      </div>
    </div>
  );
}