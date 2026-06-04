// src/components/settings/VRChatGalleryConsentModal.tsx
//
// Modal de consentimiento para usar la carpeta de fotos de VRChat en el carrusel
// de la pantalla de carga. Explica con claridad que:
//   1. Los datos se quedan en local
//   2. Nunca se comparten ni se suben a ningún servidor
//   3. El usuario puede revocar el permiso en cualquier momento

import { useState } from "react";
import { Camera, Shield, HardDrive, X, FolderOpen, Check } from "lucide-react";
import { useAppearanceStore } from "@/store/appearanceStore";
import { tauriGetVRChatPhotosDefaultPath } from "@/lib/tauri";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useT } from "@/i18n";

interface Props {
  onClose: () => void;
  /** Called when consent is granted (after saving to store) */
  onConsented: () => void;
}

export function VRChatGalleryConsentModal({ onClose, onConsented }: Props) {
  const t = useT();
  const { vrchatGallery, setVRChatGallery } = useAppearanceStore();
  const [folderPath, setFolderPath] = useState(
    vrchatGallery.folderPath || ""
  );
  const [loadingDefault, setLoadingDefault] = useState(false);

  const loadDefaultPath = async () => {
    setLoadingDefault(true);
    try {
      const p = await tauriGetVRChatPhotosDefaultPath();
      setFolderPath(p);
    } finally {
      setLoadingDefault(false);
    }
  };

  const browseFolderPath = async () => {
    const result = await openDialog({ directory: true, title: "Select VRChat photos folder" });
    if (result && typeof result === "string") setFolderPath(result);
  };

  const handleAccept = () => {
    setVRChatGallery({ consented: true, enabled: true, folderPath });
    onConsented();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-900/40 border border-violet-700/40 flex items-center justify-center shrink-0">
              <Camera className="h-4.5 w-4.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">{t("vrchat_consent_title")}</h2>
              <p className="text-xs text-zinc-500 mt-0.5">{t("vrchat_consent_subtitle")}</p>
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Descripción */}
          <p className="text-sm text-zinc-300 leading-relaxed">
            {t("vrchat_consent_description")}
          </p>

          {/* Garantías de privacidad */}
          <div className="flex flex-col gap-2.5 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">{t("vrchat_consent_privacy_title")}</p>
            {[
              { icon: HardDrive,  text: t("vrchat_consent_guarantee_disk") },
              { icon: Shield,     text: t("vrchat_consent_guarantee_local") },
              { icon: Check,      text: t("vrchat_consent_guarantee_revoke") },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-2.5">
                <Icon className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-400 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

          {/* Carpeta */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              {t("vrchat_consent_folder_label")}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-300 font-mono truncate min-w-0">
                {folderPath || <span className="text-zinc-600">{t("vrchat_consent_folder_placeholder")}</span>}
              </div>
              <button
                onClick={browseFolderPath}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs transition-colors"
                title="Seleccionar carpeta"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              onClick={loadDefaultPath}
              disabled={loadingDefault}
              className="text-[11px] text-violet-400 hover:text-violet-300 text-left transition-colors disabled:opacity-50"
            >
              {loadingDefault ? t("vrchat_consent_detecting") : t("vrchat_consent_use_default")}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm transition-colors"
          >
            {t("vrchat_consent_cancel")}
          </button>
          <button
            onClick={handleAccept}
            disabled={!folderPath.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            <Camera className="h-4 w-4" />
            {t("vrchat_consent_allow")}
          </button>
        </div>
      </div>
    </div>
  );
}
