/**
 * PackagesTab — VPM package manager for an existing Unity project.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Package, Download, Trash2, RefreshCw, Search,
  CheckCircle2, AlertTriangle, Loader2, ChevronDown,
  Sparkles, Star,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  Project, VpmPackage, VpmPackageVersion,
  InstalledVpmPackage, PkgProgress,
  tauriGetInstalledVpmPackages,
  tauriFetchVpmIndex,
  tauriInstallVpmPackageToProject,
  tauriRemoveVpmPackageFromProject,
} from "@/lib/tauri";
import { useT } from "@/i18n";

// ── helpers ───────────────────────────────────────────────────────────────────

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

function sortedVersions(pkg: VpmPackage): string[] {
  return Object.keys(pkg.versions).sort((a, b) => {
    const parse = (v: string) => v.split(".").map(Number);
    const pa = parse(a), pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

// ── Recommendation engine ─────────────────────────────────────────────────────

interface Recommendation {
  packageId: string;
  label: string;
  reason: string;
  priority: number;
}

function getRecommendations(project: Project, index: VpmPackage[]): Recommendation[] {
  const available = new Set(index.map((p) => p.id));
  const recs: Recommendation[] = [];
  const add = (id: string, label: string, reason: string, priority: number) => {
    if (available.has(id)) recs.push({ packageId: id, label, reason, priority });
  };
  add("com.vrchat.avatars", "VRChat SDK – Avatars", "Required for avatar uploads", 100);
  add("com.vrchat.base", "VRChat SDK – Base", "Core VRChat runtime", 90);
  add("com.vrchat.worlds", "VRChat SDK – Worlds", "Required for world uploads", 80);
  add("com.vrchat.udonsharp", "UdonSharp", "Write Udon scripts in C#", 70);
  add("com.vrchat.clientsim", "ClientSim", "Simulate VRChat in the editor", 60);
  if (project.shader === "liltoon") {
    add("jp.lilxyzw.liltoon", "lilToon", "Your project uses lilToon shader", 95);
  }
  if (project.shader === "poiyomi") {
    add("com.poiyomi.toon", "Poiyomi Toon", "Your project uses Poiyomi shader", 95);
  }
  if (project.vcs_enabled) {
    add("com.vrchat.vrcfury", "VRCFury", "Non-destructive avatar tools", 55);
  }
  return recs.sort((a, b) => b.priority - a.priority);
}

// ── Sub-tab bar ───────────────────────────────────────────────────────────────

type SubTab = "installed" | "browse";

function SubTabBar({ active, onChange }: { active: SubTab; onChange: (t: SubTab) => void }) {
  const t = useT();
  const tabs: { id: SubTab; label: string }[] = [
    { id: "installed", label: t("packages_tab_installed") },
    { id: "browse", label: t("packages_tab_browse") },
  ];
  return (
    <div className="flex items-center gap-0.5 px-1 py-1 border-b border-zinc-800/60 bg-zinc-900/40">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "px-3 py-1 rounded text-xs font-medium transition-colors",
            active === t.id
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function InstallProgress({ progress, step }: { progress: number; step: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] text-zinc-400 truncate">{step}</p>
      <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full bg-red-500 rounded-full transition-all duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

// ── Installed tab ─────────────────────────────────────────────────────────────

function InstalledTab({
  project,
  installed,
  loading,
  onReload,
  removing,
  onRemove,
}: {
  project: Project;
  installed: InstalledVpmPackage[];
  loading: boolean;
  onReload: () => void;
  removing: Set<string>;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
      </div>
    );
  }

  const direct = installed.filter((p) => !p.is_locked);
  const transitive = installed.filter((p) => p.is_locked);

  if (installed.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <Package className="h-8 w-8 text-zinc-700" />
        <p className="text-xs text-zinc-500">{t("packages_tab_no_packages")}</p>
        <p className="text-[10px] text-zinc-700">
          {t("packages_tab_no_packages_hint")}
        </p>
      </div>
    );
  }

  const PackageRow = ({ pkg }: { pkg: InstalledVpmPackage }) => {
    const isRemoving = removing.has(pkg.name);
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/40 group transition-colors">
        <Package className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-zinc-200 truncate">{pkg.name}</p>
          <p className="text-[10px] text-zinc-500 font-mono">{pkg.version}</p>
        </div>
        {!pkg.is_locked && (
          <button
            onClick={() => onRemove(pkg.name)}
            disabled={isRemoving}
            title={t("packages_tab_remove_package")}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 disabled:opacity-30"
          >
            {isRemoving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
      {direct.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-1.5 px-1">
            {t("packages_tab_direct")} ({direct.length})
          </p>
          <div className="flex flex-col gap-0.5">
            {direct.map((p) => <PackageRow key={p.name} pkg={p} />)}
          </div>
        </div>
      )}
      {transitive.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-1.5 px-1">
            {t("packages_tab_dependencies")} ({transitive.length})
          </p>
          <div className="flex flex-col gap-0.5">
            {transitive.map((p) => <PackageRow key={p.name} pkg={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Browse tab ────────────────────────────────────────────────────────────────

function BrowseTab({
  project,
  index,
  loadingIndex,
  indexError,
  onReloadIndex,
  installed,
  installing,
  onInstall,
}: {
  project: Project;
  index: VpmPackage[];
  loadingIndex: boolean;
  indexError: string | null;
  onReloadIndex: () => void;
  installed: InstalledVpmPackage[];
  installing: Record<string, { step: string; progress: number; error: string | null }>;
  onInstall: (packageId: string, version: string) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [expandedDesc, setExpandedDesc] = useState<Record<string, boolean>>({});

  const installedIds = useMemo(() => new Set(installed.map((p) => p.name)), [installed]);

  const recommendations = useMemo(
    () => getRecommendations(project, index),
    [project, index]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return index;
    const q = search.toLowerCase();
    return index.filter((p) => {
      const latest = p.versions[sortedVersions(p)[0]];
      return (
        p.id.toLowerCase().includes(q) ||
        latest?.display_name?.toLowerCase().includes(q) ||
        latest?.description?.toLowerCase().includes(q)
      );
    });
  }, [index, search]);

  const getSelectedVersion = (pkg: VpmPackage) =>
    selectedVersions[pkg.id] ?? sortedVersions(pkg)[0];

  if (loadingIndex) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        <p className="text-xs text-zinc-600">{t("packages_tab_fetching_index")}</p>
      </div>
    );
  }

  if (indexError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <AlertTriangle className="h-6 w-6 text-red-500" />
        <p className="text-xs text-zinc-400 font-medium">{t("packages_tab_index_failed")}</p>
        <pre className="text-[10px] text-zinc-600 bg-zinc-900 rounded p-2 max-w-full overflow-auto max-h-20 text-left">{indexError}</pre>
        <button
          onClick={onReloadIndex}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5 transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> {t("packages_tab_retry")}
        </button>
      </div>
    );
  }

  const PackageCard = ({ pkg }: { pkg: VpmPackage }) => {
    const versions = sortedVersions(pkg);
    const selectedVer = getSelectedVersion(pkg);
    const pkgVersion = pkg.versions[selectedVer];
    if (!pkgVersion) return null;

    const isInstalled = installedIds.has(pkg.id);
    const installState = installing[pkg.id];
    const isInstalling = !!installState && !installState.error && installState.progress < 1;
    const hasError = installState?.error != null;
    const isDone = !isInstalling && installState?.progress === 1;
    const expanded = expandedDesc[pkg.id];

    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-2.5">
        <div className="flex items-start gap-2">
          <Package className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-zinc-100 truncate">{pkgVersion.display_name}</p>
              {isInstalled && (
                <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-900/40 rounded px-1.5 py-0.5">
                  <CheckCircle2 className="h-2.5 w-2.5" /> {t("packages_tab_installed_ok")}
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{pkg.id}</p>
          </div>
        </div>

        {pkgVersion.description && (
          <div>
            <p className={cn("text-[11px] text-zinc-400 leading-relaxed", !expanded && "line-clamp-2")}>
              {pkgVersion.description}
            </p>
            {pkgVersion.description.length > 80 && (
              <button
                onClick={() => setExpandedDesc((prev) => ({ ...prev, [pkg.id]: !prev[pkg.id] }))}
                className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-0.5"
              >
                {expanded ? t("packages_tab_show_less") : t("packages_tab_show_more")}
              </button>
            )}
          </div>
        )}

        {installState && (isInstalling || hasError) && (
          <div>
            {hasError ? (
              <p className="text-[10px] text-red-400">{installState.error}</p>
            ) : (
              <InstallProgress progress={installState.progress} step={installState.step} />
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <select
              value={selectedVer}
              onChange={(e) =>
                setSelectedVersions((prev) => ({ ...prev, [pkg.id]: e.target.value }))
              }
              className="w-full appearance-none bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 pl-2 pr-6 py-1.5 focus:outline-none focus:border-zinc-500 cursor-pointer"
            >
              {versions.map((v, i) => (
                <option key={v} value={v}>
                  {v}{i === 0 ? " (latest)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
          </div>

          <button
            onClick={() => onInstall(pkg.id, selectedVer)}
            disabled={isInstalling || (isInstalled && !hasError)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors shrink-0",
              isInstalled && !hasError
                ? "bg-zinc-800 text-zinc-500 cursor-default"
                : "bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isInstalling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isInstalled && !hasError ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {isInstalling
              ? t("packages_tab_installing")
              : isInstalled && !hasError
              ? t("packages_tab_installed_ok")
              : hasError
              ? t("packages_tab_install_retry")
              : t("packages_tab_install")}
          </button>
        </div>
      </div>
    );
  };

  const recIds = new Set(recommendations.map((r) => r.packageId));
  const nonRecFiltered = filtered.filter((p) => !recIds.has(p.id) || search.trim());

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-zinc-800/60">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
          <input
            type="text"
            placeholder={t("packages_tab_search_placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-xs text-zinc-300 pl-8 pr-3 py-2 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {!search.trim() && recommendations.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3 w-3 text-amber-400" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {t("packages_tab_recommended")}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {recommendations.map((rec) => {
                const pkg = index.find((p) => p.id === rec.packageId);
                if (!pkg) return null;
                return (
                  <div key={rec.packageId} className="relative">
                    <div className="absolute -top-px -left-px -right-px h-0.5 bg-gradient-to-r from-amber-500/50 to-transparent rounded-t-lg" />
                    <PackageCard pkg={pkg} />
                  </div>
                );
              })}
            </div>

            {nonRecFiltered.length > 0 && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mt-4 mb-2">
                {t("packages_tab_all_packages", { count: index.length })}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {nonRecFiltered.map((pkg) => <PackageCard key={pkg.id} pkg={pkg} />)}
        </div>

        {filtered.length === 0 && search.trim() && (
          <div className="text-center py-8">
            <p className="text-xs text-zinc-600">{t("packages_tab_no_search_results", { search })}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PackagesTab({ project }: { project: Project }) {
  const t = useT();
  const [subTab, setSubTab] = useState<SubTab>("installed");

  const [installed, setInstalled] = useState<InstalledVpmPackage[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  const [index, setIndex] = useState<VpmPackage[]>([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexLoaded, setIndexLoaded] = useState(false);

  const [installing, setInstalling] = useState<
    Record<string, { step: string; progress: number; error: string | null }>
  >({});

  const loadInstalled = useCallback(() => {
    setLoadingInstalled(true);
    tauriGetInstalledVpmPackages(project.path)
      .then(setInstalled)
      .catch(console.error)
      .finally(() => setLoadingInstalled(false));
  }, [project.path]);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  const loadIndex = useCallback(() => {
    setLoadingIndex(true);
    setIndexError(null);
    tauriFetchVpmIndex()
      .then((pkgs) => { setIndex(pkgs); setIndexLoaded(true); })
      .catch((e) => setIndexError(String(e)))
      .finally(() => setLoadingIndex(false));
  }, []);

  useEffect(() => {
    if (subTab === "browse" && !indexLoaded && !loadingIndex) {
      loadIndex();
    }
  }, [subTab, indexLoaded, loadingIndex, loadIndex]);

  useEffect(() => {
    const unlisten = listen<PkgProgress>("project:pkg_progress", (ev) => {
      const { package_id, step, progress, done, error } = ev.payload;
      setInstalling((prev) => ({
        ...prev,
        [package_id]: { step, progress, error },
      }));
      if (done && !error) {
        setTimeout(loadInstalled, 300);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [loadInstalled]);

  const handleInstall = useCallback((packageId: string, version: string) => {
    setInstalling((prev) => ({
      ...prev,
      [packageId]: { step: t("packages_tab_starting"), progress: 0, error: null },
    }));
    tauriInstallVpmPackageToProject(project.path, packageId, version, [])
      .catch((e) => {
        setInstalling((prev) => ({
          ...prev,
          [packageId]: { ...prev[packageId], error: String(e), progress: prev[packageId]?.progress ?? 0 },
        }));
      });
  }, [project.path, t]);

  const handleRemove = useCallback((packageId: string) => {
    setRemoving((prev) => new Set([...prev, packageId]));
    tauriRemoveVpmPackageFromProject(project.path, packageId)
      .then(() => loadInstalled())
      .catch(console.error)
      .finally(() => setRemoving((prev) => { const s = new Set(prev); s.delete(packageId); return s; }));
  }, [project.path, loadInstalled]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SubTabBar active={subTab} onChange={setSubTab} />

      {subTab === "installed" && (
        <InstalledTab
          project={project}
          installed={installed}
          loading={loadingInstalled}
          onReload={loadInstalled}
          removing={removing}
          onRemove={handleRemove}
        />
      )}

      {subTab === "browse" && (
        <BrowseTab
          project={project}
          index={index}
          loadingIndex={loadingIndex}
          indexError={indexError}
          onReloadIndex={loadIndex}
          installed={installed}
          installing={installing}
          onInstall={handleInstall}
        />
      )}
    </div>
  );
}