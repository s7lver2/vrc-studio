import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { addLog } from "../store/logsStore";

interface BoothDebugPayload {
  msg: string;
  snippet?: string;
  totalLinks?: number;
  downloadCandidates?: Array<{ href: string; text: string }>;
  allLinks?: Array<{ href: string; text: string }>;
  buttons?: Array<{ tag: string; text: string; dataAttrs: string }>;
  globalKeys?: string[];
  url?: string;
}

export function useBoothDebug() {
  useEffect(() => {
    const unlisten = listen<BoothDebugPayload>("booth:download-debug", (event) => {
      const p = event.payload;

      addLog({ level: "tauri", message: `[booth-debug] ${p.msg}`, source: "tauri:booth:download-debug" });

      if (p.url) {
        addLog({ level: "info", message: `[booth-debug] url: ${p.url}`, source: "tauri:booth:download-debug" });
      }

      if (p.globalKeys && p.globalKeys.length > 0) {
        addLog({
          level: "info",
          message: `[booth-debug] window globals: ${p.globalKeys.join(", ")}`,
          source: "tauri:booth:download-debug",
        });
      }

      if (p.downloadCandidates && p.downloadCandidates.length > 0) {
        addLog({
          level: "info",
          message: `[booth-debug] download candidates (${p.downloadCandidates.length}):`,
          detail: p.downloadCandidates
            .map((l) => `  href="${l.href}" text="${l.text}"`)
            .join("\n"),
          source: "tauri:booth:download-debug",
        });
      } else if (p.totalLinks !== undefined) {
        addLog({
          level: "warn",
          message: `[booth-debug] no download candidates found — total links on page: ${p.totalLinks}`,
          source: "tauri:booth:download-debug",
        });
      }

      if (p.buttons && p.buttons.length > 0) {
        addLog({
          level: "info",
          message: `[booth-debug] buttons (${p.buttons.length}):`,
          detail: p.buttons
            .map((b) => `  <${b.tag}> "${b.text}" [${b.dataAttrs || "no data-attrs"}]`)
            .join("\n"),
          source: "tauri:booth:download-debug",
        });
      }

      if (p.allLinks && p.allLinks.length > 0) {
        addLog({
          level: "info",
          message: `[booth-debug] all links (${p.allLinks.length} total, first 30):`,
          detail: p.allLinks
            .slice(0, 30)
            .map((l) => `  href="${l.href}" text="${l.text}"`)
            .join("\n"),
          source: "tauri:booth:download-debug",
        });
      }

      if (p.snippet) {
        addLog({
          level: "info",
          message: "[booth-debug] DOM snippet (primeros 2000 chars):",
          detail: p.snippet.substring(0, 2000),
          source: "tauri:booth:download-debug",
        });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}