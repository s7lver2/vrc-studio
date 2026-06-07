import { create } from "zustand";
import { Project, ProjectFolder } from "@/lib/tauri";

interface ProjectsState {
  projects: Project[];
  folders: ProjectFolder[];
  selectedFolderId: string | null;
  isLoading: boolean;
  wizardOpen: boolean;
  /** IDs de proyectos que el usuario ha abierto en Unity durante esta sesión. */
  openProjectIds: Set<string>;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  updateProject: (project: Project) => void;
  reorderProjects: (orderedIds: string[]) => void;
  setLoading: (loading: boolean) => void;
  openWizard: () => void;
  closeWizard: () => void;
  markProjectOpen: (id: string) => void;
  // Folders
  setFolders: (folders: ProjectFolder[]) => void;
  addFolder: (folder: ProjectFolder) => void;
  removeFolder: (id: string) => void;
  selectFolder: (id: string | null) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  folders: [],
  selectedFolderId: null,
  isLoading: false,
  wizardOpen: false,
  openProjectIds: new Set(),

  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((s) => ({ projects: [project, ...s.projects] })),
  removeProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  updateProject: (project) =>
    set((s) => ({ projects: s.projects.map((p) => p.id === project.id ? project : p) })),
  reorderProjects: (orderedIds) =>
    set((s) => {
      const map = new Map(s.projects.map((p) => [p.id, p]));
      const reordered = orderedIds.map((id) => map.get(id)).filter(Boolean) as Project[];
      const rest = s.projects.filter((p) => !orderedIds.includes(p.id));
      return { projects: [...reordered, ...rest] };
    }),
  setLoading: (isLoading) => set({ isLoading }),
  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),
  markProjectOpen: (id) =>
    set((s) => ({ openProjectIds: new Set([...s.openProjectIds, id]) })),
  // Folders
  setFolders: (folders) => set({ folders }),
  addFolder: (folder) => set((s) => ({ folders: [...s.folders, folder] })),
  removeFolder: (id) =>
    set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),
  selectFolder: (selectedFolderId) => set({ selectedFolderId }),
}));