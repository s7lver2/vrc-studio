import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PackageAssetSelector } from "./PackageAssetSelector";
import { usePackages } from "@/hooks/usePackages";
import type { CustomPackage } from "@/lib/tauri";
import { useT } from "@/i18n";

interface PackageEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPackage: CustomPackage | null;
}

const EMPTY_FORM = {
  name: "",
  display_name: "",
  version: "1.0.0",
  description: "",
  asset_ids: [] as string[],
};

type FormState = typeof EMPTY_FORM;

export function PackageEditor({ open, onOpenChange, editingPackage }: PackageEditorProps) {
  const t = useT();
  const { createPackage, updatePackage } = usePackages();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (editingPackage) {
        setForm({
          name: editingPackage.name,
          display_name: editingPackage.display_name,
          version: editingPackage.version,
          description: editingPackage.description ?? "",
          asset_ids: editingPackage.asset_ids,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setErrors({});
    }
  }, [open, editingPackage]);

  const patch = (field: keyof FormState, value: string | string[]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!form.display_name.trim()) e.display_name = t("pkg_editor_name_required");
    if (!form.name.trim()) {
      e.name = t("pkg_editor_id_required");
    } else if (!/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(form.name)) {
      e.name = t("pkg_editor_id_invalid");
    }
    if (!form.version.trim()) {
      e.version = t("pkg_editor_version_required");
    } else if (!/^\d+\.\d+\.\d+$/.test(form.version)) {
      e.version = t("pkg_editor_version_invalid");
    }
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setSaving(true);
    try {
      if (editingPackage) {
        await updatePackage(editingPackage.id, form);
      } else {
        await createPackage(form);
      }
      onOpenChange(false);
    } catch (err) {
      setErrors({ _global: String(err) });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            {editingPackage ? t("pkg_editor_title_edit") : t("pkg_editor_title_new")}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">{t("pkg_editor_name_label")}</label>
            <input
              value={form.display_name}
              onChange={(e) => patch("display_name", e.target.value)}
              placeholder={t("create_project_name_placeholder")}
              className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            {errors.display_name && <p className="text-xs text-red-400">{errors.display_name}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">{t("pkg_editor_id_label")}</label>
            <input
              value={form.name}
              onChange={(e) => patch("name", e.target.value.toLowerCase())}
              placeholder="com.miusuario.mipaquete"
              disabled={Boolean(editingPackage)}
              className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.name && <p className="text-xs text-red-400">{errors.name}</p>}
            {editingPackage && (
              <p className="text-xs text-zinc-600">{t("pkg_editor_id_readonly")}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">{t("pkg_editor_version_label")}</label>
            <input
              value={form.version}
              onChange={(e) => patch("version", e.target.value)}
              placeholder="1.0.0"
              className="w-36 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            {errors.version && <p className="text-xs text-red-400">{errors.version}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">{t("pkg_editor_description_label")}</label>
            <textarea
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              placeholder={t("project_detail_section_details")}
              rows={3}
              className="resize-none rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">{t("pkg_editor_assets_label")}</label>
            <PackageAssetSelector
              selectedIds={form.asset_ids}
              onChange={(ids) => patch("asset_ids", ids)}
            />
          </div>

          {errors._global && <p className="text-sm text-red-400">{errors._global}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-6 py-4">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            {t("pkg_editor_cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {saving
              ? t("pkg_editor_saving")
              : editingPackage
              ? t("pkg_editor_save_changes")
              : t("pkg_editor_create_package")}
          </button>
        </div>
      </div>
    </div>
  );
}