// src/hooks/useUpdateSettings.ts
import { useState, useCallback } from "react";

export type UpdateChannel = "stable" | "testing";

export interface UpdateSettings {
  channel:      UpdateChannel;
  autoDownload: boolean;
}

const STORAGE_KEY = "vrc-update-settings";

function loadSettings(): UpdateSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UpdateSettings;
  } catch { /* ignore */ }
  return { channel: "stable", autoDownload: false };
}

export function useUpdateSettings() {
  const [settings, setSettings] = useState<UpdateSettings>(loadSettings);

  const updateSettings = useCallback((patch: Partial<UpdateSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { settings, updateSettings };
}