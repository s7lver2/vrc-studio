// src/hooks/useUpdateChecker.ts
import { useEffect, useState, useCallback, useRef } from "react";
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

interface UseUpdateCheckerOptions {
  channel?:      string;
  autoDownload?: boolean;
}

interface UseUpdateCheckerReturn {
  updateInfo:    UpdateCheckResult | null;
  checking:      boolean;
  installing:    boolean;
  error:         string | null;
  dismiss:       () => void;
  installUpdate: () => Promise<void>;
  /** Dispara una comprobación manual, ignorando el flag de sesión. */
  checkNow:      (overrideChannel?: string) => Promise<void>;
}

export function useUpdateChecker(
  { channel = "stable", autoDownload = false }: UseUpdateCheckerOptions = {}
): UseUpdateCheckerReturn {
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checking,   setChecking]   = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  // Evita disparar autoDownload más de una vez por update detectado
  const autoTriggered = useRef(false);

  const checkNow = useCallback(async (overrideChannel?: string) => {
    setChecking(true);
    setError(null);
    try {
      const result = await invoke<UpdateCheckResult>("check_for_update", {
        channel: overrideChannel ?? channel,
      });
      setUpdateInfo(result.has_update ? result : null);
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  }, [channel]);

  // Comprobar una vez por sesión (y por canal) al montar
  useEffect(() => {
    const key = `vrc-update-checked-${new Date().toDateString()}-${channel}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    checkNow();
  }, [channel, checkNow]);

  const installUpdate = useCallback(async () => {
    if (!updateInfo) return;
    setInstalling(true);
    try {
      await invoke("download_and_install_update", {
        url:       updateInfo.download_url,
        signature: updateInfo.signature,
        channel,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  }, [updateInfo, channel]);

  // Auto-descarga: arrancar la descarga en cuanto se detecta el update
  useEffect(() => {
    if (autoDownload && updateInfo?.has_update && !autoTriggered.current) {
      autoTriggered.current = true;
      installUpdate();
    }
  }, [autoDownload, updateInfo, installUpdate]);

  const dismiss = useCallback(() => {
    setUpdateInfo(null);
    autoTriggered.current = false;
  }, []);

  return { updateInfo, checking, installing, error, dismiss, installUpdate, checkNow };
}