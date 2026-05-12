import { useState, useMemo, useRef, useEffect } from "react";
import { Download, Trash2 } from "lucide-react";
import { useLogsStore, LogLevel } from "@/store/logsStore";
import { LogEntry } from "@/components/logs/LogEntry";
import { LogsToolbar } from "@/components/logs/LogsToolbar";
import { useT } from "@/i18n";

export default function Logs({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const entries  = useLogsStore((s) => s.entries);
  const clear    = useLogsStore((s) => s.clear);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    <div className={embedded ? "flex flex-col" : "flex flex-col h-full"}>
      {/* Header — igual que Projects */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{t("logs_title")}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {t("logs_subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            title={t("logs_export")}
            className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          >
            <Download className="h-4 w-4" />
            {t("logs_export")}
          </button>
          <button
            onClick={clear}
            title={t("logs_clear")}
            className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-red-500/50 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            {t("logs_clear")}
          </button>
        </div>
      </div>

      <LogsToolbar
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
        count={visible.length}
      />

      <div className="flex items-center gap-2 px-8 py-2 border-b border-zinc-800">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-red-500"
          />
          Auto-scroll
        </label>
        {visible.length === 0 && (
          <span className="text-xs text-zinc-600 ml-2">
            {entries.length === 0 ? t("logs_empty") : t("logs_no_results")}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.map((entry) => (
          <LogEntry key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}