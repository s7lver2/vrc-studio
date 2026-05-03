import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface DownloadEvent {
  item_id: string;
  percentage: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: "downloading" | "extracting" | "done" | "error";
}

export function useDownloadProgress() {
  const [downloads, setDownloads] = useState<Record<string, DownloadEvent>>({});

  useEffect(() => {
    const unlisten = listen<DownloadEvent>("download://progress", (event) => {
      const payload = event.payload;

      setDownloads((prev) => {
        const next = { ...prev, [payload.item_id]: payload };

        // Limpiar entradas "done" / "error" después de 3 segundos
        if (payload.status === "done" || payload.status === "error") {
          setTimeout(() => {
            setDownloads((p) => {
              const cleaned = { ...p };
              delete cleaned[payload.item_id];
              return cleaned;
            });
          }, 3000);
        }

        return next;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return { downloads };
}