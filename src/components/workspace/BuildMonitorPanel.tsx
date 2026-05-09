import { useState, useEffect, useRef } from "react";
import type { Project } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Hammer, Play, Square, Clock, RotateCcw } from "lucide-react";
import { useT } from "@/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

type BuildEventKind =
  | { kind: "build_started" }
  | { kind: "build_finished"; total_ms: number }
  | { kind: "phase_started"; phase: string; label: string }
  | { kind: "phase_finished"; phase: string; duration_ms: number }
  | { kind: "log_line"; text: string };

interface PhaseState {
  phase: string;
  label: string;
  status: "pending" | "running" | "done";
  duration_ms: number | null;
  startedAt: number | null;
}

interface BuildRun {
  startedAt: number;
  finishedAt: number | null;
  total_ms: number | null;
  phases: PhaseState[];
}

const PHASE_AVG_MS: Record<string, number> = {
  asset_detect:   800,
  script_compile: 12000,
  shader_compile: 5000,
  asset_import:   3000,
  domain_reload:  4000,
};

const PHASE_ORDER = ["asset_detect", "script_compile", "shader_compile", "asset_import", "domain_reload"];

function formatMs(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function PhaseRow({ phase, tick }: { phase: PhaseState; tick: number }) {
  const elapsed   = phase.startedAt ? tick - phase.startedAt : 0;
  const estimated = PHASE_AVG_MS[phase.phase] ?? 5000;
  const progress  =
    phase.status === "done"    ? 100 :
    phase.status === "running" ? Math.min(95, (elapsed / estimated) * 100) : 0;

  const barColor =
    phase.status === "done"    ? "bg-green-500" :
    phase.status === "running" ? "bg-red-500 animate-pulse" : "bg-zinc-700";

  const textColor =
    phase.status === "done"    ? "text-green-400" :
    phase.status === "running" ? "text-zinc-100"  : "text-zinc-600";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {phase.status === "done"    && <span className="text-green-400 text-xs">✓</span>}
          {phase.status === "running" && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
          )}
          {phase.status === "pending" && <span className="h-2 w-2 rounded-full bg-zinc-700" />}
          <span className={`text-xs font-medium ${textColor}`}>{phase.label}</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500">
          {phase.status === "done" && phase.duration_ms != null
            ? formatMs(phase.duration_ms)
            : phase.status === "running"
            ? formatMs(elapsed)
            : "—"}
        </span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function HistoryRow({ run }: { run: BuildRun }) {
  const t = useT();
  const time  = new Date(run.startedAt).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const total      = run.total_ms != null ? formatMs(run.total_ms) : "—";
  const donePhases = run.phases.filter((p) => p.status === "done").length;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
      <Hammer className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-300 font-mono">{time}</p>
        <p className="text-[10px] text-zinc-600">{t("ws_build_phases", { done: donePhases, total: run.phases.length })}</p>
      </div>
      <span className="text-xs font-mono text-zinc-400 shrink-0">{total}</span>
    </div>
  );
}

interface Props {
  project: Project;
}

export function BuildMonitorPanel({ project: _project }: Props) {
  const t = useT();
  const [monitoring, setMonitoring]       = useState(false);
  const [currentPhases, setCurrentPhases] = useState<PhaseState[]>([]);
  const [buildActive, setBuildActive]     = useState(false);
  const [lastTotal, setLastTotal]         = useState<number | null>(null);
  const [history, setHistory]             = useState<BuildRun[]>([]);
  const [logLines, setLogLines]           = useState<string[]>([]);
  const [tick, setTick]                   = useState(Date.now());
  const [eta, setEta]                     = useState<number | null>(null);
  const currentRunRef = useRef<BuildRun | null>(null);
  const logBottomRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!buildActive) return;
    const id = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(id);
  }, [buildActive]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  useEffect(() => {
    if (!buildActive) { setEta(null); return; }
    const remaining = currentPhases
      .filter((p) => p.status !== "done")
      .reduce((acc, p) => {
        const avg = PHASE_AVG_MS[p.phase] ?? 5000;
        if (p.status === "running" && p.startedAt) {
          return acc + Math.max(0, avg - (Date.now() - p.startedAt));
        }
        return acc + avg;
      }, 0);
    setEta(remaining);
  }, [currentPhases, buildActive, tick]);

  useEffect(() => {
    if (!monitoring) return;
    const unlisten = listen<BuildEventKind>("build:event", (event) => {
      const ev = event.payload;

      if (ev.kind === "build_started") {
        const run: BuildRun = { startedAt: Date.now(), finishedAt: null, total_ms: null, phases: [] };
        currentRunRef.current = run;
        setBuildActive(true);
        setCurrentPhases([]);
        setLogLines([]);
      }

      if (ev.kind === "phase_started") {
        const newPhase: PhaseState = {
          phase: ev.phase, label: ev.label,
          status: "running", duration_ms: null, startedAt: Date.now(),
        };
        setCurrentPhases((prev) => {
          const without = prev.filter((p) => p.phase !== ev.phase);
          return [...without, newPhase].sort(
            (a, b) => (PHASE_ORDER.indexOf(a.phase) ?? 99) - (PHASE_ORDER.indexOf(b.phase) ?? 99)
          );
        });
        if (currentRunRef.current) {
          currentRunRef.current.phases = [
            ...currentRunRef.current.phases.filter((p) => p.phase !== ev.phase),
            newPhase,
          ];
        }
      }

      if (ev.kind === "phase_finished") {
        setCurrentPhases((prev) =>
          prev.map((p) =>
            p.phase === ev.phase ? { ...p, status: "done", duration_ms: ev.duration_ms } : p
          )
        );
        if (currentRunRef.current) {
          currentRunRef.current.phases = currentRunRef.current.phases.map((p) =>
            p.phase === ev.phase ? { ...p, status: "done", duration_ms: ev.duration_ms } : p
          );
        }
      }

      if (ev.kind === "build_finished") {
        setBuildActive(false);
        setLastTotal(ev.total_ms);
        if (currentRunRef.current) {
          const finished: BuildRun = { ...currentRunRef.current, finishedAt: Date.now(), total_ms: ev.total_ms };
          setHistory((h) => [finished, ...h.slice(0, 9)]);
          currentRunRef.current = null;
        }
      }

      if (ev.kind === "log_line") {
        setLogLines((prev) => [...prev.slice(-199), ev.text]);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [monitoring]);

  const startMonitor = async () => {
    await invoke("start_build_monitor");
    setMonitoring(true);
  };

  const stopMonitor = async () => {
    await invoke("stop_build_monitor");
    setMonitoring(false);
    setBuildActive(false);
  };

  const reset = () => {
    setCurrentPhases([]);
    setLogLines([]);
    setLastTotal(null);
    setBuildActive(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 shrink-0">
        <Hammer className="h-4 w-4 text-zinc-500" />
        <span className="text-sm font-semibold text-zinc-200">{t("ws_build_title")}</span>
        <span className="text-[10px] text-zinc-600">{t("ws_build_subtitle")}</span>

        <div className="ml-auto flex items-center gap-2">
          {lastTotal != null && !buildActive && (
            <span className="text-[10px] font-mono text-zinc-500">
              {t("ws_build_last", { time: formatMs(lastTotal) })}
            </span>
          )}
          {buildActive && eta != null && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-yellow-400">
              <Clock className="h-3 w-3" />
              {t("ws_build_remaining", { time: formatMs(eta) })}
            </span>
          )}
          <button
            onClick={reset}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            title={t("ws_build_reset")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {monitoring ? (
            <button
              onClick={stopMonitor}
              className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-red-400 border border-zinc-700 rounded px-3 py-1 transition-colors"
            >
              <Square className="h-3 w-3" />
              {t("ws_build_stop")}
            </button>
          ) : (
            <button
              onClick={startMonitor}
              className="flex items-center gap-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded px-3 py-1 transition-colors"
            >
              <Play className="h-3 w-3" />
              {t("ws_build_start")}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Left column: phases + history */}
        <div className="w-72 shrink-0 flex flex-col border-r border-zinc-800 overflow-y-auto">
          <div className="p-4 border-b border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {t("ws_build_current_build")}
              </span>
              {buildActive && (
                <span className="flex items-center gap-1 text-[10px] text-red-400 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400 inline-block" />
                  {t("ws_build_in_progress")}
                </span>
              )}
            </div>

            {!monitoring && (
              <p className="text-xs text-zinc-600">
                {t("ws_build_start_hint")}
              </p>
            )}

            {monitoring && !buildActive && currentPhases.length === 0 && (
              <p className="text-xs text-zinc-600 animate-pulse">
                {t("ws_build_waiting")}
              </p>
            )}

            {currentPhases.length > 0 && (
              <div className="flex flex-col gap-3">
                {currentPhases.map((phase) => (
                  <PhaseRow key={phase.phase} phase={phase} tick={tick} />
                ))}

                {buildActive && (
                  <div className="pt-2 border-t border-zinc-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{t("ws_build_total")}</span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        {formatMs(tick - (currentRunRef.current?.startedAt ?? tick))}
                      </span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-600/60 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(95,
                            (currentPhases.filter((p) => p.status === "done").length /
                            Math.max(currentPhases.length, 1)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                {t("ws_build_history")}
              </p>
              <div className="flex flex-col gap-2">
                {history.map((run, i) => (
                  <HistoryRow key={i} run={run} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: raw log */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2 border-b border-zinc-800 shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              {t("ws_build_log")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] text-zinc-400 space-y-0.5">
            {logLines.length === 0 && (
              <p className="text-zinc-700">{t("ws_build_no_activity")}</p>
            )}
            {logLines.map((line, i) => (
              <div key={i} className="leading-relaxed whitespace-pre-wrap break-all hover:text-zinc-200">
                {line}
              </div>
            ))}
            <div ref={logBottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
}