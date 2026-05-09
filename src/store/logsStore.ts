// src/store/logsStore.ts
import { create } from "zustand";

export type LogLevel = "log" | "info" | "warn" | "error" | "tauri" | "react";

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  detail?: string;      // stack trace, JSON payload, etc.
  timestamp: number;    // Date.now()
  source?: string;      // "console" | "tauri:event-name" | "react" | "unhandled"
}

interface LogsState {
  entries: LogEntry[];
  maxEntries: number;
  errorCount: number;
  warnCount: number;
  addEntry: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  clear: () => void;
}

let _nextId = 0;

export const useLogsStore = create<LogsState>((set) => ({
  entries: [],
  maxEntries: 500,
  errorCount: 0,
  warnCount: 0,

  addEntry: (entry) =>
    set((state) => {
      const newEntry: LogEntry = {
        ...entry,
        id: String(++_nextId),
        timestamp: Date.now(),
      };
      const entries = [newEntry, ...state.entries].slice(0, state.maxEntries);
      return {
        entries,
        errorCount: state.errorCount + (entry.level === "error" || entry.level === "react" ? 1 : 0),
        warnCount: state.warnCount + (entry.level === "warn" ? 1 : 0),
      };
    }),

  clear: () => set({ entries: [], errorCount: 0, warnCount: 0 }),
}));

// Función helper exportada para uso fuera de componentes React (interceptores globales)
export function addLog(entry: Omit<LogEntry, "id" | "timestamp">) {
  useLogsStore.getState().addEntry(entry);
}

