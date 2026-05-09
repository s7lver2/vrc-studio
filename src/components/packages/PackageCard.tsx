import { Package, Trash2, Edit, Hammer, FolderOpen, CheckCircle2, Clock } from "lucide-react";
import type { CustomPackage } from "@/lib/tauri";
import { useT } from "@/i18n";

interface PackageCardProps {
  pkg: CustomPackage;
  onEdit: (pkg: CustomPackage) => void;
  onDelete: (pkg: CustomPackage) => void;
  onBuild: (pkg: CustomPackage) => void;
  onOpenFolder: (pkg: CustomPackage) => void;
  isBuilding?: boolean;
}

export function PackageCard({
  pkg, onEdit, onDelete, onBuild, onOpenFolder, isBuilding,
}: PackageCardProps) {
  const t = useT();
  const isBuilt = Boolean(pkg.zip_path);

  return (
    <div className="group relative flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden hover:border-zinc-700 transition-all duration-200 hover:shadow-lg hover:shadow-black/30">
      <div className={`h-0.5 w-full ${isBuilt ? "bg-gradient-to-r from-emerald-500/80 via-emerald-400/40 to-transparent" : "bg-gradient-to-r from-zinc-700/80 to-transparent"}`} />

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 rounded-lg p-2 ${isBuilt ? "bg-emerald-950/60 border border-emerald-900/40" : "bg-zinc-800 border border-zinc-700/50"}`}>
            <Package size={14} className={isBuilt ? "text-emerald-400" : "text-zinc-500"} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-zinc-100 leading-tight">{pkg.display_name}</h3>
            <p className="truncate text-[10px] text-zinc-600 font-mono mt-0.5">{pkg.name}</p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
              isBuilt
                ? "bg-emerald-950/80 text-emerald-400 border border-emerald-900/40"
                : "bg-zinc-800/80 text-zinc-500 border border-zinc-700/50"
            }`}
          >
            {isBuilt ? <CheckCircle2 size={9} /> : <Clock size={9} />}
            {isBuilt ? t("pkg_card_built") : t("pkg_card_draft")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-zinc-800/60 border border-zinc-700/40 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
            {t("pkg_card_version", { version: pkg.version })}
          </span>
          <span className="text-[10px] text-zinc-600">
            {t("pkg_card_assets", { count: pkg.asset_ids.length, s: pkg.asset_ids.length !== 1 ? "s" : "" })}
          </span>
        </div>

        {pkg.description && (
          <p className="line-clamp-2 text-xs text-zinc-500 leading-relaxed">{pkg.description}</p>
        )}
      </div>

      <div className="mx-4 h-px bg-zinc-800/60" />

      <div className="flex items-center gap-1 px-3 py-2.5">
        <button
          title={t("pkg_card_edit")}
          onClick={() => onEdit(pkg)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          <Edit size={12} />
          {t("pkg_card_edit")}
        </button>

        <button
          title={t("pkg_card_build")}
          onClick={() => onBuild(pkg)}
          disabled={isBuilding}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Hammer size={12} className={isBuilding ? "animate-pulse" : ""} />
          {isBuilding ? t("pkg_card_building") : t("pkg_card_build")}
        </button>

        {isBuilt && (
          <button
            title={t("pkg_card_open")}
            onClick={() => onOpenFolder(pkg)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <FolderOpen size={12} />
            {t("pkg_card_open")}
          </button>
        )}

        <button
          title={t("pkg_card_delete")}
          onClick={() => onDelete(pkg)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-red-950/40 hover:text-red-400 transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}