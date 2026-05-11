import { Search } from "lucide-react";
import type { LogLevel } from "@/store/logsStore";
import { useT } from "@/i18n";

interface Props {
  search: string;
  onSearch: (v: string) => void;
  filter: LogLevel | "all";
  onFilter: (v: LogLevel | "all") => void;
  count: number;
}

export function LogsToolbar({ search, onSearch, filter, onFilter, count }: Props) {
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
    <div className="flex items-center gap-2 px-8 py-3 border-b border-zinc-800 flex-wrap gap-y-2">
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("logs_filter_placeholder")}
          className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors"
        />
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => onFilter(l.value)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
              filter === l.value
                ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                : "border-zinc-700 bg-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <span className="text-xs text-zinc-600 ml-auto shrink-0">{count} entries</span>
    </div>
  );
}