// src/pages/Logs.tsx
import { useState, useMemo, useRef, useEffect } from "react";
import { useLogsStore, LogLevel } from "@/store/logsStore";
import { LogEntry } from "@/components/logs/LogEntry";
import { LogsToolbar } from "@/components/logs/LogsToolbar";
import { useT } from "@/i18n";


export default function Logs() {
  const t = useT();
  const entries  = useLogsStore((s) => s.entries);
  const clear    = useLogsStore((s) => s.clear);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Filtrar
  const visible = useMemo(() => {
    return entries.filter((e) => {
      if (filter !== "all" && e.level !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.message.toLowerCase().includes(q) ||
          e.source?.toLowerCase().includes(q) ||
          e.detail?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entries, filter, search]);

  // Auto-scroll al fondo cuando llegan entradas nuevas
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [visible.length, autoScroll]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vrc-studio-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-zinc-100">{t("logs_title")}</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Diagnóstico en tiempo real — reemplaza DevTools
        </p>
      </div>

      {/* Toolbar */}
      <LogsToolbar
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
        onClear={clear}
        onExport={handleExport}
        count={visible.length}
      />

      {/* Auto-scroll toggle */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/40">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-zinc-400"
          />
          Auto-scroll
        </label>
        {visible.length === 0 && (
          <span className="text-xs text-zinc-600 ml-2">
            {entries.length === 0
              ? t("logs_empty")
              : "Sin resultados para el filtro actual."}
          </span>
        )}
      </div>

      {/* Log list — newest first */}
      <div className="flex-1 overflow-y-auto">
        {visible.map((entry) => (
          <LogEntry key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}