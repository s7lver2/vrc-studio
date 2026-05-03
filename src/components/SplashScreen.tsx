/**
 * SplashScreen — Initial loading screen for VRC Studio.
 * Shows a morphing geometric animation with the app name.
 * Auto-dismisses after ~2s once the app is ready.
 */

import { useEffect, useState, useRef } from "react";

interface Props {
  onDone: () => void;
}

// ── SVG morphing shape paths ──────────────────────────────────────────────────
// Each frame is an SVG path for a shape centered in a ~100x100 box

const SHAPE_FRAMES = [
  // Cube face (square)
  "M 20 20 L 80 20 L 80 80 L 20 80 Z",
  // Pentagon
  "M 50 10 L 88 37 L 73 80 L 27 80 L 12 37 Z",
  // Triangle
  "M 50 12 L 90 82 L 10 82 Z",
  // Diamond
  "M 50 10 L 90 50 L 50 90 L 10 50 Z",
  // Hexagon
  "M 50 10 L 83 30 L 83 70 L 50 90 L 17 70 L 17 30 Z",
  // Star (5 points simplified)
  "M 50 10 L 61 35 L 88 35 L 67 54 L 74 80 L 50 65 L 26 80 L 33 54 L 12 35 L 39 35 Z",
  // Back to square
  "M 20 20 L 80 20 L 80 80 L 20 80 Z",
];

// ── Particle ──────────────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  opacity: number;
  color: string;
}

const PARTICLE_COLORS = [
  "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#3b82f6", "#a855f7",
  "#ec4899", "#ffffff",
];

export function SplashScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  const [shapeIdx, setShapeIdx] = useState(0);
  const [morphProgress, setMorphProgress] = useState(0);
  const [dotCount, setDotCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>();
  const startRef = useRef<number>(0);

  // Particle animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const W = canvas.width = window.innerWidth;
    const H = canvas.height = window.innerHeight;

    const particles: Particle[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.4 + 0.1,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    }));

    let running = true;
    const loop = () => {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => { running = false; if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // Phase timer
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("show"), 100);
    const t2 = setTimeout(() => setPhase("exit"), 2400);
    const t3 = setTimeout(onDone, 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  // Loading dots
  useEffect(() => {
    const iv = setInterval(() => setDotCount((d) => (d + 1) % 4), 400);
    return () => clearInterval(iv);
  }, []);

  // Shape morphing
  useEffect(() => {
    let frame: number;
    let start: number | null = null;
    const DURATION = 600;
    const PAUSE = 200;
    let pausing = false;
    let pauseStart = 0;

    const tick = (ts: number) => {
      if (!start) start = ts;
      if (pausing) {
        if (ts - pauseStart > PAUSE) {
          pausing = false;
          start = ts;
        }
      } else {
        const p = Math.min((ts - start) / DURATION, 1);
        setMorphProgress(p);
        if (p >= 1) {
          setShapeIdx((i) => (i + 1) % (SHAPE_FRAMES.length - 1));
          pausing = true;
          pauseStart = ts;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Interpolate SVG paths (simple linear blend for matching-length paths)
  const currentPath = SHAPE_FRAMES[shapeIdx];
  const nextPath = SHAPE_FRAMES[shapeIdx + 1] ?? SHAPE_FRAMES[0];

  const eased = morphProgress < 0.5
    ? 4 * morphProgress ** 3
    : 1 - (-2 * morphProgress + 2) ** 3 / 2;

  const isVisible = phase !== "enter";
  const isExiting = phase === "exit";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        background: "hsl(222 14% 8%)", // mismo que --sidebar-bg
        opacity: isExiting ? 0 : 1,
        transition: isExiting ? "opacity 0.5s ease-in" : "opacity 0.3s ease-out",
        pointerEvents: isExiting ? "none" : "all",
      }}
    >
      {/* Particle canvas — igual */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ opacity: 0.6 }}
      />

      {/* Radial glow */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(239,68,68,0.08) 0%, transparent 60%)",
          transform: `scale(${isVisible ? 1 : 0.6})`,
          transition: "transform 0.8s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      />

      {/* Content */}
      <div
        className="relative flex flex-col items-center gap-8"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 0.5s ease-out, transform 0.6s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {/* Morphing shape — sin cambios */}
        <div className="relative">
          <div
            className="absolute inset-[-12px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
          <svg
            width="96" height="96"
            viewBox="0 0 100 100"
            style={{ filter: "drop-shadow(0 0 16px rgba(239,68,68,0.5))" }}
          >
            <defs>
              <linearGradient id="shapeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#f97316" />
                <stop offset="100%" stopColor="#eab308" />
              </linearGradient>
            </defs>
            <path
              d={currentPath}
              fill="none"
              stroke="url(#shapeGrad)"
              strokeWidth="6"
              opacity="0.3"
              style={{ filter: "blur(4px)" }}
            />
            <path
              d={currentPath}
              fill="url(#shapeGrad)"
              opacity="0.15"
            />
            <path
              d={currentPath}
              fill="none"
              stroke="url(#shapeGrad)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              opacity="0.9"
            />
          </svg>
        </div>

        {/* App name */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-baseline gap-1">
            <span
              className="text-3xl font-bold tracking-tight"
              style={{
                background: "linear-gradient(135deg, #ffffff 0%, #a1a1aa 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                letterSpacing: "-0.02em",
              }}
            >
              VRC
            </span>
            <span
              className="text-3xl font-bold tracking-tight"
              style={{
                background: "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                letterSpacing: "-0.02em",
              }}
            >
              {" "}Studio
            </span>
          </div>
          <p className="text-xs text-zinc-500 tracking-[0.3em] uppercase">
            Avatar Asset Manager
          </p>
        </div>

        {/* Loading indicator */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-48 h-px bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: "40%",
                background: "linear-gradient(90deg, transparent, #ef4444, transparent)",
                animation: "shimmerLoad 1.2s ease-in-out infinite",
              }}
            />
          </div>
          <p className="text-[10px] text-zinc-500 tracking-wider">
            Loading{".".repeat(dotCount)}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes shimmerLoad {
          0% { transform: translateX(-200%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
