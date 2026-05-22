import { useState, useEffect, useCallback, useRef } from "react";
import { X, Package, CheckCircle2, Loader2, ExternalLink, Play } from "lucide-react";
import {
  tauriLaunchUnityForProject,
  tauriCheckUnityRunning,
  tauriImportItemsInUnity,
  tauriFindUnityForVersion,
} from "@/lib/tauri";
import type { InventoryItem, Project } from "@/lib/tauri";
import { GlobalProjectPickerModal } from "@/components/shared/GlobalProjectPickerModal";
import { useProjectsStore } from "@/store/projects";
import { useT } from "@/i18n";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

interface Props {
  items: InventoryItem[];
  onClose: () => void;
}

type Phase = "pick-project" | "waiting-for-unity" | "importing-step" | "done" | "error";

export function OpenInUnityModal({ items, onClose }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("pick-project");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const { markProjectOpen } = useProjectsStore();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unityReady, setUnityReady] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepBusy, setStepBusy] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const importStartedRef = useRef(false);

  const openSingleItem = useCallback(async (project: Project, itemPath: string) => {
    setStepBusy(true);
    try {
      await tauriImportItemsInUnity(project.path, [itemPath]);
    } catch (e) {
      setErrorMsg(String(e));
      setPhase("error");
      throw e;
    } finally {
      setStepBusy(false);
    }
  }, []);

  const handleNextStep = useCallback(async () => {
    if (!selectedProject) return;
    const next = currentStep + 1;
    if (next >= items.length) {
      setPhase("done");
      return;
    }
    setCurrentStep(next);
    await openSingleItem(selectedProject, items[next].local_path);
  }, [selectedProject, currentStep, items, openSingleItem]);

  const handleProjectSelected = useCallback(
    async (project: Project, _isRunning: boolean) => {
      setSelectedProject(project);
      markProjectOpen(project.id);
      setUnityReady(false);
      setPhase("waiting-for-unity");
      try {
        const unityPath =
          (await tauriFindUnityForVersion(project.unity_version).catch(() => null)) ?? "";
        await tauriLaunchUnityForProject(project.path, unityPath);
      } catch (e) {
        setErrorMsg(String(e));
        setPhase("error");
      }
    },
    [markProjectOpen]
  );

  const handleImportNow = useCallback(async () => {
    if (!selectedProject || importStartedRef.current) return;
    importStartedRef.current = true;
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setCurrentStep(0);
    setPhase("importing-step");
    await openSingleItem(selectedProject, items[0].local_path);
  }, [selectedProject, items, openSingleItem]);

  useEffect(() => {
    if (phase !== "waiting-for-unity" || !selectedProject) return;
    const check = async () => {
      try {
        const running = await tauriCheckUnityRunning(selectedProject.path);
        setUnityReady(running);
      } catch { /* ignore */ }
    };
    check();
    pollingRef.current = setInterval(check, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [phase, selectedProject]);

  if (phase === "pick-project") {
    const subtitle = items.length === 1
      ? t("open_in_unity_subtitle_one")
      : t("open_in_unity_subtitle_multiple", { count: items.length });
    return (
      <GlobalProjectPickerModal
        title={t("open_in_unity_title")}
        subtitle={subtitle}
        onClose={onClose}
        onSelect={handleProjectSelected}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-950/60 border border-violet-900/50 p-1.5">
              <ExternalLink className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">{t("open_in_unity_title")}</h3>
              {selectedProject && (
                <p className="text-[10px] text-zinc-500 truncate max-w-[220px]">
                  {selectedProject.name}
                </p>
              )}
            </div>
          </div>
          {(phase === "done" || phase === "error") && (
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {/* Waiting for Unity */}
          {phase === "waiting-for-unity" && (
            <div className="flex flex-col gap-4">
              <div
                className={cn(
                  "rounded-xl border p-4 flex items-center gap-3 transition-all duration-500",
                  unityReady
                    ? "border-emerald-900/60 bg-emerald-950/20"
                    : "border-violet-900/40 bg-violet-950/20"
                )}
              >
                {unityReady ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                ) : (
                  <Loader2 className="h-5 w-5 text-violet-400 animate-spin shrink-0" />
                )}
                <div>
                  <p className={cn("text-xs font-semibold transition-colors", unityReady ? "text-emerald-300" : "text-violet-300")}>
                    {unityReady ? t("open_in_unity_ready") : t("open_in_unity_waiting")}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {unityReady ? t("open_in_unity_ready_desc") : t("open_in_unity_waiting_desc")}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
                    <Package className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <p className="text-xs text-zinc-500 truncate">{item.display_name ?? item.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step-by-step import */}
          {phase === "importing-step" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1">
                <span>{t("open_in_unity_step", { current: currentStep + 1, total: items.length })}</span>
                <span className="text-zinc-600 truncate max-w-[180px]">{items[currentStep]?.display_name ?? items[currentStep]?.name}</span>
              </div>
              <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
                {items.map((item, i) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all",
                      i < currentStep
                        ? "border-emerald-900/50 bg-emerald-950/20"
                        : i === currentStep
                        ? "border-violet-900/50 bg-violet-950/20"
                        : "border-zinc-800/60 bg-zinc-900/40"
                    )}
                  >
                    {i < currentStep ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : i === currentStep ? (
                      <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin shrink-0" />
                    ) : (
                      <Package className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    )}
                    <p className={cn("text-xs truncate", i < currentStep ? "text-emerald-300" : i === currentStep ? "text-violet-300" : "text-zinc-500")}>
                      {item.display_name ?? item.name}
                    </p>
                  </div>
                ))}
              </div>
              {!stepBusy && (
                <p className="text-[11px] text-zinc-400 text-center">{t("open_in_unity_instruction")}</p>
              )}
            </div>
          )}

          {/* Done */}
          {phase === "done" && (
            <div className="flex items-center justify-center gap-2 py-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <p className="text-sm font-medium text-emerald-300">{t("open_in_unity_success")}</p>
            </div>
          )}

          {/* Error */}
          {phase === "error" && (
            <div className="flex items-start gap-2 rounded-xl bg-red-950/30 border border-red-900/40 px-4 py-3">
              <p className="text-xs text-red-400">{errorMsg ?? t("open_in_unity_error_unknown")}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 shrink-0 flex flex-col gap-2">
          {phase === "waiting-for-unity" && (
            <button
              onClick={handleImportNow}
              disabled={!unityReady}
              className={cn(
                "w-full py-2.5 rounded-xl text-xs font-semibold transition-all duration-300 flex items-center justify-center gap-2",
                unityReady
                  ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/30"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              )}
            >
              <Play className="h-3.5 w-3.5" />
              {t("open_in_unity_import_now")}
            </button>
          )}
          {phase === "importing-step" && !stepBusy && (
            <button
              onClick={handleNextStep}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
              {currentStep + 1 < items.length
                ? t("open_in_unity_next", { next: currentStep + 2, total: items.length })
                : t("open_in_unity_finish")}
            </button>
          )}
          {phase === "importing-step" && stepBusy && (
            <button disabled className="w-full py-2.5 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-500 flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("open_in_unity_opening")}
            </button>
          )}
          {(phase === "done" || phase === "error") && (
            <button onClick={onClose} className="w-full py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors">
              {t("common_close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}