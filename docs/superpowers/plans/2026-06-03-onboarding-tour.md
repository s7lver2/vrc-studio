# Onboarding Spotlight Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a first-launch spotlight tour that highlights sidebar nav items one by one, teaching new users to navigate the app by clicking each highlighted element.

**Architecture:** A `useTour` hook holds state (active step, visible flag) and persists completion to `localStorage`. `TourOverlay` renders a full-screen dimmed backdrop with a transparent "hole" punched over the current target element using a large `box-shadow`. Clicking the highlighted area advances the tour. `TourTooltip` is a floating panel anchored near the target element. The tour mounts in `App.tsx` and is triggered once after the splash screen completes.

**Tech Stack:** React 18, TypeScript, Zustand (not needed — local hook state is sufficient), Tailwind CSS, `getBoundingClientRect()` for element positioning.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/hooks/useTour.ts` | Create | Tour state, step definitions, localStorage flag, advance/skip/complete |
| `src/components/onboarding/TourOverlay.tsx` | Create | Spotlight hole + click-catcher that advances the tour |
| `src/components/onboarding/TourTooltip.tsx` | Create | Floating tooltip: title, description, step indicator, optional Skip button |
| `src/components/sidebar/Sidebar.tsx` | Modify | Add `data-tour-id` attributes to all nav buttons + settings button |
| `src/components/sidebar/NavItem.tsx` | Modify | Accept and forward `data-tour-id` prop |
| `src/App.tsx` | Modify | Mount `<TourOverlay>`, start tour after `splashDone` becomes true |

---

### Task 1: `useTour` hook — state, steps, localStorage flag

**Files:**
- Create: `src/hooks/useTour.ts`

This hook owns all tour logic. It exposes:
- `tourVisible` — whether the tour overlay is currently mounted
- `step` — index of the current step (0-based)
- `currentStep` — the step object `{ targetId, title, description }`
- `totalSteps` — 6
- `advance()` — go to next step, or complete if last
- `skip()` — mark done and hide
- `startTour()` — called by App.tsx after splash done (only if not already completed)

- [ ] **Step 1: Create the hook file**

```ts
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
      if (next >= STEPS.length) {
        // Will trigger complete on next render via effect, handled in TourOverlay
        return next;
      }
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
```

- [ ] **Step 2: Verify file was created**

```bash
ls src/hooks/useTour.ts
```
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTour.ts
git commit -m "feat: add useTour hook with 6-step onboarding steps and localStorage flag"
```

---

### Task 2: `TourOverlay` component — spotlight hole + click-catcher

**Files:**
- Create: `src/components/onboarding/TourOverlay.tsx`

This component:
1. Finds the DOM element with `document.querySelector('[data-tour-id="<targetId>"]')`
2. Gets its `getBoundingClientRect()`
3. Renders a transparent div at that exact position + 8px padding — with `box-shadow: 0 0 0 9999px rgba(0,0,0,0.72)` — creating the spotlight effect
4. The transparent div is clickable and calls `advance()` on click
5. When `step >= totalSteps`, calls `complete()` and unmounts
6. Recalculates rect on `step` change and on `resize` event

- [ ] **Step 1: Create the component file**

```tsx
// src/components/onboarding/TourOverlay.tsx
import { useEffect, useRef, useState } from "react";
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
  const rafRef = useRef<number | null>(null);

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

    // Small delay to allow any layout shift from step change
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
      {/* Spotlight hole — transparent div with huge box-shadow acting as overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          pointerEvents: "none",
        }}
      />
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
```

- [ ] **Step 2: Verify the file was created**

```bash
ls src/components/onboarding/TourOverlay.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/TourOverlay.tsx
git commit -m "feat: add TourOverlay with spotlight hole using box-shadow technique"
```

---

### Task 3: `TourTooltip` component — floating tooltip

**Files:**
- Create: `src/components/onboarding/TourTooltip.tsx`

The tooltip:
- Positions itself to the **right** of the spotlight rect (since the sidebar is on the left edge, the tooltip should appear to the right of the highlighted button)
- If the element is near the bottom of the screen, it flips upward
- Shows: step indicator dots, title (bold), description, and a "Skip tour" button **only on step 0**
- Shows "Haz clic en el elemento" hint text in small italic below description

- [ ] **Step 1: Create the component**

```tsx
// src/components/onboarding/TourTooltip.tsx

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
  const TOOLTIP_WIDTH = 220;
  const TOOLTIP_GAP   = 16; // gap between spotlight right edge and tooltip left edge

  // Position to the right of the spotlight
  const left = rect.left + rect.width + TOOLTIP_GAP;
  // Vertically centered on the spotlight, clamped to viewport
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
      <p className="text-[10px] text-zinc-600 italic">Haz clic para continuar →</p>

      {/* Skip — only on first step */}
      {step === 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onSkip(); }}
          className="mt-1 text-[10px] text-zinc-600 hover:text-zinc-400 text-left transition-colors"
        >
          Saltar tour
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/onboarding/TourTooltip.tsx
git commit -m "feat: add TourTooltip with step dots, title, description and skip button"
```

---

### Task 4: Add `data-tour-id` attributes to Sidebar nav items

**Files:**
- Modify: `src/components/sidebar/NavItem.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`

`NavItem` already uses `forwardRef` — just add `data-tour-id` prop forwarding. The sidebar already loops through `navItems` — we pass `data-tour-id` matching the step targetIds.

**Mapping:**

| Section | data-tour-id |
|---|---|
| `projects` | `nav-projects` |
| `packages` | `nav-packages` |
| `shop` | `nav-shop` |
| `inventory` | `nav-inventory` |
| `tracker` | `nav-tracker` |
| Settings button (footer) | `nav-settings` |

- [ ] **Step 1: Update `NavItem.tsx` to accept and pass through `data-tour-id`**

Replace the current `NavItemProps` interface and component with:

```tsx
// src/components/sidebar/NavItem.tsx
import { forwardRef } from "react";

interface NavItemProps {
  icon: any;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  compact?: boolean;
  wip?: boolean;
  style?: React.CSSProperties;
  "data-tour-id"?: string;
}

export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(
  ({ icon: Icon, label, active, onClick, badge, compact = false, wip = false, "data-tour-id": tourId }, ref) => {
    return (
      <button
        ref={ref}
        onClick={onClick}
        title={compact ? label : undefined}
        data-tour-id={tourId}
        className={`
          relative flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-all
          ${active
            ? "bg-zinc-800"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
          }
          ${compact ? "justify-center" : "justify-start"}
        `}
        style={active ? { color: "var(--accent-color)" } : {}}
      >
        <div className="relative">
          <Icon className="h-5 w-5 shrink-0" />
          {compact && badge && badge > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-zinc-900" />
          )}
          {compact && wip && (
            <span className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-amber-500 ring-1 ring-zinc-900" />
          )}
        </div>

        {!compact && (
          <span className="truncate text-sm font-medium">{label}</span>
        )}

        {!compact && badge && badge > 0 && (
          <span className="ml-auto px-1.5 py-0.5 text-xs font-semibold rounded-full bg-red-500/20 text-red-400 ring-1 ring-red-500/30">
            {badge > 99 ? "99+" : badge}
          </span>
        )}

        {!compact && wip && (
          <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
            WIP
          </span>
        )}
      </button>
    );
  }
);

NavItem.displayName = "NavItem";
```

- [ ] **Step 2: Update `Sidebar.tsx` to pass `data-tour-id` to each NavItem and to the Settings button**

In `Sidebar.tsx`, update the `navItems` array to include a `tourId` field, and pass it as `data-tour-id` to `<NavItem>`. Also add `data-tour-id="nav-settings"` to the Settings `<button>` in the footer.

Find the `navItems` definition and the nav loop (lines ~18-74 in the current file) and replace with:

```tsx
// In Sidebar.tsx — update navItems array type and data:
const navItems: {
  section: Exclude<Section, "settings" | "logs">;
  label: string;
  icon: typeof Boxes;
  wip?: boolean;
  tourId?: string;
}[] = [
  { section: "projects",  label: t("nav_projects"),  icon: Boxes,        tourId: "nav-projects"  },
  { section: "packages",  label: t("nav_packages"),  icon: Package,      tourId: "nav-packages"  },
  { section: "shop",      label: t("nav_shop"),      icon: ShoppingBag,  tourId: "nav-shop",      wip: true },
  { section: "inventory", label: t("nav_inventory"), icon: Archive,      tourId: "nav-inventory" },
  { section: "tracker",   label: t("nav_tracker"),   icon: Bell,         tourId: "nav-tracker",   wip: true },
  { section: "git",       label: "Git",              icon: GitBranch },
];

// In the nav loop, pass tourId:
{navItems.map(({ section, label, icon, wip, tourId }) => (
  <NavItem
    key={section}
    icon={icon}
    label={label}
    active={activeSection === section}
    onClick={() => setActiveSection(section)}
    badge={section === "tracker" && trackerUnread > 0 ? trackerUnread : undefined}
    compact={isNarrow}
    wip={wip}
    data-tour-id={tourId}
  />
))}
```

And on the Settings button in the footer, add `data-tour-id="nav-settings"`:

```tsx
<button
  data-tour-id="nav-settings"
  onClick={() => setActiveSection("settings")}
  className={`p-2 rounded-lg transition-all ${
    activeSection === "settings"
      ? "bg-zinc-800"
      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
  }`}
  style={activeSection === "settings" ? { color: "var(--accent-color)" } : {}}
  title={t("nav_settings")}
>
  <Settings className="h-5 w-5" />
</button>
```

- [ ] **Step 3: Verify TypeScript compiles — run tsc check**

```bash
cd E:/vrcstudio && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors related to `data-tour-id` or `tourId`.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/NavItem.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat: add data-tour-id attributes to sidebar nav items for onboarding tour"
```

---

### Task 5: Wire tour into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

The tour should start automatically after the splash screen finishes (`splashDone` becomes `true`). We use the `useTour` hook at the `App` component level and render `<TourOverlay>` when `tourVisible` is true.

- [ ] **Step 1: Import the hook and component in `App.tsx`**

Add these imports at the top of `App.tsx`:

```tsx
import { useTour } from "@/hooks/useTour";
import { TourOverlay } from "@/components/onboarding/TourOverlay";
```

- [ ] **Step 2: Add tour hook usage inside the `App()` function**

After the existing `const [splashDone, setSplashDone] = useState(false);` line, add:

```tsx
const { tourVisible, step, totalSteps, currentStep, startTour, advance, skip, complete } = useTour();
```

- [ ] **Step 3: Update `handleSplashDone` to also trigger the tour**

Replace:
```tsx
const handleSplashDone = useCallback(() => setSplashDone(true), []);
```
With:
```tsx
const handleSplashDone = useCallback(() => {
  setSplashDone(true);
  // Small delay so the app layout is visible before tour starts
  setTimeout(startTour, 600);
}, [startTour]);
```

- [ ] **Step 4: Render `<TourOverlay>` in the JSX**

At the very end of the `App()` return, after `<MigrationPopup .../>`, add:

```tsx
{splashDone && tourVisible && (
  <TourOverlay
    step={step}
    totalSteps={totalSteps}
    currentStep={currentStep}
    onAdvance={advance}
    onSkip={skip}
    onComplete={complete}
  />
)}
```

- [ ] **Step 5: Run TypeScript check to verify no errors**

```bash
cd E:/vrcstudio && npx tsc --noEmit 2>&1 | head -40
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire onboarding tour into App — starts after splash, uses TourOverlay"
```

---

### Task 6: Manual smoke test + tour reset utility

**Files:**
- Modify: `src/App.tsx` — add a way to re-trigger tour from Settings (optional dev helper, can be a console one-liner)

The tour stores its completion state in `localStorage` under key `"onboarding_tour_done"`. To re-test:

```js
// In browser devtools console:
localStorage.removeItem("onboarding_tour_done"); location.reload();
```

- [ ] **Step 1: Verify tour works end-to-end manually**

1. Run `npm run tauri dev` (or `cargo tauri dev`)
2. Open the app — after splash, the tour should appear highlighting "Proyectos"
3. Click the highlighted button → advances to "Paquetes"
4. Continue clicking through all 6 steps
5. After step 6 (Ajustes), tour disappears
6. Reload — tour should NOT re-appear (localStorage flag set)
7. Run `localStorage.removeItem("onboarding_tour_done")` in devtools, reload — tour appears again

- [ ] **Step 2: Verify Skip button works on step 0 only**

1. Clear localStorage flag, reload
2. On step 1 (Proyectos), confirm "Saltar tour" button is visible
3. Click "Saltar tour" — tour disappears
4. Reload — tour does NOT reappear (flag set)
5. Advance to step 2, confirm "Saltar tour" is gone

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: onboarding spotlight tour complete — 6 steps, skip on step 1, localStorage persistence"
```
