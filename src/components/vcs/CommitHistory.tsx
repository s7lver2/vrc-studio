import type { CommitEntry } from "@/types/vcs";
import { useLocale, useT } from "@/i18n";

interface Props {
  entries: CommitEntry[];
  onSelect?: (entry: CommitEntry) => void;
}

function formatTimestamp(ts: number, locale: string): string {
  const date = new Date(ts * 1000);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return date.toLocaleTimeString(locale === "de" ? "de-DE" : locale === "es" ? "es-ES" : "en-US", { hour: "2-digit", minute: "2-digit" }) +
      " today";
  }
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(locale === "de" ? "de-DE" : locale === "es" ? "es-ES" : "en-US", { day: "2-digit", month: "short", year: "2-digit" });
}

function AuthorAvatar({ author }: { author: string }) {
  const initials = author
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const hue = [...author].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
      style={{ background: `hsl(${hue},50%,35%)` }}
      title={author}
    >
      {initials || "?"}
    </div>
  );
}

export function CommitHistory({ entries, onSelect }: Props) {
  const locale = useLocale();
  const t = useT();

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-zinc-600">
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="3" x2="12" y2="9" />
          <line x1="12" y1="15" x2="12" y2="21" />
        </svg>
        <p className="text-xs">{t("vcs_no_history")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {entries.map((entry, idx) => (
        <button
          key={entry.id}
          onClick={() => onSelect?.(entry)}
          className="group relative flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left"
        >
          {/* Graph line */}
          <div className="flex flex-col items-center shrink-0 mt-0.5">
            {idx > 0 && <div className="w-px h-2 bg-zinc-700 -mt-3 mb-0" />}
            <div className="w-2.5 h-2.5 rounded-full border-2 border-red-500 bg-zinc-950 shrink-0 z-10" />
            {idx < entries.length - 1 && (
              <div className="w-px flex-1 bg-zinc-700 mt-0.5" style={{ minHeight: "16px" }} />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 pb-1">
            <p className="text-xs text-zinc-200 truncate group-hover:text-white leading-snug">
              {entry.message}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <AuthorAvatar author={entry.author} />
              <span className="text-[10px] text-zinc-500 truncate">{entry.author}</span>
              <span className="text-[10px] text-zinc-600 ml-auto shrink-0">{formatTimestamp(entry.timestamp, locale)}</span>
            </div>
          </div>

          {/* SHA badge */}
          <div className="shrink-0 mt-0.5">
            <span className="text-[10px] font-mono text-zinc-600 group-hover:text-red-400 transition-colors">
              {entry.id.slice(0, 7)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}