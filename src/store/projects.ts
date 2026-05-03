import { create } from "zustand";
import { Project } from "@/lib/tauri";

interface ProjectsState {
  projects: Project[];
  isLoading: boolean;
  wizardOpen: boolean;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setLoading: (loading: boolean) => void;
  openWizard: () => void;
  closeWizard: () => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  isLoading: false,
  wizardOpen: false,

  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((s) => ({ projects: [project, ...s.projects] })),
  removeProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  setLoading: (isLoading) => set({ isLoading }),
  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),
}));
