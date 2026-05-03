import { Package, Trash2, Edit, Hammer, FolderOpen } from "lucide-react";
import type { CustomPackage } from "@/lib/tauri";

interface PackageCardProps {
  pkg: CustomPackage;
  onEdit: (pkg: CustomPackage) => void;
  onDelete: (pkg: CustomPackage) => void;
  onBuild: (pkg: CustomPackage) => void;
  onOpenFolder: (pkg: CustomPackage) => void;
  isBuilding?: boolean;
}

export function PackageCard({
  pkg,
  onEdit,
  onDelete,
  onBuild,
  onOpenFolder,
  isBuilding,
}: PackageCardProps) {
  const isBuilt = Boolean(pkg.zip_path);

  return (
    <div className="group relative flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Package size={16} className="mt-0.5 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-zinc-100">
            {pkg.display_name}
          </h3>
          <p className="truncate text-[10px] text-zinc-600">{pkg.name}</p>
        </div>
        {/* Status badge */}
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            isBuilt
              ? "bg-emerald-950 text-emerald-400"
              : "bg-zinc-800 text-zinc-500"
          }`}
        >
          {isBuilt ? "Built" : "Draft"}
        </span>
      </div>

      {/* Meta */}
      <p className="text-xs text-zinc-500">
        v{pkg.version} · {pkg.asset_ids.length} asset
        {pkg.asset_ids.length !== 1 ? "s" : ""}
      </p>

      {pkg.description && (
        <p className="line-clamp-2 text-xs text-zinc-400">{pkg.description}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 border-t border-zinc-800 pt-3">
        <button
          title="Editar"
          onClick={() => onEdit(pkg)}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          <Edit size={13} />
        </button>

        <button
          title="Generar ZIP"
          onClick={() => onBuild(pkg)}
          disabled={isBuilding}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-40"
        >
          <Hammer size={13} />
        </button>

        {isBuilt && (
          <button
            title="Abrir carpeta"
            onClick={() => onOpenFolder(pkg)}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <FolderOpen size={13} />
          </button>
        )}

        <button
          title="Eliminar"
          onClick={() => onDelete(pkg)}
          className="ml-auto rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}