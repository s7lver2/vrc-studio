import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import {
  useAppearanceStore,
  applyUiScale,
  applyFontSize,
  applyAnimSpeed,
  applyAccentColor,
  applySidebarWidth,
  applyBgStyle,
} from "@/store/appearanceStore";
import { addLog } from "@/store/logsStore";

// ── Global console interceptor ─────────────────────────────────────────────
// Forwards console.warn/error/log to the in-app logs panel so every error
// is visible without opening DevTools.
(function installConsoleInterceptor() {
  const _warn  = console.warn.bind(console);
  const _error = console.error.bind(console);
  const _log   = console.log.bind(console);

  const fmt = (args: unknown[]) =>
    args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");

  console.warn = (...args: unknown[]) => {
    _warn(...args);
    addLog({ level: "warn", message: fmt(args), source: "console" });
  };
  console.error = (...args: unknown[]) => {
    _error(...args);
    const msg = fmt(args);
    // Suppress React devtools noise
    if (msg.includes("ReactDOM.render is no longer supported")) return;
    addLog({ level: "error", message: msg, source: "console" });
  };
  console.log = (...args: unknown[]) => {
    _log(...args);
    // Only forward logs that look like app events (prefixed with [])
    const msg = fmt(args);
    if (msg.startsWith("[")) {
      addLog({ level: "log", message: msg, source: "console" });
    }
  };
})();

// ── Global unhandled error / promise rejection ─────────────────────────────
window.addEventListener("error", (e) => {
  addLog({
    level: "error",
    message: `Unhandled error: ${e.message}`,
    detail: e.error?.stack ?? undefined,
    source: "unhandled",
  });
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  addLog({
    level: "error",
    message: `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    detail: reason instanceof Error ? reason.stack : undefined,
    source: "unhandled",
  });
});


const s = useAppearanceStore.getState();
applyUiScale(s.uiScale);
applyFontSize(s.fontSize);
applyAnimSpeed(s.animSpeed);
applyAccentColor(s.accentColor);
applySidebarWidth(s.sidebarWidth);
applyBgStyle(s.bgStyle);

// Aplicar la escala guardada al arrancar
try {
  const raw = localStorage.getItem("app:appearance");
  if (raw) {
    const { uiScale } = JSON.parse(raw);
    if (uiScale !== undefined && uiScale !== null) {
      applyUiScale(uiScale as 0.8 | 0.9 | 1.0 | 1.1 | 1.2);
    }
  }
} catch {}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);