import { useEffect, useState, useRef } from "react";

interface Props {
  onDone: () => void;
  /** 0–100: loading progress driven by page preloads in App.tsx */
  progress: number;
}

export function SplashScreen({ onDone, progress }: Props) {
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  // Use state (not ref) so the progress effect re-runs when this flips to true,
  // even if progress already reached 100 before the minimum animation time passed.
  const [canExit, setCanExit] = useState(false);
  const exitStartedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("show");
      // Allow exit only after the enter animation has settled (500ms)
      setTimeout(() => setCanExit(true), 500);
    }, 80);
    // Hard fallback: never hang forever
    const fallback = setTimeout(() => triggerExit(), 30_000);
    return () => { clearTimeout(t); clearTimeout(fallback); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerExit = () => {
    if (exitStartedRef.current) return;
    exitStartedRef.current = true;
    setPhase("exit");
    setTimeout(onDone, 500);
  };

  // Exit once progress reaches 100 AND the minimum animation time has passed.
  // Both are in the dependency array so this fires whichever arrives last.
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
        background: "hsl(222 14% 8%)",
        opacity: exiting ? 0 : 1,
        transition: exiting ? "opacity 0.5s ease-in" : "opacity 0.25s ease-out",
        pointerEvents: exiting ? "none" : "all",
      }}
    >
      {/* Dot grid background */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ opacity: 0.18 }}
        aria-hidden="true"
      >
        <defs>
          <pattern id="splashDots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#3f3f46" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#splashDots)" />
      </svg>

      {/* Bottom-center content */}
      <div
        className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-5"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(16px)",
          transition: "opacity 0.45s ease-out, transform 0.55s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {/* Logo + wordmark */}
        <div className="flex items-center gap-3">
          <img
            src="/logo-mark-256.png"
            alt="VRC Studio"
            style={{
              width: 44,
              height: 44,
              objectFit: "contain",
              filter: "brightness(0) invert(1)",
              transform: visible ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(-12deg)",
              transition: "transform 0.6s cubic-bezier(0.34,1.56,0.64,1)",
              flexShrink: 0,
            }}
          />
          <div className="flex flex-col gap-0" style={{ overflow: "hidden" }}>
            <span style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              color: "#ffffff",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}>VRC</span>
            <span style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              color: "rgba(255,255,255,0.7)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}>Studio</span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ width: 180, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: "100%",
              height: 2,
              borderRadius: 99,
              background: "rgba(255,255,255,0.15)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${progress}%`,
                borderRadius: 99,
                background: "#ffffff",
                boxShadow: "0 0 8px rgba(255,255,255,0.5)",
                transition: "width 0.35s ease-out",
              }}
            />
          </div>
          <p style={{
            fontSize: 9,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.35)",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}>
            Loading…
          </p>
        </div>
      </div>
    </div>
  );
}
