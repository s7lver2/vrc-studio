// src/components/inventory/MigrationWizard.tsx
import { useState } from "react";
import { X, CheckSquare, Square, ChevronRight, Loader2, ShieldCheck, PackagePlus } from "lucide-react";
import { appDataDir } from "@tauri-apps/api/path";
import {
  tauriCreateMigrationBackup,
  tauriCreateContainerZip,
  tauriImportMultiAvatarPackage,
  tauriDeleteInventoryItem,
} from "../../lib/tauri";
import { detectAvatarVariants } from "./ImportLocalDialog";
import { useInventoryStore } from "../../store/inventoryStore";
import type { InventoryItem } from "../../lib/tauri";
import { useT } from "@/i18n";

type Step = "backup" | "select" | "configure" | "done";

interface VariantConfig {
  item: InventoryItem;
  label: string;
  isMaterials: boolean;
}

interface GroupConfig {
  name: string;
  author: string;
  variants: VariantConfig[];
}

interface Props {
  onClose: () => void;
}

export function MigrationWizard({ onClose }: Props) {
  const t = useT();
  const { items, fetchAll } = useInventoryStore();
  const [step, setStep] = useState<Step>("backup");
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  // select step
  const [migratedIds, setMigratedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // configure step
  const [groupConfig, setGroupConfig] = useState<GroupConfig>({ name: "", author: "", variants: [] });
  const [configError, setConfigError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // done step
  const [groupCount, setGroupCount] = useState(0);

  const availableItems = items.filter(
    (i) => !migratedIds.has(i.id) && !i.is_multi_avatar
  );

  // ── Step: backup ────────────────────────────────────────────────
  const handleBackup = async () => {
    setBackupLoading(true);
    setBackupError(null);
    try {
      const path = await tauriCreateMigrationBackup();
      setBackupPath(path);
      setStep("select");
    } catch (e) {
      setBackupError(String(e));
    } finally {
      setBackupLoading(false);
    }
  };

  // ── Step: select ────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleProceedToConfig = () => {
    if (selectedIds.size < 2) return;
    const selected = availableItems.filter((i) => selectedIds.has(i.id));

    // Try to detect common prefix / name from first item
    const firstName = selected[0].name ?? "";
    const detected = detectAvatarVariants(firstName + ".zip");
    const commonName = detected?.productName ?? firstName;

    const variants: VariantConfig[] = selected.map((item) => {
      const det = detectAvatarVariants((item.name ?? "") + ".zip");
      return {
        item,
        label: det?.variants?.[0]?.avatarName ?? item.name ?? item.id,
        isMaterials: det?.variants?.[0]?.isMaterials ?? false,
      };
    });

    setGroupConfig({ name: commonName, author: selected[0].author ?? "", variants });
    setConfigError(null);
    setStep("configure");
  };

  // ── Step: configure ─────────────────────────────────────────────
  const updateVariant = (idx: number, partial: Partial<VariantConfig>) => {
    setGroupConfig((prev) => {
      const variants = [...prev.variants];
      variants[idx] = { ...variants[idx], ...partial };
      return { ...prev, variants };
    });
  };

  const handleImport = async () => {
    if (!groupConfig.name.trim()) {
      setConfigError(t("migration_wizard_pkg_name_required"));
      return;
    }
    if (groupConfig.variants.some((v) => !v.label.trim())) {
      setConfigError(t("migration_wizard_labels_required"));
      return;
    }
    setConfigError(null);
    setImporting(true);
    try {
      // Build container zip
      const dataDir = await appDataDir();
      const outputPath = `${dataDir}inventory/${Date.now()}_container.zip`;
      const sourcePaths = groupConfig.variants.map((v) => v.item.local_path);
      await tauriCreateContainerZip(sourcePaths, outputPath);

      // Build variant args — sub_zip_name is the basename of local_path
      const variantArgs = groupConfig.variants.map((v) => ({
        label: v.label.trim(),
        is_materials: v.isMaterials,
        sub_zip_name: v.item.local_path.split(/[\\/]/).pop() ?? v.item.local_path,
      }));

      await tauriImportMultiAvatarPackage({
        zip_path: outputPath,
        name: groupConfig.name.trim(),
        author: groupConfig.author.trim() || undefined,
        product_images: [],
        variants: variantArgs,
      });

      // Remove original items (inventory only — files are now inside container)
      for (const v of groupConfig.variants) {
        await tauriDeleteInventoryItem(v.item.id, "InventoryOnly");
      }

      // Track migrated
      setMigratedIds((prev) => {
        const next = new Set(prev);
        groupConfig.variants.forEach((v) => next.add(v.item.id));
        return next;
      });
      setSelectedIds(new Set());

      await fetchAll();

      setGroupCount((c) => c + 1);
      setStep("done");
    } catch (e) {
      setConfigError(String(e));
    } finally {
      setImporting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-semibold text-zinc-100">{t("migration_wizard_title")}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-900/60 text-violet-300 border border-violet-700/50 font-bold tracking-wide uppercase">
              {t("migration_wizard_beta")}
            </span>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-6 pt-4">
          {(["backup", "select", "configure", "done"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                step === s
                  ? "bg-violet-500"
                  : ["backup", "select", "configure", "done"].indexOf(step) > i
                  ? "bg-violet-800"
                  : "bg-zinc-800"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">

          {/* ── Backup ── */}
          {step === "backup" && (
            <>
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-8 w-8 text-violet-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{t("migration_wizard_backup_heading")}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {t("migration_wizard_backup_desc")}
                  </p>
                </div>
              </div>
              {backupPath && (
                <p className="text-xs text-green-400 break-all">{t("migration_wizard_backup_saved")} {backupPath}</p>
              )}
              {backupError && (
                <p className="text-xs text-red-400">{backupError}</p>
              )}
              <button
                onClick={handleBackup}
                disabled={backupLoading}
                className="mt-2 w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {backupLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {backupLoading ? t("migration_wizard_backup_creating") : t("migration_wizard_backup_create")}
              </button>
            </>
          )}

          {/* ── Select ── */}
          {step === "select" && (
            <>
              <p className="text-xs text-zinc-400">
                {t("migration_wizard_select_hint")}
              </p>
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {availableItems.length === 0 && (
                  <p className="text-xs text-zinc-500 text-center py-6">{t("migration_wizard_no_items")}</p>
                )}
                {availableItems.map((item) => {
                  const checked = selectedIds.has(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggleSelect(item.id)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
                        checked ? "bg-violet-900/40 border border-violet-700/50" : "bg-zinc-800/60 border border-transparent hover:bg-zinc-800"
                      }`}
                    >
                      {checked ? (
                        <CheckSquare className="h-4 w-4 text-violet-400 shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-zinc-600 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-200 truncate">{item.name ?? item.id}</p>
                        {item.author && (
                          <p className="text-[10px] text-zinc-500 truncate">{item.author}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleProceedToConfig}
                  disabled={selectedIds.size < 2}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                >
                  {t("migration_wizard_configure_group")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}

          {/* ── Configure ── */}
          {step === "configure" && (
            <>
              <p className="text-xs text-zinc-400">{t("migration_wizard_configure_hint")}</p>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">{t("migration_wizard_package_name_label")}</label>
                  <input
                    type="text"
                    value={groupConfig.name}
                    onChange={(e) => setGroupConfig((p) => ({ ...p, name: e.target.value }))}
                    className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 outline-none focus:border-violet-500"
                    placeholder={t("migration_wizard_package_name_placeholder")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">{t("migration_wizard_author_label")}</label>
                  <input
                    type="text"
                    value={groupConfig.author}
                    onChange={(e) => setGroupConfig((p) => ({ ...p, author: e.target.value }))}
                    className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 outline-none focus:border-violet-500"
                    placeholder={t("migration_wizard_author_placeholder")}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">{t("migration_wizard_variants_label")}</p>
                {groupConfig.variants.map((v, idx) => (
                  <div key={v.item.id} className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-zinc-500 truncate mb-1">{v.item.name ?? v.item.id}</p>
                      <input
                        type="text"
                        value={v.label}
                        onChange={(e) => updateVariant(idx, { label: e.target.value })}
                        className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-100 outline-none focus:border-violet-500"
                        placeholder={t("migration_wizard_variant_placeholder")}
                      />
                    </div>
                    <button
                      onClick={() => updateVariant(idx, { isMaterials: !v.isMaterials })}
                      className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                        v.isMaterials
                          ? "bg-amber-900/40 border-amber-700/50 text-amber-300"
                          : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {t("migration_wizard_mat_button")}
                    </button>
                  </div>
                ))}
              </div>

              {configError && (
                <p className="text-xs text-red-400 mt-1">{configError}</p>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                >
                  {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {importing ? t("migration_wizard_importing") : t("migration_wizard_create_package")}
                </button>
              </div>
            </>
          )}

          {/* ── Done ── */}
          {step === "done" && (
            <>
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="h-12 w-12 rounded-full bg-violet-900/40 border border-violet-700/50 flex items-center justify-center">
                  <PackagePlus className="h-6 w-6 text-violet-400" />
                </div>
                <p className="text-sm font-semibold text-zinc-100">
                  {t("migration_wizard_done_groups")
                    .replace("{count}", String(groupCount))
                    .replace("{s}", groupCount !== 1 ? "s" : "")}
                </p>
                <p className="text-xs text-zinc-400">
                  {t("migration_wizard_done_desc")}
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setStep("select")}
                  className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs font-medium transition-colors"
                >
                  {t("migration_wizard_add_another")}
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors"
                >
                  {t("migration_wizard_finish")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
