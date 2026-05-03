import type { CommitEntry } from "@/types/vcs";

interface Props {
  entries: CommitEntry[];
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CommitHistory({ entries }: Props) {
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500 px-4 py-2">Sin historial de commits.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-zinc-800 max-h-64 overflow-y-auto">
      {entries.map((entry) => (
        <div key={entry.id} className="flex flex-col gap-0.5 px-4 py-2">
          <span className="text-sm text-zinc-200 truncate">{entry.message}</span>
          <div className="flex gap-2 text-xs text-zinc-500">
            <span className="font-mono">{entry.id}</span>
            <span>{entry.author}</span>
            <span>{formatTimestamp(entry.timestamp)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}