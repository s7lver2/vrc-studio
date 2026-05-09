/**
 * ScanProjectsWizard — 2-step wizard to scan the drive for existing Unity
 * projects and import them into the panel without recreating any files.
 */

import { useState, useRef, useCallback } from "react";
import {
  X, HardDrive, Search, FolderOpen, ChevronRight,
  Loader2, CheckCircle2, AlertTriangle, Check,
  TerminalSquare, FolderSearch, Pencil, GitBranch,
  ChevronDown, ChevronUp,
} from "lucide-react";
import {
  tauriScanForProjects,
  tauriImportExistingProject,
  ScannedProject,
  Project,
} from "@/lib/tauri";
import { useT } from "@/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScanEntry extends ScannedProject {
  displayName: string;
  importState: "pending" | "importing" | "done" | "skipped" | "error";
  importError?: string;
}

type WizardStep = 1 | 2;
type ScanStatus = "idle" | "scanning" | "done" | "error";

// ── Helper ────────────────────────────────────────────────────────────────────

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ── Inline name editor ────────────────────────────────────────────────────────

function InlineNameEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="flex-1 bg-zinc-800 border border-red-600 rounded px-2 py-0.5 text-xs text-zinc-100 outline-none min-w-0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      className="flex items-center gap-1 group min-w-0"
      onClick={() => { setDraft(value); setEditing(true); }}
      title={t("scan_projects_rename_hint")}
    >
      <span className="text-xs font-medium text-zinc-100 truncate">{value}</span>
      <Pencil className="h-3 w-3 text-zinc-600 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
    </button>
  );
}

// ── Project row ───────────────────────────────────────────────────────────────

function ProjectRow({
  entry,
  selected,
  onToggle,
  onRename,
}: {
  entry: ScanEntry;
  selected: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const isImporting = entry.importState === "importing";
  const isDone = entry.importState === "done";
  const isError = entry.importState === "error";
  const isSkipped = entry.importState === "skipped";

  return (
    <div
      className={cn(
        "rounded-xl border transition-all",
        isDone   && "border-green-700/50 bg-green-950/20",
        isError  && "border-red-700/50 bg-red-950/20",
        isSkipped || entry.already_imported
               ? "border-zinc-800/50 opacity-60"
               : selected
               ? "border-red-600/60 bg-red-950/10"
               : "border-zinc-800 bg-zinc-900/50",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Checkbox / status icon */}
        <div className="shrink-0 w-5 flex items-center justify-center">
          {isImporting ? (
            <Loader2 className="h-4 w-4 text-red-400 animate-spin" />
          ) : isDone ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          ) : isError ? (
            <AlertTriangle className="h-4 w-4 text-red-400" />
          ) : entry.already_imported ? (
            <CheckCircle2 className="h-4 w-4 text-zinc-600" aria-label={t("scan_projects_import", { count: 0, s: "" })} /> 
          ) : (
            <button
              onClick={onToggle}
              className={cn(
                "h-4 w-4 rounded border transition-colors flex items-center justify-center",
                selected
                  ? "bg-red-600 border-red-600"
                  : "border-zinc-600 hover:border-zinc-400 bg-transparent"
              )}
            >
              {selected && <Check className="h-2.5 w-2.5 text-white" />}
            </button>
          )}
        </div>

        {/* Folder icon */}
        <div className="shrink-0 h-8 w-8 rounded-lg bg-zinc-800 flex items-center justify-center">
          <FolderSearch className="h-4 w-4 text-zinc-400" />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            {entry.importState === "pending" && !entry.already_imported ? (
              <InlineNameEditor value={entry.displayName} onChange={onRename} />
            ) : (
              <span className="text-xs font-medium text-zinc-200 truncate">
                {entry.displayName}
              </span>
            )}
            {entry.already_imported && (
              <span className="shrink-0 text-[9px] px-1.5 py-px rounded-full bg-zinc-700 text-zinc-400 border border-zinc-600">
                {t("scan_projects_imported")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-mono">{entry.unity_version}</span>
            {entry.path.includes(".git") || true ? null : null}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isError && (
            <span className="text-[10px] text-red-400 max-w-[120px] truncate" title={entry.importError}>
              {entry.importError}
            </span>
          )}
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Expanded: show full path */}
      {expanded && (
        <div className="px-3 pb-2.5 border-t border-zinc-800/50 pt-2">
          <p className="text-[10px] text-zinc-600 font-mono break-all">{entry.path}</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onImported: (projects: Project[]) => void;
}

export function ScanProjectsWizard({ onClose, onImported }: Props) {
  const t = useT();
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1
  const [rootDir, setRootDir] = useState<string | null>(null);

  // Step 2
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<string[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [importPhase, setImportPhase] = useState<"idle" | "importing" | "done">("idle");
  const [importedProjects, setImportedProjects] = useState<Project[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ── Step 1 actions ──────────────────────────────────────────────────────────

  const pickFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({ directory: true, multiple: false });
      if (typeof result === "string") setRootDir(result);
    } catch { /* dialog plugin not available */ }
  };

  const startScan = async () => {
    if (!rootDir) return;
    setStep(2);
    setScanStatus("scanning");
    abortRef.current = false;
    setEntries([]);
    setLogs([]);
    setSelected(new Set());
    setImportPhase("idle");
    setImportedProjects([]);

    addLog(`Scanning: ${rootDir}`);

    try {
      const found = await tauriScanForProjects(rootDir);
      addLog(`Found ${found.length} Unity project(s).`);

      const initialEntries: ScanEntry[] = found.map((p) => ({
        ...p,
        displayName: p.name,
        importState: "pending",
      }));
      setEntries(initialEntries);

      // Auto-select non-already-imported projects
      const autoSelect = new Set(
        initialEntries.filter((e) => !e.already_imported).map((e) => e.path)
      );
      setSelected(autoSelect);

      setScanStatus("done");
      addLog(
        found.length === 0
          ? "No Unity projects found in the selected directory."
          : `${autoSelect.size} project(s) ready to import.`
      );
    } catch (e: any) {
      addLog(`Scan error: ${e?.message ?? String(e)}`);
      setScanStatus("error");
    }
  };

  // ── Step 2 actions ──────────────────────────────────────────────────────────

  const toggleEntry = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    const importable = entries.filter((e) => !e.already_imported).map((e) => e.path);
    setSelected((prev) =>
      prev.size === importable.length ? new Set() : new Set(importable)
    );
  };

  const renameEntry = (path: string, name: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.path === path ? { ...e, displayName: name } : e))
    );
  };

  const importSelected = async () => {
    const toImport = entries.filter(
      (e) => selected.has(e.path) && !e.already_imported
    );
    if (toImport.length === 0) return;

    setImportPhase("importing");
    const imported: Project[] = [];

    for (const entry of toImport) {
      setEntries((prev) =>
        prev.map((e) => e.path === entry.path ? { ...e, importState: "importing" } : e)
      );
      addLog(`Importing: ${entry.displayName} …`);

      try {
        const project = await tauriImportExistingProject(entry.path, entry.displayName);
        imported.push(project);
        addLog(`  ✓ Imported as "${project.name}" (Unity ${project.unity_version})`);
        setEntries((prev) =>
          prev.map((e) => e.path === entry.path ? { ...e, importState: "done" } : e)
        );
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        addLog(`  ✗ Failed: ${msg}`);
        setEntries((prev) =>
          prev.map((e) =>
            e.path === entry.path ? { ...e, importState: "error", importError: msg } : e
          )
        );
      }
    }

    setImportedProjects(imported);
    setImportPhase("done");
    addLog(`Import complete. ${imported.length} project(s) added.`);
    if (imported.length > 0) onImported(imported);
  };

  // ── Derived state ───────────────────────────────────────────────────────────

  const importableCount = entries.filter((e) => !e.already_imported).length;
  const selectedCount = [...selected].filter(
    (p) => !entries.find((e) => e.path === p)?.already_imported
  ).length;
  const doneCount = entries.filter((e) => e.importState === "done").length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-red-600/20 border border-red-600/40 flex items-center justify-center">
              <HardDrive className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">{t("scan_projects_title")}</h2>
              <p className="text-[11px] text-zinc-500">
                {step === 1
                  ? t("scan_projects_root_label")
                  : scanStatus === "scanning"
                  ? t("scan_projects_scanning")
                  : t("scan_projects_done", { count: entries.length, s: entries.length !== 1 ? "s" : "" })}
              </p>
            </div>
          </div>

          {/* Step pills */}
          <div className="flex items-center gap-2">
            {([1, 2] as const).map((s) => (
              <div
                key={s}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border",
                  step === s
                    ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                    : s < step
                    ? "bg-green-900/40 border-green-700/50 text-green-400"
                    : "bg-zinc-900 border-zinc-800 text-zinc-600"
                )}
              >
                {s < step ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <span className="w-3 h-3 flex items-center justify-center text-[10px] font-mono">{s}</span>
                )}
                <span>{s === 1 ? t("scan_projects_step1") : t("scan_projects_step2")}</span>
              </div>
            ))}
            <button
              onClick={onClose}
              className="ml-2 h-7 w-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Step 1: Configure ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
            {/* Root directory */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-300">{t("scan_projects_root_label")}</label>
              <p className="text-[11px] text-zinc-500">
                Select a folder. The wizard will search all subdirectories (up to 6 levels deep)
                for Unity projects, identified by the presence of{" "}
                <code className="text-zinc-400 font-mono">ProjectSettings/ProjectVersion.txt</code>.
              </p>
              <div className="flex gap-2">
                <div
                  className={cn(
                    "flex-1 flex items-center bg-zinc-800 border rounded-lg px-3 py-2 text-sm",
                    rootDir
                      ? "border-zinc-700 text-zinc-200"
                      : "border-dashed border-zinc-600 text-zinc-600"
                  )}
                >
                  {rootDir ? (
                    <span className="truncate font-mono text-xs">{rootDir}</span>
                  ) : (
                    <span className="text-xs italic">{t("scan_projects_root_placeholder")}</span>
                  )}
                </div>
                <button
                  onClick={pickFolder}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 text-zinc-200 text-xs font-medium transition-colors whitespace-nowrap"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("scan_projects_browse")}
                </button>
              </div>
              {rootDir && (
                <button
                  onClick={() => setRootDir(null)}
                  className="self-start text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  × {t("scan_projects_clear")}
                </button>
              )}
            </div>

            {/* Info box */}
            <div className="rounded-xl bg-blue-950/30 border border-blue-800/50 px-4 py-3 flex flex-col gap-1">
              <p className="text-xs font-medium text-blue-300 flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" /> How it works
              </p>
              <ul className="text-[11px] text-blue-400/80 space-y-1 list-disc list-inside leading-relaxed">
                <li>Scans subdirectories for <code className="font-mono">ProjectSettings/ProjectVersion.txt</code></li>
                <li>Reads the Unity version from each project automatically</li>
                <li>Detects if a Git repository is present and marks VCS as enabled</li>
                <li>Projects already in your panel are shown greyed out (won't be re-imported)</li>
                <li>You can rename each project before importing</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── Step 2: Scan results ──────────────────────────────────────────── */}
        {step === 2 && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Phase banner */}
            {scanStatus === "scanning" && (
              <div className="flex items-center gap-3 px-6 py-3 bg-blue-950/30 border-b border-blue-800/40 shrink-0">
                <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />
                <p className="text-xs text-blue-300">
                  {t("scan_projects_scanning")} <span className="font-mono text-blue-400">{rootDir}</span>…
                </p>
              </div>
            )}

            {scanStatus === "done" && entries.length > 0 && importPhase === "idle" && (
              <div className="flex items-center gap-3 px-6 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
                <button
                  onClick={toggleAll}
                  className={cn(
                    "h-4 w-4 rounded border transition-colors flex items-center justify-center shrink-0",
                    selectedCount === importableCount && importableCount > 0
                      ? "bg-red-600 border-red-600"
                      : "border-zinc-600 hover:border-zinc-400"
                  )}
                >
                  {selectedCount === importableCount && importableCount > 0 && (
                    <Check className="h-2.5 w-2.5 text-white" />
                  )}
                </button>
                <p className="text-xs text-zinc-400 flex-1">
                  {t("scan_projects_selected_count", { selected: selectedCount, importable: importableCount })}
                </p>
                <span className="text-[10px] text-zinc-600">
                  {t("scan_projects_rename_hint")}
                </span>
              </div>
            )}

            {scanStatus === "done" && entries.length === 0 && (
              <div className="flex items-center gap-3 px-6 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300">{t("scan_projects_no_results")}</p>
              </div>
            )}

            {importPhase === "done" && (
              <div className="flex items-center gap-3 px-6 py-3 bg-green-950/30 border-b border-green-800/40 shrink-0">
                <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                <p className="text-xs text-green-300">
                  {t("scan_projects_done", { count: doneCount, s: doneCount !== 1 ? "s" : "" })}
                </p>
              </div>
            )}

            {/* Project list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
              {scanStatus === "scanning" && (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 flex items-center gap-3 px-3 py-2.5">
                    <div className="w-5 h-5 bg-zinc-800 rounded animate-pulse shrink-0" />
                    <div className="w-8 h-8 bg-zinc-800 rounded-lg animate-pulse shrink-0" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="h-3 bg-zinc-800 rounded animate-pulse w-48" />
                      <div className="h-2.5 bg-zinc-800/70 rounded animate-pulse w-32" />
                    </div>
                  </div>
                ))
              )}

              {entries.map((entry) => (
                <ProjectRow
                  key={entry.path}
                  entry={entry}
                  selected={selected.has(entry.path)}
                  onToggle={() => toggleEntry(entry.path)}
                  onRename={(name) => renameEntry(entry.path, name)}
                />
              ))}
            </div>

            {/* Console */}
            <div className="shrink-0 border-t border-zinc-800">
              <button
                className="w-full flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 transition-colors"
                onClick={() => setConsoleOpen((v) => !v)}
              >
                <TerminalSquare className="h-3.5 w-3.5" />
                <span>Console</span>
                <span className="text-[10px] ml-1 text-zinc-700">{logs.length} events</span>
                {consoleOpen ? (
                  <ChevronDown className="h-3 w-3 ml-auto" />
                ) : (
                  <ChevronUp className="h-3 w-3 ml-auto" />
                )}
              </button>
              {consoleOpen && (
                <div className="bg-zinc-950 border-t border-zinc-800/50 px-4 py-3 max-h-32 overflow-y-auto font-mono text-[10px] text-zinc-500 space-y-0.5">
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={
                        log.includes("✗") || log.includes("error")
                          ? "text-red-400"
                          : log.includes("✓") || log.includes("complete")
                          ? "text-green-500"
                          : ""
                      }
                    >
                      {log}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 shrink-0">
          {step === 1 ? (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                {t("scan_projects_cancel")}
              </button>
              <button
                onClick={startScan}
                disabled={!rootDir}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                <Search className="h-4 w-4" />
                {t("scan_projects_start")}
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                {importPhase === "done" ? t("scan_projects_close") : t("scan_projects_cancel")}
              </button>

              {/* Right side: import button or progress */}
              {importPhase === "idle" && scanStatus === "done" && selectedCount > 0 && (
                <button
                  onClick={importSelected}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
                >
                  <GitBranch className="h-4 w-4" />
                  {t("scan_projects_import", { count: selectedCount, s: selectedCount !== 1 ? "s" : "" })}
                </button>
              )}

              {importPhase === "importing" && (
                <div className="flex items-center gap-2 text-zinc-400 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin text-red-400" />
                  {t("scan_projects_importing", { done: doneCount, total: selectedCount })}
                </div>
              )}

              {importPhase === "done" && (
                <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("scan_projects_done", { count: doneCount, s: doneCount !== 1 ? "s" : "" })}
                </div>
              )}

              {importPhase === "idle" && scanStatus === "done" && selectedCount === 0 && (
                <span className="text-xs text-zinc-600">{t("scan_projects_no_selection")}</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}