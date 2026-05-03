import { create } from "zustand";
import type { CustomPackage } from "@/lib/tauri";

interface PackagesState {
  packages: CustomPackage[];
  loading: boolean;
  error: string | null;

  setPackages: (packages: CustomPackage[]) => void;
  addPackage: (pkg: CustomPackage) => void;
  replacePackage: (pkg: CustomPackage) => void;
  removePackage: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const usePackagesStore = create<PackagesState>((set) => ({
  packages: [],
  loading: false,
  error: null,

  setPackages: (packages) => set({ packages }),
  addPackage: (pkg) => set((s) => ({ packages: [pkg, ...s.packages] })),
  replacePackage: (pkg) =>
    set((s) => ({ packages: s.packages.map((p) => (p.id === pkg.id ? pkg : p)) })),
  removePackage: (id) =>
    set((s) => ({ packages: s.packages.filter((p) => p.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));