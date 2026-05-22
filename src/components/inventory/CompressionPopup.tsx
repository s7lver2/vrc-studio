/**
 * CompressionPopup — Popup modal que aparece durante la compresión/descompresión
 * de un asset del inventario. Incluye:
 *  - Animación de caja vista desde arriba (POV cenital) en la que se van
 *    acomodando paquetes, luego la tapa se cierra y el ciclo se repite.
 *  - Barra de progreso real conectada al evento "compress://progress".
 */

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useT } from "../../i18n";
import { TetrisAnimation } from "../shared/TetrisAnimation";

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
  /** Multi-select queue: índice actual (1-based) */
  queueCurrent?: number;
  /** Multi-select queue: total de items */
  queueTotal?: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompressionPopup({ itemId, itemName, mode, onDone, onError, queueCurrent, queueTotal }: Props) {
  const t = useT();
  const [percentage, setPercentage] = useState(0);
  const [phase, setPhase] = useState<string>(mode === "compress" ? "compressing" : "decompressing");
  const unlistenRef = useRef<(() => void) | null>(null);

  // Resetear el porcentaje cuando cambia el item (cola multi-select)
  useEffect(() => {
    setPercentage(0);
    setPhase(mode === "compress" ? "compressing" : "decompressing");
  }, [itemId, mode]);

  useEffect(() => {
    let active = true;
    listen<CompressProgressEvent>("compress://progress", (event) => {
      if (!active) return;
      if (event.payload.item_id !== itemId) return;
      // Nunca retroceder: solo aceptamos valores mayores al actual
      setPercentage((prev) => Math.max(prev, Math.round(event.payload.percentage)));
      setPhase(event.payload.phase);
      if (event.payload.phase === "done") {
        setTimeout(() => { if (active) onDone(); }, 800);
      } else if (event.payload.phase === "error") {
        onError(t("compression_error"));
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });
    const watchdog = setTimeout(() => {
      if (active) onError(t("compression_timeout"));
    }, 30_000);
    return () => {
      active = false;
      unlistenRef.current?.();
      clearTimeout(watchdog);
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
        <TetrisAnimation phase={phase} mode={mode} />
        <div className="text-center">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[220px]">{itemName}</p>
          <p className="text-[10px] text-zinc-600 mt-1">{subtitle}</p>
        </div>
        <div className="w-full flex flex-col gap-3">
          {/* Barra de progreso del item actual */}
          <div>
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

          {/* Barra de cola — solo en multi-select */}
          {queueTotal && queueTotal > 1 ? (
            <div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-500 rounded-full transition-all duration-500"
                  style={{ width: `${((queueCurrent ?? 1) / queueTotal) * 100}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-zinc-600">{t("compression_queue")}</span>
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {queueCurrent} / {queueTotal}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}