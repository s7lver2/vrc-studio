import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUpdateSettings, UpdateChannel } from "@/hooks/useUpdateSettings";
import { useUpdateChecker } from "@/hooks/useUpdateChecker";
import { useT } from "@/i18n";

interface AvailableVersion {
  version:       string;
  channel:       string;
  pub_date:      string;
  notes:         string;
  download_url:  string;
  download_size: number;
  is_current:    boolean;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

export function UpdateSettingsPanel() {
  const t = useT();
  const { settings, updateSettings } = useUpdateSettings();
  const { updateInfo, checking, installing, error, checkNow, installUpdate } =
    useUpdateChecker({ channel: settings.channel, autoDownload: settings.autoDownload });

  const [versions,          setVersions]          = useState<AvailableVersion[] | null>(null);
  const [loadingVersions,   setLoadingVersions]   = useState(false);
  const [versionsError,     setVersionsError]     = useState<string | null>(null);
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);

  const handleLoadVersions = useCallback(async () => {
    setLoadingVersions(true);
    setVersionsError(null);
    try {
      const result = await invoke<AvailableVersion[]>("list_available_versions", {
        channel: settings.channel,
      });
      setVersions(result);
    } catch (e) {
      setVersionsError(String(e));
    } finally {
      setLoadingVersions(false);
    }
  }, [settings.channel]);

  const handleChannelChange = useCallback((c: UpdateChannel) => {
    updateSettings({ channel: c });
    setVersions(null);
  }, [updateSettings]);

  const handleInstallVersion = useCallback(async (v: AvailableVersion) => {
    setInstallingVersion(v.version);
    setVersionsError(null);
    try {
      await invoke("download_and_install_update", {
        url:       v.download_url,
        signature: "",
        channel:   settings.channel,
      });
    } catch (e) {
      setVersionsError(String(e));
    } finally {
      setInstallingVersion(null);
    }
  }, [settings.channel]);

  // Metadatos de canal usando t() — se recalcula en cada render (correcto)
  const channelMeta: Record<UpdateChannel, { label: string; description: string; color: string }> = {
    stable:  {
      label:       t("updates_channel_stable_label"),
      description: t("updates_channel_stable_desc"),
      color:       "text-emerald-400",
    },
    testing: {
      label:       t("updates_channel_testing_label"),
      description: t("updates_channel_testing_desc"),
      color:       "text-amber-400",
    },
  };

  return (
    <div className="space-y-6 text-sm text-white/80">

      {/* ── Canal ── */}
      <section>
        <h3 className="font-semibold text-white mb-1">{t("updates_channel_title")}</h3>
        <p className="text-white/40 text-xs mb-3">{t("updates_channel_desc")}</p>
        <div className="flex gap-2">
          {(["stable", "testing"] as UpdateChannel[]).map((c) => {
            const meta   = channelMeta[c];
            const active = settings.channel === c;
            return (
              <button
                key={c}
                onClick={() => handleChannelChange(c)}
                className={[
                  "flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-violet-500 bg-violet-500/15"
                    : "border-white/10 bg-white/5 hover:bg-white/10",
                ].join(" ")}
              >
                <p className={`font-medium ${active ? meta.color : "text-white/60"}`}>
                  {meta.label}
                </p>
                <p className="text-white/40 text-xs mt-0.5">{meta.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Auto-descarga ── */}
      <section className="flex items-center justify-between rounded-lg border border-white/10
                          bg-white/5 px-4 py-3">
        <div>
          <p className="font-medium text-white">{t("updates_auto_download_label")}</p>
          <p className="text-white/40 text-xs mt-0.5">{t("updates_auto_download_desc")}</p>
        </div>
        <button
          role="switch"
          aria-checked={settings.autoDownload}
          onClick={() => updateSettings({ autoDownload: !settings.autoDownload })}
          className={[
            "relative w-10 h-6 rounded-full transition-colors shrink-0",
            settings.autoDownload ? "bg-violet-600" : "bg-white/20",
          ].join(" ")}
        >
          <span
            className={[
              "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
              settings.autoDownload ? "translate-x-4" : "translate-x-0",
            ].join(" ")}
          />
        </button>
      </section>

      {/* ── Buscar actualización ── */}
      <section>
        <h3 className="font-semibold text-white mb-3">{t("updates_check_title")}</h3>
        <button
          onClick={() => checkNow()}
          disabled={checking}
          className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60
                     text-white font-medium px-4 py-2 text-xs transition-colors"
        >
          {checking ? t("updates_checking") : t("updates_check_button")}
        </button>

        {error && (
          <p className="mt-2 text-red-400 text-xs">{error}</p>
        )}

        {updateInfo && (
          <div className="mt-3 rounded-lg border border-violet-500/40 bg-violet-500/10 p-3">
            <p className="font-medium text-white">
              {t("updates_new_version", { version: updateInfo.remote_version })}
              {updateInfo.download_size > 0 && (
                <span className="ml-2 text-white/50 font-normal text-xs">
                  {formatSize(updateInfo.download_size)}
                </span>
              )}
            </p>
            {updateInfo.notes && (
              <p className="text-white/60 text-xs mt-1 line-clamp-2">{updateInfo.notes}</p>
            )}
            <button
              onClick={installUpdate}
              disabled={installing}
              className="mt-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-60
                         text-white text-xs font-medium px-3 py-1.5 transition-colors"
            >
              {installing ? t("updates_installing") : t("updates_install_now")}
            </button>
          </div>
        )}

        {!checking && !updateInfo && !error && (
          <p className="mt-2 text-white/40 text-xs">
            {t("updates_up_to_date", { channel: channelMeta[settings.channel].label })}
          </p>
        )}
      </section>

      {/* ── Versiones disponibles ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-white">{t("updates_versions_title")}</h3>
            <p className="text-white/40 text-xs mt-0.5">{t("updates_versions_desc")}</p>
          </div>
          <button
            onClick={handleLoadVersions}
            disabled={loadingVersions}
            className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50
                       transition-colors shrink-0 ml-4"
          >
            {loadingVersions
              ? t("updates_versions_loading")
              : versions
              ? t("updates_versions_reload")
              : t("updates_versions_load")}
          </button>
        </div>

        {versionsError && (
          <p className="text-red-400 text-xs mb-2">{versionsError}</p>
        )}

        {versions && (
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {versions.length === 0 && (
              <p className="text-white/40 text-xs">
                {t("updates_versions_empty", { channel: channelMeta[settings.channel].label })}
              </p>
            )}
            {versions.map((v) => (
              <div
                key={v.version}
                className={[
                  "flex items-center justify-between rounded-lg px-3 py-2.5 border transition-colors",
                  v.is_current
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-white/8 bg-white/5",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <span className="font-medium text-white text-xs">v{v.version}</span>
                  {v.is_current && (
                    <span className="ml-2 text-emerald-400 text-[10px]">
                      {t("updates_versions_current")}
                    </span>
                  )}
                  <p className="text-white/40 text-[10px] mt-0.5 truncate">
                    {formatDate(v.pub_date)}
                    {v.download_size > 0 && ` · ${formatSize(v.download_size)}`}
                  </p>
                </div>
                {!v.is_current && (
                  <button
                    onClick={() => handleInstallVersion(v)}
                    disabled={installingVersion === v.version}
                    className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50
                               transition-colors ml-3 shrink-0"
                  >
                    {installingVersion === v.version
                      ? t("updates_installing")
                      : t("updates_versions_install")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}