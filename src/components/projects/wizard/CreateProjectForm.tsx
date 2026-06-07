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
  tauriListInventory,
  tauriGetItemVariants,
  tauriSetProjectCoverImage,
  UnityInstallation,
  Project,
  VpmPackage,
  InventoryItem,
  ItemVariant,
  EarlyImportRef,
} from "@/lib/tauri";
import { toAssetUrl } from "@/lib/utils";
import { CreationProgress } from "./CreationProgress";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import {
  ChevronRight, ChevronLeft, Loader2, Search,
  Package, CheckCircle2, ChevronDown, Sparkles,
  AlertTriangle, RefreshCw, X, Image,
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

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps: { num: 1 | 2 | 3; label: string }[] = [
    { num: 1, label: "Setup" },
    { num: 2, label: "Paquetes" },
    { num: 3, label: "Early Import" },
  ];
  return (
    <div className="flex items-center gap-0 select-none px-6 pt-4">
      {steps.map((s, i) => {
        const isDone = step > s.num;
        const isActive = step === s.num;
        return (
          <div key={s.num} className="flex items-center" style={{ flex: i < steps.length - 1 ? 1 : 0 }}>
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{
                  background: isDone ? "#16a34a" : isActive ? "#dc2626" : "#27272a",
                  color: isDone || isActive ? "#fff" : "#52525b",
                }}
              >
                {isDone ? "✓" : s.num}
              </div>
              <span
                className="text-[10px]"
                style={{ color: isActive ? "#f4f4f5" : isDone ? "#71717a" : "#52525b", fontWeight: isActive ? 600 : 400 }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 mx-2 h-px bg-zinc-800" style={{ minWidth: 16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Early Import step ─────────────────────────────────────────────────────────

interface EarlyImportStepProps {
  selectedRefs: EarlyImportRef[];
  onToggle: (itemId: string) => void;
  onSetVariant: (itemId: string, subZipName: string | null) => void;
}

function EarlyImportStep({ selectedRefs, onToggle, onSetVariant }: EarlyImportStepProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filter, setFilter] = useState("");
  const [variantMap, setVariantMap] = useState<Record<string, ItemVariant[]>>({});

  useEffect(() => {
    tauriListInventory().then(setItems).catch(() => {});
  }, []);

  // Load variants when an item gets selected
  useEffect(() => {
    for (const ref of selectedRefs) {
      if (variantMap[ref.item_id] !== undefined) continue;
      tauriGetItemVariants(ref.item_id)
        .then((v) => setVariantMap((prev) => ({ ...prev, [ref.item_id]: v })))
        .catch(() => setVariantMap((prev) => ({ ...prev, [ref.item_id]: [] })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRefs]);

  const filtered = items.filter((item) => {
    const label = item.display_name ?? item.name;
    return label.toLowerCase().includes(filter.toLowerCase()) ||
      (item.author?.toLowerCase().includes(filter.toLowerCase()) ?? false);
  });

  const coverFor = (item: InventoryItem) => {
    if (item.custom_cover_path) return toAssetUrl(item.custom_cover_path);
    if (item.thumbnail_url) return item.thumbnail_url;
    if (item.product_images.length > 0) {
      const p = item.product_images[0];
      return p.startsWith("http") ? p : (toAssetUrl(p) ?? null);
    }
    return null;
  };

  const getRef = (itemId: string) => selectedRefs.find((r) => r.item_id === itemId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 leading-relaxed">
        <span className="text-yellow-400 mt-0.5">⚡</span>
        <span>Los items seleccionados se extraerán automáticamente en Unity la primera vez que abras el proyecto, uno a uno, sin confirmación.</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
        <Search className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        <input
          className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
          placeholder="Buscar en inventario…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-zinc-600 text-center py-6">
          {items.length === 0 ? "Tu inventario está vacío" : "Sin resultados"}
        </p>
      ) : (
        <div className="grid grid-cols-5 gap-2 max-h-52 overflow-y-auto pr-1">
          {filtered.map((item) => {
            const label = item.display_name ?? item.name;
            const ref = getRef(item.id);
            const selected = !!ref;
            const variants = variantMap[item.id] ?? [];
            const cover = coverFor(item);
            return (
              <div key={item.id} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggle(item.id)}
                  className="w-full focus:outline-none"
                >
                  <div
                    className="relative w-full aspect-square rounded-xl overflow-hidden border-2 transition-all"
                    style={{ borderColor: selected ? "#dc2626" : "#27272a" }}
                  >
                    {cover ? (
                      <img src={cover} alt={label} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                        <Package className="h-5 w-5 text-zinc-700" />
                      </div>
                    )}
                    {selected && (
                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                        <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                  </div>
                </button>
                <p className="text-[9px] text-zinc-500 text-center leading-tight line-clamp-2 w-full px-0.5">
                  {label}
                </p>
                {/* Variant selector — visible when selected and item has variants */}
                {selected && variants.length > 0 && (
                  <div className="w-full relative">
                    <select
                      value={ref.sub_zip_name ?? ""}
                      onChange={(e) => onSetVariant(item.id, e.target.value || null)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-[9px] bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 focus:outline-none focus:border-red-600 appearance-none pr-4"
                    >
                      <option value="">Todo el paquete</option>
                      {variants.map((v) => (
                        <option key={v.id} value={v.sub_zip_name}>{v.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-zinc-600" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {selectedRefs.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-950/40 border border-red-900/40 w-fit text-xs font-medium text-red-400">
          <span>⚡</span>
          <span>{selectedRefs.length} item{selectedRefs.length !== 1 ? "s" : ""} seleccionado{selectedRefs.length !== 1 ? "s" : ""}</span>
        </div>
      )}
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

// Official VRChat packages that are world-only — excluded from avatar project picker
const WORLD_ONLY_IDS = new Set([
  "com.vrchat.worlds",
  "com.vrchat.udonsharp",
  "com.vrchat.clientsim",
]);

function getRecommendations(vcsEnabled: boolean, index: VpmPackage[]): Rec[] {
  const available = new Set(index.map((p) => p.id));
  const recs: Rec[] = [];
  const add = (id: string, label: string, reason: string, priority: number) => {
    if (available.has(id)) recs.push({ packageId: id, label, reason, priority });
  };

  // Core VRChat SDK — avatar-only
  add("com.vrchat.avatars", "VRChat SDK – Avatars", "Required for avatar uploads", 100);
  add("com.vrchat.base",    "VRChat SDK – Base",    "Core VRChat runtime",          90);

  // VCS projects benefit from non-destructive workflow
  if (vcsEnabled) {
    add("com.vrchat.vrcfury", "VRCFury", "Non-destructive avatar tools, great with Git", 55);
  }

  // Nice to have for avatars
  add("com.vrchat.gesture-manager", "GestureManager", "Preview animations in editor", 45);

  return recs.sort((a, b) => b.priority - a.priority);
}

// ── Source badge colors (matching PackagesPage) ───────────────────────────────
function pkgSourceColor(id: string): { dot: string; badge: string } {
  if (id.startsWith("com.vrchat"))  return { dot: "bg-red-400",    badge: "text-red-400"    };
  if (id.startsWith("com.poiyomi")) return { dot: "bg-pink-400",   badge: "text-pink-400"   };
  if (id.startsWith("jp.lilxyzw")) return  { dot: "bg-violet-400", badge: "text-violet-400" };
  if (id.startsWith("nadena.dev")) return  { dot: "bg-blue-400",   badge: "text-blue-400"   };
  return                                   { dot: "bg-zinc-500",   badge: "text-zinc-500"   };
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
  const [activeCategory, setActiveCategory] = useState<string>("all");
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
    const q = search.toLowerCase().trim();
    // Exclude world-only official packages from the avatar project wizard
    let base = index.filter((p) => !WORLD_ONLY_IDS.has(p.id));
    if (q) {
      base = base.filter((p) => {
        const latest = p.versions[sortedVersions(p)[0]];
        return (
          p.id.toLowerCase().includes(q) ||
          latest?.display_name?.toLowerCase().includes(q) ||
          latest?.description?.toLowerCase().includes(q)
        );
      });
    }
    if (!q && activeCategory !== "all") {
      base = base.filter((p) => categorizePackage(p.id) === activeCategory);
    }
    return base;
  }, [index, search, activeCategory]);

  const getPickerVersion = (pkg: VpmPackage) =>
    pickerVersions[pkg.id] ?? sortedVersions(pkg)[0];

  const isSelected = (id: string) => id in selected;

  const togglePackage = (pkg: VpmPackage) => {
    const ver = getPickerVersion(pkg);
    if (isSelected(pkg.id)) onChange(pkg.id, null);
    else onChange(pkg.id, ver);
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
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5 transition-colors">
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
        <p className="text-[10px] text-zinc-600">You can skip this step and install packages later.</p>
      </div>
    );
  }

  const recIds = new Set(recommendations.map((r) => r.packageId));
  const showRecs = !search.trim() && activeCategory === "all" && recommendations.length > 0;
  const listPkgs = filtered.filter((p) => !recIds.has(p.id) || search.trim() || activeCategory !== "all");

  const PkgRow = ({ pkg, recLabel }: { pkg: VpmPackage; recLabel?: string }) => {
    const versions = sortedVersions(pkg);
    const ver = getPickerVersion(pkg);
    const meta = pkg.versions[ver];
    if (!meta) return null;
    const sel = isSelected(pkg.id);
    const { dot, badge } = pkgSourceColor(pkg.id);

    return (
      <div
        className={cn(
          "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all cursor-pointer",
          sel ? "border-red-600/50 bg-red-950/20" : "border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/40"
        )}
        onClick={() => togglePackage(pkg)}
      >
        {/* Checkbox */}
        <div className={cn(
          "h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors",
          sel ? "bg-red-600 border-red-600" : "border-zinc-700 bg-zinc-900"
        )}>
          {sel && <CheckCircle2 className="h-3 w-3 text-white" />}
        </div>

        {/* Source dot */}
        <div className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-0.5", dot)} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-zinc-100 truncate">{meta.display_name}</span>
            {recLabel && (
              <span className="flex items-center gap-0.5 text-[9px] font-medium text-amber-400 bg-amber-950/40 border border-amber-900/30 rounded-full px-1.5 py-0.5 shrink-0">
                <Sparkles className="h-2 w-2" /> {recLabel}
              </span>
            )}
          </div>
          <p className={cn("text-[10px] font-mono mt-0.5 truncate", badge)}>{pkg.id}</p>
          {meta.description && (
            <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1 leading-relaxed">{meta.description}</p>
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
            className="appearance-none bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] text-zinc-400 pl-2 pr-5 py-1.5 focus:outline-none cursor-pointer"
          >
            {versions.map((v, i) => (
              <option key={v} value={v}>{v}{i === 0 ? " ★" : ""}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-zinc-600" />
        </div>
      </div>
    );
  };

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="flex-1 flex min-h-0 gap-3">
      {/* ── Left sidebar: categories ── */}
      <div className="w-36 shrink-0 flex flex-col gap-0.5 overflow-y-auto pr-1">
        <button
          onClick={() => setActiveCategory("all")}
          className={cn(
            "flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors",
            activeCategory === "all"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          )}
        >
          <Package className="h-3.5 w-3.5 shrink-0" />
          <span>All</span>
          <span className="ml-auto text-[10px] text-zinc-600">{index.filter((p) => !WORLD_ONLY_IDS.has(p.id)).length}</span>
        </button>

        <div className="my-1 border-t border-zinc-800/60" />

        {CATEGORIES.map((cat) => {
          const count = index.filter((p) => !WORLD_ONLY_IDS.has(p.id) && categorizePackage(p.id) === cat.id).length;
          if (count === 0) return null;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                activeCategory === cat.id
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              )}
            >
              <span className="shrink-0 text-sm leading-none">{cat.icon}</span>
              <span className="truncate">{cat.label}</span>
              <span className="ml-auto text-[10px] text-zinc-600 shrink-0">{count}</span>
            </button>
          );
        })}

        {selectedCount > 0 && (
          <>
            <div className="my-1 border-t border-zinc-800/60 mt-auto" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950/30 border border-red-900/30">
              <CheckCircle2 className="h-3 w-3 text-red-400 shrink-0" />
              <span className="text-[10px] font-semibold text-red-300">{selectedCount} selected</span>
            </div>
          </>
        )}
      </div>

      {/* ── Right panel: package list ── */}
      <div className="flex-1 flex flex-col min-h-0 gap-2 min-w-0">
        {/* Search */}
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
          <input
            type="text"
            placeholder="Search packages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-xs text-zinc-300 pl-8 pr-3 py-2 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
          />
        </div>

        {/* Package list */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-0.5">
          {/* Recommendations */}
          {showRecs && (
            <>
              <div className="flex items-center gap-1.5 px-1 mb-0.5">
                <Sparkles className="h-3 w-3 text-amber-400" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Recommended</p>
              </div>
              {recommendations.map((rec) => {
                const pkg = index.find((p) => p.id === rec.packageId);
                if (!pkg) return null;
                return <PkgRow key={rec.packageId} pkg={pkg} recLabel={rec.reason} />;
              })}
              {listPkgs.length > 0 && (
                <div className="my-1 border-t border-zinc-800/60" />
              )}
            </>
          )}

          {/* Package list (by category or search) */}
          {listPkgs.map((pkg) => <PkgRow key={pkg.id} pkg={pkg} />)}

          {filtered.length === 0 && search.trim() && (
            <p className="text-center text-xs text-zinc-600 py-8">No packages found for "{search}"</p>
          )}
        </div>
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [earlyImportRefs, setEarlyImportRefs] = useState<EarlyImportRef[]>([]);

  const toggleEarlyImport = useCallback((itemId: string) => {
    setEarlyImportRefs((prev) =>
      prev.some((r) => r.item_id === itemId)
        ? prev.filter((r) => r.item_id !== itemId)
        : [...prev, { item_id: itemId, sub_zip_name: null }]
    );
  }, []);

  const setEarlyImportVariant = useCallback((itemId: string, subZipName: string | null) => {
    setEarlyImportRefs((prev) =>
      prev.map((r) => r.item_id === itemId ? { ...r, sub_zip_name: subZipName } : r)
    );
  }, []);

  // ── Step 1 state
  const [installations, setInstallations] = useState<UnityInstallation[]>([]);
  const [scanning, setScanning] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [destinationDir, setDestinationDir] = useState("");
  const [unity, setUnity] = useState<UnityInstallation | null>(null);
  const [vcsEnabled, setVcsEnabled] = useState(false);
  const [coverImagePath, setCoverImagePath] = useState<string | null>(null);

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

  const pickCoverImage = async () => {
    const result = await openDialog({
      title: "Select cover image (optional)",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      multiple: false,
    }).catch(() => null);
    if (result && typeof result === "string") setCoverImagePath(result);
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

  const handleSubmit = async (explicitRefs?: EarlyImportRef[]) => {
    if (!unity) return;
    const itemRefs = explicitRefs ?? earlyImportRefs;
    setSubmitting(true);
    setSubmitError(null);
    events.reset();
    setSubmitted(true);
    try {
      let project = await tauriCreateProject({
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
        early_import_items: itemRefs,
      });
      // Apply cover image if the user picked one
      if (coverImagePath) {
        try {
          project = await tauriSetProjectCoverImage(project.id, coverImagePath);
        } catch (e) {
          console.warn("[create-project] could not set cover image:", e);
        }
      }
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
      <div className={cn(
        "w-full rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col max-h-[90vh] transition-all duration-200",
        step === 2 ? "max-w-2xl" : "max-w-xl"
      )}>
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

            {/* Cover image */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Cover Image <span className="text-zinc-600">(optional)</span>
              </label>
              <div className="flex items-center gap-3">
                {coverImagePath ? (
                  <div className="w-14 h-14 rounded-lg overflow-hidden border border-zinc-700 shrink-0">
                    <img src={`https://asset.localhost/${encodeURIComponent(coverImagePath)}`} alt="Cover" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                    <Image className="h-5 w-5 text-zinc-600" />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Shown in the icon grid and in Discord when you're working on this project.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={pickCoverImage}
                      className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                      <Image className="h-3 w-3" />
                      {coverImagePath ? "Change image" : "Select image"}
                    </button>
                    {coverImagePath && (
                      <button
                        onClick={() => setCoverImagePath(null)}
                        className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
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

          {step === 3 && (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <EarlyImportStep selectedRefs={earlyImportRefs} onToggle={toggleEarlyImport} onSetVariant={setEarlyImportVariant} />
            </div>
          )}

        <div className="border-t border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
          {step === 1 && (
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
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" /> {t("create_project_back")}
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
              >
                {t("create_project_next")} <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" /> {t("create_project_back")}
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleSubmit([])  /* Omitir: explicitly pass empty */}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40"
                >
                  {t("create_project_skip")}
                </button>
                <button
                  onClick={() => handleSubmit()}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Crear proyecto
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}