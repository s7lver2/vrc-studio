/**
 * GetStarted — Tutorial interactivo de primera vez para VRC Studio.
 * Se muestra la primera vez que se abre la app (o al hacer "Restart with Get Started").
 * El usuario debe explorar cada sección para avanzar.
 */

import { useState, useEffect, useCallback } from "react";
import {
  FolderOpen, ShoppingBag, Package, Archive, Bell,
  Settings, ChevronRight, Check, Sparkles, Play,
  Box, ArrowRight, X
} from "lucide-react";
import { useAppStore, Section } from "@/store/app";
import { useT } from "@/i18n";

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "app:getStartedDone";

export function isGetStartedDone(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}
export function markGetStartedDone() {
  try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
}
export function resetGetStarted() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── Step definitions ─────────────────────────────────────────────────────────

interface Step {
  id: string;
  section: Section | null; // null = no navega
  icon: React.ComponentType<any>;
  color: string;
  bgColor: string;
  borderColor: string;
  title: string;
  subtitle: string;
  description: string;
  tryLabel: string;
  tryDescription: string;
  tips: string[];
}

function buildSteps(t: (key: import("@/i18n").TranslationKey) => string): Step[] {
  return [
    {
      id: "welcome",
      section: null,
      icon: Sparkles,
      color: "text-red-400",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
      title: t("getstarted_s1_title"),
      subtitle: t("getstarted_s1_subtitle"),
      description: t("getstarted_s1_desc"),
      tryLabel: t("getstarted_s1_tryLabel"),
      tryDescription: t("getstarted_s1_tryDesc"),
      tips: [
        t("getstarted_s1_tip1"),
        t("getstarted_s1_tip2"),
        t("getstarted_s1_tip3"),
      ],
    },
    {
      id: "projects",
      section: "projects",
      icon: FolderOpen,
      color: "text-blue-400",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      title: t("getstarted_s2_title"),
      subtitle: t("getstarted_s2_subtitle"),
      description: t("getstarted_s2_desc"),
      tryLabel: t("getstarted_s2_tryLabel"),
      tryDescription: t("getstarted_s2_tryDesc"),
      tips: [
        t("getstarted_s2_tip1"),
        t("getstarted_s2_tip2"),
        t("getstarted_s2_tip3"),
      ],
    },
    {
      id: "shop",
      section: "shop",
      icon: ShoppingBag,
      color: "text-pink-400",
      bgColor: "bg-pink-500/10",
      borderColor: "border-pink-500/20",
      title: t("getstarted_s3_title"),
      subtitle: t("getstarted_s3_subtitle"),
      description: t("getstarted_s3_desc"),
      tryLabel: t("getstarted_s3_tryLabel"),
      tryDescription: t("getstarted_s3_tryDesc"),
      tips: [
        t("getstarted_s3_tip1"),
        t("getstarted_s3_tip2"),
        t("getstarted_s3_tip3"),
      ],
    },
    {
      id: "inventory",
      section: "inventory",
      icon: Archive,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      title: t("getstarted_s4_title"),
      subtitle: t("getstarted_s4_subtitle"),
      description: t("getstarted_s4_desc"),
      tryLabel: t("getstarted_s4_tryLabel"),
      tryDescription: t("getstarted_s4_tryDesc"),
      tips: [
        t("getstarted_s4_tip1"),
        t("getstarted_s4_tip2"),
        t("getstarted_s4_tip3"),
      ],
    },
    {
      id: "packages",
      section: "packages",
      icon: Package,
      color: "text-violet-400",
      bgColor: "bg-violet-500/10",
      borderColor: "border-violet-500/20",
      title: t("getstarted_s5_title"),
      subtitle: t("getstarted_s5_subtitle"),
      description: t("getstarted_s5_desc"),
      tryLabel: t("getstarted_s5_tryLabel"),
      tryDescription: t("getstarted_s5_tryDesc"),
      tips: [
        t("getstarted_s5_tip1"),
        t("getstarted_s5_tip2"),
        t("getstarted_s5_tip3"),
      ],
    },
    {
      id: "tracker",
      section: "tracker",
      icon: Bell,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      title: t("getstarted_s6_title"),
      subtitle: t("getstarted_s6_subtitle"),
      description: t("getstarted_s6_desc"),
      tryLabel: t("getstarted_s6_tryLabel"),
      tryDescription: t("getstarted_s6_tryDesc"),
      tips: [
        t("getstarted_s6_tip1"),
        t("getstarted_s6_tip2"),
        t("getstarted_s6_tip3"),
      ],
    },
    {
      id: "settings",
      section: "settings",
      icon: Settings,
      color: "text-zinc-400",
      bgColor: "bg-zinc-500/10",
      borderColor: "border-zinc-500/20",
      title: t("getstarted_s7_title"),
      subtitle: t("getstarted_s7_subtitle"),
      description: t("getstarted_s7_desc"),
      tryLabel: t("getstarted_s7_tryLabel"),
      tryDescription: t("getstarted_s7_tryDesc"),
      tips: [
        t("getstarted_s7_tip1"),
        t("getstarted_s7_tip2"),
        t("getstarted_s7_tip3"),
      ],
    },
    {
      id: "done",
      section: null,
      icon: Check,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      title: t("getstarted_s8_title"),
      subtitle: t("getstarted_s8_subtitle"),
      description: t("getstarted_s8_desc"),
      tryLabel: t("getstarted_s8_tryLabel"),
      tryDescription: t("getstarted_s8_tryDesc"),
      tips: [
        t("getstarted_s8_tip1"),
        t("getstarted_s8_tip2"),
        t("getstarted_s8_tip3"),
      ],
    },
  ];
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface GetStartedProps {
  onClose: () => void;
}

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function GetStarted({ onClose }: GetStartedProps) {
  const t = useT();
  const STEPS = buildSteps(t);
  const [stepIndex, setStepIndex] = useState(0);
  const [visitedSections, setVisitedSections] = useState<Set<string>>(new Set(["welcome"]));
  const [exiting, setExiting] = useState(false);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const canAdvance = visitedSections.has(step.id);

  const handleTry = useCallback(() => {
    if (step.section) {
      setActiveSection(step.section);
    }
    setVisitedSections((prev) => new Set([...prev, step.id]));
  }, [step, setActiveSection]);

  const handleNext = useCallback(() => {
    if (isLast) {
      handleFinish();
      return;
    }
    const next = STEPS[stepIndex + 1];
    setVisitedSections((prev) => new Set([...prev, next.id]));
    setStepIndex((i) => i + 1);
  }, [isLast, stepIndex]);

  const handleBack = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  const handleFinish = useCallback(() => {
    setExiting(true);
    markGetStartedDone();
    setTimeout(() => {
      onClose();
    }, 400);
  }, [onClose]);

  const handleSkip = useCallback(() => {
    markGetStartedDone();
    setExiting(true);
    setTimeout(() => onClose(), 400);
  }, [onClose]);

  // Mark welcome as visited on mount
  useEffect(() => {
    setVisitedSections(new Set(["welcome"]));
  }, []);

  const StepIcon = step.icon;
  const progress = ((stepIndex) / (STEPS.length - 1)) * 100;

  return (
    <div
      className="fixed inset-0 z-[9998] flex"
      style={{
        opacity: exiting ? 0 : 1,
        transition: "opacity 0.4s ease",
        pointerEvents: exiting ? "none" : "all",
      }}
    >
      {/* Sidebar — step list */}
      <aside className="w-56 shrink-0 bg-zinc-950 border-r border-zinc-800/80 flex flex-col py-6 gap-0.5 overflow-y-auto">
        {/* Logo */}
        <div className="px-5 pb-5 flex items-center gap-2.5 border-b border-zinc-800/60 mb-2">
          <div className="h-7 w-7 rounded-lg bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
            <Box className="h-4 w-4 text-red-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-200 leading-none">VRC Studio</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">{t("getstarted_get_started")}</p>
          </div>
        </div>

        {STEPS.map((s, i) => {
          const SIcon = s.icon;
          const active = i === stepIndex;
          const visited = visitedSections.has(s.id);
          const done = i < stepIndex || (visited && i > stepIndex);
          return (
            <button
              key={s.id}
              onClick={() => setStepIndex(i)}
              className={cn(
                "relative flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-left transition-all text-xs",
                active
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60"
              )}
            >
              {/* Step indicator */}
              <div
                className={cn(
                  "h-5 w-5 rounded-full flex items-center justify-center shrink-0 transition-all border",
                  active ? `${s.bgColor} ${s.borderColor} ${s.color}` :
                  (visited || done) ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" :
                  "bg-zinc-800 border-zinc-700 text-zinc-600"
                )}
              >
                {(visited || done) && !active
                  ? <Check className="h-2.5 w-2.5" />
                  : <SIcon className="h-2.5 w-2.5" />
                }
              </div>
              <span className={cn("font-medium truncate", active && "text-zinc-100")}>
                {s.title}
              </span>
            </button>
          );
        })}

        {/* Skip button */}
        <div className="mt-auto px-4 pt-4">
          <button
            onClick={handleSkip}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors border border-zinc-800 hover:border-zinc-700"
          >
            <X className="h-3 w-3" /> {t("getstarted_skip")}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 bg-zinc-950 flex flex-col overflow-hidden">
        {/* Progress bar */}
        <div className="h-0.5 bg-zinc-900 shrink-0">
          <div
            className="h-full bg-red-500 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-10 overflow-y-auto">
          <div className="w-full max-w-xl flex flex-col gap-8">

            {/* Icon + header */}
            <div className="flex flex-col items-center text-center gap-4">
              <div
                className={cn(
                  "h-16 w-16 rounded-2xl flex items-center justify-center border",
                  step.bgColor, step.borderColor
                )}
              >
                <StepIcon className={cn("h-8 w-8", step.color)} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-1.5">
                  {t("getstarted_step_of", { current: String(stepIndex + 1), total: String(STEPS.length) })}
                </p>
                <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">{step.title}</h1>
                <p className="text-sm text-zinc-400 mt-1">{step.subtitle}</p>
              </div>
            </div>

            {/* Description */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-5">
              <p className="text-sm text-zinc-300 leading-relaxed">{step.description}</p>
            </div>

            {/* Try it block */}
            {step.section && (
              <div className={cn("rounded-xl border px-6 py-5 flex flex-col gap-3", step.borderColor, step.bgColor)}>
                <div className="flex items-start gap-3">
                  <Play className={cn("h-4 w-4 shrink-0 mt-0.5", step.color)} />
                  <div className="flex-1">
                    <p className={cn("text-sm font-semibold", step.color)}>{step.tryLabel}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{step.tryDescription}</p>
                  </div>
                </div>
                <button
                  onClick={handleTry}
                  className={cn(
                    "self-start flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                    visitedSections.has(step.id)
                      ? "bg-emerald-600/15 border-emerald-500/30 text-emerald-300"
                      : `${step.bgColor} ${step.borderColor} ${step.color} hover:opacity-80`
                  )}
                >
                  {visitedSections.has(step.id)
                    ? <><Check className="h-3.5 w-3.5" /> {t("getstarted_visited")}</>
                    : <><ArrowRight className="h-3.5 w-3.5" /> {t("getstarted_go_to", { title: step.title })}</>
                  }
                </button>
              </div>
            )}

            {/* Tips */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{t("getstarted_tips_label")}</p>
              <div className="flex flex-col gap-1.5">
                {step.tips.map((tip, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-zinc-700 shrink-0 mt-1.5" />
                    <p className="text-xs text-zinc-500 leading-relaxed">{tip}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleBack}
                disabled={isFirst}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-0 disabled:pointer-events-none"
              >
                ← {t("getstarted_back")}
              </button>

              <button
                onClick={handleNext}
                disabled={!canAdvance}
                className={cn(
                  "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all border",
                  canAdvance
                    ? isLast
                      ? "bg-emerald-600 hover:bg-emerald-500 border-emerald-500/50 text-white"
                      : "bg-red-600 hover:bg-red-500 border-red-500/50 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-600 cursor-not-allowed"
                )}
              >
                {isLast ? (
                  <><Check className="h-4 w-4" /> {t("getstarted_done")}</>
                ) : (
                  <>{t("getstarted_next")} <ChevronRight className="h-4 w-4" /></>
                )}
              </button>
            </div>

            {!canAdvance && step.section && (
              <p className="text-center text-[11px] text-zinc-600 -mt-4">
                {t("getstarted_mark_hint", { title: step.title })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}