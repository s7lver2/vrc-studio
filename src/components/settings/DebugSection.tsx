import { useState, useEffect } from "react";
import { tauriGetAppSettings, tauriSetAppSettings } from "../../lib/tauri";

export function DebugSection() {
  const [useSdkInternally, setUseSdkInternally] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tauriGetAppSettings().then((s) => setUseSdkInternally(s.use_sdk_internally ?? true));
  }, []);

  const toggle = async () => {
    setSaving(true);
    try {
      const current = await tauriGetAppSettings();
      await tauriSetAppSettings({ ...current, use_sdk_internally: !useSdkInternally });
      setUseSdkInternally((v) => !v);
    } catch (e) {
      console.error("Failed to save use_sdk_internally:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Debug</p>
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl">
        <div>
          <p className="text-sm font-medium text-zinc-200">Use SDK internally</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Embedded tools (AvatarPerf) route calls through the SDK picker modals. Disable to revert to direct Tauri calls.
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={saving}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            useSdkInternally ? "bg-zinc-400" : "bg-zinc-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              useSdkInternally ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
