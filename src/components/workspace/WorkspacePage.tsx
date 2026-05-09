import { useState } from "react";
import type { Project } from "@/lib/tauri";
import { useAppStore } from "@/store/app";
import { GitBranch, Terminal, BookOpen, Package, ChevronLeft, Hammer } from "lucide-react";
import { WorkspaceGitPanel } from "./WorkspaceGitPanel";
import { TerminalPanel } from "./TerminalPanel";
import { JournalPanel } from "./JournalPanel";
import { AssetInspectorPanel } from "./AssetInspectorPanel";
import { BuildMonitorPanel } from "./BuildMonitorPanel";
import { useT } from "@/i18n";

type WorkspaceSection = "git" | "terminal" | "journal" | "assets" | "build";

export function WorkspacePage({ project }: { project: Project }) {
  const t = useT();
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const [section, setSection] = useState<WorkspaceSection>("git");

  const SECTIONS: { id: WorkspaceSection; icon: typeof GitBranch; label: string }[] = [
    { id: "git",      icon: GitBranch, label: t("ws_tab_git")      },
    { id: "terminal", icon: Terminal,  label: t("ws_tab_terminal") },
    { id: "journal",  icon: BookOpen,  label: t("ws_tab_journal")   },
    { id: "assets",   icon: Package,   label: t("ws_tab_assets")    },
    { id: "build",    icon: Hammer,    label: t("ws_tab_build")     },
  ];

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Icon sidebar */}
      <div className="w-14 shrink-0 flex flex-col items-center py-4 gap-1 border-r border-zinc-800 bg-zinc-950">
        <button
          onClick={closeWorkspace}
          title="Back to Projects"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="w-8 border-t border-zinc-800 mb-2" />

        {SECTIONS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            title={label}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              section === id
                ? "bg-red-600 text-white"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-zinc-100 truncate">{project.name}</h1>
            <p className="text-[10px] text-zinc-500 font-mono truncate">{project.path}</p>
          </div>
          <div className="ml-auto shrink-0">
            <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
              {project.unity_version}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {section === "git"      && <WorkspaceGitPanel project={project} />}
          {section === "terminal" && <TerminalPanel project={project} />}
          {section === "journal"  && <JournalPanel project={project} />}
          {section === "assets"   && <AssetInspectorPanel project={project} />}
          {section === "build"    && <BuildMonitorPanel project={project} />}
        </div>
      </div>
    </div>
  );
}