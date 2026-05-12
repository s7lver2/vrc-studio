/**
 * SplashScreen — Rediseño coherente con la estética de VRC Studio.
 * Logo con cuadrado rojo + texto escalonado + barra de progreso.
 * Sin partículas de colores. Sin formas aleatorias.
 */

import { useEffect, useState, useRef } from "react";

interface Props {
  onDone: () => void;
}

export function SplashScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  const [barWidth, setBarWidth] = useState(0);
  const barRafRef = useRef<number>(0);
  const barStartRef = useRef<number>(0);
  const BAR_DURATION = 1800; // ms para llenar la barra

  // Fases
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("show"), 80);
    const t2 = setTimeout(() => setPhase("exit"), 2300);
    const t3 = setTimeout(onDone, 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  // Barra de progreso animada con rAF (más suave que CSS transition)
  useEffect(() => {
    if (phase !== "show") return;
    barStartRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - barStartRef.current;
      // Ease-out cubic: rápida al inicio, desacelera al final
      const t = Math.min(elapsed / BAR_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setBarWidth(eased * 100);
      if (t < 1) {
        barRafRef.current = requestAnimationFrame(tick);
      }
    };
    barRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(barRafRef.current);
  }, [phase]);

  const visible = phase !== "enter";
  const exiting = phase === "exit";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden select-none"
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
        style={{ opacity: 0.25 }}
        aria-hidden="true"
      >
        <defs>
          <pattern id="splashDots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#3f3f46" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#splashDots)" />
      </svg>

      {/* Glow radial detrás del logo */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(220,38,38,0.12) 0%, transparent 70%)",
          transform: `scale(${visible ? 1 : 0.4})`,
          transition: "transform 0.9s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      />

      {/* Contenedor principal */}
      <div
        className="relative flex flex-col items-center gap-8"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(20px)",
          transition: "opacity 0.45s ease-out, transform 0.55s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {/* Logo: cuadrado rojo + texto */}
        <div className="flex items-center gap-4">
          {/* El cuadrado rojo — igual que el de la sidebar */}
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)",
              boxShadow: "0 0 32px rgba(220,38,38,0.45), 0 0 8px rgba(220,38,38,0.3)",
              transform: visible ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(-12deg)",
              transition: "transform 0.6s cubic-bezier(0.34,1.56,0.64,1)",
              flexShrink: 0,
            }}
          />

          {/* Texto del logo */}
          <div className="flex flex-col gap-0.5" style={{ overflow: "hidden" }}>
            {/* "VRC" */}
            <div
              style={{
                transform: visible ? "translateX(0)" : "translateX(-24px)",
                opacity: visible ? 1 : 0,
                transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.05s, opacity 0.4s ease-out 0.05s",
              }}
            >
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  background: "linear-gradient(135deg, #f4f4f5 0%, #a1a1aa 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
              >
                VRC
              </span>
            </div>

            {/* "Studio" */}
            <div
              style={{
                transform: visible ? "translateX(0)" : "translateX(-24px)",
                opacity: visible ? 1 : 0,
                transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.13s, opacity 0.4s ease-out 0.13s",
              }}
            >
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  background: "linear-gradient(135deg, #ef4444 0%, #f87171 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
              >
                Studio
              </span>
            </div>
          </div>
        </div>

        {/* Subtítulo */}
        <div
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(6px)",
            transition: "opacity 0.5s ease-out 0.22s, transform 0.5s ease-out 0.22s",
          }}
        >
          <p
            style={{
              fontSize: 10,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#52525b",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            Avatar Asset Manager
          </p>
        </div>

        {/* Barra de progreso */}
        <div
          style={{
            opacity: visible ? 1 : 0,
            transition: "opacity 0.4s ease-out 0.3s",
          }}
        >
          <div
            style={{
              width: 200,
              height: 2,
              borderRadius: 99,
              background: "#27272a",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${barWidth}%`,
                borderRadius: 99,
                background: "linear-gradient(90deg, #dc2626, #ef4444)",
                boxShadow: "0 0 8px rgba(220,38,38,0.6)",
                transition: "none", // rAF lo maneja, no CSS
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}