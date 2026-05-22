// src/components/vcs/VcsPanel.tsx
import { GitBranch, ExternalLink } from "lucide-react";
import { useAppStore } from "@/store/app";

interface Props {
  projectPath: string;
}

export function VcsPanel({ projectPath }: Props) {
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
        <GitBranch className="h-7 w-7 text-violet-400" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-zinc-100">Git management moved</p>
        <p className="text-xs text-zinc-500 max-w-xs">
          Version control for this project is now available in the dedicated Git tab.
        </p>
      </div>
      <button
        onClick={() => setActiveSection("git")}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open Git Tab
      </button>
      <p className="text-[10px] text-zinc-700 font-mono">{projectPath}</p>
    </div>
  );
}