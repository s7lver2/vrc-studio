// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { addLog } from "./store/logsStore";
import { listen } from "@tauri-apps/api/event";

// ── Interceptar console.* ──────────────────────────────────────────────────────
const _origLog   = console.log.bind(console);
const _origInfo  = console.info.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function serializeArgs(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a, null, 2); } catch { return String(a); }
  }).join(" ");
}

console.log = (...args: unknown[]) => {
  _origLog(...args);
  addLog({ level: "log", message: serializeArgs(args), source: "console" });
};
console.info = (...args: unknown[]) => {
  _origInfo(...args);
  addLog({ level: "info", message: serializeArgs(args), source: "console" });
};
console.warn = (...args: unknown[]) => {
  _origWarn(...args);
  addLog({ level: "warn", message: serializeArgs(args), source: "console" });
};
console.error = (...args: unknown[]) => {
  _origError(...args);
  addLog({ level: "error", message: serializeArgs(args), source: "console" });
};

// ── Errores globales no capturados ────────────────────────────────────────────
window.onerror = (msg, src, line, col, err) => {
  addLog({
    level: "error",
    message: String(msg),
    detail: err?.stack ?? `${src}:${line}:${col}`,
    source: "unhandled",
  });
};

window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  addLog({
    level: "error",
    message: reason instanceof Error ? reason.message : String(reason),
    detail: reason instanceof Error ? reason.stack : undefined,
    source: "unhandled-promise",
  });
});

// ── Escuchar eventos Tauri relevantes ─────────────────────────────────────────
// Solo eventos que el usuario necesita para diagnosticar la app
const TAURI_LOG_EVENTS = [
  "download://progress",
  "booth:auth_success",
  "booth:logged_out",
  "booth:purchases_loaded",
  "ripper:auth_success",
  "ripper:logged_out",
  "ripper:session_expired",
  "unity:installations-detected",
];
for (const evt of TAURI_LOG_EVENTS) {
  listen(evt, (event) => {
    addLog({
      level: "tauri",
      message: evt,
      detail: JSON.stringify(event.payload, null, 2),
      source: `tauri:${evt}`,
    });
  }).catch(() => {}); // ignore if Tauri not available
}

// ── Render ────────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);