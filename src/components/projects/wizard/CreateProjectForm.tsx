/**
 * CreateProjectForm — two-step wizard:
 *   Step 1  Setup    : name, destination, unity version, VCS toggle
 *   Step 2  Packages : VPM package picker with version selection + smart recommendations
 */

import { useEffect, useState, useMemo, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  tauriListUnityInstallations,
  tauriCreateProject,
  tauriFetchVpmIndex,
  UnityInstallation,
  Project,
  VpmPackage,
} from "@/lib/tauri";
import { CreationProgress } from "./CreationProgress";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import {
  ChevronRight, ChevronLeft, Loader2, Search,
  Package, CheckCircle2, ChevronDown, Sparkles,
  AlertTriangle, RefreshCw, X,
} from "lucide-react";
import { useT } from "@/i18n";
import { categorizePackage, CATEGORIES } from "@/lib/packageCategories";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Versiones de Unity permitidas para crear proyectos VRC Studio. */
const ALLOWED_UNITY_VERSIONS = new Set([
  "2022.3.22f1",
  "2022.3.6f1",
  "2019.4.31f1",
]);

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

function sortedVersions(pkg: VpmPackage): string[] {
  return Object.keys(pkg.versions).sort((a, b) => {
    const parse = (v: string) => v.split(".").map(Number);
    const [pa, pb] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 }) {
  const steps = [
    { num: 1, label: "Setup" },
    { num: 2, label: "Packages" },
  ];
  return (
    <div className="flex items-center gap-0 select-none">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-0">
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors",
              step > s.num
                ? "bg-red-600 text-white"
                : step === s.num
                ? "bg-red-600 text-white ring-2 ring-red-600/30"
                : "bg-zinc-800 text-zinc-500"
            )}>
              {step > s.num ? <CheckCircle2 className="h-3 w-3" /> : s.num}
            </div>
            <span className={cn(
              "text-xs font-medium transition-colors",
              step === s.num ? "text-zinc-200" : "text-zinc-600"
            )}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className="h-px w-8 mx-3 bg-zinc-800" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Recommendation engine ─────────────────────────────────────────────────────

interface Rec {
  packageId: string;
  label: string;
  reason: string;
  priority: number;
}

function getRecommendations(vcsEnabled: boolean, index: VpmPackage[]): Rec[] {
  const available = new Set(index.map((p) => p.id));
  const recs: Rec[] = [];
  const add = (id: string, label: string, reason: string, priority: number) => {
    if (available.has(id)) recs.push({ packageId: id, label, reason, priority });
  };

  // Core VRChat SDK — always recommended
  add("com.vrchat.avatars", "VRChat SDK – Avatars", "Required for avatar uploads", 100);
  add("com.vrchat.base",    "VRChat SDK – Base",    "Core VRChat runtime",          90);
  add("com.vrchat.worlds",  "VRChat SDK – Worlds",  "Required for world uploads",   80);

  // Build tooling
  add("com.vrchat.udonsharp",  "UdonSharp",  "Write Udon scripts in C#",            70);
  add("com.vrchat.clientsim",  "ClientSim",  "Simulate VRChat in the editor",       60);

  // VCS projects benefit from non-destructive workflow
  if (vcsEnabled) {
    add("com.vrchat.vrcfury", "VRCFury", "Non-destructive avatar tools, great with Git", 55);
  }

  // Nice to have
  add("com.vrchat.gesture-manager", "GestureManager", "Preview animations in editor",   45);

  return recs.sort((a, b) => b.priority - a.priority);
}

// ── Step 2: Package picker ────────────────────────────────────────────────────

interface PkgPickerProps {
  vcsEnabled: boolean;
  selected: Record<string, string>;   // id → version
  onChange: (id: string, version: string | null) => void;
}

function PackagePicker({ vcsEnabled, selected, onChange }: PkgPickerProps) {
  const [index, setIndex]       = useState<VpmPackage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState("");
  const [pickerVersions, setPickerVersions] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    tauriFetchVpmIndex()
      .then(setIndex)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const recommendations = useMemo(
    () => getRecommendations(vcsEnabled, index),
    [vcsEnabled, index]
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

  const getPickerVersion = (pkg: VpmPackage) =>
    pickerVersions[pkg.id] ?? sortedVersions(pkg)[0];

  const isSelected = (id: string) => id in selected;

  const togglePackage = (pkg: VpmPackage) => {
    const ver = getPickerVersion(pkg);
    if (isSelected(pkg.id)) {
      onChange(pkg.id, null);
    } else {
      onChange(pkg.id, ver);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        <p className="text-xs text-zinc-500">Fetching VRChat package registry…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <p className="text-xs text-zinc-400 font-medium">Could not load VPM registry</p>
        <pre className="text-[10px] text-zinc-600 bg-zinc-900 rounded p-2 max-w-full overflow-auto max-h-16 text-left">{error}</pre>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5 transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
        <p className="text-[10px] text-zinc-600">You can skip this step and install packages later.</p>
      </div>
    );
  }

  const recIds = new Set(recommendations.map((r) => r.packageId));
  const nonRecFiltered = filtered.filter((p) => !recIds.has(p.id) || search.trim());

  const PkgRow = ({ pkg, recLabel }: { pkg: VpmPackage; recLabel?: string }) => {
    const versions = sortedVersions(pkg);
    const ver = getPickerVersion(pkg);
    const pkgMeta = pkg.versions[ver];
    if (!pkgMeta) return null;
    const sel = isSelected(pkg.id);

    return (
      <div className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer",
        sel
          ? "border-red-600/60 bg-red-950/20"
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
      )} onClick={() => togglePackage(pkg)}>
        {/* Checkbox */}
        <div className={cn(
          "mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors",
          sel ? "bg-red-600 border-red-600" : "border-zinc-700 bg-zinc-900"
        )}>
          {sel && <CheckCircle2 className="h-3 w-3 text-white" />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-semibold text-zinc-200">{pkgMeta.display_name}</p>
            {recLabel && (
              <span className="flex items-center gap-0.5 text-[9px] font-medium text-amber-400 bg-amber-950/50 border border-amber-900/40 rounded px-1.5 py-0.5">
                <Sparkles className="h-2 w-2" /> {recLabel}
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{pkg.id}</p>
          {pkgMeta.description && (
            <p className="text-[10px] text-zinc-500 mt-1 line-clamp-1 leading-relaxed">{pkgMeta.description}</p>
          )}
        </div>

        {/* Version picker */}
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <select
            value={ver}
            onChange={(e) => {
              setPickerVersions((prev) => ({ ...prev, [pkg.id]: e.target.value }));
              if (sel) onChange(pkg.id, e.target.value);
            }}
            className="appearance-none bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-400 pl-2 pr-5 py-1 focus:outline-none cursor-pointer"
          >
            {versions.map((v, i) => (
              <option key={v} value={v}>{v}{i === 0 ? " ★" : ""}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-zinc-600" />
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
        <input
          type="text"
          placeholder="Search packages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-xs text-zinc-300 pl-8 pr-3 py-2 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
        />
      </div>

      {/* Selected count */}
      {Object.keys(selected).length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <Package className="h-3 w-3" />
          <span>{Object.keys(selected).length} package{Object.keys(selected).length !== 1 ? "s" : ""} selected</span>
        </div>
      )}

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
        {/* Recommendations */}
        {!search.trim() && recommendations.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-amber-400" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Recommended
              </p>
            </div>
            {recommendations.map((rec) => {
              const pkg = index.find((p) => p.id === rec.packageId);
              if (!pkg) return null;
              return (
                <div key={rec.packageId} className="relative">
                  <div className="absolute -top-px -left-px -right-px h-0.5 bg-gradient-to-r from-amber-500/40 to-transparent rounded-t-lg" />
                  <PkgRow pkg={pkg} recLabel={rec.reason} />
                </div>
              );
            })}
          </div>
        )}

        {/* Categorized packages (when no search) */}
        {!search.trim() ? (
          CATEGORIES.map((cat) => {
            const pkgs = nonRecFiltered.filter((p) => categorizePackage(p.id) === cat.id);
            if (pkgs.length === 0) return null;
            return (
              <div key={cat.id} className="flex flex-col gap-1.5 mt-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 flex items-center gap-1">
                  {cat.icon} {cat.label} <span className="text-zinc-700">({pkgs.length})</span>
                </p>
                {pkgs.map((pkg) => <PkgRow key={pkg.id} pkg={pkg} />)}
              </div>
            );
          })
        ) : (
          // Flat list when searching
          nonRecFiltered.map((pkg) => <PkgRow key={pkg.id} pkg={pkg} />)
        )}

        {filtered.length === 0 && search.trim() && (
          <p className="text-center text-xs text-zinc-600 py-6">No packages found for "{search}"</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onCreated: (project: Project) => void;
  onClose: () => void;
}

export function CreateProjectForm({ onCreated, onClose }: Props) {
  const t = useT();
  const [step, setStep] = useState<1 | 2>(1);

  // ── Step 1 state
  const [installations, setInstallations] = useState<UnityInstallation[]>([]);
  const [scanning, setScanning] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [destinationDir, setDestinationDir] = useState("");
  const [unity, setUnity] = useState<UnityInstallation | null>(null);
  const [vcsEnabled, setVcsEnabled] = useState(false);

  // ── Step 2 state — selectedPkgs: packageId → version
  const [selectedPkgs, setSelectedPkgs] = useState<Record<string, string>>({});

  // ── Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const events = useProjectEvents();

  useEffect(() => {
    tauriListUnityInstallations()
      .then((list) => {
        const allowed = list.filter((i) => ALLOWED_UNITY_VERSIONS.has(i.version));
        setInstallations(allowed);
        if (allowed.length === 1) setUnity(allowed[0]);
      })
      .finally(() => setScanning(false));
  }, []);

  const pickFolder = async () => {
    const result = await openDialog({ directory: true, title: "Seleccionar carpeta destino" });
    if (result && typeof result === "string") setDestinationDir(result);
  };

  const step1Valid =
    projectName.trim().length > 0 &&
    destinationDir.trim().length > 0 &&
    unity !== null;

  const handlePkgChange = (id: string, version: string | null) => {
    setSelectedPkgs((prev) => {
      if (version === null) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: version };
    });
  };

  const handleSubmit = async () => {
    if (!unity) return;
    setSubmitting(true);
    setSubmitError(null);
    events.reset();
    setSubmitted(true);
    try {
      const project = await tauriCreateProject({
        name: projectName.trim(),
        destination_dir: destinationDir,
        unity_version: unity.version,
        unity_path: unity.path,
        unity_type: "standard",
        avatar_base_id: null,
        shader: null,
        vcs_enabled: vcsEnabled,
        vpm_packages: Object.keys(selectedPkgs),
        custom_package_ids: [],
      });
      onCreated(project);
    } catch (err) {
      setSubmitError(String(err));
      setSubmitting(false);
    }
  };

  // ── Progress view ──
  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl p-6">
          <CreationProgress
            progress={events.progress}
            message={events.message}
            done={events.done}
            error={events.error ?? submitError}
            onClose={onClose}
          />
        </div>
      </div>
    );
  }

  // ── Wizard ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 shrink-0">
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-100">{t("create_project_title")}</h2>
            <StepIndicator step={step} />
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 1 && (
          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("create_project_name_label")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t("create_project_name_placeholder")}
                autoFocus
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-red-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("create_project_location_label")} <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={destinationDir}
                  onChange={(e) => setDestinationDir(e.target.value)}
                  placeholder="C:\Projects"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-red-600 focus:outline-none"
                />
                <button
                  onClick={pickFolder}
                  className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                  title={t("create_project_location_browse")}
                >
                  📁
                </button>
              </div>
              {destinationDir && projectName && (
                <p className="mt-1 text-xs text-zinc-600 truncate">
                  → {destinationDir}\{projectName}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("create_project_unity_label")} <span className="text-red-500">*</span>
              </label>
              {scanning ? (
                <p className="text-xs text-zinc-500">{t("create_project_scanning_unity")}</p>
              ) : installations.length === 0 ? (
                <p className="text-xs text-zinc-500 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2">
                  {t("create_project_no_unity")}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {installations.map((inst) => (
                    <button
                      key={inst.path}
                      onClick={() => setUnity(inst)}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                        unity?.path === inst.path
                          ? "border-red-600 bg-red-950/30"
                          : "border-zinc-700 hover:border-zinc-600 bg-zinc-800/20"
                      }`}
                    >
                      <div>
                        <span className="text-sm font-medium text-zinc-100">{inst.version}</span>
                        <span className="ml-2 text-xs text-zinc-500 truncate max-w-[200px] hidden sm:inline">
                          {inst.path}
                        </span>
                      </div>
                      {inst.is_custom && (
                        <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                          Custom
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-md border border-zinc-700 bg-zinc-800/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">{t("create_project_vcs_label")}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{t("create_project_vcs_desc")}</p>
              </div>
              <button
                onClick={() => setVcsEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  vcsEnabled ? "bg-red-600" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    vcsEnabled ? "translate-x-4" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 flex flex-col min-h-0 px-6 py-4 gap-3">
            <div className="shrink-0">
              <p className="text-xs text-zinc-400 leading-relaxed">
                {t("create_project_packages_desc")}
              </p>
            </div>
            <PackagePicker
              vcsEnabled={vcsEnabled}
              selected={selectedPkgs}
              onChange={handlePkgChange}
            />
          </div>
        )}

        <div className="border-t border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
          {step === 1 ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                {t("create_project_cancel")}
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("create_project_next")} <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" /> {t("create_project_back")}
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40"
                >
                  {t("create_project_skip")}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("create_project_submit")}
                  {Object.keys(selectedPkgs).length > 0 && (
                    <span className="rounded-full bg-red-800/60 px-1.5 py-0.5 text-[10px] font-bold">
                      +{Object.keys(selectedPkgs).length}
                    </span>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}