import { useEffect, useCallback } from "react";
import { usePackagesStore } from "@/store/packagesStore";
import {
  tauriListPackages,
  tauriCreatePackage,
  tauriUpdatePackage,
  tauriDeletePackage,
  tauriBuildPackage,
  type CreatePackagePayload,
} from "@/lib/tauri";

export function usePackages() {
  const store = usePackagesStore();

  const fetchPackages = useCallback(async () => {
    store.setLoading(true);
    store.setError(null);
    try {
      const packages = await tauriListPackages();
      store.setPackages(packages);
    } catch (e) {
      store.setError(String(e));
    } finally {
      store.setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const createPackage = async (payload: CreatePackagePayload) => {
    const pkg = await tauriCreatePackage(payload);
    store.addPackage(pkg);
    return pkg;
  };

  const updatePackage = async (id: string, payload: CreatePackagePayload) => {
    const pkg = await tauriUpdatePackage(id, payload);
    store.replacePackage(pkg);
    return pkg;
  };

  const deletePackage = async (id: string) => {
    await tauriDeletePackage(id);
    store.removePackage(id);
  };

  const buildPackage = async (id: string) => {
    const pkg = await tauriBuildPackage(id);
    store.replacePackage(pkg);
    return pkg;
  };

  return {
    packages: store.packages,
    loading: store.loading,
    error: store.error,
    createPackage,
    updatePackage,
    deletePackage,
    buildPackage,
    refresh: fetchPackages,
  };
}