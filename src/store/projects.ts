import { create } from "zustand";
import { Project } from "@/lib/tauri";

interface ProjectsState {
  projects: Project[];
  isLoading: boolean;
  wizardOpen: boolean;
  /** IDs de proyectos que el usuario ha abierto en Unity durante esta sesión. */
  openProjectIds: Set<string>;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  updateProject: (project: Project) => void;
  setLoading: (loading: boolean) => void;
  openWizard: () => void;
  closeWizard: () => void;
  markProjectOpen: (id: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
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
  setLoading: (isLoading) => set({ isLoading }),
  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),
  markProjectOpen: (id) =>
    set((s) => ({ openProjectIds: new Set([...s.openProjectIds, id]) })),
}));