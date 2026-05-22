# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que los ajustes de Apariencia sean completamente funcionales en toda la app, fusionar las tabs Compression + Storage en una sola sección mejorada, y rediseñar completamente Connections con un concepto nuevo y atrevido.

**Architecture:**
- Task 1 corrige el sistema de CSS variables y asegura que cada ajuste de apariencia se propaga a toda la UI (incluyendo el acento de color dinámico).
- Task 2 fusiona `StorageSection` dentro de `CompressionSection` (renombrada `CompressionStorageSection`) y actualiza el nav sidebar de Settings.
- Task 3 reemplaza el sistema de tiles de Connections por un "Connection Hub" de tarjetas expansibles con estado en vivo, acciones rápidas e indicadores visuales atrevidos.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Zustand, Lucide React, Tauri 2 (Rust backend).

---

## Contexto previo importante

Antes de implementar, lee estos archivos para tener contexto completo:

```bash
cat src/store/appearanceStore.ts src/main.tsx src/index.css
cat src/pages/Settings.tsx
cat src/components/settings/AppearanceSection.tsx
cat src/components/settings/CompressionSection.tsx src/components/settings/StorageSection.tsx
grep -n "ConnectionsSection\|IntegrationTile\|BoothBlock\|RipperBlock" src/pages/Settings.tsx | head -30
```

---

## Task 1: Apariencia completamente funcional en toda la app

**Objetivo:** Cada ajuste de la sección Appearance se aplica en tiempo real a toda la aplicación: accent color, background, font size, animation speed, sidebar width, UI scale, card sizes y view defaults.

**Problemas conocidos a resolver:**
1. `--anim` "off" envía `"0.0001s"` pero la CSS lo usa en `calc(var(--anim) * 200ms)` — unidades incompatibles → fix: cambiar a `"0"` unitless.
2. No existe `--accent-color` como variable CSS derivada; los componentes usan `violet-500` hardcoded → fix: añadir `--accent-color: hsl(var(--accent-h) var(--accent-s) var(--accent-l))` en `:root`.
3. `AppearanceSection` usa `border-violet-500` hardcoded para estados activos → fix: usar `style={{ borderColor: "var(--accent-color)" }}` dinámicamente.
4. `BgStyle "zinc-950"` cambia `--app-bg` pero el `body` aún usa `hsl(var(--background))` hardcoded → fix: hacer que body también use `var(--app-bg)`.
5. Sidebar "narrow" muestra solo iconos pero `Sidebar.tsx` puede no tener implementado el modo icon-only → verificar y completar.

**Files:**
- Modify: `src/index.css`
- Modify: `src/store/appearanceStore.ts`
- Modify: `src/components/settings/AppearanceSection.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx` (verificar modo narrow)
- Modify: `src/App.tsx` (verificar que `--app-bg` se aplica a body/root)

---

### Task 1.1: Fix CSS variables fundamentales

**Files:**
- Modify: `src/index.css`
- Modify: `src/store/appearanceStore.ts`

- [ ] **Step 1: Leer el estado actual de `index.css` y `appearanceStore.ts`**

```bash
cat src/index.css && echo "===" && grep -n "ANIM_MAP\|applyBgStyle\|applyAccentColor\|--accent\|--app-bg\|--anim" src/store/appearanceStore.ts
```

- [ ] **Step 2: Añadir `--accent-color` derivado y corregir `body` background en `index.css`**

En el bloque `:root`, añade la variable derivada:

```css
:root {
  /* ... variables existentes ... */
  --accent-color: hsl(var(--accent-h) var(--accent-s) var(--accent-l));
}
```

Cambia el bloque `body` para que también use `--app-bg`:

```css
body {
  margin: 0;
  background-color: var(--app-bg);      /* ← era hsl(var(--background)) */
  color: hsl(var(--foreground));
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 3: Corregir `ANIM_MAP` en `appearanceStore.ts`**

Busca:
```ts
const ANIM_MAP: Record = {
  off: "0.0001s", slow: "2", normal: "1", fast: "0.4",
};
```

Reemplaza con (unitless para que `calc(var(--anim) * 200ms)` funcione):
```ts
const ANIM_MAP: Record = {
  off: "0", slow: "2", normal: "1", fast: "0.4",
};
```

- [ ] **Step 4: Verificar que la CSS usa el multiplicador correctamente**

El bloque `*` en `index.css` debe quedar así (si `--anim` es `0`, el resultado es `0ms` — las transiciones desaparecen):

```css
* {
  transition-property: color, background-color, border-color, opacity, box-shadow;
  transition-duration: calc(var(--anim, 1) * 200ms);
  transition-timing-function: ease;
}
```

Esto ya debería estar correcto. Solo verifica que no haya otras ocurrencias de `transition-duration` que no usen la variable:

```bash
grep -n "transition-duration" src/index.css
```

Si hay líneas con valores hardcoded, añádeles la variable multiplicada también.

- [ ] **Step 5: Commit del fix de CSS variables**

```bash
git add src/index.css src/store/appearanceStore.ts
git commit -m "fix(appearance): correct --anim unitless value, add --accent-color derived var, fix body bg"
```

---

### Task 1.2: Hacer que los estados activos de AppearanceSection usen el accent color

**Files:**
- Modify: `src/components/settings/AppearanceSection.tsx`

El problema: todos los botones "activos" dentro de AppearanceSection usan `border-violet-500 bg-violet-950/30` hardcoded en lugar del color de acento dinámico.

- [ ] **Step 1: Leer AppearanceSection completo**

```bash
cat src/components/settings/AppearanceSection.tsx
```

- [ ] **Step 2: Añadir helper `accentStyle` al componente**

Justo después de la declaración de `activeAccent`, añade:

```ts
// Estilos inline dinámicos para estados activos con el accent color
const accentBorder = { borderColor: "var(--accent-color)" } as React.CSSProperties;
const accentBg = { borderColor: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.12)" } as React.CSSProperties;
const accentText = { color: "var(--accent-color)" } as React.CSSProperties;
```

- [ ] **Step 3: Actualizar selector de Background**

Busca el map de background options. El botón activo usa `border-violet-500`. Reemplaza:

```tsx
// ANTES
className={cn(
  "flex flex-col items-start gap-2 p-3 rounded-xl border-2 transition-all",
  bgStyle === opt.value
    ? "border-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.2)]"
    : "border-zinc-800 hover:border-zinc-700"
)}
```

```tsx
// DESPUÉS
className={cn(
  "flex flex-col items-start gap-2 p-3 rounded-xl border-2 transition-all",
  bgStyle === opt.value
    ? "border-zinc-700"          // el color real viene del style={}
    : "border-zinc-800 hover:border-zinc-700"
)}
style={bgStyle === opt.value ? {
  ...accentBorder,
  boxShadow: `0 0 12px hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.25)`,
  background: opt.hex,
} : { background: opt.hex }}
```

- [ ] **Step 4: Actualizar selector de Font Size**

Busca el map de font size options. El botón activo usa `border-violet-500 bg-violet-950/30`. Reemplaza:

```tsx
// ANTES
className={cn(
  "flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all",
  fontSize === opt.value
    ? "border-violet-500 bg-violet-950/30"
    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
)}
```

```tsx
// DESPUÉS
className={cn(
  "flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all",
  fontSize === opt.value
    ? "border-zinc-700"
    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
)}
style={fontSize === opt.value ? accentBg : {}}
```

- [ ] **Step 5: Actualizar selector de Animation Speed**

Busca el map de animation options. Reemplaza:

```tsx
// ANTES
className={cn(
  "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all capitalize",
  animSpeed === opt
    ? "border-violet-500 bg-violet-950/30"
    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
)}
```

```tsx
// DESPUÉS
className={cn(
  "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all capitalize",
  animSpeed === opt
    ? "border-zinc-700"
    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
)}
style={animSpeed === opt ? accentBg : {}}
```

- [ ] **Step 6: Actualizar Default View Mode buttons**

Busca el map de `["grid", "list"]`. Reemplaza el active style:

```tsx
// ANTES
defaultView === v
  ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
  : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300"
```

```tsx
// DESPUÉS  (sin clases de color para el estado activo, todo via style)
defaultView === v
  ? "border-zinc-700"
  : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300"
style={defaultView === v ? { ...accentBg, ...accentText } : {}}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/AppearanceSection.tsx
git commit -m "feat(appearance): dynamic accent color in AppearanceSection active states"
```

---

### Task 1.3: Propagar el accent color al resto de la UI crítica

**Objetivo:** Los nav items activos del sidebar, los badges WIP/BETA, y los toggles usan el accent. No todos los elementos necesitan cambio — solo los que tienen un "selected/active" state.

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/pages/Settings.tsx` (el toggle del sidebar de settings y los nav items)

- [ ] **Step 1: Leer Sidebar.tsx**

```bash
cat src/components/sidebar/Sidebar.tsx
```

- [ ] **Step 2: En `Sidebar.tsx`, cambiar el active indicator al accent color**

Busca el elemento que marca el nav item activo (probablemente tiene `bg-red-500` o `bg-zinc-700` o similar). Cámbialo a:

```tsx
// El indicador lateral de item activo
style={{ background: "var(--accent-color)" }}
```

Si hay un badge o highlight de item activo, usa `style={{ color: "var(--accent-color)" }}` en lugar de `text-red-400` hardcoded.

- [ ] **Step 3: En `Settings.tsx`, cambiar active nav item al accent**

Busca en el sidebar de settings el estado activo del botón:
```tsx
active
  ? "bg-zinc-800 text-zinc-100"
  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
```

Ajusta el item activo para usar el accent color sutilmente en el texto:
```tsx
active
  ? "bg-zinc-800 text-zinc-100"    // background sigue siendo zinc-800
  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
// y añade al  activo:
style={active ? { color: "var(--accent-color)" } : {}}
```

- [ ] **Step 4: Verificar el modo "narrow" del sidebar**

```bash
grep -n "narrow\|icon.only\|collapsed\|sidebarWidth" src/components/sidebar/Sidebar.tsx
```

Si el modo "narrow" no está implementado (solo cambia el ancho CSS pero no oculta los labels), añade la lógica:

```tsx
const { sidebarWidth } = useAppearanceStore();
const isNarrow = sidebarWidth === "narrow";

// En cada nav item:
{!isNarrow && {label}}
// Tooltip cuando narrow:
title={isNarrow ? label : undefined}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/pages/Settings.tsx
git commit -m "feat(appearance): propagate accent color to sidebar active states, implement narrow sidebar mode"
```

---

### Task 1.4: Asegurar que card sizes y defaultView se consumen correctamente

**Objetivo:** `shopItemSize`, `inventoryItemSize`, y `defaultView` del store se usan en Shop/Inventory. Verificar que realmente los leen desde el store.

**Files:**
- Grep para encontrar qué componentes consumen estos valores

- [ ] **Step 1: Buscar dónde se consume `shopItemSize` / `inventoryItemSize`**

```bash
grep -rn "shopItemSize\|inventoryItemSize\|defaultView\|useAppearanceStore" src/ --include="*.tsx" | grep -v "AppearanceSection\|appearanceStore"
```

- [ ] **Step 2: Si Shop no lee `shopItemSize` del store, añadir el hook**

En el componente de grid de Shop (probablemente `src/components/shop/ShopGrid.tsx` o similar):

```tsx
import { useAppearanceStore } from "@/store/appearanceStore";

// dentro del componente:
const { shopItemSize } = useAppearanceStore();

// Usar en el grid:
const cardWidth = shopItemSize === "compact" ? 160 : shopItemSize === "normal" ? 200 : 240;
// O en Tailwind (si tienes clases condicionales):
const gridCols = shopItemSize === "compact"
  ? "grid-cols-5"
  : shopItemSize === "normal"
    ? "grid-cols-4"
    : "grid-cols-3";
```

- [ ] **Step 3: Si Inventory no lee `inventoryItemSize` del store, añadir el hook**

Mismo patrón en `src/components/inventory/` — busca el grid principal y lee `inventoryItemSize`.

- [ ] **Step 4: Si el componente de grid de Inventory usa `defaultView`, verificar**

```bash
grep -rn "defaultView\|viewMode\|\"grid\"\|\"list\"" src/components/inventory/ --include="*.tsx" | head -20
```

Si `defaultView` no se usa como valor inicial del state local:

```tsx
const { defaultView } = useAppearanceStore();
const [viewMode, setViewMode] = useState(defaultView);
```

- [ ] **Step 5: Commit**

```bash
git add src/components/
git commit -m "feat(appearance): connect shopItemSize, inventoryItemSize, defaultView to actual grid components"
```

---

## Task 2: Fusionar Compression + Storage en una sola tab mejorada

**Objetivo:** Eliminar la tab "Storage" del sidebar de Settings. Mover el contenido de `StorageSection` a una nueva sección dentro de la tab "Compression" (renombrada "Storage & Compression"). Mejorar el diseño visual de Compression.

**Files:**
- Modify: `src/pages/Settings.tsx` (nav groups, routing, nuevo wrapper)
- Modify: `src/components/settings/CompressionSection.tsx` (mejorar diseño)
- Delete or merge: `src/components/settings/StorageSection.tsx` (su contenido se mueve, el archivo puede quedar como re-export o eliminarse)

**Estructura de la nueva tab:**

```
Storage & Compression
├── [Sub-nav]: Storage | Compression           ← dos pestañas internas
│
│ TAB: Storage (contenido actual de StorageSection)
│   ├── Disk Usage (stat bars)
│   ├── Cache (clear + memory cache)
│   ├── Space Recovery (SpaceReclaimer)
│   └── Assets Folder
│
│ TAB: Compression (contenido actual de CompressionSection mejorado)
│   ├── Preset cards (Fast / Balanced / Maximum / Store / Custom)
│   ├── Speed/Ratio visual bars
│   └── Custom config expandido
```

---

### Task 2.1: Crear la nueva sección fusionada `StorageCompressionSection`

**Files:**
- Create: `src/components/settings/StorageCompressionSection.tsx`

- [ ] **Step 1: Crear el componente con sub-nav interno**

```tsx
// src/components/settings/StorageCompressionSection.tsx
import { useState } from "react";
import { HardDrive, Archive } from "lucide-react";
import { StorageSection } from "./StorageSection";
import { CompressionSection } from "./CompressionSection";

type SubTab = "storage" | "compression";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function StorageCompressionSection() {
  const [activeTab, setActiveTab] = useState("storage");

  const tabs: { id: SubTab; label: string; icon: React.ElementType }[] = [
    { id: "storage",     label: "Storage",     icon: HardDrive },
    { id: "compression", label: "Compression", icon: Archive   },
  ];

  return (
    
      {/* Sub-nav pill */}
      
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
                active
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
              style={active ? {
                background: "var(--app-bg, #09090b)",
                border: "1px solid",
                borderColor: "var(--accent-color)",
                color: "var(--accent-color)",
                boxShadow: "0 0 10px hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.2)",
              } : {}}
            >
              
              {tab.label}
            
          );
        })}
      

      {/* Content */}
      {activeTab === "storage"     && }
      {activeTab === "compression" && }
    
  );
}
```

- [ ] **Step 2: Verificar que el componente compila (check imports)**

```bash
cd src && grep -n "^import" components/settings/StorageSection.tsx | head -5
cd src && grep -n "^import" components/settings/CompressionSection.tsx | head -5
```

Si hay errores, ajusta los imports en el nuevo archivo.

- [ ] **Step 3: Commit del nuevo componente**

```bash
git add src/components/settings/StorageCompressionSection.tsx
git commit -m "feat(settings): create StorageCompressionSection with internal sub-nav"
```

---

### Task 2.2: Actualizar Settings.tsx — nav y routing

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Añadir import del nuevo componente**

En los imports de Settings.tsx, añade:
```tsx
import { StorageCompressionSection } from "@/components/settings/StorageCompressionSection";
```

- [ ] **Step 2: Actualizar el tipo `SettingsTab`**

```tsx
// ANTES
type SettingsTab = "general" | "packages" | "integrations" | "connections" |
  "compression" | "updates" | "debug" | "appearance" | "storage" | "logs" | "import";

// DESPUÉS (eliminar "storage", renombrar "compression" a "storage-compression")
type SettingsTab = "general" | "packages" | "integrations" | "connections" |
  "storage-compression" | "updates" | "debug" | "appearance" | "logs" | "import";
```

- [ ] **Step 3: Actualizar `NAV_GROUPS`**

```tsx
// ANTES (en el grupo APP):
items: [
  { id: "general",     labelKey: "settings_tab_general",     icon: SettingsIcon },
  { id: "appearance",  labelKey: "settings_tab_appearance",  icon: Palette },
  { id: "compression", labelKey: "settings_tab_compression", icon: Archive },
  { id: "storage",     labelKey: "settings_tab_storage",     icon: HardDrive },
],

// DESPUÉS (eliminar storage, renombrar compression):
items: [
  { id: "general",             labelKey: "settings_tab_general",     icon: SettingsIcon },
  { id: "appearance",          labelKey: "settings_tab_appearance",  icon: Palette },
  { id: "storage-compression", labelKey: "settings_tab_storage_compression", icon: Archive },
],
```

Nota: añade la i18n key `"settings_tab_storage_compression"` → `"Storage & Compression"` en los archivos de i18n (busca con `grep -rn "settings_tab_compression" src/i18n/`).

- [ ] **Step 4: Actualizar el `main` render**

```tsx
// ANTES
{activeTab === "compression" && }
{activeTab === "storage" && }

// DESPUÉS
{activeTab === "storage-compression" && (
  <>
    
    
  </>
)}
```

Elimina también el wrapper `CompressionSectionWrapper` si ya no se usa.

- [ ] **Step 5: Añadir la i18n key**

```bash
grep -rn "settings_tab_compression\|compression_section_title" src/i18n/
```

En cada archivo de i18n (`en.ts`, `es.ts`, `de.ts`), añade:
```ts
settings_tab_storage_compression: "Storage & Compression",
// es.ts:
settings_tab_storage_compression: "Almacenamiento y Compresión",
// de.ts:
settings_tab_storage_compression: "Speicher & Komprimierung",
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.tsx src/i18n/
git commit -m "feat(settings): merge storage+compression tabs into single 'Storage & Compression' section"
```

---

### Task 2.3: Mejorar el diseño visual de CompressionSection

**Files:**
- Modify: `src/components/settings/CompressionSection.tsx`

Los cambios de diseño son:
1. Los preset cards usan `border-l-[3px]` para el estado activo — cambia a un diseño más limpio con `box-shadow` glow usando el accent color del preset.
2. El panel "custom" expandido tiene labels en mayúsculas sin separación visual — mejorar con separadores y labels más legibles.
3. El botón "Save" debe usar el accent color de la app (no rojo hardcoded).

- [ ] **Step 1: Mejorar el active state de los preset cards**

En el map de `PRESETS.map(...)`, busca el `className` del botón activo:

```tsx
// ANTES
active
  ? cn("border-l-[3px]", p.accentBorder, p.accentBg)
  : "border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
```

```tsx
// DESPUÉS (active con box-shadow glow en el color del preset, no border-left)
active
  ? cn("border", p.accentBorder, p.accentBg)
  : "border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
// y añade al botón:
style={active ? {
  boxShadow: `0 0 0 1px ${getPresetAccentHex(p.id)}, 0 4px 16px ${getPresetAccentHex(p.id)}33`,
} : {}}
```

Añade el helper antes del return de `CompressionSection`:
```ts
function getPresetAccentHex(preset: CompressionPreset): string {
  const map: Record = {
    fast: "#f59e0b", balanced: "#38bdf8",
    maximum: "#8b5cf6", store: "#71717a", custom: "#ef4444",
  };
  return map[preset];
}
```

- [ ] **Step 2: Mejorar el botón Save**

```tsx
// ANTES
className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
  saved
    ? "bg-emerald-700/25 border border-emerald-500/40 text-emerald-300"
    : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100 border border-zinc-600")}

// DESPUÉS (usa accent-color cuando no está guardado)
className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
  saved
    ? "bg-emerald-700/25 border-emerald-500/40 text-emerald-300"
    : "text-zinc-100 border-zinc-700 hover:border-zinc-500")}
style={!saved ? { borderColor: "var(--accent-color)", color: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.1)" } : {}}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/CompressionSection.tsx
git commit -m "refactor(compression): cleaner preset active states with glow, accent-aware save button"
```

---

## Task 3: Redesign completo de Connections

**Objetivo:** Reemplazar el sistema de `IntegrationTile` (tiles pequeñas de 80px) por un "Connection Hub" — tarjetas expansibles de ancho completo con estado en vivo, avatares de cuenta, acciones rápidas, y un diseño atrevido que mantiene toda la funcionalidad.

**Concepto visual — "Connection Hub":**
- Cada integración es una tarjeta de ancho completo (~w-full)
- La tarjeta tiene 3 zonas: izquierda (logo + nombre + status pulse), centro (info + cuenta conectada), derecha (acciones)
- Estado conectado: borde verde con glow, pulse animado, muestra avatar/usuario
- Estado desconectado: gris con call-to-action prominente
- Bloqueado por dev code: overlay semitransparente con candado y mensaje descriptivo
- El GitHub device flow ahora se muestra en línea dentro de la propia card (no modal separado) si cabe, o en un mini-panel que se expande de la card
- Sin modal de detalle extra — todo está visible en la tarjeta expandida

**Files:**
- Create: `src/components/settings/ConnectionHub.tsx` ← componente nuevo completo
- Modify: `src/pages/Settings.tsx` ← usar `ConnectionHub` en lugar de `ConnectionsSection`

---

### Task 3.1: Crear `ConnectionHub.tsx`

**Files:**
- Create: `src/components/settings/ConnectionHub.tsx`

- [ ] **Step 1: Crear el componente base con tipos**

```tsx
// src/components/settings/ConnectionHub.tsx
import React, { useState, useEffect } from "react";
import {
  Wifi, Lock, LogOut, RefreshCw, ExternalLink,
  Loader2, CheckCircle2, XCircle, AlertTriangle,
  Copy, Check,
} from "lucide-react";
import { useBoothStatus } from "@/hooks/useBoothStatus";
import { useRipperStatus, RipperStatus } from "@/hooks/useRipperStatus";
import { github, GithubUserInfo } from "@/lib/tauri";
import { useAppStore } from "@/store/app";
import { DeveloperCodeModal } from "./DeveloperCodeModal";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type ConnectionStatus = "connected" | "disconnected" | "unknown" | "expired";

interface ConnectionCardConfig {
  id: string;
  name: string;
  description: string;
  logo: React.ReactNode;
  status: ConnectionStatus;
  accountLine?: string;        // texto de cuenta conectada, ej "@usuario" o "12 purchases"
  requiresDevCode: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  // Contenido extra que se expande en la card cuando está conectado
  expandedContent?: React.ReactNode;
  // Si true, la card tiene un "device flow" in-progress state
  connectingState?: "idle" | "waiting" | "done";
  devicePrompt?: { user_code: string; verification_uri: string } | null;
}
```

- [ ] **Step 2: Implementar `ConnectionCard` — el componente de tarjeta individual**

```tsx
function ConnectionCard({
  card,
  isLocked,
  onLockedClick,
}: {
  card: ConnectionCardConfig;
  isLocked: boolean;
  onLockedClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isConnected = card.status === "connected";
  const isExpired = card.status === "expired";
  const isUnknown = card.status === "unknown";

  const statusColor: Record = {
    connected: "#34d399",   // emerald
    disconnected: "#52525b", // zinc
    unknown: "#a16207",      // amber dim
    expired: "#f59e0b",      // amber
  };
  const statusLabel: Record = {
    connected: "Connected",
    disconnected: "Disconnected",
    unknown: "Checking…",
    expired: "Session expired",
  };

  return (
    <div
      className={cn(
        "relative rounded-2xl border overflow-hidden transition-all duration-300",
        isConnected
          ? "border-emerald-800/60"
          : isExpired
            ? "border-amber-900/50"
            : "border-zinc-800"
      )}
      style={{
        background: isConnected
          ? "radial-gradient(ellipse at 0% 0%, rgba(52,211,153,0.06) 0%, #09090b 60%)"
          : "#0f0f11",
        boxShadow: isConnected
          ? "0 0 0 1px rgba(52,211,153,0.15), 0 4px 24px rgba(52,211,153,0.08)"
          : isExpired
            ? "0 0 0 1px rgba(245,158,11,0.15)"
            : "none",
      }}
    >
      {/* Lock overlay */}
      {isLocked && (
        
          
            
          
          
            Dev Code Required
            Tap to unlock with developer code
          
        
      )}

      {/* Main row */}
      
        {/* Logo con status ring */}
        
          
            {card.logo}
          
          {/* Pulse dot */}
          
            {isConnected && (
              
            )}
          
        

        {/* Info */}
        
          
            {card.name}
            
              {statusLabel[card.status]}
            
          
          {card.description}
          {card.accountLine && isConnected && (
            {card.accountLine}
          )}
        

        {/* Actions */}
        
          {isConnected ? (
            <>
              {card.expandedContent && (
                <button
                  onClick={() => setExpanded((e) => !e)}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                >
                  {expanded ? "Less" : "Details"}
                
              )}
              
                 Disconnect
              
            </>
          ) : isExpired ? (
            
               Reconnect
            
          ) : isUnknown ? (
            
              
            
          ) : (
            /* DEVICE FLOW en progreso — mostrar inline */
            card.connectingState === "waiting" && card.devicePrompt ? null /* inline below */ : (
              <button
                onClick={card.onConnect}
                disabled={card.connectingState === "waiting"}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-zinc-100 transition-all"
                style={{ background: "var(--accent-color)", boxShadow: "0 0 12px hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.3)" }}
              >
                Connect
              
            )
          )}
        
      

      {/* GitHub device flow — panel in-card */}
      {card.connectingState === "waiting" && card.devicePrompt && !isConnected && (
        <DeviceFlowPanel
          userCode={card.devicePrompt.user_code}
          verificationUri={card.devicePrompt.verification_uri}
          onCancel={card.onConnect /* parent debe reinicializar */}
        />
      )}

      {/* Expanded detail */}
      {expanded && card.expandedContent && (
        
          {card.expandedContent}
        
      )}
    
  );
}
```

- [ ] **Step 3: Implementar `DeviceFlowPanel` — el panel in-card de GitHub OAuth**

```tsx
function DeviceFlowPanel({
  userCode,
  verificationUri,
  onCancel,
}: {
  userCode: string;
  verificationUri: string;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    
      
        
        Waiting for GitHub authorization…
      
      
        
          Open{" "}
          
            {verificationUri}
          {" "}
          and enter this code:
        
        
          
            {userCode}
          
          
            {copied ?  : }
          
        
        
          Cancel
        
      
    
  );
}
```

- [ ] **Step 4: Implementar el componente principal `ConnectionHub`**

```tsx
export function ConnectionHub() {
  const { untrustedSourcesUnlocked, setUntrustedSourcesUnlocked } = useAppStore();
  const { riperstoreExperimental, setRiperstoreExperimental } = useAppStore();
  const [showCodeModal, setShowCodeModal] = useState(false);

  // GitHub
  const [githubUser, setGithubUser] = useState(null);
  const [githubAuthStep, setGithubAuthStep] = useState("idle");
  const [devicePrompt, setDevicePrompt] = useState(null);

  // Booth + Ripper
  const { status: boothStatus, purchaseCount, connect: boothConnect, disconnect: boothDisconnect } = useBoothStatus();
  const { status: ripperStatus, connect: ripperConnect, disconnect: ripperDisconnect, reconnect: ripperReconnect } = useRipperStatus();

  useEffect(() => {
    github.getUser().then(setGithubUser).catch(() => setGithubUser(null));
  }, []);

  const startGithubAuth = async () => {
    if (githubAuthStep === "waiting") {
      // cancelar
      setGithubAuthStep("idle");
      setDevicePrompt(null);
      return;
    }
    setGithubAuthStep("waiting");
    try {
      const prompt = await github.startDeviceAuth();
      setDevicePrompt(prompt);
      const info = await github.pollToken();
      setGithubUser(info);
      setGithubAuthStep("done");
      setDevicePrompt(null);
    } catch {
      setGithubAuthStep("idle");
      setDevicePrompt(null);
    }
  };

  const cards: ConnectionCardConfig[] = [
    {
      id: "github",
      name: "GitHub",
      description: "Link your GitHub account to unlock repository integrations and private package sources.",
      logo: (
        
          
        
      ),
      status: githubUser ? "connected" : githubAuthStep === "waiting" ? "unknown" : "disconnected",
      accountLine: githubUser ? `@${githubUser.login}` : undefined,
      requiresDevCode: false,
      onConnect: startGithubAuth,
      onDisconnect: async () => { await github.logout(); setGithubUser(null); },
      connectingState: githubAuthStep,
      devicePrompt: devicePrompt,
      expandedContent: githubUser ? (
        
          
          
            {githubUser.name ?? githubUser.login}
            @{githubUser.login}
          
          
             Profile
          
        
      ) : undefined,
    },
    {
      id: "booth",
      name: "Booth.pm",
      description: "Connect to browse and import your Booth.pm purchases directly into your library.",
      logo: 🛒,
      status: boothStatus === "connected" ? "connected" : boothStatus === "unknown" ? "unknown" : "disconnected",
      accountLine: boothStatus === "connected" && purchaseCount !== null
        ? `${purchaseCount} purchased item${purchaseCount !== 1 ? "s" : ""} detected`
        : undefined,
      requiresDevCode: false,
      onConnect: boothConnect,
      onDisconnect: boothDisconnect,
    },
    {
      id: "riperstore",
      name: "Riperstore",
      description: "Experimental integration with Riperstore forums for extended asset discovery.",
      logo: 🔮,
      status: ripperStatus === "connected" ? "connected" : ripperStatus === "expired" ? "expired" : "disconnected",
      requiresDevCode: true,
      onConnect: () => { setRiperstoreExperimental(true); ripperConnect(); },
      onDisconnect: () => { ripperDisconnect(); setRiperstoreExperimental(false); },
    },
  ];

  return (
    <>
      {showCodeModal && (
        <DeveloperCodeModal
          onClose={() => setShowCodeModal(false)}
          onUnlocked={() => { setUntrustedSourcesUnlocked(true); setShowCodeModal(false); }}
        />
      )}

      
        {/* Dev mode indicator */}
        
          
             Integrations
          
          {untrustedSourcesUnlocked ? (
            <button
              onClick={() => setUntrustedSourcesUnlocked(false)}
              className="flex items-center gap-1 text-[9px] px-2 py-1 rounded-md border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
               Lock Dev Mode
            
          ) : (
            
               Some integrations require dev code
            
          )}
        

        {/* Cards */}
        
          {cards.map((card) => (
            <ConnectionCard
              key={card.id}
              card={card}
              isLocked={card.requiresDevCode && !untrustedSourcesUnlocked}
              onLockedClick={() => setShowCodeModal(true)}
            />
          ))}
        
      
    </>
  );
}
```

- [ ] **Step 5: Verificar que todos los imports existen**

```bash
grep -rn "useBoothStatus\|useRipperStatus\|github\|GithubUserInfo\|DeveloperCodeModal\|useAppStore" src/components/settings/ConnectionHub.tsx | head -20
# Verificar que los hooks devuelven lo que esperamos:
grep -n "purchaseCount\|reconnect" src/hooks/useBoothStatus.ts src/hooks/useRipperStatus.ts
```

Si `purchaseCount` no existe en `useBoothStatus`, ajusta el campo `accountLine` de la card de Booth para no usarlo.
Si `reconnect` no existe en `useRipperStatus`, en la card de Riperstore usa `ripperConnect` en lugar de `ripperReconnect`.

- [ ] **Step 6: Commit de ConnectionHub**

```bash
git add src/components/settings/ConnectionHub.tsx
git commit -m "feat(connections): new ConnectionHub — full-width cards with live status, device flow inline, dev lock overlay"
```

---

### Task 3.2: Integrar ConnectionHub en Settings.tsx

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Añadir el import**

```tsx
import { ConnectionHub } from "@/components/settings/ConnectionHub";
```

- [ ] **Step 2: Reemplazar la función `ConnectionsSection` en el main render**

```tsx
// ANTES
{activeTab === "connections" && }

// DESPUÉS
{activeTab === "connections" && (
  <>
    
    
  </>
)}
```

- [ ] **Step 3: La función `ConnectionsSection` antigua puede quedar pero ya no se renderiza**

Opcionalmente, si quieres limpiar el archivo:
```bash
# Verificar que ConnectionsSection ya no se llama en ningún otro lugar
grep -n "ConnectionsSection\|IntegrationTile\|IntegrationDetailModal" src/pages/Settings.tsx | wc -l
```

Si solo aparece en su propia definición, la puedes eliminar o comentar. Esto es opcional.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(settings): use new ConnectionHub in connections tab, remove legacy ConnectionsSection"
```

---

### Task 3.3: Añadir animación pulse al status dot

**Objetivo:** El `animate-ping` de Tailwind no funciona con `var(--anim)` porque es una animación CSS fija. Cuando `animSpeed` es "off", hay que detener el ping también.

**Files:**
- Modify: `src/components/settings/ConnectionHub.tsx`

- [ ] **Step 1: Añadir condición para el ping basada en `animSpeed`**

Importa el store:
```tsx
import { useAppearanceStore } from "@/store/appearanceStore";
```

En `ConnectionCard`:
```tsx
const { animSpeed } = useAppearanceStore();
```

En el pulse dot:
```tsx
{isConnected && animSpeed !== "off" && (
  
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/ConnectionHub.tsx
git commit -m "fix(connections): respect animSpeed=off for status pulse animation"
```

---

## Self-Review

### Spec coverage

| Requisito | Tarea cubierta |
|---|---|
| Ajustes de apariencia completamente funcionales en toda la app | Task 1.1–1.4 |
| Accent color se propaga a la UI entera | Task 1.1, 1.2, 1.3 |
| Card sizes y defaultView conectados a Shop/Inventory | Task 1.4 |
| Sidebar narrow mode funcional | Task 1.3, Step 3-4 |
| Fix bug `--anim: "0.0001s"` | Task 1.1 |
| Fusionar Compression + Storage | Task 2.1–2.3 |
| Mejorar diseño de Compression | Task 2.3 |
| Redesign completo de Connections | Task 3.1–3.3 |
| Device flow (GitHub) se muestra in-card, no modal separado | Task 3.1, Step 3 |
| Locked integrations con overlay descriptivo | Task 3.1, Step 2 |
| Respetar `animSpeed=off` en animaciones de Connection | Task 3.3 |

### Posibles gaps

1. **i18n**: se añaden keys nuevas (`settings_tab_storage_compression`). Verifica que todos los archivos de i18n (`en.ts`, `es.ts`, `de.ts`) tienen la key añadida antes de hacer el commit de la Task 2.
2. **Sidebar narrow**: puede requerir más trabajo dependiendo de cómo está implementado `Sidebar.tsx`. Si es muy complejo, puede dejarse como nice-to-have.
3. **purchaseCount en Booth**: el hook `useBoothStatus` puede o no exponer `purchaseCount`. Verificar en Task 3.1, Step 5.

### Type consistency

- `ConnectionCardConfig.connectingState`: `"idle" | "waiting" | "done"` — igual en `githubAuthStep`.
- `ConnectionStatus`: `"connected" | "disconnected" | "unknown" | "expired"` — mapea directamente a los valores de `RipperStatus` y a los retornos de `useBoothStatus`.
- `SubTab`: `"storage" | "compression"` — local a `StorageCompressionSection`.
- `SettingsTab`: se elimina `"storage"` y se añade `"storage-compression"` — actualizar en un solo lugar (el tipo y los `NAV_GROUPS`).
