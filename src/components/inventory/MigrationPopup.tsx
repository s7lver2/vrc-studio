// src/components/inventory/MigrationPopup.tsx
import { useState, useEffect, useRef } from "react";
import { Sparkles, X } from "lucide-react";
import { MigrationWizard } from "./MigrationWizard";
import { useT } from "@/i18n";

const DISMISSED_KEY = "multi_avatar_migration_dismissed";

interface Props {
  hasItems: boolean;
}

export function MigrationPopup({ hasItems }: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const shownRef = useRef(false);

  // Show once when items first load and the user hasn't dismissed before
  useEffect(() => {
    if (hasItems && !shownRef.current && localStorage.getItem(DISMISSED_KEY) !== "true") {
      shownRef.current = true;
      // Small delay so it doesn't flash immediately on startup
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [hasItems]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setVisible(false);
  };

  return (
    <>
      {!showWizard && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
              <p className="text-sm font-semibold text-zinc-100">{t("migration_popup_title")}</p>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-900/60 text-violet-300 border border-violet-700/50 font-bold tracking-wide uppercase shrink-0">
                {t("migration_wizard_beta")}
              </span>
            </div>
            <button onClick={dismiss} className="h-5 w-5 flex items-center justify-center text-zinc-600 hover:text-zinc-300 shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {t("migration_popup_body")}
          </p>
          <div className="flex gap-2 justify-end pt-1">
            <button
              onClick={dismiss}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              {t("migration_popup_dismiss")}
            </button>
            <button
              onClick={() => setShowWizard(true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
            >
              {t("migration_popup_start")}
            </button>
          </div>
        </div>
      )}

      {showWizard && (
        <MigrationWizard onClose={() => { setShowWizard(false); setVisible(false); }} />
      )}
    </>
  );
}
