import { useState, useRef, useEffect } from "react";
import type { Project } from "@/lib/tauri";
import { vcs, terminal } from "@/lib/tauri";
import { ChevronRight, HelpCircle } from "lucide-react";
import { useT,TranslationKey } from "@/i18n";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface OutputLine {
  id: number;
  type: "command" | "out" | "err" | "info" | "success" | "warn" | "header" | "prompt";
  text: string;
}

let lineId = 0;
const mkLine = (type: OutputLine["type"], text: string): OutputLine => ({
  id: lineId++,
  type,
  text,
});

// ── Wizard inline ─────────────────────────────────────────────────────────────

type UploadType = "avatar" | "world";
type WizardStep = "username" | "password" | "blueprint" | "confirm";

interface WizardState {
  type: UploadType;
  step: WizardStep;
  username: string;
  password: string;
  blueprint: string;
}

// ── Allowlist de comandos ─────────────────────────────────────────────────────

interface CommandDef {
  usage: string;
  descriptionKey: TranslationKey;
  group: string;
  interactive?: boolean;
}

const COMMANDS: Record<string, CommandDef> = {
  "help":  { usage: "help",  descriptionKey: "vcs_terminal_cmd_help_desc",   group: "General" },
  "clear": { usage: "clear", descriptionKey: "vcs_terminal_cmd_clear_desc",   group: "General" },

  "git status":    { usage: "git status",        descriptionKey: "vcs_terminal_cmd_git_status_desc",     group: "Git" },
  "git log":       { usage: "git log [n]",        descriptionKey: "vcs_terminal_cmd_git_log_desc",       group: "Git" },
  "git fetch":     { usage: "git fetch",          descriptionKey: "vcs_terminal_cmd_git_fetch_desc",     group: "Git" },
  "git diff":      { usage: "git diff [archivo]", descriptionKey: "vcs_terminal_cmd_git_diff_desc",      group: "Git" },
  "git stash":     { usage: "git stash",          descriptionKey: "vcs_terminal_cmd_git_stash_desc",     group: "Git" },
  "git stash pop": { usage: "git stash pop",      descriptionKey: "vcs_terminal_cmd_git_stash_pop_desc", group: "Git" },
  "git branch":    { usage: "git branch",         descriptionKey: "vcs_terminal_cmd_git_branch_desc",    group: "Git" },

  "ls":            { usage: "ls",            descriptionKey: "vcs_terminal_cmd_ls_desc",            group: "Proyecto" },
  "project info":  { usage: "project info",  descriptionKey: "vcs_terminal_cmd_project_info_desc",  group: "Proyecto" },
  "packages list": { usage: "packages list", descriptionKey: "vcs_terminal_cmd_packages_list_desc",  group: "Proyecto" },

  "vrchat upload avatar": {
    usage: "vrchat upload avatar",
    descriptionKey: "vcs_terminal_cmd_vrchat_upload_avatar_desc",
    group: "VRChat SDK",
    interactive: true,
  },
  "vrchat upload world": {
    usage: "vrchat upload world",
    descriptionKey: "vcs_terminal_cmd_vrchat_upload_world_desc",
    group: "VRChat SDK",
    interactive: true,
  },
  "vrchat status": {
    usage: "vrchat status",
    descriptionKey: "vcs_terminal_cmd_vrchat_status_desc",
    group: "VRChat SDK",
  },
};

// ── Ejecutor de comandos normales ─────────────────────────────────────────────

async function executeAllowedCommand(
  rawCmd: string,
  project: Project,
  addLine: (type: OutputLine["type"], text: string) => void,
  t: (key: string, vars?: Record<string, any>) => string,  // ← ahora acepta string
): Promise<"done" | "clear" | "wizard:avatar" | "wizard:world"> {
  const parts = rawCmd.trim().toLowerCase().split(/\s+/);
  const cmd2 = parts.slice(0, 2).join(" ");
  const cmd1 = parts[0] ?? "";

  if (cmd1 === "clear") return "clear";

  if (cmd1 === "help") {
    const groups: Record<string, CommandDef[]> = {};
    for (const def of Object.values(COMMANDS)) {
      groups[def.group] = groups[def.group] ?? [];
      groups[def.group].push(def);
    }
    for (const [group, cmds] of Object.entries(groups)) {
      addLine("header", `── ${t(`vcs_terminal_group_${group.toLowerCase()}`)} ─────────────────────────────`);
      for (const c of cmds) addLine("out", `  ${c.usage.padEnd(30)} ${t(c.descriptionKey)}`);
    }
    return "done";
  }

  if (cmd2 === "git status") {
    try {
      const s = await vcs.getStatus(project.path);
      addLine("out", `${t("vcs_terminal_git_branch")}: ${s.branch}${s.has_upstream ? ` | ↑${s.ahead} ↓${s.behind}` : ` (${t("vcs_terminal_no_remote")})`}`);
      if (s.staged.length)    addLine("success", `${t("vcs_terminal_staged")} (${s.staged.length}): ${s.staged.join(", ")}`);
      if (s.unstaged.length)  addLine("warn",    `${t("vcs_terminal_modified")} (${s.unstaged.length}): ${s.unstaged.join(", ")}`);
      if (s.untracked.length) addLine("info",    `${t("vcs_terminal_untracked")} (${s.untracked.length}): ${s.untracked.join(", ")}`);
      if (!s.staged.length && !s.unstaged.length && !s.untracked.length)
        addLine("success", t("vcs_terminal_clean"));
    } catch (e) { addLine("err", String(e)); }
    return "done";
  }

  if (cmd2 === "git log") {
    try {
      const limit = parseInt(parts[2] ?? "10", 10);
      const entries = await vcs.getLog(project.path, isNaN(limit) ? 10 : limit);
      for (const e of entries) {
        const date = new Date(e.timestamp * 1000).toLocaleDateString("es-ES"); // se podría formatear según locale
        addLine("out", `${e.id.slice(0, 7)}  ${e.message}  · ${e.author}  · ${date}`);
      }
      if (entries.length === 0) addLine("info", t("vcs_terminal_no_commits"));
    } catch (e) { addLine("err", String(e)); }
    return "done";
  }

  if (cmd2 === "git branch") {
    try {
      const branches = await vcs.listBranches(project.path);
      for (const b of branches) addLine("out", `${b.is_current ? "* " : "  "}${b.name}`);
    } catch (e) { addLine("err", String(e)); }
    return "done";
  }

  if (["git fetch", "git stash"].includes(cmd2) || rawCmd.trim().toLowerCase() === "git stash pop") {
    try {
      const result = await terminal.run(project.path, rawCmd.trim());
      if (result.stdout) result.stdout.split("\n").filter(Boolean).forEach((l) => addLine("out", l));
      if (result.stderr) result.stderr.split("\n").filter(Boolean).forEach((l) => addLine("warn", l));
      if (result.exit_code !== 0) addLine("err", `[exit ${result.exit_code}]`);
    } catch (e) { addLine("err", String(e)); }
    return "done";
  }

  if (cmd2 === "git diff") {
    try {
      const result = await terminal.run(project.path, "git diff --stat");
      if (result.stdout) result.stdout.split("\n").filter(Boolean).forEach((l) => addLine("out", l));
      else addLine("info", t("vcs_terminal_no_diff"));
    } catch (e) { addLine("err", String(e)); }
    return "done";
  }

  if (cmd1 === "ls") {
    try {
      const result = await terminal.run(project.path, "cmd /c dir /b");
      if (result.stdout) result.stdout.split("\n").filter(Boolean).forEach((l) => addLine("out", l));
    } catch (e) { addLine("err", String(e)); }
    return "done";
  }

  if (rawCmd.trim().toLowerCase() === "project info") {
    addLine("out", `${t("vcs_terminal_project_name")}:   ${project.name}`);
    addLine("out", `${t("vcs_terminal_project_path")}:     ${project.path}`);
    addLine("out", `${t("vcs_terminal_project_unity")}:    ${project.unity_version}`);
    addLine("out", `${t("vcs_terminal_project_git")}:      ${project.vcs_enabled ? t("vcs_terminal_enabled") : t("vcs_terminal_disabled")}`);
    return "done";
  }

  if (rawCmd.trim().toLowerCase() === "packages list") {
    try {
      const result = await terminal.run(
        project.path,
        "cmd /c type Packages\\manifest.json 2>nul || type Packages/manifest.json",
      );
      if (result.stdout) {
        try {
          const manifest = JSON.parse(result.stdout);
          const deps = Object.entries(manifest.dependencies ?? {});
          if (deps.length === 0) addLine("info", t("vcs_terminal_no_vpm_deps"));
          else for (const [id, ver] of deps) addLine("out", `  ${String(id).padEnd(40)} ${ver}`);
        } catch {
          result.stdout.split("\n").filter(Boolean).forEach((l) => addLine("out", l));
        }
      }
    } catch (e) { addLine("err", String(e)); }
    return "done";
  }

  if (rawCmd.trim().toLowerCase() === "vrchat status") {
    addLine("info", t("vcs_terminal_vrchat_status_hint"));
    return "done";
  }

  if (rawCmd.trim().toLowerCase() === "vrchat upload avatar") return "wizard:avatar";
  if (rawCmd.trim().toLowerCase() === "vrchat upload world")  return "wizard:world";

  addLine("err", t("vcs_terminal_unknown_cmd", { cmd: rawCmd.trim() }));
  return "done";
}

// ── Wizard step helpers ───────────────────────────────────────────────────────

function startWizard(
  type: UploadType,
  addLine: (type: OutputLine["type"], text: string) => void,
  t: (key: TranslationKey, vars?: Record<string, any>) => string,
): WizardState {
  const label = type === "avatar" ? t("vcs_terminal_wizard_avatar") : t("vcs_terminal_wizard_world");
  addLine("header",  `── VRChat SDK Upload · ${label} ─────────────────`);
  addLine("info",    t("vcs_terminal_wizard_cancel_hint"));
  addLine("prompt",  t("vcs_terminal_wizard_username"));
  return { type, step: "username", username: "", password: "", blueprint: "" };
}

async function advanceWizard(
  answer: string,
  wizard: WizardState,
  addLine: (type: OutputLine["type"], text: string) => void,
  t: (key: TranslationKey, vars?: Record<string, any>) => string,
): Promise<WizardState | null> {
  if (answer.trim().toLowerCase() === "cancel") {
    addLine("warn", t("vcs_terminal_wizard_cancelled"));
    return null;
  }

  switch (wizard.step) {
    case "username": {
      if (!answer.trim()) { addLine("err", t("vcs_terminal_wizard_username_required")); addLine("prompt", t("vcs_terminal_wizard_username")); return wizard; }
      addLine("prompt", t("vcs_terminal_wizard_password"));
      return { ...wizard, step: "password", username: answer.trim() };
    }

    case "password": {
      if (!answer.trim()) { addLine("err", t("vcs_terminal_wizard_password_required")); addLine("prompt", t("vcs_terminal_wizard_password")); return wizard; }
      addLine("info", t("vcs_terminal_wizard_auth_progress", { username: wizard.username }));
      await new Promise((r) => setTimeout(r, 800));
      addLine("success", t("vcs_terminal_wizard_auth_success", { username: wizard.username }));
      addLine("info", t("vcs_terminal_wizard_blueprints_available"));
      if (wizard.type === "avatar") {
        addLine("out", `  [1]  avtr_00000000-0000-0000-0001  —  ${t("vcs_terminal_wizard_avatar_main")}`);
        addLine("out", `  [2]  avtr_00000000-0000-0000-0002  —  ${t("vcs_terminal_wizard_avatar_test")}`);
      } else {
        addLine("out", `  [1]  wrld_00000000-0000-0000-0001  —  ${t("vcs_terminal_wizard_world_main")}`);
      }
      addLine("out", `  [N]  nuevo  —  ${t("vcs_terminal_wizard_new_blueprint")}`);
      addLine("prompt", t("vcs_terminal_wizard_blueprint_prompt", { type: t(wizard.type === "avatar" ? "vcs_terminal_wizard_avatar" : "vcs_terminal_wizard_world") }));
      return { ...wizard, step: "blueprint", password: answer.trim() };
    }

    case "blueprint": {
      const bp = answer.trim();
      if (!bp) { addLine("err", t("vcs_terminal_wizard_blueprint_required")); addLine("prompt", t("vcs_terminal_wizard_blueprint_prompt", { type: t(wizard.type === "avatar" ? "vcs_terminal_wizard_avatar" : "vcs_terminal_wizard_world") })); return wizard; }
      const resolved = bp.toLowerCase() === "nuevo" ? t("vcs_terminal_wizard_new_bp", { type: t(wizard.type === "avatar" ? "vcs_terminal_wizard_avatar" : "vcs_terminal_wizard_world") }) : bp;
      addLine("out", `${t("vcs_terminal_wizard_blueprint")}: ${resolved}`);
      addLine("prompt", t("vcs_terminal_wizard_confirm"));
      return { ...wizard, step: "confirm", blueprint: resolved };
    }

    case "confirm": {
      if (!["s", "si", "sí", "y", "yes"].includes(answer.trim().toLowerCase())) {
        addLine("warn", t("vcs_terminal_wizard_cancelled"));
        return null;
      }
      addLine("info", t("vcs_terminal_wizard_upload_progress"));
      const steps = [
        { msg: t("vcs_terminal_wizard_step_validate"),  ok: t("vcs_terminal_wizard_step_validate_ok"), ms: 600 },
        { msg: t("vcs_terminal_wizard_step_build", { type: t(wizard.type === "avatar" ? "vcs_terminal_wizard_avatar" : "vcs_terminal_wizard_world") }), ok: t("vcs_terminal_wizard_step_build_ok"), ms: 900 },
        { msg: t("vcs_terminal_wizard_step_upload"), ok: t("vcs_terminal_wizard_step_upload_ok"), ms: 1200 },
      ];
      for (const s of steps) {
        addLine("info", `[ ] ${s.msg}`);
        await new Promise((r) => setTimeout(r, s.ms));
        addLine("success", `[✓] ${s.ok}`);
      }
      addLine("header", t("vcs_terminal_wizard_done_header", { type: t(wizard.type === "avatar" ? "vcs_terminal_wizard_avatar" : "vcs_terminal_wizard_world") }));
      addLine("out",  `${t("vcs_terminal_wizard_blueprint")}: ${wizard.blueprint}`);
      addLine("info", t("vcs_terminal_wizard_simulated_note"));
      return null;
    }

    default:
      return null;
  }
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  project: Project;
}

export function SandboxedTerminal({ project }: Props) {
  const t = useT();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<OutputLine[]>([
    mkLine("info", t("vcs_terminal_welcome", { name: project.name })),
    mkLine("info", t("vcs_terminal_intro")),
  ]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const _t = (key: string, vars?: Record<string, any>) => t(key as TranslationKey, vars);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const addLine = (type: OutputLine["type"], text: string) => {
    setOutput((prev) => [...prev, mkLine(type, text)]);
  };

  const handleWizardInput = async (answer: string) => {
    if (!wizard) return;
    const display = wizard.step === "password" ? "•".repeat(Math.min(answer.length, 12)) : answer;
    addLine("command", `  › ${display}`);
    setRunning(true);
    try {
      const next = await advanceWizard(answer, wizard, addLine, _t);
      setWizard(next);
    } finally {
      setRunning(false);
    }
  };

  const runCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    if (wizard) {
      setInput("");
      await handleWizardInput(trimmed);
      return;
    }

    const lower = trimmed.toLowerCase();
    const isAllowed = Object.keys(COMMANDS).some((k) => lower.startsWith(k));

    addLine("command", `$ ${trimmed}`);
    setHistory((h) => [trimmed, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    setInput("");
    setRunning(true);

    if (!isAllowed) {
      addLine("err", t("vcs_terminal_command_not_allowed", { cmd: trimmed }));
      addLine("info", t("vcs_terminal_command_help_hint"));
      setRunning(false);
      return;
    }

    try {
      const result = await executeAllowedCommand(trimmed, project, addLine, _t);
      if (result === "clear") {
        setOutput([mkLine("info", t("vcs_terminal_welcome", { name: project.name }))]);
      } else if (result === "wizard:avatar" || result === "wizard:world") {
        const type: UploadType = result === "wizard:avatar" ? "avatar" : "world";
        setWizard(startWizard(type, addLine, t));
      }
    } catch (e) {
      addLine("err", t("vcs_terminal_unexpected_error", { error: String(e) }));
    } finally {
      setRunning(false);
    }
  };

  const lineStyle: Record<OutputLine["type"], string> = {
    command: "text-zinc-300",
    out:     "text-zinc-400",
    err:     "text-red-400",
    info:    "text-zinc-600",
    success: "text-green-400",
    warn:    "text-yellow-400",
    header:  "text-red-500/80 font-semibold mt-2",
    prompt:  "text-cyan-400",
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { runCommand(input); return; }
    if (!wizard) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const idx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(idx);
        setInput(history[idx] ?? "");
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const idx = Math.max(historyIdx - 1, -1);
        setHistoryIdx(idx);
        setInput(idx === -1 ? "" : history[idx] ?? "");
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const lower = input.toLowerCase();
        const match = Object.values(COMMANDS).find((c) => c.usage.startsWith(lower) && c.usage !== lower);
        if (match) setInput(match.usage);
      }
    }
  };

  const quickGroups = Object.entries(
    Object.entries(COMMANDS).reduce<Record<string, { key: string; def: CommandDef }[]>>((acc, [key, def]) => {
      acc[def.group] = acc[def.group] ?? [];
      acc[def.group].push({ key, def });
      return acc;
    }, {})
  );

  const isPasswordStep = wizard?.step === "password";

  return (
    <div className="flex h-full">
      {/* Output panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-0.5">
          {output.map((line) => (
            <div key={line.id} className={`leading-relaxed whitespace-pre-wrap break-all ${lineStyle[line.type]}`}>
              {line.type === "prompt" ? (
                <span>
                  <span className="text-cyan-700 mr-1 select-none">?</span>
                  {line.text}
                  <span className="text-zinc-700 ml-1 select-none">›</span>
                </span>
              ) : line.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input row */}
        <div className={`flex items-center gap-2 px-4 py-3 border-t shrink-0 transition-colors ${
          wizard ? "border-cyan-900/50 bg-cyan-950/20" : "border-zinc-800 bg-zinc-950"
        }`}>
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${wizard ? "text-cyan-500" : "text-red-500"}`} />
          <input
            type={isPasswordStep ? "password" : "text"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            placeholder={
              wizard
                ? isPasswordStep
                  ? t("vcs_terminal_wizard_password_placeholder")
                  : wizard.step === "username"
                  ? t("vcs_terminal_wizard_username_placeholder")
                  : wizard.step === "blueprint"
                  ? t("vcs_terminal_wizard_blueprint_placeholder")
                  : t("vcs_terminal_wizard_confirm_placeholder")
                : running
                ? t("vcs_terminal_executing")
                : t("vcs_terminal_input_placeholder")
            }
            className="flex-1 bg-transparent text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {running && <span className="text-[10px] text-zinc-600 animate-pulse shrink-0">{t("vcs_terminal_executing")}</span>}
          {wizard && !running && (
            <button
              onClick={() => { addLine("warn", t("vcs_terminal_wizard_cancelled")); setWizard(null); setInput(""); }}
              className="text-[10px] font-mono text-zinc-600 hover:text-red-400 transition-colors shrink-0"
            >
              [cancel]
            </button>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-52 shrink-0 border-l border-zinc-800 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
          <HelpCircle className="h-3.5 w-3.5 text-zinc-600" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t("vcs_terminal_commands_title")}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {quickGroups.map(([group, items]) => (
            <div key={group} className="mb-3">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600 px-1 mb-1">  {t(`vcs_terminal_group_${group.toLowerCase()}` as TranslationKey)}</p>
              {items.map(({ key, def }) => (
                <button
                  key={key}
                  onClick={() => { if (!wizard && !running) runCommand(def.usage); }}
                  disabled={running || !!wizard}
                  className="w-full text-left px-2 py-1.5 rounded text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors disabled:opacity-30 truncate"
                  title={t(def.descriptionKey)}
                >
                  {def.interactive && <span className="text-red-400 mr-1">▶</span>}
                  {def.usage}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}