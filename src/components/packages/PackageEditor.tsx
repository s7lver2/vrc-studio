import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PackageAssetSelector } from "./PackageAssetSelector";
import { usePackages } from "@/hooks/usePackages";
import type { CustomPackage } from "@/lib/tauri";

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
  const { createPackage, updatePackage } = usePackages();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Inicializar formulario cuando se abre el editor
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
    if (!form.display_name.trim()) e.display_name = "Nombre requerido";
    if (!form.name.trim()) {
      e.name = "ID requerido";
    } else if (!/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(form.name)) {
      e.name = "Formato inválido (ej: com.user.mipaquete)";
    }
    if (!form.version.trim()) {
      e.version = "Versión requerida";
    } else if (!/^\d+\.\d+\.\d+$/.test(form.version)) {
      e.version = "Semver inválido (ej: 1.0.0)";
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
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            {editingPackage ? "Editar paquete" : "Nuevo paquete"}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-6 py-5">
          {/* Display name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">
              Nombre del paquete
            </label>
            <input
              value={form.display_name}
              onChange={(e) => patch("display_name", e.target.value)}
              placeholder="Mi Paquete"
              className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            {errors.display_name && (
              <p className="text-xs text-red-400">{errors.display_name}</p>
            )}
          </div>

          {/* Package ID */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">
              ID del paquete
            </label>
            <input
              value={form.name}
              onChange={(e) => patch("name", e.target.value.toLowerCase())}
              placeholder="com.miusuario.mipaquete"
              disabled={Boolean(editingPackage)}
              className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.name && (
              <p className="text-xs text-red-400">{errors.name}</p>
            )}
            {editingPackage && (
              <p className="text-xs text-zinc-600">
                El ID no puede cambiarse una vez creado el paquete.
              </p>
            )}
          </div>

          {/* Version */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">Versión</label>
            <input
              value={form.version}
              onChange={(e) => patch("version", e.target.value)}
              placeholder="1.0.0"
              className="w-36 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            {errors.version && (
              <p className="text-xs text-red-400">{errors.version}</p>
            )}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">
              Descripción
            </label>
            <textarea
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              placeholder="Describe qué incluye este paquete…"
              rows={3}
              className="resize-none rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          {/* Assets */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">
              Assets incluidos
            </label>
            <PackageAssetSelector
              selectedIds={form.asset_ids}
              onChange={(ids) => patch("asset_ids", ids)}
            />
          </div>

          {errors._global && (
            <p className="text-sm text-red-400">{errors._global}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-6 py-4">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {saving
              ? "Guardando…"
              : editingPackage
              ? "Guardar cambios"
              : "Crear paquete"}
          </button>
        </div>
      </div>
    </div>
  );
}