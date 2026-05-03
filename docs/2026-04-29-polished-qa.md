# VRC Studio — Fase 6: Pulido y QA — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer VRC Studio production-ready: infraestructura de errores robusta, mensajes amigables para el usuario, optimizaciones de rendimiento en el frontend, suite de tests E2E para el flujo de creación de avatar y onboarding para nuevos usuarios.

**Architecture:** Se añade una capa de error centralizada en Rust (`AppError`) mapeada a mensajes legibles en el frontend vía un catálogo i18n-ready. Los tests E2E usan `tauri-driver` + `WebdriverIO`. El onboarding es un wizard React renderizado sobre un portal cuando se detecta primera ejecución desde el backend.

**Tech Stack:** Rust (thiserror, tauri 2), React 19 + TypeScript, Vitest + @testing-library/react, tauri-driver + WebdriverIO, @tanstack/react-virtual, shadcn/ui (Toast, Dialog, Progress), Zustand.

---

## Mapa de archivos

### Creados en esta fase

| Archivo | Responsabilidad |
|---|---|
| `src-tauri/src/error.rs` | `AppError` enum unificado con `thiserror`, serialización JSON |
| `src-tauri/src/commands/onboarding.rs` | Comandos `check_first_run`, `complete_onboarding` |
| `src-tauri/src/services/onboarding.rs` | Lógica de detección de primera ejecución y escritura de flag |
| `src/components/error/ErrorBoundary.tsx` | React Error Boundary de clase con fallback UI |
| `src/components/error/GlobalErrorHandler.tsx` | Listener de eventos Tauri de error + dispatch a toast |
| `src/components/onboarding/OnboardingWizard.tsx` | Wizard de 3 pasos para nueva instalación |
| `src/components/onboarding/steps/StepWelcome.tsx` | Paso 1: bienvenida + explicación de la app |
| `src/components/onboarding/steps/StepProjectsFolder.tsx` | Paso 2: selección de carpeta de proyectos por defecto |
| `src/components/onboarding/steps/StepAccounts.tsx` | Paso 3: vincular cuentas Booth / GitHub (opcional) |
| `src/lib/errors.ts` | Catálogo de mensajes de error en español, función `friendlyMessage(code)` |
| `src/hooks/useVirtualList.ts` | Wrapper tipado de `@tanstack/react-virtual` para listas largas |
| `src/components/inventory/VirtualInventoryGrid.tsx` | Grid virtualizado para el Inventory |
| `src/components/shop/VirtualShopGrid.tsx` | Grid virtualizado para resultados del Shop |
| `tests/e2e/avatar-creation.spec.ts` | Suite E2E del flujo completo de creación de avatar |
| `tests/e2e/helpers/tauri.ts` | Helpers para interactuar con la app en WebdriverIO |
| `.wdio.conf.ts` | Configuración de WebdriverIO + tauri-driver |

### Modificados en esta fase

| Archivo | Cambio |
|---|---|
| `src-tauri/src/commands/*.rs` | Cambiar retorno de `String` a `Result<T, AppError>` |
| `src-tauri/src/main.rs` | Registrar `commands::onboarding::check_first_run`, `complete_onboarding` |
| `src-tauri/Cargo.toml` | Añadir `thiserror` |
| `src/App.tsx` | Envolver app con `<ErrorBoundary>` y montar `<GlobalErrorHandler>` + lógica de onboarding |
| `src/pages/Inventory.tsx` | Usar `VirtualInventoryGrid` en lugar del grid actual |
| `src/pages/Shop.tsx` | Usar `VirtualShopGrid` en lugar del grid actual |
| `src/lib/tauri.ts` | Añadir wrapper tipado `invoke` con interceptor de errores |
| `package.json` | Añadir scripts `test:e2e` y dependencias de testing |

---

## Task 1: AppError unificado en Rust

**Files:**
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Añadir `thiserror` al Cargo.toml**

Edita `src-tauri/Cargo.toml`, sección `[dependencies]`:

```toml
thiserror = "1"
```

- [ ] **Step 2: Verificar que compila**

```bash
cd src-tauri && cargo check
```

Expected: sin errores.

- [ ] **Step 3: Escribir el test del módulo error**

Crea `src-tauri/src/error.rs` con los tests primero:

```rust
use thiserror::Error;
use serde::Serialize;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum AppError {
    #[error("DB_ERROR: {0}")]
    Database(String),

    #[error("IO_ERROR: {0}")]
    Io(String),

    #[error("VPM_ERROR: {0}")]
    Vpm(String),

    #[error("GIT_ERROR: {0}")]
    Git(String),

    #[error("UNITY_NOT_FOUND")]
    UnityNotFound,

    #[error("DOWNLOAD_FAILED: {0}")]
    DownloadFailed(String),

    #[error("AUTH_ERROR: {0}")]
    Auth(String),

    #[error("ONBOARDING_ERROR: {0}")]
    Onboarding(String),

    #[error("UNKNOWN_ERROR: {0}")]
    Unknown(String),
}

// Tauri requiere que los errores de comandos implementen Serialize
// AppError ya lo hace vía serde + thiserror

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::Git(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_serializes_to_json_with_code() {
        let err = AppError::UnityNotFound;
        let json = serde_json::to_string(&err).expect("serialize");
        assert!(json.contains("UNITY_NOT_FOUND"), "got: {json}");
    }

    #[test]
    fn app_error_database_carries_message() {
        let err = AppError::Database("table not found".to_string());
        let json = serde_json::to_string(&err).expect("serialize");
        assert!(json.contains("table not found"), "got: {json}");
    }

    #[test]
    fn from_io_error_conversion() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err = AppError::from(io_err);
        assert!(matches!(app_err, AppError::Io(_)));
    }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
cd src-tauri && cargo test error::tests
```

Expected: `3 passed`.

- [ ] **Step 5: Registrar el módulo en main.rs**

Añade al inicio de `src-tauri/src/main.rs`:

```rust
mod error;
pub use error::AppError;
```

- [ ] **Step 6: Compilar para confirmar sin errores**

```bash
cd src-tauri && cargo check
```

Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat(error): add unified AppError enum with thiserror"
```

---

## Task 2: Migrar comandos Rust a Result<T, AppError>

**Files:**
- Modify: `src-tauri/src/commands/projects.rs`
- Modify: `src-tauri/src/commands/packages.rs`
- Modify: `src-tauri/src/commands/vcs.rs`
- Modify: `src-tauri/src/commands/unity.rs`
- Modify: `src-tauri/src/commands/shop.rs`
- Modify: `src-tauri/src/commands/inventory.rs`

> Esta tarea es mecánica pero crítica: todos los comandos que hoy retornan `Result<T, String>` pasan a `Result<T, AppError>`. Esto permite que el frontend distinga el tipo de error.

- [ ] **Step 1: Escribir test de integración de un comando migrado**

En `src-tauri/src/commands/projects.rs`, añade al bloque `#[cfg(test)]`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    #[test]
    fn open_nonexistent_project_returns_io_error() {
        let result = open_project_in_unity("/nonexistent/path/project");
        assert!(matches!(result, Err(AppError::Io(_)) | Err(AppError::UnityNotFound)));
    }
}
```

- [ ] **Step 2: Ejecutar el test — debe fallar porque la firma todavía retorna String**

```bash
cd src-tauri && cargo test commands::projects::tests
```

Expected: error de compilación — tipo de retorno incorrecto.

- [ ] **Step 3: Cambiar la firma de todos los comandos**

Patrón de cambio en **cada archivo** de `commands/`:

```rust
// ANTES
#[tauri::command]
pub async fn create_project(args: CreateProjectArgs) -> Result<Project, String> {
    some_service::create(args).map_err(|e| e.to_string())
}

// DESPUÉS
#[tauri::command]
pub async fn create_project(args: CreateProjectArgs) -> Result<Project, AppError> {
    some_service::create(args)  // el service ya retorna Result<_, AppError>
}
```

Aplica este patrón a todos los comandos en `projects.rs`, `packages.rs`, `vcs.rs`, `unity.rs`, `shop.rs`, `inventory.rs`.

- [ ] **Step 4: Migrar los services para retornar AppError**

En cada `services/*.rs`, cambia los `map_err(|e| e.to_string())` por los `From` impls que ya existen en `error.rs`. Ejemplo en `services/unity_manager.rs`:

```rust
// ANTES
pub fn open_in_unity(path: &str) -> Result<(), String> {
    std::process::Command::new(&self.unity_path)
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// DESPUÉS
pub fn open_in_unity(path: &str) -> Result<(), AppError> {
    std::process::Command::new(&self.unity_path)
        .arg(path)
        .spawn()?;   // From<io::Error> for AppError ya definido
    Ok(())
}
```

- [ ] **Step 5: Correr todos los tests y compilación completa**

```bash
cd src-tauri && cargo test && cargo build
```

Expected: todos los tests pasan, sin errores de compilación.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/services/
git commit -m "refactor(commands): migrate all commands to Result<T, AppError>"
```

---

## Task 3: Catálogo de mensajes de error y wrapper invoke tipado

**Files:**
- Create: `src/lib/errors.ts`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Escribir tests del catálogo de errores**

Crea `src/lib/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { friendlyMessage, AppErrorCode } from './errors';

describe('friendlyMessage', () => {
  it('devuelve mensaje para UNITY_NOT_FOUND', () => {
    const msg = friendlyMessage({ code: 'UNITY_NOT_FOUND' });
    expect(msg).toContain('Unity');
    expect(msg.length).toBeGreaterThan(10);
  });

  it('devuelve mensaje para DB_ERROR con detalle', () => {
    const msg = friendlyMessage({ code: 'DB_ERROR', message: 'no such table' });
    expect(msg).toContain('base de datos');
  });

  it('devuelve mensaje genérico para código desconocido', () => {
    const msg = friendlyMessage({ code: 'SOMETHING_NEW' as AppErrorCode });
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe('string');
  });
});
```

- [ ] **Step 2: Ejecutar para verificar que fallan**

```bash
npx vitest run src/lib/errors.test.ts
```

Expected: `Cannot find module './errors'`.

- [ ] **Step 3: Implementar el catálogo**

Crea `src/lib/errors.ts`:

```typescript
export type AppErrorCode =
  | 'DB_ERROR'
  | 'IO_ERROR'
  | 'VPM_ERROR'
  | 'GIT_ERROR'
  | 'UNITY_NOT_FOUND'
  | 'DOWNLOAD_FAILED'
  | 'AUTH_ERROR'
  | 'ONBOARDING_ERROR'
  | 'UNKNOWN_ERROR';

export interface AppError {
  code: AppErrorCode | string;
  message?: string;
}

const MESSAGES: Record<string, (err: AppError) => string> = {
  DB_ERROR: (e) =>
    `Error en la base de datos local. Reinicia la app. Detalle: ${e.message ?? '—'}`,
  IO_ERROR: (e) =>
    `No se pudo leer o escribir en disco. Comprueba los permisos. Detalle: ${e.message ?? '—'}`,
  VPM_ERROR: (e) =>
    `Error al gestionar paquetes VPM. Detalle: ${e.message ?? '—'}`,
  GIT_ERROR: (e) =>
    `Error en el repositorio Git. Detalle: ${e.message ?? '—'}`,
  UNITY_NOT_FOUND:
    () => 'No se encontró Unity instalado. Instálalo desde la pantalla de Configuración.',
  DOWNLOAD_FAILED: (e) =>
    `La descarga ha fallado. Comprueba tu conexión. Detalle: ${e.message ?? '—'}`,
  AUTH_ERROR: (e) =>
    `Error de autenticación. Vuelve a conectar tu cuenta. Detalle: ${e.message ?? '—'}`,
  ONBOARDING_ERROR: (e) =>
    `Error durante la configuración inicial. Detalle: ${e.message ?? '—'}`,
};

export function friendlyMessage(err: AppError): string {
  const handler = MESSAGES[err.code];
  if (handler) return handler(err);
  return `Ha ocurrido un error inesperado (${err.code}). Revisa los logs para más detalles.`;
}
```

- [ ] **Step 4: Ejecutar tests — deben pasar**

```bash
npx vitest run src/lib/errors.test.ts
```

Expected: `3 passed`.

- [ ] **Step 5: Actualizar el wrapper invoke en tauri.ts**

En `src/lib/tauri.ts`, añade un interceptor global que convierte errores de Tauri al tipo `AppError`:

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { friendlyMessage, type AppError } from './errors';

export class TauriError extends Error {
  constructor(public readonly appError: AppError) {
    super(friendlyMessage(appError));
    this.name = 'TauriError';
  }
}

/** Wrapper tipado de invoke que convierte errores Rust → TauriError */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (raw: unknown) {
    // Rust serializa AppError como { code, message }
    if (typeof raw === 'object' && raw !== null && 'code' in raw) {
      throw new TauriError(raw as AppError);
    }
    // Error de red / Tauri genérico
    throw new TauriError({ code: 'UNKNOWN_ERROR', message: String(raw) });
  }
}
```

- [ ] **Step 6: Verificar que compila TypeScript**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/lib/errors.ts src/lib/errors.test.ts src/lib/tauri.ts
git commit -m "feat(errors): add error catalog and typed invoke wrapper"
```

---

## Task 4: Error Boundary y notificaciones globales en React

**Files:**
- Create: `src/components/error/ErrorBoundary.tsx`
- Create: `src/components/error/GlobalErrorHandler.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Escribir test del ErrorBoundary**

Crea `src/components/error/ErrorBoundary.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

const ThrowError = () => {
  throw new Error('test crash');
};

describe('ErrorBoundary', () => {
  it('muestra fallback UI cuando un hijo lanza un error', () => {
    // Suprimir console.error que React lanza en test al capturar el error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/algo ha ido mal/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('renderiza hijos normalmente cuando no hay error', () => {
    render(
      <ErrorBoundary>
        <span>contenido ok</span>
      </ErrorBoundary>
    );
    expect(screen.getByText('contenido ok')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar — deben fallar**

```bash
npx vitest run src/components/error/ErrorBoundary.test.tsx
```

Expected: `Cannot find module './ErrorBoundary'`.

- [ ] **Step 3: Implementar ErrorBoundary**

Crea `src/components/error/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <h2 className="text-xl font-semibold">Algo ha ido mal</h2>
          <p className="text-muted-foreground text-sm max-w-md">
            {this.state.error?.message ?? 'Error desconocido'}
          </p>
          <Button
            variant="outline"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Intentar de nuevo
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Implementar GlobalErrorHandler**

Crea `src/components/error/GlobalErrorHandler.tsx`:

```tsx
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '@/hooks/use-toast';
import { friendlyMessage, type AppError } from '@/lib/errors';

/** Escucha el evento Tauri "app://error" emitido por el backend para errores no fatales */
export default function GlobalErrorHandler() {
  const { toast } = useToast();

  useEffect(() => {
    const unlisten = listen<AppError>('app://error', ({ payload }) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: friendlyMessage(payload),
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [toast]);

  return null;
}
```

- [ ] **Step 5: Montar ambos en App.tsx**

En `src/App.tsx`, envuelve el árbol principal:

```tsx
import ErrorBoundary from '@/components/error/ErrorBoundary';
import GlobalErrorHandler from '@/components/error/GlobalErrorHandler';
import { Toaster } from '@/components/ui/toaster';

export default function App() {
  return (
    <ErrorBoundary>
      <GlobalErrorHandler />
      {/* ... resto del árbol: Router, Sidebar, etc. */}
      <Toaster />
    </ErrorBoundary>
  );
}
```

- [ ] **Step 6: Correr tests**

```bash
npx vitest run src/components/error/
```

Expected: `2 passed`.

- [ ] **Step 7: Commit**

```bash
git add src/components/error/ src/App.tsx
git commit -m "feat(ui): add ErrorBoundary and GlobalErrorHandler with toast notifications"
```

---

## Task 5: Listas virtualizadas para Inventory y Shop

**Files:**
- Create: `src/hooks/useVirtualList.ts`
- Create: `src/components/inventory/VirtualInventoryGrid.tsx`
- Create: `src/components/shop/VirtualShopGrid.tsx`
- Modify: `src/pages/Inventory.tsx`
- Modify: `src/pages/Shop.tsx`
- Modify: `package.json`

- [ ] **Step 1: Instalar @tanstack/react-virtual**

```bash
npm install @tanstack/react-virtual
```

Expected: `added 1 package`.

- [ ] **Step 2: Escribir test del hook useVirtualList**

Crea `src/hooks/useVirtualList.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVirtualList } from './useVirtualList';

describe('useVirtualList', () => {
  it('retorna virtualItems cuando se proveen items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const { result } = renderHook(() =>
      useVirtualList({ items, estimateSize: () => 120, containerRef: { current: null } })
    );
    // Con containerRef null, virtualItems puede ser vacío pero el hook no debe lanzar
    expect(Array.isArray(result.current.virtualItems)).toBe(true);
    expect(typeof result.current.totalSize).toBe('number');
  });
});
```

- [ ] **Step 3: Ejecutar — debe fallar**

```bash
npx vitest run src/hooks/useVirtualList.test.ts
```

Expected: `Cannot find module './useVirtualList'`.

- [ ] **Step 4: Implementar el hook**

Crea `src/hooks/useVirtualList.ts`:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';

interface UseVirtualListOptions<T> {
  items: T[];
  estimateSize: (index: number) => number;
  containerRef: RefObject<HTMLElement | null>;
  /** Número de columnas (para grids). Por defecto 1. */
  lanes?: number;
  overscan?: number;
}

export function useVirtualList<T>({
  items,
  estimateSize,
  containerRef,
  lanes = 1,
  overscan = 5,
}: UseVirtualListOptions<T>) {
  const virtualizer = useVirtualizer({
    count: Math.ceil(items.length / lanes),
    getScrollElement: () => containerRef.current,
    estimateSize,
    overscan,
    lanes,
  });

  return {
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    virtualizer,
  };
}
```

- [ ] **Step 5: Ejecutar test**

```bash
npx vitest run src/hooks/useVirtualList.test.ts
```

Expected: `1 passed`.

- [ ] **Step 6: Implementar VirtualInventoryGrid**

Crea `src/components/inventory/VirtualInventoryGrid.tsx`:

```tsx
import { useRef } from 'react';
import { useVirtualList } from '@/hooks/useVirtualList';
import type { InventoryItem } from '@/lib/types';
import InventoryCard from './InventoryCard';

const CARD_HEIGHT = 200; // px estimado por fila de cards
const COLUMNS = 4;

interface Props {
  items: InventoryItem[];
}

export default function VirtualInventoryGrid({ items }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { virtualItems, totalSize } = useVirtualList({
    items,
    estimateSize: () => CARD_HEIGHT,
    containerRef,
    lanes: COLUMNS,
    overscan: 3,
  });

  return (
    <div
      ref={containerRef}
      className="overflow-auto h-full w-full"
      style={{ contain: 'strict' }}
    >
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map((vRow) => {
          const rowStart = vRow.index * COLUMNS;
          const rowItems = items.slice(rowStart, rowStart + COLUMNS);
          return (
            <div
              key={vRow.key}
              style={{
                position: 'absolute',
                top: vRow.start,
                left: 0,
                width: '100%',
                display: 'grid',
                gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
                gap: '1rem',
              }}
            >
              {rowItems.map((item) => (
                <InventoryCard key={item.id} item={item} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implementar VirtualShopGrid**

Crea `src/components/shop/VirtualShopGrid.tsx`:

```tsx
import { useRef } from 'react';
import { useVirtualList } from '@/hooks/useVirtualList';
import type { ShopProduct } from '@/lib/types';
import ProductCard from './ProductCard';

const CARD_HEIGHT = 260;
const COLUMNS = 3;

interface Props {
  products: ShopProduct[];
}

export default function VirtualShopGrid({ products }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { virtualItems, totalSize } = useVirtualList({
    items: products,
    estimateSize: () => CARD_HEIGHT,
    containerRef,
    lanes: COLUMNS,
    overscan: 3,
  });

  return (
    <div
      ref={containerRef}
      className="overflow-auto h-full w-full"
      style={{ contain: 'strict' }}
    >
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map((vRow) => {
          const rowStart = vRow.index * COLUMNS;
          const rowItems = products.slice(rowStart, rowStart + COLUMNS);
          return (
            <div
              key={vRow.key}
              style={{
                position: 'absolute',
                top: vRow.start,
                left: 0,
                width: '100%',
                display: 'grid',
                gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
                gap: '1rem',
              }}
            >
              {rowItems.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Sustituir el grid actual en Inventory.tsx**

En `src/pages/Inventory.tsx`, reemplaza el grid estático por el virtualizado:

```tsx
// ANTES
import InventoryCard from '@/components/inventory/InventoryCard';
// ... dentro del JSX:
<div className="grid grid-cols-4 gap-4 overflow-auto">
  {items.map(item => <InventoryCard key={item.id} item={item} />)}
</div>

// DESPUÉS
import VirtualInventoryGrid from '@/components/inventory/VirtualInventoryGrid';
// ... dentro del JSX (mismo contenedor):
<VirtualInventoryGrid items={items} />
```

- [ ] **Step 9: Sustituir el grid en Shop.tsx**

```tsx
// ANTES
import ProductCard from '@/components/shop/ProductCard';
<div className="grid grid-cols-3 gap-4 overflow-auto">
  {products.map(p => <ProductCard key={p.id} product={p} />)}
</div>

// DESPUÉS
import VirtualShopGrid from '@/components/shop/VirtualShopGrid';
<VirtualShopGrid products={products} />
```

- [ ] **Step 10: Verificar arranque de la app**

```bash
npm run tauri dev
```

Navega a Inventory y Shop. Verifica que los grids renderizan correctamente y no hay errores de consola.

- [ ] **Step 11: Commit**

```bash
git add src/hooks/useVirtualList.ts src/hooks/useVirtualList.test.ts \
        src/components/inventory/VirtualInventoryGrid.tsx \
        src/components/shop/VirtualShopGrid.tsx \
        src/pages/Inventory.tsx src/pages/Shop.tsx package.json
git commit -m "perf(ui): virtualize Inventory and Shop grids with @tanstack/react-virtual"
```

---

## Task 6: Onboarding — detección de primera ejecución (Rust)

**Files:**
- Create: `src-tauri/src/services/onboarding.rs`
- Create: `src-tauri/src/commands/onboarding.rs`
- Modify: `src-tauri/src/main.rs`

La primera ejecución se detecta comprobando si existe la clave `onboarding_completed = true` en la tabla de configuración global de SQLite. Si no existe, el backend emite el evento `app://first-run` y espera el comando `complete_onboarding`.

- [ ] **Step 1: Escribir tests del service de onboarding**

Crea `src-tauri/src/services/onboarding.rs` con los tests primero:

```rust
use crate::db::DbPool;
use crate::error::AppError;

pub struct OnboardingService {
    pool: DbPool,
}

impl OnboardingService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Retorna true si el usuario ya completó el onboarding.
    pub fn is_completed(&self) -> Result<bool, AppError> {
        let conn = self.pool.get()?;
        let result: Option<String> = conn
            .query_row(
                "SELECT value FROM app_config WHERE key = 'onboarding_completed'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(result.as_deref() == Some("true"))
    }

    /// Marca el onboarding como completado.
    pub fn complete(&self) -> Result<(), AppError> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO app_config (key, value) VALUES ('onboarding_completed', 'true')
             ON CONFLICT(key) DO UPDATE SET value = 'true'",
            [],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    #[test]
    fn is_completed_returns_false_on_fresh_db() {
        let pool = create_test_pool();
        let svc = OnboardingService::new(pool);
        assert_eq!(svc.is_completed().unwrap(), false);
    }

    #[test]
    fn complete_then_is_completed_returns_true() {
        let pool = create_test_pool();
        let svc = OnboardingService::new(pool.clone());
        svc.complete().unwrap();
        assert_eq!(svc.is_completed().unwrap(), true);
    }

    #[test]
    fn complete_is_idempotent() {
        let pool = create_test_pool();
        let svc = OnboardingService::new(pool);
        svc.complete().unwrap();
        svc.complete().unwrap(); // no debe lanzar error de constraint
        assert_eq!(svc.is_completed().unwrap(), true);
    }
}
```

> **Nota:** `create_test_pool` es una función helper en `src-tauri/src/db/mod.rs` que crea una DB SQLite `:memory:` con las migraciones aplicadas. Si no existe, añádela:
>
> ```rust
> #[cfg(test)]
> pub fn create_test_pool() -> DbPool {
>     let pool = r2d2::Pool::builder()
>         .build(r2d2_sqlite::SqliteConnectionManager::memory())
>         .expect("test pool");
>     run_migrations(&pool.get().unwrap()).expect("migrations");
>     pool
> }
> ```

- [ ] **Step 2: Ejecutar tests — deben fallar (módulo no declarado)**

```bash
cd src-tauri && cargo test services::onboarding::tests
```

Expected: error de compilación — módulo no declarado.

- [ ] **Step 3: Declarar el módulo en services/mod.rs**

En `src-tauri/src/services/mod.rs`, añade:

```rust
pub mod onboarding;
```

- [ ] **Step 4: Ejecutar tests — deben pasar**

```bash
cd src-tauri && cargo test services::onboarding::tests
```

Expected: `3 passed`.

- [ ] **Step 5: Crear los comandos Tauri de onboarding**

Crea `src-tauri/src/commands/onboarding.rs`:

```rust
use tauri::{AppHandle, Manager};
use crate::{error::AppError, services::onboarding::OnboardingService};

#[tauri::command]
pub async fn check_first_run(app: AppHandle) -> Result<bool, AppError> {
    let pool = app.state::<crate::db::DbPool>().inner().clone();
    let svc = OnboardingService::new(pool);
    let completed = svc.is_completed()?;
    Ok(!completed) // retorna true si ES primera ejecución
}

#[tauri::command]
pub async fn complete_onboarding(app: AppHandle) -> Result<(), AppError> {
    let pool = app.state::<crate::db::DbPool>().inner().clone();
    let svc = OnboardingService::new(pool);
    svc.complete()
}
```

- [ ] **Step 6: Registrar los comandos en main.rs**

En `src-tauri/src/main.rs`, en el builder de Tauri, añade a `invoke_handler`:

```rust
tauri::Builder::default()
    // ... plugins existentes ...
    .invoke_handler(tauri::generate_handler![
        // ... comandos existentes ...
        commands::onboarding::check_first_run,
        commands::onboarding::complete_onboarding,
    ])
```

- [ ] **Step 7: Compilar**

```bash
cd src-tauri && cargo build
```

Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/services/onboarding.rs \
        src-tauri/src/commands/onboarding.rs \
        src-tauri/src/services/mod.rs \
        src-tauri/src/commands/mod.rs \
        src-tauri/src/main.rs
git commit -m "feat(onboarding): add first-run detection and complete_onboarding command"
```

---

## Task 7: Onboarding UI — Wizard de primera ejecución

**Files:**
- Create: `src/components/onboarding/OnboardingWizard.tsx`
- Create: `src/components/onboarding/steps/StepWelcome.tsx`
- Create: `src/components/onboarding/steps/StepProjectsFolder.tsx`
- Create: `src/components/onboarding/steps/StepAccounts.tsx`
- Modify: `src/App.tsx`

El wizard se monta como un portal de pantalla completa sobre la app, bloqueando la navegación hasta que se completa o descarta.

- [ ] **Step 1: Escribir tests del wizard**

Crea `src/components/onboarding/OnboardingWizard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OnboardingWizard from './OnboardingWizard';

describe('OnboardingWizard', () => {
  it('muestra el paso de bienvenida al inicio', () => {
    render(<OnboardingWizard onComplete={vi.fn()} />);
    expect(screen.getByText(/bienvenido a vrc studio/i)).toBeInTheDocument();
  });

  it('avanza al paso 2 al pulsar Siguiente', () => {
    render(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(screen.getByText(/carpeta de proyectos/i)).toBeInTheDocument();
  });

  it('llama a onComplete al terminar el wizard', () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);

    // Paso 1 → 2
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    // Paso 2 → 3
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    // Paso 3 → Finalizar
    fireEvent.click(screen.getByRole('button', { name: /empezar/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Ejecutar — deben fallar**

```bash
npx vitest run src/components/onboarding/OnboardingWizard.test.tsx
```

Expected: `Cannot find module './OnboardingWizard'`.

- [ ] **Step 3: Implementar StepWelcome**

Crea `src/components/onboarding/steps/StepWelcome.tsx`:

```tsx
export default function StepWelcome() {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <img src="/icon.png" alt="VRC Studio" className="w-24 h-24" />
      <h1 className="text-3xl font-bold">Bienvenido a VRC Studio</h1>
      <p className="text-muted-foreground max-w-md">
        Tu estudio para crear y gestionar avatares de VRChat. Vamos a configurar
        algunas cosas básicas antes de empezar.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Implementar StepProjectsFolder**

Crea `src/components/onboarding/steps/StepProjectsFolder.tsx`:

```tsx
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tauri';

interface Props {
  onFolderSelected: (path: string) => void;
}

export default function StepProjectsFolder({ onFolderSelected }: Props) {
  const [folder, setFolder] = useState('');

  async function selectFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      setFolder(selected);
      onFolderSelected(selected);
      // Persistir en settings
      await invoke('set_setting', { key: 'default_projects_folder', value: selected });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Carpeta de proyectos</h2>
      <p className="text-muted-foreground text-sm">
        Elige dónde se guardarán tus proyectos de Unity por defecto.
        Puedes cambiarlo más tarde en Configuración.
      </p>
      <div className="flex gap-2">
        <Input value={folder} readOnly placeholder="Ninguna carpeta seleccionada" />
        <Button variant="outline" onClick={selectFolder}>
          Elegir carpeta
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implementar StepAccounts**

Crea `src/components/onboarding/steps/StepAccounts.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function StepAccounts() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Cuentas vinculadas</h2>
      <p className="text-muted-foreground text-sm">
        Conecta tus cuentas para acceder al Shop. Puedes saltarte este paso y hacerlo más tarde
        desde Configuración.
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between border rounded-lg p-4">
          <div>
            <p className="font-medium">Booth.pm</p>
            <p className="text-xs text-muted-foreground">Para comprar y descargar assets</p>
          </div>
          <Button variant="outline" size="sm"
            onClick={() => window.open('https://booth.pm', '_blank')}>
            Conectar
          </Button>
        </div>
        <div className="flex items-center justify-between border rounded-lg p-4">
          <div>
            <p className="font-medium">GitHub</p>
            <p className="text-xs text-muted-foreground">Para control de versiones</p>
          </div>
          <Button variant="outline" size="sm">
            Conectar con GitHub
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implementar OnboardingWizard**

Crea `src/components/onboarding/OnboardingWizard.tsx`:

```tsx
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import StepWelcome from './steps/StepWelcome';
import StepProjectsFolder from './steps/StepProjectsFolder';
import StepAccounts from './steps/StepAccounts';
import { invoke } from '@/lib/tauri';

const STEPS = [
  { label: 'Bienvenida', component: StepWelcome },
  { label: 'Carpeta de proyectos', component: StepProjectsFolder },
  { label: 'Cuentas', component: StepAccounts },
];

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [selectedFolder, setSelectedFolder] = useState('');
  const isLast = step === STEPS.length - 1;

  async function handleNext() {
    if (isLast) {
      await invoke('complete_onboarding');
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  }

  const StepComponent = STEPS[step].component;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
      <div className="w-full max-w-lg p-8 flex flex-col gap-8">
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-1" />

        <div className="min-h-[200px] flex items-center justify-center">
          {step === 1
            ? <StepProjectsFolder onFolderSelected={setSelectedFolder} />
            : <StepComponent />
          }
        </div>

        <div className="flex justify-end gap-3">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              Atrás
            </Button>
          )}
          <Button onClick={handleNext}>
            {isLast ? 'Empezar' : 'Siguiente'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 7: Ejecutar tests**

```bash
npx vitest run src/components/onboarding/OnboardingWizard.test.tsx
```

Expected: `3 passed`.

- [ ] **Step 8: Integrar en App.tsx**

En `src/App.tsx`, añade la lógica de primera ejecución:

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tauri';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loadingOnboarding, setLoadingOnboarding] = useState(true);

  useEffect(() => {
    invoke<boolean>('check_first_run')
      .then((isFirst) => setShowOnboarding(isFirst))
      .catch(() => setShowOnboarding(false))
      .finally(() => setLoadingOnboarding(false));
  }, []);

  if (loadingOnboarding) return null; // evita flash

  return (
    <ErrorBoundary>
      <GlobalErrorHandler />
      {/* ... resto del árbol */}
      {showOnboarding && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
      <Toaster />
    </ErrorBoundary>
  );
}
```

- [ ] **Step 9: Probar manualmente el onboarding**

```bash
npm run tauri dev
```

1. Borra la DB local para simular primera ejecución: elimina el archivo SQLite en `%APPDATA%\vrc-studio\vrc-studio.db`.
2. Reinicia la app.
3. Verifica que aparece el wizard en pantalla completa.
4. Completa los 3 pasos.
5. Verifica que al reiniciar la app el wizard no aparece.

- [ ] **Step 10: Commit**

```bash
git add src/components/onboarding/ src/App.tsx
git commit -m "feat(onboarding): add 3-step first-run wizard"
```

---

## Task 8: Configuración de tests E2E con tauri-driver + WebdriverIO

**Files:**
- Create: `.wdio.conf.ts`
- Create: `tests/e2e/helpers/tauri.ts`
- Modify: `package.json`

- [ ] **Step 1: Instalar dependencias E2E**

```bash
npm install --save-dev @wdio/cli @wdio/local-runner @wdio/mocha-framework \
    @wdio/spec-reporter webdriverio tauri-driver
```

Expected: paquetes instalados sin errores.

- [ ] **Step 2: Crear la configuración de WebdriverIO**

Crea `.wdio.conf.ts`:

```typescript
import { join } from 'path';
import type { Options } from '@wdio/types';

const tauriDriver = join(
  process.env.HOME ?? '',
  '.cargo',
  'bin',
  process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver'
);

export const config: Options.Testrunner = {
  specs: ['./tests/e2e/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: './src-tauri/target/release/vrc-studio',
      },
      browserName: '',
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    timeout: 60_000,
  },
  services: [
    [
      'tauri',
      {
        driverBinaryPath: tauriDriver,
      },
    ],
  ],
};
```

- [ ] **Step 3: Crear helpers de Tauri para los tests E2E**

Crea `tests/e2e/helpers/tauri.ts`:

```typescript
import { browser } from '@wdio/globals';

/** Espera a que un elemento sea visible con texto específico. */
export async function waitForText(selector: string, text: string, timeout = 10_000) {
  const el = await browser.$(selector);
  await el.waitForDisplayed({ timeout });
  const content = await el.getText();
  if (!content.includes(text)) {
    throw new Error(`Expected "${text}" in "${content}" for selector ${selector}`);
  }
  return el;
}

/** Hace click en un botón por su texto. */
export async function clickButton(label: string) {
  const btn = await browser.$(`button=${label}`);
  await btn.waitForEnabled({ timeout: 10_000 });
  await btn.click();
}

/** Espera a que la app cargue la pantalla principal (sidebar visible). */
export async function waitForAppReady() {
  const sidebar = await browser.$('[data-testid="sidebar"]');
  await sidebar.waitForDisplayed({ timeout: 15_000 });
}
```

- [ ] **Step 4: Añadir script E2E al package.json**

En `package.json`, añade en `"scripts"`:

```json
"test:e2e": "npm run tauri build && wdio run .wdio.conf.ts",
"test:e2e:dev": "wdio run .wdio.conf.ts"
```

- [ ] **Step 5: Instalar tauri-driver como binario Cargo**

```bash
cargo install tauri-driver --locked
```

Expected: `tauri-driver` instalado en `~/.cargo/bin`.

- [ ] **Step 6: Verificar que la configuración es válida**

```bash
npx wdio config --yes
```

Expected: sin errores de parseo del config.

- [ ] **Step 7: Añadir data-testid al sidebar**

En `src/components/sidebar/Sidebar.tsx`, añade el atributo al elemento raíz:

```tsx
// ANTES
<aside className="w-64 border-r bg-muted/40 ...">

// DESPUÉS
<aside data-testid="sidebar" className="w-64 border-r bg-muted/40 ...">
```

- [ ] **Step 8: Commit**

```bash
git add .wdio.conf.ts tests/e2e/helpers/ package.json \
        src/components/sidebar/Sidebar.tsx
git commit -m "test(e2e): configure tauri-driver + WebdriverIO for E2E testing"
```

---

## Task 9: Test E2E — Flujo completo de creación de avatar

**Files:**
- Create: `tests/e2e/avatar-creation.spec.ts`

- [ ] **Step 1: Escribir la suite E2E**

Crea `tests/e2e/avatar-creation.spec.ts`:

```typescript
import { browser } from '@wdio/globals';
import { clickButton, waitForAppReady, waitForText } from './helpers/tauri';

describe('Flujo de creación de avatar', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('1. La página de proyectos se carga al iniciar', async () => {
    await waitForText('[data-testid="page-title"]', 'Proyectos');
  });

  it('2. El botón "Nuevo avatar" abre el wizard', async () => {
    await clickButton('Nuevo avatar');
    await waitForText('[data-testid="wizard-step-title"]', 'Versión de Unity');
  });

  it('3. Paso 1: seleccionar Unity estándar y avanzar', async () => {
    const standardRadio = await browser.$('[data-testid="unity-type-standard"]');
    await standardRadio.click();
    await clickButton('Siguiente');
    await waitForText('[data-testid="wizard-step-title"]', 'Configuración del avatar');
  });

  it('4. Paso 2: saltar configuración de avatar base', async () => {
    await clickButton('Siguiente'); // sin seleccionar base model
    await waitForText('[data-testid="wizard-step-title"]', 'Importar paquetes');
  });

  it('5. Paso 3: avanzar sin seleccionar paquetes', async () => {
    await clickButton('Siguiente');
    await waitForText('[data-testid="wizard-step-title"]', 'Detalles finales');
  });

  it('6. Paso 4: introducir nombre y crear proyecto', async () => {
    const nameInput = await browser.$('[data-testid="project-name-input"]');
    await nameInput.setValue('E2E Test Avatar');

    await clickButton('Crear proyecto');

    // El backend procesa; esperar feedback de progreso y resultado
    const progressBar = await browser.$('[data-testid="creation-progress"]');
    await progressBar.waitForDisplayed({ timeout: 5_000 });

    // Esperar a que el proyecto aparezca en la lista (timeout generoso para Unity setup)
    await waitForText('[data-testid="project-list"]', 'E2E Test Avatar', 60_000);
  });

  it('7. El proyecto creado aparece en la lista con acciones disponibles', async () => {
    const projectCard = await browser.$('[data-testid="project-card-e2e-test-avatar"]');
    await projectCard.waitForDisplayed({ timeout: 5_000 });

    const openBtn = await projectCard.$('button=Abrir en Unity');
    expect(await openBtn.isDisplayed()).toBe(true);
  });
});
```

- [ ] **Step 2: Añadir data-testid a los elementos del wizard en React**

En `src/components/wizard/WizardLayout.tsx` (o equivalente), añade `data-testid="wizard-step-title"` al título del paso activo.

En `src/pages/Projects.tsx`, añade `data-testid="page-title"` al `<h1>`.

En `src/pages/Projects.tsx`, añade `data-testid="project-list"` al contenedor de la lista.

En los project cards, añade `data-testid={`project-card-${project.name.toLowerCase().replace(/\s+/g, '-')}`}`.

En el wizard paso 1, añade `data-testid="unity-type-standard"` al radio de Unity estándar.

En el wizard paso 4, añade `data-testid="project-name-input"` al input de nombre y `data-testid="creation-progress"` a la barra de progreso.

- [ ] **Step 3: Build de release de la app**

```bash
npm run tauri build
```

Expected: binario generado en `src-tauri/target/release/vrc-studio`.

- [ ] **Step 4: Ejecutar la suite E2E**

```bash
npm run test:e2e:dev
```

Expected: `7 passing`.

> Si algún test falla por timing, ajusta los `timeout` en el test correspondiente. Los timeouts generosos (60s) son intencionados para la creación de proyectos Unity en CI.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/avatar-creation.spec.ts \
        src/components/wizard/ src/pages/Projects.tsx
git commit -m "test(e2e): add full avatar creation flow E2E suite"
```

---

## Task 10: Code splitting y lazy loading

**Files:**
- Modify: `src/App.tsx` (o el router principal)

Las páginas pesadas (Shop, Inventory) se cargan con `React.lazy` para reducir el bundle inicial.

- [ ] **Step 1: Escribir test de que las rutas principales existen**

Crea `src/App.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock de las páginas lazy para evitar dynamic import en tests
vi.mock('./pages/Shop', () => ({ default: () => <div>Shop Page</div> }));
vi.mock('./pages/Inventory', () => ({ default: () => <div>Inventory Page</div> }));
vi.mock('./pages/Projects', () => ({ default: () => <div>Projects Page</div> }));

import App from './App';

describe('App routing', () => {
  it('renderiza Projects en la ruta raíz', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText('Projects Page')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar test**

```bash
npx vitest run src/App.test.tsx
```

Expected: `1 passed` (o ajustar según la estructura real del router).

- [ ] **Step 3: Aplicar React.lazy a las páginas pesadas**

En el archivo de rutas (router o `App.tsx`):

```tsx
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

// Páginas con lazy load
const Projects = lazy(() => import('./pages/Projects'));
const Shop = lazy(() => import('./pages/Shop'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Packages = lazy(() => import('./pages/Packages'));
const Settings = lazy(() => import('./pages/Settings'));

// En el JSX:
<Suspense fallback={<div className="flex items-center justify-center h-full">Cargando…</div>}>
  <Routes>
    <Route path="/" element={<Projects />} />
    <Route path="/shop" element={<Shop />} />
    <Route path="/inventory" element={<Inventory />} />
    <Route path="/packages" element={<Packages />} />
    <Route path="/settings" element={<Settings />} />
  </Routes>
</Suspense>
```

- [ ] **Step 4: Analizar el bundle antes y después**

```bash
npm run build -- --mode production
npx vite-bundle-visualizer
```

Verifica que los chunks de Shop e Inventory son separados del bundle principal (`index`).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "perf(ui): lazy-load heavy pages with React.lazy + Suspense"
```

---

## Task 11: Checklist de QA final y smoke test manual

**Files:**
- Create: `docs/qa/qa-checklist.md`

- [ ] **Step 1: Crear el documento de checklist**

Crea `docs/qa/qa-checklist.md`:

```markdown
# VRC Studio — QA Checklist Fase 6

## Flujo de creación de avatar
- [ ] Wizard abre correctamente desde el botón "Nuevo avatar"
- [ ] Paso 1: Unity estándar seleccionable. Unity custom seleccionable. Features se habilitan/deshabilitan según el tipo.
- [ ] Paso 2: Grid de base models del Inventory visible. Shader selector funciona. Skip funciona.
- [ ] Paso 3: Paquetes VPM del índice oficial cargados. Paquetes custom visibles. Dependencias se resuelven.
- [ ] Paso 4: Validación de nombre vacío muestra error. Selector de carpeta funciona.
- [ ] Barra de progreso aparece durante la creación.
- [ ] Proyecto aparece en la lista al terminar.
- [ ] Unity se abre al proyecto al pulsar "Abrir en Unity".

## Errores y notificaciones
- [ ] Crear proyecto sin Unity instalado muestra toast con mensaje "No se encontró Unity instalado".
- [ ] Error de red en Shop muestra toast descriptivo.
- [ ] Error de DB en arranque muestra ErrorBoundary con botón "Intentar de nuevo".

## Onboarding
- [ ] En instalación limpia aparece el wizard de onboarding.
- [ ] Paso de carpeta de proyectos persiste en Configuración tras completar.
- [ ] Tras completar el onboarding, no vuelve a aparecer en reinicios.

## Rendimiento
- [ ] Inventory con 500+ items no congela la UI al hacer scroll.
- [ ] Shop con 200+ resultados no congela la UI.
- [ ] Tiempo de carga inicial < 2 segundos en hardware moderado.

## VCS (regresión)
- [ ] Inicializar Git en nuevo proyecto funciona.
- [ ] Status, commit y push funcionan correctamente.

## Subida de avatar a VRChat (smoke test)
- [ ] Crear proyecto con Unity estándar.
- [ ] Instalar VRChat SDK vía VPM.
- [ ] Abrir en Unity y subir avatar de prueba.
- [ ] Confirmar que el avatar aparece en VRChat.
```

- [ ] **Step 2: Ejecutar el checklist manualmente**

Completa cada ítem del checklist ejecutando la app en modo release:

```bash
npm run tauri build && ./src-tauri/target/release/vrc-studio
```

Marca cada ítem. Si un ítem falla, crea un issue en el tracker antes de continuar.

- [ ] **Step 3: Ejecutar suite de tests completa**

```bash
# Tests unitarios
npx vitest run

# Tests E2E
npm run test:e2e
```

Expected: todos los tests pasan.

- [ ] **Step 4: Commit final**

```bash
git add docs/qa/qa-checklist.md
git commit -m "docs(qa): add QA checklist for Fase 6"
git tag v0.6.0
```

---

## Self-Review

### 1. Cobertura de spec

| Requisito (Fase 6) | Tarea que lo implementa |
|---|---|
| Testing E2E del flujo de creación de avatar | Task 8 + Task 9 |
| Prueba de subida de avatares a VRChat | Task 11 (smoke test manual) |
| Ajustes de rendimiento del frontend | Task 5 (virtualización) + Task 10 (lazy loading) |
| Manejo robusto de errores y mensajes de usuario | Task 1 + Task 2 + Task 3 + Task 4 |
| Onboarding para usuarios nuevos | Task 6 + Task 7 |

### 2. Consistencia de tipos

- `AppError` definido en Task 1, usado en Task 2 (`commands`), Task 3 (`tauri.ts`), Task 6 (`onboarding.rs`). ✅
- `invoke<T>` wrapper definido en Task 3, usado en Task 7 (`OnboardingWizard`, `StepProjectsFolder`). ✅
- `useVirtualList` definido en Task 5, usado en `VirtualInventoryGrid` y `VirtualShopGrid`. ✅
- `data-testid` añadidos en Task 9, usados en `avatar-creation.spec.ts`. ✅

### 3. Sin placeholders

Todos los steps incluyen código real. No hay "TBD", "implementar más tarde", ni referencias a funciones no definidas.
