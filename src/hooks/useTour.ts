// src/hooks/useTour.ts
import { useState, useCallback } from "react";

const TOUR_DONE_KEY = "onboarding_tour_done";

export interface TourStep {
  targetId: string;   // matches data-tour-id attribute in the DOM
  title: string;
  description: string;
}

const STEPS: TourStep[] = [
  {
    targetId: "nav-projects",
    title: "Proyectos",
    description: "Aquí gestionas tus proyectos de Unity. Haz clic para continuar.",
  },
  {
    targetId: "nav-packages",
    title: "Paquetes VPM",
    description: "Instala y gestiona paquetes VPM para tus proyectos.",
  },
  {
    targetId: "nav-inventory",
    title: "Inventario",
    description: "Guarda y organiza tus avatares, assets y paquetes descargados.",
  },
  {
    targetId: "nav-shop",
    title: "Shop",
    description: "Descarga paquetes directamente desde la tienda integrada.",
  },
  {
    targetId: "nav-tracker",
    title: "Tracker",
    description: "Sigue las actualizaciones de tus assets de Booth automáticamente.",
  },
  {
    targetId: "nav-settings",
    title: "Ajustes",
    description: "Personaliza el tema, idioma, y conecta Discord y otras integraciones. ¡Listo!",
  },
];

export function useTour() {
  const [tourVisible, setTourVisible] = useState(false);
  const [step, setStep] = useState(0);

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
    setStep((prev) => {
      const next = prev + 1;
      return next;
    });
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
