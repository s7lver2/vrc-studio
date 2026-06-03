import { useEffect, useState } from "react";
import type { TourStep } from "@/hooks/useTour";
import { TourTooltip } from "./TourTooltip";

const PADDING = 8; // px around the highlighted element

interface Props {
  step: number;
  totalSteps: number;
  currentStep: TourStep | null;
  onAdvance: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function TourOverlay({ step, totalSteps, currentStep, onAdvance, onSkip, onComplete }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);

  // Complete when step exceeds steps array
  useEffect(() => {
    if (step >= totalSteps) {
      onComplete();
    }
  }, [step, totalSteps, onComplete]);

  // Find target element and measure it
  useEffect(() => {
    if (!currentStep) return;

    const measure = () => {
      const el = document.querySelector(`[data-tour-id="${currentStep.targetId}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };

    const t = setTimeout(measure, 50);
    window.addEventListener("resize", measure);

    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [currentStep]);

  if (!currentStep || step >= totalSteps || !rect) return null;

  const spotLeft   = rect.left   - PADDING;
  const spotTop    = rect.top    - PADDING;
  const spotWidth  = rect.width  + PADDING * 2;
  const spotHeight = rect.height + PADDING * 2;

  return (
    <>
      {/* Full-screen pointer-events blocker (behind spotlight) */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          pointerEvents: "none",
        }}
      />
      {/* Spotlight hole — transparent div with huge box-shadow acting as overlay */}
      <div
        onClick={onAdvance}
        style={{
          position: "fixed",
          left:   spotLeft,
          top:    spotTop,
          width:  spotWidth,
          height: spotHeight,
          borderRadius: 10,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
          zIndex: 9999,
          cursor: "pointer",
          outline: "2px solid rgba(255,255,255,0.18)",
          outlineOffset: "0px",
          transition: "left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease",
        }}
      />

      {/* Tooltip anchored near the spotlight */}
      <TourTooltip
        step={step}
        totalSteps={totalSteps}
        title={currentStep.title}
        description={currentStep.description}
        rect={{ left: spotLeft, top: spotTop, width: spotWidth, height: spotHeight }}
        onSkip={onSkip}
      />
    </>
  );
}
