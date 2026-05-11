import { useUpdateChecker } from "@/hooks/useUpdateChecker";
import { useUpdateSettings } from "@/hooks/useUpdateSettings";
import { useT } from "@/i18n";

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateDialog() {
  const t = useT();
  const { settings }                                        = useUpdateSettings();
  const { updateInfo, installing, dismiss, installUpdate }  = useUpdateChecker({
    channel:      settings.channel,
    autoDownload: settings.autoDownload,
  });

  if (!updateInfo) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-white/10
                 bg-[#1a1a2e]/95 shadow-2xl backdrop-blur-sm p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="font-semibold text-white">
            {t("updates_dialog_title", { version: updateInfo.remote_version })}
          </p>
          <p className="text-white/50 text-xs mt-0.5">
            {t("updates_dialog_current", { version: updateInfo.current_version })}
            {updateInfo.download_size > 0 && (
              <> · {formatSize(updateInfo.download_size)}</>
            )}
            <span className="ml-1.5 rounded px-1 py-0.5 bg-white/10 text-white/40 text-[10px] uppercase tracking-wide">
              {settings.channel}
            </span>
          </p>
        </div>
        <button
          onClick={dismiss}
          className="text-white/40 hover:text-white/80 transition-colors text-lg leading-none mt-0.5"
          aria-label={t("updates_dialog_close")}
        >
          ×
        </button>
      </div>

      {updateInfo.notes && (
        <p className="text-white/70 text-xs mb-3 line-clamp-3">{updateInfo.notes}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={installUpdate}
          disabled={installing}
          className="flex-1 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60
                     text-white font-medium py-1.5 text-xs transition-colors"
        >
          {installing ? t("updates_installing") : t("updates_dialog_update")}
        </button>
        <button
          onClick={dismiss}
          className="flex-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/70
                     font-medium py-1.5 text-xs transition-colors"
        >
          {t("updates_dialog_later")}
        </button>
      </div>
    </div>
  );
}