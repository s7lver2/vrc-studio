/**
 * ToolsSection — ajustes del sistema de tools:
 * • Rama del registry de tools (main vs feature/tools-system vs custom)
 * • Botón de forzar refresco de caché
 */

import { useCallback, useEffect, useState } from "react";
import { GitBranch, RefreshCw, CheckCircle2, AlertTriangle, Loader2, Wrench } from "lucide-react";
import { tauriGetAppSettings, tauriSetAppSettings, tauriToolsClearRegistryCache } from "@/lib/tauri";
import { useToolsStore } from "@/store/toolsStore";

// Branches in the vrcstudio-tools repo (https://github.com/s7lver2/vrcstudio-tools)
const KNOWN_BRANCHES = [
  {
    value: "main",
    label: "main",
    description: "Stable production registry. Only fully released tools.",
    badge: "stable",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
] as const;

type ClearState = "idle" | "running" | "done" | "error";

export function ToolsSection() {
  const [branch, setBranch] = useState<string>("main");
  const [customBranch, setCustomBranch] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearState, setClearState] = useState<ClearState>("idle");
  const [clearError, setClearError] = useState<string | null>(null);

  const fetchRegistry = useToolsStore((s) => s.fetchRegistry);

  // ── Load current setting ────────────────────────────────────────────────
  useEffect(() => {
    tauriGetAppSettings().then((s) => {
      const b = s.tools_registry_branch || "main";
      const isKnown = KNOWN_BRANCHES.some((k) => k.value === b);
      if (isKnown) {
        setBranch(b);
        setUseCustom(false);
      } else if (b === "feature/tools-system") {
        // Migrated: this branch no longer exists in vrcstudio-tools — reset to main
        setBranch("main");
        setUseCustom(false);
        saveBranch("main");
      } else {
        setBranch(KNOWN_BRANCHES[0].value);
        setCustomBranch(b);
        setUseCustom(true);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist branch ──────────────────────────────────────────────────────
  const saveBranch = useCallback(async (newBranch: string) => {
    setSaving(true);
    try {
      const current = await tauriGetAppSettings();
      await tauriSetAppSettings({ ...current, tools_registry_branch: newBranch });
    } catch (e) {
      console.error("Failed to save tools_registry_branch:", e);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSelectBranch = useCallback(
    async (value: string) => {
      setBranch(value);
      setUseCustom(false);
      await saveBranch(value);
    },
    [saveBranch]
  );

  const handleCustomBranchApply = useCallback(async () => {
    const trimmed = customBranch.trim();
    if (!trimmed) return;
    await saveBranch(trimmed);
  }, [customBranch, saveBranch]);

  // ── Clear cache + refetch ───────────────────────────────────────────────
  const handleClearAndRefresh = useCallback(async () => {
    setClearState("running");
    setClearError(null);
    try {
      await tauriToolsClearRegistryCache();
      await fetchRegistry();
      setClearState("done");
      // auto-reset after 2.5s
      setTimeout(() => setClearState("idle"), 2500);
    } catch (e) {
      setClearError(String(e));
      setClearState("error");
    }
  }, [fetchRegistry]);

  const effectiveBranch = useCustom ? customBranch.trim() || "main" : branch;
  const repoUrl = `https://github.com/s7lver2/vrc-studio/tree/${effectiveBranch}/tools-registry`;

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-4 pb-6 border-b border-zinc-800/60 mb-6">
        <div className="flex-shrink-0 p-2.5 rounded-xl bg-zinc-800 border border-zinc-700/50">
          <Wrench className="h-5 w-5 text-zinc-300" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Tools</h1>
          <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">
            Registry source and cache settings for the Tools Marketplace.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-7">

        {/* ── Registry branch ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            Registry Branch
          </p>
          <p className="text-xs text-zinc-500 leading-relaxed -mt-1">
            Controls which branch of{" "}
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors"
            >
              s7lver2/vrc-studio
            </a>{" "}
            is used to load the tools registry. Switch to the dev branch to access
            tools that are still being developed.
          </p>

          {/* Known branch options */}
          <div className="flex flex-col gap-2">
            {KNOWN_BRANCHES.map((b) => {
              const active = !useCustom && branch === b.value;
              return (
                <button
                  key={b.value}
                  onClick={() => handleSelectBranch(b.value)}
                  disabled={saving}
                  className={[
                    "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60",
                    active
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800/60",
                  ].join(" ")}
                >
                  <div className="mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: active ? "rgb(139 92 246)" : "rgb(63 63 70)",
                      background: active ? "rgb(139 92 246)" : "transparent",
                    }}
                  >
                    {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm ${active ? "text-white" : "text-zinc-300"}`}>
                        {b.label}
                      </span>
                      <span className={`text-[10px] font-semibold border rounded px-1.5 py-0.5 ${b.badgeColor}`}>
                        {b.badge}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{b.description}</p>
                  </div>
                </button>
              );
            })}

            {/* Custom branch option */}
            <button
              onClick={() => { setUseCustom(true); setBranch(""); }}
              disabled={saving}
              className={[
                "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60",
                useCustom
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800/60",
              ].join(" ")}
            >
              <div className="mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: useCustom ? "rgb(139 92 246)" : "rgb(63 63 70)",
                  background: useCustom ? "rgb(139 92 246)" : "transparent",
                }}
              >
                {useCustom && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${useCustom ? "text-white" : "text-zinc-400"}`}>
                  Custom branch
                </span>
                <p className="text-xs text-zinc-500 mt-0.5">Enter any branch name manually.</p>
              </div>
            </button>

            {/* Custom branch input — visible when useCustom */}
            {useCustom && (
              <div className="ml-7 flex items-center gap-2">
                <input
                  type="text"
                  value={customBranch}
                  onChange={(e) => setCustomBranch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCustomBranchApply(); }}
                  placeholder="e.g. feature/my-tool"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-colors"
                />
                <button
                  onClick={handleCustomBranchApply}
                  disabled={saving || !customBranch.trim()}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                </button>
              </div>
            )}
          </div>

          {/* Current effective branch indicator */}
          <div className="flex items-center gap-2 text-xs text-zinc-600 mt-1">
            <GitBranch className="h-3 w-3" />
            <span>
              Registry URL:{" "}
              <span className="font-mono text-zinc-400">
                raw.githubusercontent.com/s7lver2/vrc-studio/<span className="text-violet-400">{effectiveBranch}</span>/tools-registry/registry.json
              </span>
            </span>
          </div>
        </div>

        {/* ── Cache management ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Registry Cache
          </p>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Force refresh</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Clears the local registry cache (1-hour TTL) and re-fetches from the selected branch immediately.
                  Useful after pushing changes to the registry.
                </p>
              </div>

              {clearState === "done" ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
                  <CheckCircle2 className="h-4 w-4" />
                  Refreshed
                </div>
              ) : clearState === "error" ? (
                <div className="flex items-center gap-1.5 text-xs text-red-400 shrink-0">
                  <AlertTriangle className="h-4 w-4" />
                  Failed
                </div>
              ) : (
                <button
                  onClick={handleClearAndRefresh}
                  disabled={clearState === "running"}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${clearState === "running" ? "animate-spin" : ""}`} />
                  {clearState === "running" ? "Refreshing…" : "Refresh now"}
                </button>
              )}
            </div>

            {clearError && (
              <div className="px-5 pb-4">
                <p className="text-xs text-red-400">{clearError}</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}