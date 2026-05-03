import { useEffect, useState } from "react";
import { Plus, GitBranch, X, HardDrive } from "lucide-react";
import { useProjectsStore } from "@/store/projects";
import { ProjectList } from "@/components/projects/ProjectList";
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { CreateProjectForm } from "@/components/projects/wizard/CreateProjectForm";
import { ScanProjectsWizard } from "@/components/projects/ScanProjectsWizard";
import { ProjectDetailModal } from "@/components/projects/ProjectDetailModal";
import { VcsPanel } from "@/components/vcs/VcsPanel";
import {
  tauriListProjects,
  tauriDeleteProject,
  tauriOpenProjectInUnity,
  tauriListUnityInstallations,
  Project,
} from "@/lib/tauri";
import { useT } from "@/i18n";

export default function Projects() {
  const t = useT();
  const {
    projects, isLoading, wizardOpen,
    setProjects, setLoading, removeProject, addProject, openWizard, closeWizard, updateProject,
  } = useProjectsStore();

  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [scanWizardOpen, setScanWizardOpen] = useState(false);
  const [detailProject, setDetailProject] = useState<Project | null>(null);

  useEffect(() => {
    setLoading(true);
    tauriListProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = async (project: Project) => {
    const installations = await tauriListUnityInstallations().catch(() => []);
    const match = installations.find((i) => i.version === project.unity_version);
    if (!match) {
      alert(t("projects_open_unity_missing", { version: project.unity_version }));
      return;
    }
    await tauriOpenProjectInUnity(project.id, project.path, match.path).catch((e) =>
      alert(t("projects_open_unity_error", { error: e }))
    );
  };

  const handleDeleteConfirm = async (alsoDeleteFiles: boolean) => {
    if (!deletingProject) return;
    setIsDeleting(true);
    try {
      await tauriDeleteProject(deletingProject.id, alsoDeleteFiles);
      removeProject(deletingProject.id);
      if (selectedProject?.id === deletingProject.id) setSelectedProject(null);
      if (detailProject?.id === deletingProject.id) setDetailProject(null);
    } catch (e) {
      alert(t("projects_delete_error", { error: e }));
    } finally {
      setIsDeleting(false);
      setDeletingProject(null);
    }
  };

  const handleCreated = (project: Project) => {
    addProject(project);
    closeWizard();
  };

  const handleDetailUpdated = (project: Project) => {
    updateProject?.(project);
    setDetailProject(project);
  };

  const projectCount = projects.length;
  const pluralS = projectCount !== 1 ? "s" : "";

  return (
    <div data-testid="page-projects" className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-zinc-800 px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{t("projects_title")}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {projectCount > 0
              ? t("projects_subtitle", { count: projectCount, s: pluralS })
              : t("projects_empty")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScanWizardOpen(true)}
            className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          >
            <HardDrive size={16} />
            {t("projects_scan_drive")}
          </button>
          <button
            onClick={openWizard}
            className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            <Plus size={16} />
            {t("projects_create")}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <p className="text-sm text-zinc-600">{t("projects_loading")}</p>
            </div>
          ) : (
            <ProjectList
              projects={projects}
              onOpen={handleOpen}
              onDelete={setDeletingProject}
              onDetail={setDetailProject}
            />
          )}
        </div>

        {!detailProject && selectedProject?.vcs_enabled && (
          <div className="w-72 shrink-0 border-l border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <GitBranch size={14} className="text-zinc-400" />
                <span className="text-sm font-medium text-zinc-200 truncate max-w-[160px]">
                  {selectedProject.name}
                </span>
              </div>
              <button onClick={() => setSelectedProject(null)} className="text-zinc-600 hover:text-zinc-300">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VcsPanel projectPath={selectedProject.path} />
            </div>
          </div>
        )}
      </div>

      {deletingProject && (
        <DeleteProjectDialog
          project={deletingProject}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingProject(null)}
          isDeleting={isDeleting}
        />
      )}

      {wizardOpen && <CreateProjectForm onCreated={handleCreated} onClose={closeWizard} />}

      {scanWizardOpen && (
        <ScanProjectsWizard
          onImported={(importedProjects) => { importedProjects.forEach(addProject); }}
          onClose={() => setScanWizardOpen(false)}
        />
      )}

      {detailProject && (
        <ProjectDetailModal
          project={detailProject}
          onClose={() => setDetailProject(null)}
          onDelete={(p) => { setDetailProject(null); setDeletingProject(p); }}
          onUpdated={handleDetailUpdated}
        />
      )}
    </div>
  );
}