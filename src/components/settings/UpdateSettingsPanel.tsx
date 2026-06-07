import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUpdateSettings, UpdateChannel, isBetaChannel } from "@/hooks/useUpdateSettings";
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

interface BetaSubscription {
  slug:          string;
  name:          string;
  description:   string;
  code:          string;
  subscribed_at: string;
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
    useUpdateChecker({
      channel:      settings.channel,
      autoDownload: settings.autoDownload,
      betaBuild:    settings.betaBuild,
    });

  const [versions,          setVersions]          = useState<AvailableVersion[] | null>(null);
  const [loadingVersions,   setLoadingVersions]   = useState(false);
  const [versionsError,     setVersionsError]     = useState<string | null>(null);
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);

  // ── Beta state ──────────────────────────────────────────────────────────────
  const [betaSubs,      setBetaSubs]      = useState<BetaSubscription[]>([]);
  const [betaCode,      setBetaCode]      = useState("");
  const [redeemingBeta, setRedeemingBeta] = useState(false);
  const [betaError,     setBetaError]     = useState<string | null>(null);

  const loadBetaSubs = useCallback(async () => {
    try {
      const subs = await invoke<BetaSubscription[]>("list_beta_subscriptions");
      setBetaSubs(subs);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadBetaSubs(); }, [loadBetaSubs]);

  const handleRedeemBeta = useCallback(async () => {
    if (!betaCode.trim()) return;
    setRedeemingBeta(true);
    setBetaError(null);
    try {
      const sub = await invoke<BetaSubscription>("redeem_beta_code", { code: betaCode.trim() });
      setBetaSubs((prev) => {
        const filtered = prev.filter((s) => s.slug !== sub.slug);
        return [sub, ...filtered];
      });
      setBetaCode("");
    } catch (e) {
      setBetaError(t("updates_beta_invalid"));
      void e;
    } finally {
      setRedeemingBeta(false);
    }
  }, [betaCode, t]);

  const handleSelectBeta = useCallback((slug: string) => {
    updateSettings({ channel: slug, betaBuild: 0 });
    setVersions(null);
  }, [updateSettings]);

  const handleLeaveBeta = useCallback(async (slug: string) => {
    try {
      await invoke("remove_beta_subscription", { slug });
      setBetaSubs((prev) => prev.filter((s) => s.slug !== slug));
    } catch { /* ignore */ }
    if (settings.channel === slug) {
      updateSettings({ channel: "stable", betaBuild: undefined });
    }
  }, [settings.channel, updateSettings]);

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
    updateSettings({ channel: c, betaBuild: undefined });
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

  const onBetaChannel = isBetaChannel(settings.channel);

  const channelMeta: Record<string, { label: string; description: string; color: string }> = {
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

  const currentChannelLabel = onBetaChannel
    ? (betaSubs.find((s) => s.slug === settings.channel)?.name ?? settings.channel)
    : (channelMeta[settings.channel]?.label ?? settings.channel);

  return (
    <div className="space-y-6 text-sm text-white/80">

      {/* ── Canal ── */}
      <section>
        <h3 className="font-semibold text-white mb-1">{t("updates_channel_title")}</h3>
        <p className="text-white/40 text-xs mb-3">{t("updates_channel_desc")}</p>
        <div className="flex gap-2">
          {(["stable", "testing"] as UpdateChannel[]).map((c) => {
            const meta   = channelMeta[c];
            const active = !onBetaChannel && settings.channel === c;
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

        {/* Active beta banner */}
        {onBetaChannel && (
          <div className="mt-2 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2
                          flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-purple-300 font-medium">
                {t("updates_beta_active_label")}{" "}
                <span className="text-white">
                  {betaSubs.find((s) => s.slug === settings.channel)?.name ?? settings.channel}
                </span>
              </p>
              {settings.betaBuild !== undefined && (
                <p className="text-[10px] text-purple-400/70 mt-0.5">
                  Build #{settings.betaBuild}
                </p>
              )}
            </div>
            <button
              onClick={() => handleChannelChange("stable")}
              className="text-[10px] text-purple-400 hover:text-purple-300 shrink-0 transition-colors"
            >
              → Stable
            </button>
          </div>
        )}
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
              {onBetaChannel
                ? `Build #${updateInfo.remote_version} disponible`
                : t("updates_new_version", { version: updateInfo.remote_version })}
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
            {t("updates_up_to_date", { channel: currentChannelLabel })}
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
                {t("updates_versions_empty", { channel: currentChannelLabel })}
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
                  <span className="font-medium text-white text-xs">
                    {onBetaChannel ? `Build #${v.version}` : `v${v.version}`}
                  </span>
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

      {/* ── Betas privadas ── */}
      <section>
        <h3 className="font-semibold text-white mb-1">{t("updates_beta_title")}</h3>
        <p className="text-white/40 text-xs mb-3">{t("updates_beta_desc")}</p>

        {/* Code input */}
        <div className="flex gap-2 mb-4">
          <input
            value={betaCode}
            onChange={(e) => { setBetaCode(e.target.value); setBetaError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleRedeemBeta()}
            placeholder={t("updates_beta_code_placeholder")}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2
                       text-xs text-white placeholder-white/30 focus:outline-none
                       focus:border-purple-500/60 transition-colors"
          />
          <button
            onClick={handleRedeemBeta}
            disabled={redeemingBeta || !betaCode.trim()}
            className="rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50
                       text-white font-medium px-4 py-2 text-xs transition-colors shrink-0"
          >
            {redeemingBeta ? t("updates_beta_redeeming") : t("updates_beta_redeem")}
          </button>
        </div>

        {betaError && (
          <p className="text-red-400 text-xs mb-3">{betaError}</p>
        )}

        {/* Subscribed betas list */}
        {betaSubs.length === 0 ? (
          <p className="text-white/30 text-xs">{t("updates_beta_subscriptions_empty")}</p>
        ) : (
          <div className="space-y-2">
            {betaSubs.map((sub) => {
              const isActive = settings.channel === sub.slug;
              return (
                <div
                  key={sub.slug}
                  className={[
                    "rounded-lg border px-3 py-2.5 transition-colors",
                    isActive
                      ? "border-purple-500/50 bg-purple-500/10"
                      : "border-white/10 bg-white/5",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`font-medium text-xs ${isActive ? "text-purple-300" : "text-white"}`}>
                        {sub.name}
                        {isActive && (
                          <span className="ml-2 text-[10px] text-purple-400 font-normal">
                            ● activa
                          </span>
                        )}
                      </p>
                      {sub.description && (
                        <p className="text-white/40 text-[10px] mt-0.5 line-clamp-2">
                          {sub.description}
                        </p>
                      )}
                      <p className="text-white/20 text-[10px] mt-1 font-mono">
                        {sub.slug}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 items-end shrink-0">
                      {!isActive ? (
                        <button
                          onClick={() => handleSelectBeta(sub.slug)}
                          className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors whitespace-nowrap"
                        >
                          Cambiar a esta →
                        </button>
                      ) : (
                        <button
                          onClick={() => handleChannelChange("stable")}
                          className="text-[10px] text-white/40 hover:text-white/60 transition-colors whitespace-nowrap"
                        >
                          → Volver a Stable
                        </button>
                      )}
                      <button
                        onClick={() => handleLeaveBeta(sub.slug)}
                        className="text-[10px] text-red-400/50 hover:text-red-400 transition-colors whitespace-nowrap"
                      >
                        {t("updates_beta_leave")}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-3 text-white/20 text-[10px] leading-relaxed">
          {t("updates_beta_warning")}
        </p>
      </section>
    </div>
  );
}
