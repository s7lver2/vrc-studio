import { useT } from "@/i18n";

interface CreationProgressProps {
  progress: number;
  message: string;
  done: boolean;
  error: string | null;
  onClose: () => void;
}

export function CreationProgress({ progress, message, done, error, onClose }: CreationProgressProps) {
  const t = useT();
  const percent = Math.round(progress * 100);

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-zinc-100">
          {error ? t("creation_progress_error") : done ? t("creation_progress_done") : t("creation_progress_title")}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{error ?? message}</p>
      </div>

      {!done && !error && (
        <div className="w-full">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-red-600 transition-all duration-300" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-right text-xs text-zinc-600">{percent}%</p>
        </div>
      )}

      {done && !error && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-950 text-green-400 text-2xl">✓</div>
      )}

      {error && (
        <div className="w-full rounded-lg border border-red-900 bg-red-950/30 p-3">
          <p className="text-xs text-red-300 font-mono break-all">{error}</p>
        </div>
      )}

      {(done || error) && (
        <button onClick={onClose} className="rounded-md bg-zinc-700 px-6 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors">
          {t("creation_progress_close")}
        </button>
      )}
    </div>
  );
}