// src/hooks/useTour.ts
import { useState, useCallback } from "react";
import { useT } from "@/i18n";

const TOUR_DONE_KEY = "onboarding_tour_done";

export interface TourStep {
  targetId: string;
  title: string;
  description: string;
}

export function useTour() {
  const t = useT();
  const [tourVisible, setTourVisible] = useState(false);
  const [step, setStep] = useState(0);

  const STEPS: TourStep[] = [
    { targetId: "nav-projects",  title: t("tour_step_projects_title"),  description: t("tour_step_projects_desc")  },
    { targetId: "nav-packages",  title: t("tour_step_packages_title"),  description: t("tour_step_packages_desc")  },
    { targetId: "nav-inventory", title: t("tour_step_inventory_title"), description: t("tour_step_inventory_desc") },
    { targetId: "nav-shop",      title: t("tour_step_shop_title"),      description: t("tour_step_shop_desc")      },
    { targetId: "nav-tracker",   title: t("tour_step_tracker_title"),   description: t("tour_step_tracker_desc")   },
    { targetId: "nav-settings",  title: t("tour_step_settings_title"),  description: t("tour_step_settings_desc")  },
  ];

  const startTour = useCallback(() => {
    if (localStorage.getItem(TOUR_DONE_KEY) === "true") return;
    setStep(0);
    setTourVisible(true);
  }, []);

  const complete = useCallback(() => {
    localStorage.setItem(TOUR_DONE_KEY, "true");
    setTourVisible(false);
  }, []);

  const advance = useCallback(() => {
    setStep((prev) => prev + 1);
  }, []);

  const skip = useCallback(() => {
    complete();
  }, [complete]);

  return {
    tourVisible,
    step,
    currentStep: STEPS[step] ?? null,
    totalSteps: STEPS.length,
    startTour,
    advance,
    skip,
    complete,
  };
}
