// src/components/onboarding/TourTooltip.tsx
import { useT } from "@/i18n";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  rect: Rect;
  onSkip: () => void;
}

export function TourTooltip({ step, totalSteps, title, description, rect, onSkip }: Props) {
  const t = useT();
  const TOOLTIP_WIDTH = 220;
  const TOOLTIP_GAP   = 16;

  const left = rect.left + rect.width + TOOLTIP_GAP;
  const idealTop = rect.top + rect.height / 2 - 60;
  const top = Math.max(12, Math.min(idealTop, window.innerHeight - 180));

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: TOOLTIP_WIDTH,
        zIndex: 10000,
        pointerEvents: "auto",
      }}
      className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl p-4 flex flex-col gap-2.5 animate-fade-in"
    >
      {/* Step dots */}
      <div className="flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              i === step
                ? "w-4 bg-red-500"
                : i < step
                  ? "w-1.5 bg-zinc-500"
                  : "w-1.5 bg-zinc-700"
            }`}
          />
        ))}
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-zinc-100 leading-tight">{title}</p>

      {/* Description */}
      <p className="text-xs text-zinc-400 leading-relaxed">{description}</p>

      {/* Click hint */}
      <p className="text-[10px] text-zinc-600 italic">{t("tour_click_hint")}</p>

      {/* Skip — only on first step */}
      {step === 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onSkip(); }}
          className="mt-1 text-[10px] text-zinc-600 hover:text-zinc-400 text-left transition-colors"
        >
          {t("tour_skip")}
        </button>
      )}
    </div>
  );
}
