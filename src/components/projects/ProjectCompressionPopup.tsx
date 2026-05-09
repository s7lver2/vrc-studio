/**
 * ProjectCompressionPopup — compression progress modal.
 */

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { TetrisAnimation } from "../shared/TetrisAnimation";
import { useT } from "@/i18n";

interface CompressProgressEvent {
  item_id: string;
  percentage: number;
  phase: "compressing" | "decompressing" | "done" | "error";
}

interface Props {
  projectId: string;
  projectName: string;
  mode: "compress" | "decompress";
  onDone: () => void;
  onError: (msg: string) => void;
}

export function ProjectCompressionPopup({ projectId, projectName, mode, onDone, onError }: Props) {
  const t = useT();
  const [percentage, setPercentage] = useState(0);
  const [phase, setPhase] = useState<string>(mode === "compress" ? "compressing" : "decompressing");
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    listen<CompressProgressEvent>("compress://progress", (event) => {
      if (!active) return;
      if (event.payload.item_id !== projectId) return;
      setPercentage(Math.round(event.payload.percentage));
      setPhase(event.payload.phase);
      if (event.payload.phase === "done") {
        setTimeout(() => { if (active) onDone(); }, 800);
      } else if (event.payload.phase === "error") {
        onError(t("project_compress_error"));
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });
    return () => {
      active = false;
      unlistenRef.current?.();
    };
  }, [projectId, onDone, onError, t]);

  const title =
    mode === "compress"
      ? phase === "done"
        ? t("project_compress_title_done_compress")
        : t("project_compress_title_compress")
      : phase === "done"
      ? t("project_compress_title_done_decompress")
      : t("project_compress_title_decompress");

  const subtitle =
    mode === "compress"
      ? t("project_compress_saving")
      : t("project_compress_restore");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative z-10 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 w-80 flex flex-col items-center gap-5">
        <TetrisAnimation phase={phase} mode={mode} />
        <div className="text-center">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[220px]">{projectName}</p>
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