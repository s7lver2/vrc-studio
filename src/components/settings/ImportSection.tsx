import { useState, useEffect } from "react";
import { ExternalLink, Loader2, Layers, Timer, X, Download, CheckCircle2 } from "lucide-react";
import { tauriGetAppSettings, tauriSetAppSettings, tauriReadVccRepos } from "@/lib/tauri";
import type { AppSettings } from "@/lib/tauri";
import { useT } from "@/i18n";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "relative flex-shrink-0 w-11 h-6 rounded-full border transition-all duration-200",
        value ? "bg-violet-600 border-violet-500/60" : "bg-zinc-800 border-zinc-700"
      )}
    >
      <span className={cn(
        "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200",
        value ? "left-[calc(100%-1.375rem)]" : "left-0.5"
      )} />
    </button>
  );
}

// Componente para añadir nueva URL VPM
function ImportVccButton({
  existing,
  onImport,
}: {
  existing: string[];
  onImport: (newUrls: string[]) => void;
}) {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "done" | "none">("idle");

  const handleImport = async () => {
    setState("loading");
    try {
      const discovered = await tauriReadVccRepos();
      const existingSet = new Set(existing);
      const newUrls = discovered.filter((u) => !existingSet.has(u));
      if (newUrls.length > 0) {
        onImport(newUrls);
        setState("done");
      } else {
        setState("none");
      }
    } catch (e) {
      console.error("Failed to read VCC/alcom repos:", e);
      setState("idle");
    }
    setTimeout(() => setState("idle"), 3000);
  };

  return (
    <button
      onClick={handleImport}
      disabled={state === "loading"}
      className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {state === "loading" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : state === "done" ? (
        <CheckCircle2 className="h-3 w-3 text-green-400" />
      ) : (
        <Download className="h-3 w-3" />
      )}
      {state === "done"
        ? t("import_sect_import_done")
        : state === "none"
        ? t("import_sect_import_none")
        : t("import_sect_import_alcom")}
    </button>
  );
}

function VpmSourceInput({ onAdd }: { onAdd: (url: string) => void }) {
  const t = useT();
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const isValid = trimmed.startsWith("http://") || trimmed.startsWith("https://");

  const submit = () => {
    if (!isValid) return;
    onAdd(trimmed);
    setValue("");
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={t("import_sect_url_placeholder")}
        className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none font-mono"
      />
      <button
        onClick={submit}
        disabled={!isValid}
        className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t("import_sect_add_url")}
      </button>
    </div>
  );
}

export function ImportSection() {
  const t = useT();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tauriGetAppSettings()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      await tauriSetAppSettings(next);
    } catch (e) {
      console.error("Failed to save settings:", e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-violet-950/60 border border-violet-900/50 p-2.5">
          <ExternalLink className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{t("import_sect_header_title")}</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{t("import_sect_header_desc")}</p>
        </div>
        {saving && <Loader2 className="h-3.5 w-3.5 text-zinc-600 animate-spin ml-auto" />}
      </div>

      {/* Card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">

        {/* Row 1: skip dialog */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-800/80">
          <div className="flex-1 pr-4">
            <p className="text-sm font-medium text-zinc-200">{t("import_sect_skip_dialog_label")}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {t("import_sect_skip_dialog_desc")}
            </p>
          </div>
          <Toggle
            value={settings?.unity_import_skip_dialog ?? false}
            onChange={(v) => update({ unity_import_skip_dialog: v })}
          />
        </div>

        {/* Row 2: sequential */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-800/80">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-zinc-200">{t("import_sect_sequential_label")}</p>
              <Layers className="h-3.5 w-3.5 text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {t("import_sect_sequential_desc")}
            </p>
          </div>
          <Toggle
            value={settings?.unity_import_sequential ?? true}
            onChange={(v) => update({ unity_import_sequential: v })}
          />
        </div>

        {/* Row 3: boot wait */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-800/80">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-zinc-200">{t("import_sect_boot_wait_label")}</p>
              <Timer className="h-3.5 w-3.5 text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {t("import_sect_boot_wait_desc")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="number"
              min={30}
              max={600}
              step={10}
              value={settings?.unity_boot_wait_secs ?? 180}
              onChange={(e) => {
                const v = Math.max(30, Math.min(600, Number(e.target.value)));
                update({ unity_boot_wait_secs: v });
              }}
              className="w-20 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono text-center px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-600 focus:border-violet-600 transition-colors"
            />
            <span className="text-xs text-zinc-500 whitespace-nowrap">{t("import_sect_boot_wait_unit")}</span>
          </div>
        </div>

        {/* Extra VPM sources */}
        <div className="border-t border-zinc-800/80">
          <div className="px-5 py-4 flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">{t("import_sect_vpm_sources_label")}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {t("import_sect_vpm_sources_desc")}
              </p>
            </div>

            {/* Lista de fuentes actuales */}
            <div className="flex flex-col gap-1.5">
              {(settings?.extra_vpm_sources ?? []).map((src, i) => (
                <div key={i} className="flex items-center gap-2">
                  <p className="flex-1 truncate font-mono text-xs text-zinc-400 bg-zinc-800 rounded px-2 py-1.5 border border-zinc-700">
                    {src}
                  </p>
                  <button
                    onClick={() => {
                      const next = [...(settings?.extra_vpm_sources ?? [])];
                      next.splice(i, 1);
                      update({ extra_vpm_sources: next });
                    }}
                    className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                    title={t("import_sect_remove_source")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Importar desde alcom / VCC */}
            <div className="flex items-center gap-3">
              <ImportVccButton
                existing={settings?.extra_vpm_sources ?? []}
                onImport={(newUrls) =>
                  update({
                    extra_vpm_sources: [...(settings?.extra_vpm_sources ?? []), ...newUrls],
                  })
                }
              />
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                {t("import_sect_alcom_hint")}
              </p>
            </div>

            {/* Input para añadir nueva fuente */}
            <VpmSourceInput
              onAdd={(url) =>
                update({
                  extra_vpm_sources: [...(settings?.extra_vpm_sources ?? []), url],
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}