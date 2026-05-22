// src/components/vcs/SandboxedTerminal.tsx
import { Terminal, ExternalLink } from "lucide-react";
import { useAppStore } from "@/store/app";
import type { Project } from "@/lib/tauri";

interface Props {
  project: Project;
}

export function SandboxedTerminal({ project }: Props) {
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center bg-zinc-950">
      <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
        <Terminal className="h-7 w-7 text-emerald-400" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-zinc-100">Terminal</p>
        <p className="text-xs text-zinc-500 max-w-xs">
          Git operations for <span className="text-zinc-300">{project.name}</span> are available in the Git tab.
        </p>
      </div>
      <button
        onClick={() => setActiveSection("git")}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm font-medium text-zinc-200 transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open Git Tab
      </button>
    </div>
  );
}