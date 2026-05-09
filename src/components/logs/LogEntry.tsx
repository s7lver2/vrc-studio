// src/components/logs/LogEntry.tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LogEntry as LogEntryType, LogLevel } from "@/store/logsStore";
import { useT } from "@/i18n";

interface Props { entry: LogEntryType; }

export function LogEntry({ entry }: Props) {
  const t = useT();

  const LEVEL_STYLES: Record<LogLevel, { bg: string; text: string; badge: string; label: string }> = {
    log:   { bg: "",                 text: "text-zinc-300",  badge: "bg-zinc-700 text-zinc-300",  label: t("logs_filter_log"),   },
    info:  { bg: "",                 text: "text-blue-300",  badge: "bg-blue-900 text-blue-300",  label: t("logs_filter_info"),  },
    warn:  { bg: "bg-yellow-950/30", text: "text-yellow-300", badge: "bg-yellow-900 text-yellow-300", label: t("logs_filter_warn"), },
    error: { bg: "bg-red-950/30",    text: "text-red-300",   badge: "bg-red-900 text-red-300",    label: t("logs_filter_error"), },
    react: { bg: "bg-red-950/40",    text: "text-red-400",   badge: "bg-red-800 text-red-200",    label: t("logs_filter_react"), },
    tauri: { bg: "",                 text: "text-purple-300", badge: "bg-purple-900 text-purple-300", label: t("logs_filter_tauri"), },
  };

  const [expanded, setExpanded] = useState(false);
  const style = LEVEL_STYLES[entry.level];
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false });

  return (
    <div className={`border-b border-zinc-800/50 ${style.bg}`}>
      <div
        className={`flex items-start gap-2 px-3 py-1.5 text-xs font-mono cursor-pointer hover:bg-white/5 ${style.text}`}
        onClick={() => entry.detail && setExpanded((e) => !e)}
      >
        {/* Level badge */}
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${style.badge}`}>
          {style.label}
        </span>

        {/* Timestamp */}
        <span className="shrink-0 text-zinc-600 text-[10px] pt-0.5">{time}</span>

        {/* Message */}
        <span className="flex-1 break-all leading-relaxed">{entry.message}</span>

        {/* Source tag */}
        {entry.source && (
          <span className="shrink-0 text-zinc-600 text-[10px] truncate max-w-[120px]">
            {entry.source}
          </span>
        )}

        {/* Expand indicator */}
        {entry.detail && (
          <span className="shrink-0 text-zinc-600">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
      </div>

      {/* Detail / stack trace */}
      {expanded && entry.detail && (
        <pre className="px-4 py-2 text-[10px] font-mono text-zinc-400 bg-zinc-900/60 overflow-x-auto whitespace-pre-wrap break-all border-t border-zinc-800">
          {entry.detail}
        </pre>
      )}
    </div>
  );
}