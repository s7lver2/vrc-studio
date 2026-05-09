// src/components/logs/LogsToolbar.tsx
import { Search, Trash2, Download, Filter } from "lucide-react";
import type { LogLevel } from "@/store/logsStore";
import { useT } from "@/i18n";




interface Props {
  search: string;
  onSearch: (v: string) => void;
  filter: LogLevel | "all";
  onFilter: (v: LogLevel | "all") => void;
  onClear: () => void;
  onExport: () => void;
  count: number;
}

export function LogsToolbar({ search, onSearch, filter, onFilter, onClear, onExport, count }: Props) {
  const t = useT();

  const LEVELS = [
    { value: "all",   label: t("logs_filter_all") },
    { value: "log",   label: t("logs_filter_log") },
    { value: "info",  label: t("logs_filter_info") },
    { value: "warn",  label: t("logs_filter_warn") },
    { value: "error", label: t("logs_filter_error") },
    { value: "react", label: t("logs_filter_react") },
    { value: "tauri", label: t("logs_filter_tauri") },
  ] as const;
  
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950/80 flex-wrap">
      {/* Search */}
      <div className="flex items-center gap-1.5 flex-1 min-w-[140px] bg-zinc-900 rounded px-2 py-1">
        <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("logs_filter_placeholder")}
          className="bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none flex-1"
        />
      </div>

      {/* Level filter pills */}
      <div className="flex items-center gap-1 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        {LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => onFilter(l.value)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              filter === l.value
                ? "bg-zinc-600 text-zinc-100"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Count */}
      <span className="text-[11px] text-zinc-600 shrink-0">t("logs_count", { count })</span>

      {/* Actions */}
      <button
        onClick={onExport}
        title={t("logs_export")}
        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <Download className="h-4 w-4" />
      </button>
      <button
        onClick={onClear}
        title={t("logs_clear")}
        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}