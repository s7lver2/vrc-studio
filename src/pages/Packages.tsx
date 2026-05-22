/**
 * PackagesPage — VPM package manager, project-scoped.
 *
 * - Catálogo multi-fuente (lee fuentes de Settings via localStorage)
 * - Click en cualquier paquete → PackageDetailModal
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Package, Download, Trash2, RefreshCw, Search,
  CheckCircle2, AlertTriangle, Loader2, ChevronDown, X,
  ArrowUpCircle, ChevronRight, FolderOpen, Boxes,
  Globe, Sparkles, Database, Link2, Layers,
  GitBranch, Info, Lock, Unlock, FileText,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/store/app";
import { useProjectsStore } from "@/store/projects";

import {
  type Project, type VpmPackage, type VpmPackageVersion,
  type InstalledVpmPackage, type PkgProgress,
  tauriGetInstalledVpmPackages,
  tauriFetchVpmRepo,
  tauriInstallVpmPackageToProject,
  tauriRemoveVpmPackageFromProject,
  tauriGetVpmPackageFiles,
} from "@/lib/tauri";
import {useT} from "../i18n";

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

function versionCompare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface SourceStyle {
  label: string; text: string; bg: string; border: string;
  iconColor: string; dot: string; glow: string;
}

function getSourceStyle(id: string): SourceStyle {
  if (id.startsWith("com.vrchat"))  return { label: "VRChat",        text: "text-red-300",    bg: "bg-red-950/50",    border: "border-red-900/50",    iconColor: "text-red-400",    dot: "bg-red-400",    glow: "shadow-red-900/20" };
  if (id.startsWith("com.poiyomi")) return { label: "Poiyomi",       text: "text-pink-300",   bg: "bg-pink-950/50",   border: "border-pink-900/50",   iconColor: "text-pink-400",   dot: "bg-pink-400",   glow: "shadow-pink-900/20" };
  if (id.startsWith("jp.lilxyzw")) return  { label: "lilxyzw",       text: "text-violet-300", bg: "bg-violet-950/50", border: "border-violet-900/50", iconColor: "text-violet-400", dot: "bg-violet-400", glow: "shadow-violet-900/20" };
  if (id.startsWith("nadena.dev")) return  { label: "Modular Avatar", text: "text-blue-300",   bg: "bg-blue-950/50",   border: "border-blue-900/50",   iconColor: "text-blue-400",   dot: "bg-blue-400",   glow: "shadow-blue-900/20" };
  return                                   { label: "Community",      text: "text-zinc-400",   bg: "bg-zinc-800/60",   border: "border-zinc-700/50",   iconColor: "text-zinc-500",   dot: "bg-zinc-500",   glow: "shadow-zinc-900/10" };
}

// ── VPM Sources ───────────────────────────────────────────────────────────────

interface VpmSource { id: string; name: string; url: string; isOfficial?: boolean; }

const OFFICIAL_SOURCE: VpmSource = {
  id: "official", name: "VRChat Official",
  url: "https://packages.vrchat.com/curated?download", isOfficial: true,
};

function getStoredVpmSources(): VpmSource[] {
  try {
    const saved = localStorage.getItem("vpm_sources");
    return saved ? JSON.parse(saved) : [OFFICIAL_SOURCE];
  } catch { return [OFFICIAL_SOURCE]; }
}

// ── PackageDetailModal ────────────────────────────────────────────────────────

type DetailTab = "overview" | "versions" | "deps" | "files";

interface PackageDetailModalProps {
  pkg: VpmPackage;
  installedVersion: string | null;
  isLocked: boolean;
  installing: { step: string; progress: number; error: string | null } | null;
  onInstall: (version: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

function PackageDetailModal({
  pkg, installedVersion, isLocked, installing, onInstall, onRemove, onClose,
}: PackageDetailModalProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [selectedVer, setSelectedVer] = useState<string>(() => sortedVersions(pkg)[0] ?? "");
  const [files, setFiles] = useState<string[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  
  const versions = sortedVersions(pkg);
  const pkgVer: VpmPackageVersion | undefined = pkg.versions[selectedVer];
  const latestVer = versions[0];
  const src = getSourceStyle(pkg.id);
  const isInstalling = !!installing && !installing.error && installing.progress < 1;
  const hasError = installing?.error != null;
  const hasUpdate = installedVersion ? versionCompare(latestVer, installedVersion) > 0 : false;

  const depCount = Object.keys(pkgVer?.dependencies ?? {}).length;

  // Close on backdrop click
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (activeTab !== "files" || files !== null || loadingFiles) return;
    if (!pkgVer?.url) return;
    setLoadingFiles(true);
    setFilesError(null);
    tauriGetVpmPackageFiles(pkgVer.url)
      .then(setFiles)
      .catch((e) => setFilesError(String(e)))
      .finally(() => setLoadingFiles(false));
  }, [activeTab, files, loadingFiles, pkgVer?.url]);

  const TABS: { id: DetailTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "overview", label: "Info",         icon: Info },
    { id: "versions", label: "Versions",    icon: GitBranch,  badge: versions.length },
    { id: "deps",     label: "Dependences", icon: Layers,     badge: depCount || undefined },
    { id: "files",    label: "Files",     icon: FileText },  // ← NEW
  ];

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className={cn(
        "w-full max-w-lg rounded-2xl border bg-zinc-900 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden",
        src.border, `shadow-xl ${src.glow}`
      )}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-4 px-5 pt-5 pb-4 border-b border-zinc-800/80 shrink-0">
          <div className={cn("rounded-xl p-3 border shrink-0", src.bg, src.border)}>
            <Package className={cn("h-5 w-5", src.iconColor)} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-zinc-100 truncate">
                {pkgVer?.display_name ?? pkg.id}
              </h2>
              <span className={cn("text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border", src.text, src.bg, src.border)}>
                {src.label}
              </span>
              {installedVersion && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-900/50 rounded-full px-1.5 py-px">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  v{installedVersion} instalado
                </span>
              )}
              {hasUpdate && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-300 bg-amber-950/60 border border-amber-800/60 rounded-full px-1.5 py-px">
                  <ArrowUpCircle className="h-2.5 w-2.5" />
                  {latestVer} disponible
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-600 font-mono mt-0.5 truncate">{pkg.id}</p>
            {pkgVer?.unity && (
              <p className="text-[10px] text-zinc-600 mt-0.5">Unity {pkgVer.unity}+</p>
            )}
          </div>

          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-0.5 px-4 pt-2 border-b border-zinc-800/60 shrink-0 bg-zinc-900">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all duration-150 -mb-px",
                activeTab === t.id
                  ? "border-red-500 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              )}
            >
              <t.icon className="h-3 w-3" />
              {t.label}
              {t.badge !== undefined && (
                <span className={cn(
                  "text-[9px] font-bold rounded-full px-1.5 py-px",
                  activeTab === t.id ? "bg-zinc-700 text-zinc-300" : "bg-zinc-800 text-zinc-600"
                )}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Overview */}
          {activeTab === "overview" && (
            <div className="p-5 flex flex-col gap-4">
              {pkgVer?.description ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">{t("shop_modal_description")}</p>
                  <p className="text-sm text-zinc-400 leading-relaxed">{pkgVer.description}</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 py-4 text-zinc-600">
                  <Info className="h-4 w-4 shrink-0" />
                  <p className="text-xs">{t("shop_modal_no_description")}</p>
                </div>
              )}

              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-2">
                <MetaCard label={t("packages_tab_pkg_id")} value={pkg.id} mono />
                <MetaCard label="Last Version" value={latestVer ?? "—"} mono />
                {pkgVer?.unity && <MetaCard label="Required Unity" value={pkgVer.unity} mono />}
                <MetaCard label="Versions" value={String(versions.length)} />
                <MetaCard label="Dependences" value={String(Object.keys(pkgVer?.dependencies ?? {}).length)} />
                {installedVersion && (
                  <MetaCard
                    label="State"
                    value={isLocked ? "Transitive depencence" : "Directly Installable"}
                    icon={isLocked ? Lock : Unlock}
                  />
                )}
              </div>

              {/* Download URL */}
              {pkgVer?.url && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">Download Url</p>
                  <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2">
                    <Link2 className="h-3 w-3 text-zinc-600 shrink-0" />
                    <p className="text-[10px] font-mono text-zinc-500 truncate flex-1">{pkgVer.url}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Versions */}
          {activeTab === "versions" && (
            <div className="p-3 flex flex-col gap-1.5">
              {versions.map((v, i) => {
                const vd = pkg.versions[v];
                const isInstalled = v === installedVersion;
                const isLatest = i === 0;
                return (
                  <div
                    key={v}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all",
                      isInstalled
                        ? "border-emerald-900/60 bg-emerald-950/20"
                        : "border-zinc-800/60 bg-zinc-800/20 hover:bg-zinc-800/40 hover:border-zinc-700/50"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 h-7 w-7 rounded-lg flex items-center justify-center border text-[9px] font-bold",
                      isInstalled ? "bg-emerald-950/60 border-emerald-900/50 text-emerald-300" : "bg-zinc-800 border-zinc-700/50 text-zinc-500"
                    )}>
                      {isLatest ? "↑" : v.split(".")[0]}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-zinc-200 font-mono">{v}</span>
                        {isLatest && (
                          <span className="text-[9px] font-bold text-zinc-500 bg-zinc-800 border border-zinc-700/60 rounded px-1.5 py-px">
                            latest
                          </span>
                        )}
                        {isInstalled && (
                          <span className="text-[9px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-900/50 rounded px-1.5 py-px">
                            instalado
                          </span>
                        )}
                      </div>
                      {vd?.unity && (
                        <p className="text-[10px] text-zinc-600 mt-0.5">Unity {vd.unity}+</p>
                      )}
                    </div>

                    {!isInstalled && (
                      <button
                        onClick={() => { setSelectedVer(v); onInstall(v); }}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-700/60 hover:bg-zinc-700 border border-zinc-600/50 text-[10px] font-semibold text-zinc-300 transition-colors"
                      >
                        <Download className="h-3 w-3" /> {t("packages_tab_install")}
                      </button>
                    )}
                    {isInstalled && !isLocked && (
                      <button
                        onClick={onRemove}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-700/50 text-[10px] font-semibold text-zinc-600 hover:text-red-400 hover:border-red-900/50 hover:bg-red-950/20 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        <Trash2 className="h-3 w-3" /> {t("packages_tab_remove")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Dependencies */}
          {activeTab === "deps" && (
            <div className="p-5 flex flex-col gap-3">
              {/* Version picker for deps */}
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">{t("packages_tab_view_deps_of")}</p>
                <div className="relative">
                  <select
                    value={selectedVer}
                    onChange={(e) => setSelectedVer(e.target.value)}
                    className="appearance-none bg-zinc-800 border border-zinc-700/60 rounded-lg text-[11px] text-zinc-300 pl-2.5 pr-6 py-1 focus:outline-none focus:border-zinc-500 cursor-pointer"
                  >
                    {versions.map((v, i) => (
                      <option key={v} value={v}>{v}{i === 0 ? ` ${t("packages_tab_latest")}` : ""}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
                </div>
              </div>

              {depCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <div className="rounded-2xl bg-zinc-800/50 border border-zinc-700/30 p-4">
                    <Layers className="h-6 w-6 text-zinc-600" />
                  </div>
                  <p className="text-xs text-zinc-500">No dependences</p>
                  <p className="text-[10px] text-zinc-700">This package does not contain dependences</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {Object.entries(pkgVer?.dependencies ?? {}).map(([depId, depVer]) => {
                    const depSrc = getSourceStyle(depId);
                    return (
                      <div
                        key={depId}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-800/60 bg-zinc-800/20"
                      >
                        <div className={cn("shrink-0 rounded-lg p-1.5 border", depSrc.bg, depSrc.border)}>
                          <Package className={cn("h-3 w-3", depSrc.iconColor)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-zinc-300 truncate">{depId}</p>
                          <p className={cn("text-[10px] font-medium", depSrc.text)}>{depSrc.label}</p>
                        </div>
                        <span className="shrink-0 text-[10px] font-mono text-zinc-500 bg-zinc-800 border border-zinc-700/40 rounded px-1.5 py-0.5">
                          {depVer}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Files & Changes */}
          {activeTab === "files" && (
            <div className="p-5 flex flex-col gap-4">

              {/* Extra links */}
              {(pkgVer?.changelogUrl || pkgVer?.documentationUrl || pkgVer?.licensesUrl) && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">
                    {t("packages_tab_links")}
                  </p>
                  {pkgVer.changelogUrl && (
                    <a
                      href={pkgVer.changelogUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      {t("packages_tab_changelog")}
                    </a>
                  )}
                  {pkgVer.documentationUrl && (
                    <a
                      href={pkgVer.documentationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      Documentación
                    </a>
                  )}
                  {pkgVer.licensesUrl && (
                    <a
                      href={pkgVer.licensesUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      {t("packages_tab_license")}
                    </a>
                  )}
                </div>
              )}

              {/* Samples */}
              {pkgVer?.samples && pkgVer.samples.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-2">
                    Samples ({pkgVer.samples.length})
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {pkgVer.samples.map((s) => (
                      <div
                        key={s.path}
                        className="flex flex-col gap-0.5 bg-zinc-800/40 border border-zinc-700/30 rounded-xl px-3 py-2.5"
                      >
                        <p className="text-xs font-medium text-zinc-200">{s.display_name}</p>
                        {s.description && (
                          <p className="text-[10px] text-zinc-500">{s.description}</p>
                        )}
                        <p className="text-[9px] font-mono text-zinc-700 mt-0.5">{s.path}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ZIP file listing */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-2">{t("packages_tab_package_contents")}</p>

                {loadingFiles && (
                  <div className="flex items-center gap-2 py-4 text-zinc-600">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" /> {t("packages_tab_reading_zip")}
                  </div>
                )}

                {filesError && !loadingFiles && (
                  <div className="flex items-start gap-2 rounded-xl bg-zinc-800/40 border border-zinc-700/30 px-3 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-zinc-600 shrink-0 mt-px" />
                    <p className="text-[10px] text-zinc-500">
                      {t("packages_tab_cant_read_content")} {filesError}
                    </p>
                  </div>
                )}

                {files !== null && !loadingFiles && !filesError && files.length === 0 && (
                  <p className="text-xs text-zinc-600 py-4 text-center">{t("packages_tab_no_files_in_zip")}</p>
                )}

                {files !== null && files.length > 0 && (
                  <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-2">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/40 transition-colors">
                        <FileText className="h-3 w-3 text-zinc-700 shrink-0" />
                        <p className="text-[10px] font-mono text-zinc-400 truncate">{f}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800/80 bg-zinc-900/80 shrink-0">
          {/* Version picker */}
          <div className="relative">
            <select
              value={selectedVer}
              onChange={(e) => setSelectedVer(e.target.value)}
              className="appearance-none bg-zinc-800 border border-zinc-700/60 rounded-lg text-[11px] text-zinc-400 pl-2.5 pr-6 py-1.5 focus:outline-none focus:border-zinc-500 cursor-pointer hover:border-zinc-600 transition-colors"
            >
              {versions.map((v, i) => (
                <option key={v} value={v}>{v}{i === 0 ? ` ${t("packages_tab_latest")}` : ""}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
          </div>

          <div className="flex-1" />

          {/* Progress */}
          {isInstalling && (
            <div className="flex-1 flex flex-col gap-1 max-w-[140px]">
              <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round(installing!.progress * 100)}%` }}
                />
              </div>
              <p className="text-[9px] text-zinc-500 truncate">{installing!.step}</p>
            </div>
          )}

          {hasError && (
            <p className="text-[10px] text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {installing!.error}
            </p>
          )}

          {/* Remove */}
          {installedVersion && !isLocked && (
            <button
              onClick={onRemove}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs font-medium text-zinc-500 hover:text-red-400 hover:border-red-900/50 hover:bg-red-950/20 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Desinstalar
            </button>
          )}

          {/* Install / installed */}
          <button
            onClick={() => onInstall(selectedVer)}
            disabled={isInstalling || (!!installedVersion && !hasError && !hasUpdate)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
              installedVersion && !hasError && !hasUpdate
                ? "bg-zinc-800/60 text-zinc-600 cursor-default border border-zinc-700/40"
                : hasError
                  ? "bg-amber-600 hover:bg-amber-500 text-white"
                  : hasUpdate
                    ? "bg-amber-600 hover:bg-amber-500 text-white shadow-sm shadow-amber-900/30"
                    : "bg-red-600 hover:bg-red-500 text-white shadow-sm shadow-red-900/40 disabled:opacity-50"
            )}
          >
            {isInstalling ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> {t("packages_tab_installing")}</>
            ) : installedVersion && !hasError && !hasUpdate ? (
              <><CheckCircle2 className="h-3 w-3" /> Instalado</>
            ) : hasUpdate ? (
              <><ArrowUpCircle className="h-3 w-3" /> Actualizar</>
            ) : (
              <><Download className="h-3 w-3" /> {t("packages_tab_install")}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// small helper card for the overview tab
function MetaCard({ label, value, mono, icon: Icon }: {
  label: string; value: string; mono?: boolean; icon?: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1 bg-zinc-800/40 border border-zinc-700/30 rounded-xl px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">{label}</p>
      <div className="flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3 text-zinc-500 shrink-0" />}
        <p className={cn("text-xs text-zinc-300 truncate", mono && "font-mono text-[10px]")}>{value}</p>
      </div>
    </div>
  );
}

// ── Sub-tab bar ───────────────────────────────────────────────────────────────

type SubTab = "installed" | "browse";

function SubTabBar({ active, onChange, installedCount, indexCount }: {
  active: SubTab; onChange: (t: SubTab) => void;
  installedCount: number; indexCount: number;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800/80 bg-zinc-950/60 shrink-0">
      {([
        { id: "installed" as SubTab, label: "Installed", count: installedCount, icon: Database },
        { id: "browse"    as SubTab, label: "Catalog",   count: indexCount,     icon: Globe },
      ]).map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
            active === t.id
              ? "bg-zinc-800 text-zinc-100 shadow-sm shadow-black/30"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          )}
        >
          <t.icon className={cn("h-3 w-3", active === t.id ? "text-zinc-300" : "text-zinc-600")} />
          {t.label}
          {t.count > 0 && (
            <span className={cn(
              "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[9px] font-bold px-1",
              active === t.id ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800/80 text-zinc-600"
            )}>
              {t.count > 999 ? "999+" : t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Installed tab ─────────────────────────────────────────────────────────────

function InstalledTab({
  installed, loading, onReload, removing, onRemove, index, onSelect,
}: {
  installed: InstalledVpmPackage[];
  loading: boolean; onReload: () => void;
  removing: Set<string>; onRemove: (id: string) => void;
  index: VpmPackage[];
  onSelect: (pkg: VpmPackage, installed: InstalledVpmPackage) => void;
}) {
  const [search, setSearch] = useState("");

  const withUpdateInfo = useMemo(() => installed.map((pkg) => {
    const catalogEntry = index.find((p) => p.id === pkg.name);
    let latestVersion: string | null = null;
    let hasUpdate = false;
    if (catalogEntry) {
      latestVersion = sortedVersions(catalogEntry)[0] ?? null;
      if (latestVersion && versionCompare(latestVersion, pkg.version) > 0) hasUpdate = true;
    }
    return { ...pkg, latestVersion, hasUpdate, catalogEntry };
  }), [installed, index]);

  const direct = useMemo(() => withUpdateInfo.filter((p) => !p.is_locked), [withUpdateInfo]);
  const transitive = useMemo(() => withUpdateInfo.filter((p) => p.is_locked), [withUpdateInfo]);

  const filtered = useMemo(() => {
    if (!search.trim()) return { direct, transitive };
    const q = search.toLowerCase();
    const f = (list: typeof direct) => list.filter((p) =>
      p.name.toLowerCase().includes(q) || p.version.toLowerCase().includes(q));
    return { direct: f(direct), transitive: f(transitive) };
  }, [direct, transitive, search]);

  const updatesCount = useMemo(() => withUpdateInfo.filter((p) => p.hasUpdate).length, [withUpdateInfo]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          <p className="text-xs text-zinc-500">Loading Packages…</p>
        </div>
      </div>
    );
  }

  if (installed.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-2xl bg-gradient-to-b from-zinc-800/60 to-zinc-900/60 border border-zinc-700/40 p-5 shadow-inner">
          <Boxes className="h-9 w-9 text-zinc-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-300">No Installed Packages</p>
          <p className="text-xs text-zinc-600 mt-1">Go to the catalog and install some</p>
        </div>
      </div>
    );
  }

  const PkgRow = ({ pkg }: { pkg: typeof withUpdateInfo[number] }) => {
    const isRemoving = removing.has(pkg.name);
    const src = getSourceStyle(pkg.name);
    const displayName = pkg.catalogEntry?.versions[sortedVersions(pkg.catalogEntry)[0]]?.display_name ?? pkg.name;

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => pkg.catalogEntry && onSelect(pkg.catalogEntry, pkg)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pkg.catalogEntry && onSelect(pkg.catalogEntry, pkg); } }}
        className="w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-800/40 transition-all duration-100 border border-transparent hover:border-zinc-700/30 text-left cursor-pointer"
      >
        <div className={cn("shrink-0 rounded-lg p-1.5 border", src.bg, src.border)}>
          <Package className={cn("h-3.5 w-3.5", src.iconColor)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-semibold text-zinc-200 truncate">{displayName}</p>
            {pkg.hasUpdate && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-bold text-amber-300 bg-amber-950/60 border border-amber-800/60 rounded-full px-1.5 py-px">
                <ArrowUpCircle className="h-2.5 w-2.5" />{pkg.latestVersion}
              </span>
            )}
            {pkg.is_locked && (
              <Lock className="h-2.5 w-2.5 text-zinc-700 shrink-0" />
            )}
          </div>
          <p className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">{pkg.name}</p>
        </div>
        <span className={cn(
          "shrink-0 text-[10px] font-mono rounded-md px-1.5 py-0.5 border",
          pkg.hasUpdate ? "text-amber-300 bg-amber-950/40 border-amber-800/50" : "text-zinc-500 bg-zinc-800/60 border-zinc-700/30"
        )}>
          {pkg.version}
        </span>
        <span className={cn("shrink-0 text-[10px] hidden sm:block w-24 truncate text-right font-medium", src.text)}>
          {src.label}
        </span>
        <div className="shrink-0 w-6 flex justify-center" onClick={(e) => e.stopPropagation()}>
          {!pkg.is_locked && (
            <button
              onClick={() => onRemove(pkg.name)}
              disabled={isRemoving}
              title="Eliminar"
              className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1 text-zinc-600 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-30"
            >
              {isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
    );
  };

  const Section = ({ title, items, badge }: { title: string; items: typeof withUpdateInfo; badge?: string }) => (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">{title}</p>
        <span className="text-[9px] font-bold text-zinc-700 bg-zinc-800/60 rounded-full px-1.5 py-px border border-zinc-700/40">{items.length}</span>
        {badge && <span className="text-[9px] font-bold text-amber-300 bg-amber-950/40 rounded-full px-1.5 py-px border border-amber-800/50">{badge}</span>}
      </div>
      {items.map((p) => <PkgRow key={p.name} pkg={p} />)}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60 shrink-0 bg-zinc-950/30">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600" />
          <input type="text" placeholder="Search Package…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-[11px] text-zinc-300 pl-7 pr-7 py-1.5 focus:outline-none focus:border-zinc-500 focus:bg-zinc-800 placeholder-zinc-600 transition-colors"
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"><X className="h-3 w-3" /></button>}
        </div>
        {updatesCount > 0 && !search && (
          <span className="text-[10px] font-semibold text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-full px-2 py-0.5 flex items-center gap-1">
            <ArrowUpCircle className="h-3 w-3" />{updatesCount} update{updatesCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto">{installed.length} instalado{installed.length !== 1 ? "s" : ""}</span>
        <button onClick={onReload} className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors" title="Recargar">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {filtered.direct.length > 0 && (
          <Section title="Direct" items={filtered.direct}
            badge={updatesCount > 0 && !search ? `${updatesCount} With Update` : undefined} />
        )}
        {filtered.transitive.length > 0 && <Section title="Dependencias" items={filtered.transitive} />}
        {filtered.direct.length === 0 && filtered.transitive.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 text-zinc-600 gap-2">
            <Search className="h-5 w-5 opacity-40" />
            <p className="text-xs">No results for "{search}"</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Browse tab ────────────────────────────────────────────────────────────────

function BrowseTab({
  index, loadingIndex, indexError, onReloadIndex,
  installed, installing, onInstall, sources, onSelect,
}: {
  index: VpmPackage[];
  loadingIndex: boolean; indexError: string | null; onReloadIndex: () => void;
  installed: InstalledVpmPackage[];
  installing: Record<string, { step: string; progress: number; error: string | null }>;
  onInstall: (packageId: string, version: string) => void;
  sources: VpmSource[];
  onSelect: (pkg: VpmPackage) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [filterSource, setFilterSource] = useState<string | null>(null);   // ← NEW
  const t = useT();

  const installedMap = useMemo(
    () => Object.fromEntries(installed.map((p) => [p.name, p.version])), [installed]);

  const availableSources = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string; dot: string }[] = [];
    for (const pkg of index) {
      const s = getSourceStyle(pkg.id);
      if (!seen.has(s.label)) { seen.add(s.label); out.push({ key: s.label, label: s.label, dot: s.dot }); }
    }
    return out;
  }, [index]);

  // Filter by both search and source pill
  const filtered = useMemo(() => {
    let list = index;
    if (filterSource) list = list.filter((p) => getSourceStyle(p.id).label === filterSource);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((p) => {
      const latest = p.versions[sortedVersions(p)[0]];
      return p.id.toLowerCase().includes(q) ||
        latest?.display_name?.toLowerCase().includes(q) ||
        latest?.description?.toLowerCase().includes(q);
    });
  }, [index, search, filterSource]);

  const getSelectedVersion = (pkg: VpmPackage) => selectedVersions[pkg.id] ?? sortedVersions(pkg)[0];

  if (loadingIndex) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="h-10 w-10 rounded-full border-2 border-zinc-800 border-t-red-500/70 animate-spin" />
          <Sparkles className="absolute inset-0 m-auto h-4 w-4 text-zinc-600" />
        </div>
        <div className="text-center">
          <p className="text-xs font-medium text-zinc-400">Cargando catálogo…</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            {sources.length} fuente{sources.length !== 1 ? "s" : ""} configurada{sources.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    );
  }

  if (indexError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-2xl bg-red-950/30 border border-red-900/30 p-4">
          <AlertTriangle className="h-6 w-6 text-red-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-300">Error al cargar el catálogo</p>
          <p className="text-xs text-zinc-600 mt-1">No se pudo conectar con el registro VPM.</p>
        </div>
        <pre className="text-[10px] text-zinc-600 bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 overflow-auto max-h-20 text-left w-full">{indexError}</pre>
        <button onClick={onReloadIndex} className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-2 transition-colors">
          <RefreshCw className="h-3 w-3" /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search toolbar */}
      <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800/60 shrink-0 bg-zinc-950/30 flex flex-col gap-2">
        {/* Search row */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
          <input type="text" placeholder="Search on the catalog…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl text-xs text-zinc-300 pl-8 pr-8 py-2 focus:outline-none focus:border-zinc-500 focus:bg-zinc-800 placeholder-zinc-600 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-600 hover:text-zinc-400">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Source filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setFilterSource(null)}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all border",
              filterSource === null
                ? "bg-zinc-700 text-zinc-100 border-zinc-600"
                : "bg-zinc-800/60 text-zinc-500 border-zinc-700/40 hover:border-zinc-600/60 hover:text-zinc-300"
            )}
          >
            All
            <span className="text-[9px] opacity-60">{index.length}</span>
          </button>
          {availableSources.map((src) => {
            const count = index.filter((p) => getSourceStyle(p.id).label === src.label).length;
            return (
              <button
                key={src.key}
                onClick={() => setFilterSource(filterSource === src.label ? null : src.label)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all border",
                  filterSource === src.label
                    ? "bg-zinc-700 text-zinc-100 border-zinc-600"
                    : "bg-zinc-800/60 text-zinc-500 border-zinc-700/40 hover:border-zinc-600/60 hover:text-zinc-300"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", src.dot)} />
                {src.label}
                <span className="text-[9px] opacity-60">{count}</span>
              </button>
            );
          })}
          <p className="ml-auto text-[10px] text-zinc-700 shrink-0">
            {search || filterSource ? `${filtered.length} {t("packages_tab_results")}` : `${index.length} packages`}
          </p>
        </div>
      </div>

      {/* Package list — grouped by source */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-4">
        {(() => {
          // Group filtered packages by source label
          const groups = new Map<string, VpmPackage[]>();
          for (const pkg of filtered) {
            const label = getSourceStyle(pkg.id).label;
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label)!.push(pkg);
          }

          if (groups.size === 0) {
            return search || filterSource ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
                <Search className="h-7 w-7 opacity-30" />
                <div className="text-center">
                  <p className="text-xs font-medium text-zinc-500">{t("packages_tab_no_results")}</p>
                  <p className="text-[10px] mt-0.5">{t("packages_tab_no_search_results", { search })}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Globe className="h-7 w-7 text-zinc-700" />
                <div className="text-center">
                  <p className="text-xs font-medium text-zinc-500">Catálogo vacío</p>
                  <p className="text-[10px] text-zinc-700 mt-0.5">Añade fuentes VPM en Ajustes → Packages</p>
                </div>
              </div>
            );
          }

          return Array.from(groups.entries()).map(([sourceLabel, pkgs]) => {
            const srcStyle = getSourceStyle(pkgs[0].id);
            return (
              <div key={sourceLabel} className="flex flex-col gap-1.5">
                {/* Section header */}
                <div className="flex items-center gap-2 px-1 pb-0.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", srcStyle.dot)} />
                  <p className={cn("text-[10px] font-bold uppercase tracking-wider", srcStyle.text)}>
                    {sourceLabel}
                  </p>
                  <span className="text-[9px] text-zinc-700 bg-zinc-800/60 rounded-full px-1.5 py-px border border-zinc-700/40">
                    {pkgs.length}
                  </span>
                </div>

                {/* Cards — uniform 2-column grid with fixed height */}
                <div className="grid grid-cols-2 gap-2">
                {pkgs.map((pkg) => {
                  const versions = sortedVersions(pkg);
                  const selectedVer = getSelectedVersion(pkg);
                  const pkgVersion = pkg.versions[selectedVer];
                  if (!pkgVersion) return null;

                  const installedVer = installedMap[pkg.id];
                  const isInstalled = !!installedVer;
                  const installState = installing[pkg.id];
                  const isInstalling = !!installState && !installState.error && installState.progress < 1;
                  const hasError = installState?.error != null;

                  return (
                    <div key={pkg.id}
                      className={cn(
                        "rounded-xl border overflow-hidden transition-all duration-150 cursor-pointer flex flex-col",
                        "h-[156px]",   // ← altura fija, todos los cards idénticos
                        isInstalled && !hasError
                          ? "border-zinc-700/60 bg-zinc-900/40 hover:border-zinc-600/60"
                          : "border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700/60 hover:bg-zinc-900/80"
                      )}
                      onClick={() => onSelect(pkg)}
                    >
                      {/* Content area — flex-1 so it fills available space */}
                      <div className="flex items-start gap-2.5 px-3 pt-3 pb-1 flex-1 min-h-0 overflow-hidden">
                        <div className={cn("shrink-0 rounded-lg p-1.5 border mt-0.5",
                          isInstalled && !hasError ? "bg-emerald-950/50 border-emerald-900/40" : cn(srcStyle.bg, srcStyle.border))}>
                          <Package className={cn("h-3 w-3", isInstalled && !hasError ? "text-emerald-400" : srcStyle.iconColor)} />
                        </div>
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs font-bold text-zinc-100 truncate">{pkgVersion.display_name ?? pkg.id}</p>
                            {isInstalled && !hasError && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-900/50 rounded-full px-1.5 py-px shrink-0">
                                <CheckCircle2 className="h-2 w-2" />v{installedVer}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-600 font-mono mt-0.5 truncate">{pkg.id}</p>
                          {pkgVersion.description && (
                            <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed line-clamp-2 overflow-hidden">{pkgVersion.description}</p>
                          )}
                          {isInstalling && (
                            <div className="mt-1.5">
                              <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-300"
                                  style={{ width: `${Math.round(installState.progress * 100)}%` }} />
                              </div>
                              <p className="text-[9px] text-zinc-500 mt-0.5 truncate">{installState.step}</p>
                            </div>
                          )}
                          {hasError && (
                            <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1 truncate">
                              <AlertTriangle className="h-3 w-3 shrink-0" />{installState.error}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Footer — always at the bottom */}
                      <div className="flex items-center gap-2 px-3 pb-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                          <select value={selectedVer}
                            onChange={(e) => setSelectedVersions((prev) => ({ ...prev, [pkg.id]: e.target.value }))}
                            className="appearance-none bg-zinc-800/80 border border-zinc-700/60 rounded-lg text-[11px] text-zinc-400 pl-2.5 pr-6 py-1.5 focus:outline-none focus:border-zinc-500 cursor-pointer hover:border-zinc-600 transition-colors"
                          >
                            {versions.map((v, i) => (
                              <option key={v} value={v}>{v}{i === 0 ? " (latest)" : ""}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
                        </div>
                        <div className="flex-1" />
                        <button
                          onClick={() => onInstall(pkg.id, selectedVer)}
                          disabled={isInstalling || (isInstalled && !hasError)}
                          className={cn(
                            "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                            isInstalled && !hasError
                              ? "bg-zinc-800/60 text-zinc-600 cursor-default border border-zinc-700/40"
                              : hasError
                                ? "bg-amber-600 hover:bg-amber-500 text-white shadow-sm shadow-amber-900/30"
                                : "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white disabled:opacity-50 shadow-sm shadow-red-900/40"
                          )}
                        >
                          {isInstalling ? <Loader2 className="h-3 w-3 animate-spin" />
                            : isInstalled && !hasError ? <CheckCircle2 className="h-3 w-3" />
                            : <Download className="h-3 w-3" />}
                          {isInstalling ? "Installing…" : isInstalled && !hasError ? "" : hasError ? "Retry" : "Install"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                </div>{/* end grid */}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

// ── Project picker bar ────────────────────────────────────────────────────────

function ProjectPickerBar() {
  const projects = useProjectsStore((s) => s.projects);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [projects, query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 border-b text-left transition-all duration-150",
          open ? "bg-zinc-900 border-zinc-700/60" : "bg-zinc-950/80 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-700/60"
        )}
      >
        <div className={cn("shrink-0 rounded-xl border p-1.5 transition-colors",
          selectedProject ? "bg-red-950/40 border-red-900/50" : "bg-zinc-800/80 border-zinc-700/50")}>
          <FolderOpen className={cn("h-3.5 w-3.5", selectedProject ? "text-red-400" : "text-zinc-500")} />
        </div>
        {selectedProject ? (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate leading-tight">{selectedProject.name}</p>
            <p className="text-[10px] text-zinc-600 font-mono truncate">{selectedProject.path}</p>
          </div>
        ) : (
          <p className="flex-1 text-sm text-zinc-500">Select A Project…</p>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 shrink-0 transition-transform duration-200", open && "rotate-180")} />
        {selectedProject && (
          <span onClick={(e) => { e.stopPropagation(); setSelectedProject(null); }}
            className="shrink-0 rounded-lg p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors" title="Deseleccionar">
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-zinc-900 border border-zinc-700/60 border-t-0 shadow-2xl shadow-black/60 max-h-72 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
            <Search className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Project…"
              className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none" />
            {query && <button onClick={() => setQuery("")} className="text-zinc-600 hover:text-zinc-400"><X className="h-3 w-3" /></button>}
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-zinc-600 px-4 py-4 text-center">Sin resultados</p>
            ) : filtered.map((p) => (
              <button key={p.id} onClick={() => { setSelectedProject(p); setOpen(false); setQuery(""); }}
                className={cn("w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/60 transition-colors",
                  selectedProject?.id === p.id && "bg-zinc-800/40")}>
                <FolderOpen className={cn("h-3.5 w-3.5 shrink-0", selectedProject?.id === p.id ? "text-red-400" : "text-zinc-600")} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-200 truncate">{p.name}</p>
                  <p className="text-[10px] text-zinc-600 font-mono truncate">{p.path}</p>
                </div>
                {selectedProject?.id === p.id && <CheckCircle2 className="h-3.5 w-3.5 text-red-400 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PackagesTab ───────────────────────────────────────────────────────────────

export function PackagesTab({ project }: { project: Project }) {
  const [subTab, setSubTab] = useState<SubTab>("installed");
  const [installed, setInstalled] = useState<InstalledVpmPackage[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState<VpmPackage[]>([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [sources, setSources] = useState<VpmSource[]>([OFFICIAL_SOURCE]);
  const [installing, setInstalling] = useState<Record<string, { step: string; progress: number; error: string | null }>>({});

  // Detail modal state
  const [detailPkg, setDetailPkg] = useState<VpmPackage | null>(null);
  const [detailInstalled, setDetailInstalled] = useState<InstalledVpmPackage | null>(null);

  const loadInstalled = useCallback(() => {
    setLoadingInstalled(true);
    tauriGetInstalledVpmPackages(project.path)
      .then(setInstalled)
      .catch(console.error)
      .finally(() => setLoadingInstalled(false));
  }, [project.path]);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  const loadIndex = useCallback(async () => {
    setLoadingIndex(true);
    setIndexError(null);
    const configuredSources = getStoredVpmSources();
    setSources(configuredSources);
    try {
      const results = await Promise.allSettled(
        configuredSources.map((src) => tauriFetchVpmRepo(src.url))
      );
      const merged = new Map<string, VpmPackage>();
      let allFailed = true;
      for (const result of results) {
        if (result.status === "fulfilled") {
          allFailed = false;
          for (const pkg of result.value) {
            if (!merged.has(pkg.id)) {
              merged.set(pkg.id, pkg);
            } else {
              const existing = merged.get(pkg.id)!;
              merged.set(pkg.id, { ...existing, versions: { ...existing.versions, ...pkg.versions } });
            }
          }
        }
      }
      if (allFailed) {
        const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => String(r.reason)).join("; ");
        setIndexError(errors || "No se pudo cargar ninguna fuente VPM");
      } else {
        setIndex(Array.from(merged.values()));
        setIndexLoaded(true);
      }
    } catch (e) {
      setIndexError(String(e));
    } finally {
      setLoadingIndex(false);
    }
  }, []);

  useEffect(() => { if (!indexLoaded && !loadingIndex) loadIndex(); }, [indexLoaded, loadingIndex, loadIndex]);

  useEffect(() => {
    const unlisten = listen<PkgProgress>("project:pkg_progress", (ev) => {
      const { package_id, step, progress, done, error } = ev.payload;
      setInstalling((prev) => ({ ...prev, [package_id]: { step, progress, error } }));
      if (done && !error) setTimeout(loadInstalled, 300);
    });
    return () => { unlisten.then((f) => f()); };
  }, [loadInstalled]);

  const handleInstall = useCallback((packageId: string, version: string) => {
    setInstalling((prev) => ({ ...prev, [packageId]: { step: "Iniciando…", progress: 0, error: null } }));
    const repoUrls = sources.map((s) => s.url);              // ← NUEVO: leer de sources
    tauriInstallVpmPackageToProject(project.path, packageId, version, repoUrls)
      .catch((e) => {
        setInstalling((prev) => ({
          ...prev,
          [packageId]: { ...prev[packageId], error: String(e), progress: prev[packageId]?.progress ?? 0 },
        }));
      });
  }, [project.path, sources]);

  const handleRemove = useCallback((packageId: string) => {
    setRemoving((prev) => new Set([...prev, packageId]));
    tauriRemoveVpmPackageFromProject(project.path, packageId)
      .then(() => loadInstalled())
      .catch(console.error)
      .finally(() => setRemoving((prev) => { const s = new Set(prev); s.delete(packageId); return s; }));
  }, [project.path, loadInstalled]);

  // Handlers for opening modal
  const handleSelectFromBrowse = useCallback((pkg: VpmPackage) => {
    const inst = installed.find((p) => p.name === pkg.id) ?? null;
    setDetailPkg(pkg);
    setDetailInstalled(inst);
  }, [installed]);

  const handleSelectFromInstalled = useCallback((pkg: VpmPackage, inst: InstalledVpmPackage) => {
    setDetailPkg(pkg);
    setDetailInstalled(inst);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SubTabBar active={subTab} onChange={setSubTab}
        installedCount={installed.length} indexCount={index.length} />

      <div className={cn("flex-1 flex flex-col min-h-0 overflow-hidden",subTab === "installed" ? "" : "hidden")}>
        <InstalledTab
          installed={installed} loading={loadingInstalled} onReload={loadInstalled}
          removing={removing} onRemove={handleRemove} index={index}
          onSelect={handleSelectFromInstalled}
        />
      </div>

      <div className={cn("flex-1 flex flex-col min-h-0 overflow-hidden",subTab === "browse" ? "" : "hidden")}>
        <BrowseTab
          index={index} loadingIndex={loadingIndex} indexError={indexError}
          onReloadIndex={loadIndex} installed={installed} installing={installing}
          onInstall={handleInstall} sources={sources}
          onSelect={handleSelectFromBrowse}
        />
      </div>

      {/* Detail modal */}
      {detailPkg && (
        <PackageDetailModal
          pkg={detailPkg}
          installedVersion={detailInstalled?.version ?? null}
          isLocked={detailInstalled?.is_locked ?? false}
          installing={installing[detailPkg.id] ?? null}
          onInstall={(version) => handleInstall(detailPkg.id, version)}
          onRemove={() => {
            handleRemove(detailPkg.id);
            setDetailPkg(null);
          }}
          onClose={() => { setDetailPkg(null); setDetailInstalled(null); }}
        />
      )}
    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const selectedProject = useAppStore((s) => s.selectedProject);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ProjectPickerBar />
      {selectedProject ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <PackagesTab project={selectedProject} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 min-h-0">
          <div className="rounded-2xl bg-gradient-to-b from-zinc-800/40 to-zinc-900/60 border border-zinc-700/40 p-7 shadow-xl shadow-black/30">
            <Boxes className="h-10 w-10 text-zinc-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-zinc-400">No project Selected</p>
            <p className="text-xs text-zinc-600 mt-1.5 flex items-center justify-center gap-1">
              Select a project from up there or from
              <ChevronRight className="h-3 w-3" />
              Projects
            </p>
          </div>
        </div>
      )}
    </div>
  );
}