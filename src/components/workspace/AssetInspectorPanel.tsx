import { useState, useEffect } from "react";
import type { Project, InstalledVpmPackage, FileNode } from "@/lib/tauri";
import { tauriGetInstalledVpmPackages, tauriGetFileTree } from "@/lib/tauri";
import { Package, RefreshCw, FolderOpen } from "lucide-react";
import { useT } from "@/i18n";

interface Props {
  project: Project;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function calcDirSize(node: FileNode): number {
  if (!node.is_dir) return node.size ?? 0;
  return (node.children ?? []).reduce((acc, c) => acc + calcDirSize(c), 0);
}

export function AssetInspectorPanel({ project }: Props) {
  const t = useT();
  const [packages, setPackages] = useState<InstalledVpmPackage[]>([]);
  const [tree, setTree]         = useState<FileNode | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [pkgs, t] = await Promise.all([
        tauriGetInstalledVpmPackages(project.path).catch(() => [] as InstalledVpmPackage[]),
        tauriGetFileTree(project.path).catch(() => null),
      ]);
      setPackages(pkgs);
      setTree(t);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [project.id]);

  const folderSizes = tree?.children
    ?.filter((c) => c.is_dir)
    .map((c) => ({ name: c.name, size: calcDirSize(c) }))
    .sort((a, b) => b.size - a.size)
    ?? [];

  const totalSize   = folderSizes.reduce((acc, f) => acc + f.size, 0);
  const biggestSize = folderSizes[0]?.size ?? 1;

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6">
      {loading && <p className="text-xs text-zinc-500 animate-pulse">{t("ws_assets_analyzing")}</p>}
      {error   && <p className="text-xs text-red-400">{t("ws_assets_error", { error })}</p>}

      {!loading && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Package className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-200">{t("ws_assets_packages")}</h2>
            <span className="text-xs text-zinc-600">({packages.length})</span>
            <button onClick={load} className="ml-auto text-zinc-600 hover:text-zinc-400">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {packages.length === 0 ? (
            <p className="text-xs text-zinc-600">{t("ws_assets_packages_empty")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {packages.map((pkg) => (
                <div
                  key={pkg.name}
                  className="flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-200 truncate">{pkg.name}</p>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">v{pkg.version}</span>
                  {pkg.is_locked && (
                    <span className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">{t("ws_assets_locked")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && folderSizes.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-200">{t("ws_assets_folder_sizes")}</h2>
            <span className="text-xs text-zinc-600">{t("ws_assets_total_size", { size: formatBytes(totalSize) })}</span>
          </div>
          <div className="flex flex-col gap-2">
            {folderSizes.slice(0, 12).map((f) => (
              <div key={f.name} className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-zinc-400 w-36 truncate shrink-0">{f.name}/</span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-600/70 rounded-full"
                    style={{ width: `${(f.size / biggestSize) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-zinc-500 font-mono w-16 text-right shrink-0">
                  {formatBytes(f.size)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}