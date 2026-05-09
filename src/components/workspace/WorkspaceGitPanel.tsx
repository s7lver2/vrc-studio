import type { Project } from "@/lib/tauri";
import { VcsPanel } from "@/components/vcs/VcsPanel";
import { useT } from "@/i18n";

interface Props {
  project: Project;
}

export function WorkspaceGitPanel({ project }: Props) {
  const t = useT();
  if (!project.vcs_enabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
        <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M6 9v6M15.4 6.6 8.6 17.4" />
        </svg>
        <p className="text-sm">{t("ws_git_disabled")}</p>
        <p className="text-xs text-zinc-700">{t("ws_git_disabled_hint")}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <VcsPanel projectPath={project.path} />
    </div>
  );
}