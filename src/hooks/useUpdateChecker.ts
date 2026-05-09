// src/hooks/useUpdateChecker.ts
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateCheckResult {
  has_update:                  boolean;
  current_version:             string;
  remote_version:              string;
  notes:                       string;
  download_url:                string;
  signature:                   string;
  download_size:               number;
  forced_onboarding_version?:  string;
  whats_new_version?:          string;
  whats_new_changelog?:        string;
}

interface UseUpdateCheckerReturn {
  updateInfo:        UpdateCheckResult | null;
  checking:          boolean;
  installing:        boolean;
  error:             string | null;
  dismiss:           () => void;
  installUpdate:     () => Promise<void>;
}

/**
 * Comprueba actualizaciones al montar el componente (una vez por sesión).
 * Expone `updateInfo` para que el componente UI decida cómo mostrarlo.
 */
export function useUpdateChecker(channel = "stable"): UseUpdateCheckerReturn {
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checking,   setChecking]   = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    // Solo comprobar una vez por sesión (evita spam al re-montar)
    const key = `vrc-update-checked-${new Date().toDateString()}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    setChecking(true);
    invoke<UpdateCheckResult>("check_for_update", { channel })
      .then((result) => {
        if (result.has_update) setUpdateInfo(result);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setChecking(false));
  }, [channel]);

  const dismiss = useCallback(() => setUpdateInfo(null), []);

  const installUpdate = useCallback(async () => {
    if (!updateInfo) return;
    setInstalling(true);
    try {
      await invoke("download_and_install_update", {
        url:       updateInfo.download_url,
        signature: updateInfo.signature,
        channel,
      });
      // El instalador se ha lanzado — cerrar la app para que el usuario
      // complete la instalación. El instalador de Windows maneja el resto.
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  }, [updateInfo, channel]);

  return { updateInfo, checking, installing, error, dismiss, installUpdate };
}