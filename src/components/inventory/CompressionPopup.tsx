/**
 * CompressionPopup — Popup modal que aparece durante la compresión/descompresión
 * de un asset del inventario. Incluye:
 *  - Animación de caja vista desde arriba (POV cenital) en la que se van
 *    acomodando paquetes, luego la tapa se cierra y el ciclo se repite.
 *  - Barra de progreso real conectada al evento "compress://progress".
 */

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Archive, PackageOpen } from "lucide-react";
import { useT } from "../../i18n"

interface CompressProgressEvent {
  item_id: string;
  percentage: number;
  phase: "compressing" | "decompressing" | "done" | "error";
}

interface Props {
  itemId: string;
  itemName: string;
  mode: "compress" | "decompress";
  onDone: () => void;
  onError: (msg: string) => void;
}

// ── Box packing animation (pure CSS + SVG) ────────────────────────────────────

function BoxAnimation({ phase }: { phase: string }) {
  const [cycle, setCycle] = useState(0);

  // restart cycle every 2.4s while active
  useEffect(() => {
    if (phase === "done") return;
    const id = setInterval(() => setCycle((c) => c + 1), 2400);
    return () => clearInterval(id);
  }, [phase]);

  if (phase === "done") {
    return (
      <div className="flex items-center justify-center w-20 h-20">
        <Archive className="h-12 w-12 text-green-400 animate-bounce" />
      </div>
    );
  }

  if (phase === "decompressing") {
    return (
      <div className="flex items-center justify-center w-20 h-20">
        <PackageOpen className="h-12 w-12 text-blue-400 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="w-20 h-20 relative select-none" key={cycle}>
      <style>{`
        @keyframes box-pkg1 {
          0%   { transform: translate(10px,-28px); opacity:0; }
          15%  { transform: translate(10px,-28px); opacity:1; }
          35%  { transform: translate(10px,2px);   opacity:1; }
          80%  { transform: translate(10px,2px);   opacity:1; }
          95%  { opacity:0; }
          100% { opacity:0; }
        }
        @keyframes box-pkg2 {
          0%   { transform: translate(28px,-28px); opacity:0; }
          30%  { transform: translate(28px,-28px); opacity:0; }
          45%  { transform: translate(28px,-28px); opacity:1; }
          62%  { transform: translate(28px,10px);  opacity:1; }
          80%  { transform: translate(28px,10px);  opacity:1; }
          95%  { opacity:0; }
          100% { opacity:0; }
        }
        @keyframes box-pkg3 {
          0%   { transform: translate(4px,-28px);  opacity:0; }
          50%  { transform: translate(4px,-28px);  opacity:0; }
          65%  { transform: translate(4px,-28px);  opacity:1; }
          78%  { transform: translate(4px,14px);   opacity:1; }
          80%  { transform: translate(4px,14px);   opacity:1; }
          93%  { opacity:0; }
          100% { opacity:0; }
        }
        @keyframes box-lid {
          0%   { transform: scaleY(0); transform-origin: top; }
          78%  { transform: scaleY(0); transform-origin: top; }
          88%  { transform: scaleY(1); transform-origin: top; }
          100% { transform: scaleY(1); transform-origin: top; }
        }
        @keyframes box-shadow-grow {
          0%   { opacity:0.3; transform:scale(0.9); }
          80%  { opacity:0.3; transform:scale(0.9); }
          90%  { opacity:0.5; transform:scale(1); }
          100% { opacity:0.5; transform:scale(1); }
        }
        .box-pkg1 { animation: box-pkg1 2.4s ease-in-out forwards; }
        .box-pkg2 { animation: box-pkg2 2.4s ease-in-out forwards; }
        .box-pkg3 { animation: box-pkg3 2.4s ease-in-out forwards; }
        .box-lid  { animation: box-lid  2.4s ease-in-out forwards; }
        .box-shadow { animation: box-shadow-grow 2.4s ease-in-out forwards; }
      `}</style>

      {/* Shadow */}
      <div className="box-shadow absolute bottom-1 left-1/2 -translate-x-1/2 w-14 h-3 rounded-full bg-black/50 blur-sm" />

      {/* Isometric box viewed from above */}
      <svg viewBox="0 0 80 80" className="absolute inset-0 w-full h-full" fill="none">
        {/* Box body (open) */}
        {/* Front face */}
        <path d="M16 44 L40 56 L64 44 L64 30 L40 42 L16 30 Z"
              fill="#3f3f46" stroke="#52525b" strokeWidth="0.8" />
        {/* Left face */}
        <path d="M16 30 L40 42 L40 56 L16 44 Z"
              fill="#27272a" stroke="#52525b" strokeWidth="0.8" />
        {/* Right face */}
        <path d="M64 30 L40 42 L40 56 L64 44 Z"
              fill="#3f3f46" stroke="#52525b" strokeWidth="0.8" />
        {/* Top rim */}
        <path d="M16 30 L40 18 L64 30 L40 42 Z"
              fill="#52525b" stroke="#71717a" strokeWidth="0.8" />

        {/* Packages being dropped in */}
        <g className="box-pkg1">
          <rect x="0" y="0" width="14" height="10" rx="1.5"
                fill="#ef4444" stroke="#b91c1c" strokeWidth="0.6" />
          <line x1="7" y1="0" x2="7" y2="10" stroke="#b91c1c" strokeWidth="0.4" />
          <line x1="0" y1="5" x2="14" y2="5" stroke="#b91c1c" strokeWidth="0.4" />
        </g>
        <g className="box-pkg2">
          <rect x="0" y="0" width="12" height="8" rx="1.5"
                fill="#3b82f6" stroke="#1d4ed8" strokeWidth="0.6" />
          <line x1="6" y1="0" x2="6" y2="8" stroke="#1d4ed8" strokeWidth="0.4" />
        </g>
        <g className="box-pkg3">
          <rect x="0" y="0" width="16" height="7" rx="1.5"
                fill="#a855f7" stroke="#7c3aed" strokeWidth="0.6" />
          <line x1="8" y1="0" x2="8" y2="7" stroke="#7c3aed" strokeWidth="0.4" />
          <line x1="0" y1="3.5" x2="16" y2="3.5" stroke="#7c3aed" strokeWidth="0.4" />
        </g>

        {/* Lid sliding in */}
        <g className="box-lid">
          <path d="M16 30 L40 18 L64 30 L40 42 Z"
                fill="#dc2626" stroke="#b91c1c" strokeWidth="0.8" />
          {/* Lid tape stripe */}
          <path d="M28 24 L52 36" stroke="#fca5a5" strokeWidth="1.5" opacity="0.7" />
        </g>
      </svg>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompressionPopup({ itemId, itemName, mode, onDone, onError }: Props) {
  const t = useT();
  const [percentage, setPercentage] = useState(0);
  const [phase, setPhase] = useState<string>(mode === "compress" ? "compressing" : "decompressing");
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    listen<CompressProgressEvent>("compress://progress", (event) => {
      if (!active) return;
      if (event.payload.item_id !== itemId) return;
      setPercentage(Math.round(event.payload.percentage));
      setPhase(event.payload.phase);
      if (event.payload.phase === "done") {
        setTimeout(() => { if (active) onDone(); }, 800);
      } else if (event.payload.phase === "error") {
        onError("Compression error");
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });
    return () => {
      active = false;
      unlistenRef.current?.();
    };
  }, [itemId, onDone, onError]);

  const title =
    mode === "compress"
      ? phase === "done"
        ? t("compression_title_compress_done")
        : t("compression_title_compress")
      : phase === "done"
      ? t("compression_title_decompress_done")
      : t("compression_title_decompress");

  const subtitle =
    mode === "compress" ? t("compression_subtitle") : t("compression_subtitle_decomp");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative z-10 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 w-80 flex flex-col items-center gap-5">
        <BoxAnimation phase={phase} />
        <div className="text-center">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[220px]">{itemName}</p>
          <p className="text-[10px] text-zinc-600 mt-1">{subtitle}</p>
        </div>
        <div className="w-full">
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-zinc-600">{phase}</span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{percentage}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}