import { useDownloadProgress } from "../../hooks/useDownloadProgress";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useT } from "@/i18n";

export function DownloadProgress() {
  const t = useT();
  const { downloads } = useDownloadProgress();
  const active = Object.values(downloads);

  if (active.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-72">
      {active.map((d) => (
        <div
          key={d.item_id}
          className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400 truncate max-w-[180px]">
              {d.item_id}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {d.status === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : d.status === "error" ? (
                <XCircle className="h-3.5 w-3.5 text-red-400" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
              )}
              <span className="text-xs capitalize text-zinc-300">
                {d.status === "done"
                  ? t("shop_download_done")
                  : d.status === "error"
                  ? t("shop_download_error")
                  : d.status}
              </span>
            </div>
          </div>

          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                d.status === "done"
                  ? "bg-green-500"
                  : d.status === "error"
                  ? "bg-red-500"
                  : "bg-red-600"
              }`}
              style={{ width: `${Math.min(d.percentage, 100)}%` }}
            />
          </div>

          <span className="text-[10px] text-zinc-500 text-right">
            {d.percentage.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}