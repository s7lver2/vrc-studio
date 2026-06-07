# Tools Packaging + avatar-perf-core Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `vrcstudio-tools` so every tool has a `src/` (TSX frontend) and `backend/` (Rust sidecar) directory, update the build pipeline to compile Vite bundles, and rewrite `avatar-perf-core` to use SDK calls instead of relying on the embedded runner in the main app.

**Architecture:** `build.py` detects a `frontend.entry` field in `tool.json` and runs `npm install && npm run build` in `src/` before packaging. The Vite config produces a self-contained IIFE bundle (`dist/ui.js`) with React inlined. The `avatar-perf-core` TSX frontend calls `window.vrcstudio.selectProject/Scene/Avatar()` and `window.vrcstudio.runSidecar()` — no direct Tauri access. The `backend/` Rust code is unchanged.

**Tech Stack:** Python 3 (build.py), Vite + React + TypeScript (tool frontend), Rust + Cargo (backend)

**Prerequisite:** Plan 1 (`2026-06-07-tools-sdk-v2-pickers.md`) must be merged first — this plan depends on `runSidecar` and the SDK pickers being available in the app.

---

## File Map

**In `vrcstudio-tools` repo:**

| Action | File | Responsibility |
|---|---|---|
| Move | `avatar-perf-core/src/` → `avatar-perf-core/backend/src/` | Rust sidecar source |
| Move | `avatar-perf-core/Cargo.toml` → `avatar-perf-core/backend/Cargo.toml` | Rust manifest |
| Create | `avatar-perf-core/src/App.tsx` | Root React component of the tool UI |
| Create | `avatar-perf-core/src/components/StepProject.tsx` | Project selection step |
| Create | `avatar-perf-core/src/components/StepScene.tsx` | Scene selection step |
| Create | `avatar-perf-core/src/components/StepAvatar.tsx` | Avatar selection step |
| Create | `avatar-perf-core/src/components/ResultView.tsx` | Results: metrics + recommendations |
| Create | `avatar-perf-core/src/main.tsx` | React DOM entry point |
| Create | `avatar-perf-core/src/types.ts` | TypeScript types (mirrors Rust AnalysisResult) |
| Create | `avatar-perf-core/src/package.json` | npm manifest |
| Create | `avatar-perf-core/src/vite.config.ts` | Vite IIFE build config |
| Create | `avatar-perf-core/src/tsconfig.json` | TypeScript config |
| Modify | `avatar-perf-core/tool.json` | Add `frontend` block, update `downloads.sidecar_windows` key |
| Modify | `build.py` | Detect `frontend.entry`, run Vite build, include `dist/ui.js` in release |
| Modify | `tools/package.py` | Include `dist/ui.js` when present |

**In `vrcstudio` repo (cleanup — after tool ships):**

| Action | File | Reason |
|---|---|---|
| Delete | `src/components/tools/runners/AvatarPerf.tsx` | Replaced by bundle |
| Delete | `src/components/tools/runners/AvatarPerfMetrics.tsx` | Same |
| Delete | `src/components/tools/runners/AvatarPerfViewport.tsx` | Same |
| Delete | `src/components/tools/runners/AvatarPerfRecommendations.tsx` | Same |
| Modify | `src/components/tools/ToolRunner.tsx` | Remove `isEmbedded` special-case for `avatar-performance-analyzer` |

---

## Task 1: Restructure `avatar-perf-core` directories

**Files:**
- Move `avatar-perf-core/src/` → `avatar-perf-core/backend/src/`
- Move `avatar-perf-core/Cargo.toml` → `avatar-perf-core/backend/Cargo.toml`
- Move `avatar-perf-core/Cargo.lock` → `avatar-perf-core/backend/Cargo.lock`
- Move `avatar-perf-core/.gitignore` (if Rust-specific) → `avatar-perf-core/backend/.gitignore`

- [ ] **Run the moves**

  ```bash
  cd ../vrcstudio-tools
  mkdir -p avatar-perf-core/backend
  mv avatar-perf-core/src avatar-perf-core/backend/src
  mv avatar-perf-core/Cargo.toml avatar-perf-core/backend/Cargo.toml
  mv avatar-perf-core/Cargo.lock avatar-perf-core/backend/Cargo.lock
  ```

- [ ] **Update `.cargo/config.toml` if it references the old path**

  Check `../vrcstudio-tools/.cargo/config.toml` — if it has a `[workspace]` or path reference to `avatar-perf-core`, update to `avatar-perf-core/backend`.

- [ ] **Verify Rust still builds**

  ```bash
  cd avatar-perf-core/backend && cargo check 2>&1 | tail -5
  ```

  Expected: `Finished` with 0 errors.

- [ ] **Commit**

  ```bash
  cd ../..
  git add -A
  git commit -m "refactor(avatar-perf): move Rust sidecar to backend/"
  ```

---

## Task 2: TypeScript types for the tool frontend

**Files:**
- Create: `avatar-perf-core/src/types.ts`

The types mirror the Rust `AnalysisResult` struct returned by the sidecar (see `avatar-perf-core/backend/src/types.rs`).

- [ ] **Create `types.ts`**

  ```typescript
  // avatar-perf-core/src/types.ts

  export type VrcRank = "Excellent" | "Good" | "Medium" | "Poor" | "VeryPoor";

  export interface AvatarMetrics {
    triangle_count: number;
    skinned_mesh_count: number;
    mesh_count: number;
    material_count: number;
    bone_count: number;
    physbone_component_count: number;
    physbone_affected_transforms: number;
    physbone_colliders: number;
    physbone_collision_check_count: number;
    constraint_count: number;
    animators: number;
    lights: number;
    particle_systems: number;
    particle_active_polys: number;
    cloths: number;
    total_cloth_vertices: number;
    audio_sources: number;
    vram_bytes: number;
  }

  export interface Recommendation {
    severity: "error" | "warning" | "info";
    metric: string;
    message: string;
    current: string;
    limit: string;
  }

  export interface AnalysisResult {
    ok: boolean;
    error: string | null;
    avatar_name: string;
    scene: string;
    metrics: AvatarMetrics;
    rank_pc: VrcRank;
    rank_quest: VrcRank;
    recommendations: Recommendation[];
    thumbnail_path: string | null;
    gltf_path: string | null;
  }
  ```

- [ ] **Commit**

  ```bash
  git add avatar-perf-core/src/types.ts
  git commit -m "feat(avatar-perf-frontend): TypeScript types for analysis result"
  ```

---

## Task 3: npm + Vite config

**Files:**
- Create: `avatar-perf-core/src/package.json`
- Create: `avatar-perf-core/src/vite.config.ts`
- Create: `avatar-perf-core/src/tsconfig.json`

- [ ] **Create `package.json`**

  ```json
  {
    "name": "avatar-perf-ui",
    "version": "1.0.1",
    "private": true,
    "scripts": {
      "build": "vite build",
      "dev": "vite"
    },
    "dependencies": {
      "react": "^18.3.1",
      "react-dom": "^18.3.1"
    },
    "devDependencies": {
      "@types/react": "^18.3.1",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.1",
      "typescript": "^5.4.5",
      "vite": "^5.3.1"
    }
  }
  ```

- [ ] **Create `vite.config.ts`**

  ```typescript
  // avatar-perf-core/src/vite.config.ts
  import { defineConfig } from "vite";
  import react from "@vitejs/plugin-react";

  export default defineConfig({
    plugins: [react()],
    build: {
      lib: {
        entry: "main.tsx",
        name: "AvatarPerfUI",
        formats: ["iife"],
        fileName: () => "ui.js",
      },
      outDir: "../dist",
      emptyOutDir: true,
      rollupOptions: {
        // React is inlined — no externals
      },
    },
    // Allow the tool to run as a dev server on a local port for development
    server: {
      port: 5174,
    },
  });
  ```

- [ ] **Create `tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "moduleResolution": "bundler",
      "jsx": "react-jsx",
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noFallthroughCasesInSwitch": true,
      "skipLibCheck": true
    },
    "include": ["**/*.ts", "**/*.tsx"]
  }
  ```

- [ ] **Install deps to verify config**

  ```bash
  cd avatar-perf-core/src && npm install 2>&1 | tail -5
  ```

  Expected: success, `node_modules/` created.

- [ ] **Commit**

  ```bash
  cd ../..
  git add avatar-perf-core/src/package.json avatar-perf-core/src/vite.config.ts avatar-perf-core/src/tsconfig.json
  git commit -m "feat(avatar-perf-frontend): Vite + npm build config"
  ```

---

## Task 4: Tool entry point + App shell

**Files:**
- Create: `avatar-perf-core/src/main.tsx`
- Create: `avatar-perf-core/src/App.tsx`

- [ ] **Create `main.tsx`**

  ```tsx
  // avatar-perf-core/src/main.tsx
  import { createRoot } from "react-dom/client";
  import { App } from "./App";

  const root = document.getElementById("root");
  if (!root) throw new Error("No #root element");
  createRoot(root).render(<App />);
  ```

- [ ] **Create `App.tsx`**

  ```tsx
  // avatar-perf-core/src/App.tsx
  import { useState } from "react";
  import { AnalysisResult } from "./types";
  import { StepProject } from "./components/StepProject";
  import { StepScene } from "./components/StepScene";
  import { StepAvatar } from "./components/StepAvatar";
  import { ResultView } from "./components/ResultView";

  // window.vrcstudio is injected by the SdkBridge preamble before this bundle runs.
  declare const window: Window & {
    vrcstudio: {
      selectProject(): Promise<{ path: string; name: string; unity_version: string } | null>;
      selectScene(path: string): Promise<{ path: string; name: string } | null>;
      selectAvatar(
        projectPath: string,
        scenePath: string
      ): Promise<{ name: string; file_id: string } | null>;
      runSidecar(args: Record<string, unknown>): Promise<unknown>;
      setProgress(progress: number, label?: string): void;
      notify(message: string, opts?: { type?: string }): void;
    };
  };

  type Step = "project" | "scene" | "avatar" | "running" | "results";

  export function App() {
    const [step, setStep] = useState<Step>("project");
    const [projectPath, setProjectPath] = useState("");
    const [projectName, setProjectName] = useState("");
    const [scenePath, setScenePath] = useState("");
    const [sceneName, setSceneName] = useState("");
    const [result, setResult] = useState<AnalysisResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const goBack = () => {
      setError(null);
      if (step === "scene") setStep("project");
      else if (step === "avatar") setStep("scene");
      else if (step === "results" || step === "running") setStep("avatar");
    };

    const handleProjectSelected = (path: string, name: string) => {
      setProjectPath(path);
      setProjectName(name);
      setStep("scene");
    };

    const handleSceneSelected = (path: string, name: string) => {
      setScenePath(path);
      setSceneName(name);
      setStep("avatar");
    };

    const handleAvatarSelected = async (avatarName: string) => {
      setStep("running");
      setError(null);
      try {
        window.vrcstudio.setProgress(0.05, "Iniciando análisis…");
        const raw = await window.vrcstudio.runSidecar({
          action: "analyze",
          project_path: projectPath,
          scene_path: scenePath,
          avatar_name: avatarName,
        });
        const res = raw as AnalysisResult;
        if (!res.ok) throw new Error(res.error ?? "Analysis failed");
        setResult(res);
        setStep("results");
        window.vrcstudio.setProgress(1.0, "Listo");
      } catch (e) {
        setError(String(e));
        window.vrcstudio.notify(String(e), { type: "error" });
        setStep("avatar");
      }
    };

    return (
      <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#09090b", color: "#e4e4e7" }}>
        {error && (
          <div style={{ padding: "8px 16px", background: "#450a0a", color: "#fca5a5", fontSize: 12 }}>
            {error}
          </div>
        )}
        {step === "project" && (
          <StepProject onSelected={handleProjectSelected} />
        )}
        {step === "scene" && (
          <StepScene
            projectPath={projectPath}
            projectName={projectName}
            onSelected={handleSceneSelected}
            onBack={goBack}
          />
        )}
        {step === "avatar" && (
          <StepAvatar
            projectPath={projectPath}
            scenePath={scenePath}
            sceneName={sceneName}
            onSelected={handleAvatarSelected}
            onBack={goBack}
          />
        )}
        {step === "running" && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#71717a", fontSize: 14 }}>
            Analizando avatar…
          </div>
        )}
        {step === "results" && result && (
          <ResultView result={result} onBack={goBack} />
        )}
      </div>
    );
  }
  ```

- [ ] **Commit**

  ```bash
  git add avatar-perf-core/src/main.tsx avatar-perf-core/src/App.tsx
  git commit -m "feat(avatar-perf-frontend): App shell with step state machine"
  ```

---

## Task 5: Step components

**Files:**
- Create: `avatar-perf-core/src/components/StepProject.tsx`
- Create: `avatar-perf-core/src/components/StepScene.tsx`
- Create: `avatar-perf-core/src/components/StepAvatar.tsx`

- [ ] **Create `StepProject.tsx`**

  ```tsx
  // avatar-perf-core/src/components/StepProject.tsx

  declare const window: Window & { vrcstudio: { selectProject(): Promise<{ path: string; name: string; unity_version: string } | null> } };

  interface Props {
    onSelected: (path: string, name: string) => void;
  }

  export function StepProject({ onSelected }: Props) {
    const handleClick = async () => {
      const p = await window.vrcstudio.selectProject();
      if (p) onSelected(p.path, p.name);
    };

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
        <p style={{ fontSize: 13, color: "#71717a", textAlign: "center" }}>
          Selecciona el proyecto Unity que contiene el avatar a analizar
        </p>
        <button
          onClick={handleClick}
          style={{
            padding: "10px 20px", background: "#27272a", border: "1px solid #3f3f46",
            borderRadius: 10, color: "#e4e4e7", fontSize: 13, cursor: "pointer",
          }}
        >
          Seleccionar proyecto…
        </button>
      </div>
    );
  }
  ```

- [ ] **Create `StepScene.tsx`**

  ```tsx
  // avatar-perf-core/src/components/StepScene.tsx
  import { useState, useEffect } from "react";

  declare const window: Window & {
    vrcstudio: {
      getScenes(path: string): Promise<Array<{ path: string; name: string }>>;
      selectScene(path: string): Promise<{ path: string; name: string } | null>;
    }
  };

  interface Props {
    projectPath: string;
    projectName: string;
    onSelected: (path: string, name: string) => void;
    onBack: () => void;
  }

  export function StepScene({ projectPath, projectName, onSelected, onBack }: Props) {
    const [scenes, setScenes] = useState<Array<{ path: string; name: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      window.vrcstudio.getScenes(projectPath)
        .then(setScenes)
        .catch((e: unknown) => setError(String(e)))
        .finally(() => setLoading(false));
    }, [projectPath]);

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #27272a" }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 16 }}>←</button>
          <span style={{ fontSize: 12, color: "#71717a" }}>{projectName}</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {loading && <p style={{ color: "#71717a", fontSize: 13 }}>Buscando escenas…</p>}
          {error && <p style={{ color: "#f87171", fontSize: 13 }}>{error}</p>}
          {!loading && !error && scenes.length === 0 && (
            <p style={{ color: "#71717a", fontSize: 13 }}>No se encontraron escenas .unity en este proyecto.</p>
          )}
          {scenes.map((s) => (
            <button
              key={s.path}
              onClick={() => onSelected(s.path, s.name)}
              style={{
                display: "flex", flexDirection: "column", width: "100%", textAlign: "left",
                padding: "10px 12px", marginBottom: 6, background: "#18181b",
                border: "1px solid #27272a", borderRadius: 10, cursor: "pointer", color: "#e4e4e7",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
              <span style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>{s.path}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  ```

- [ ] **Create `StepAvatar.tsx`**

  ```tsx
  // avatar-perf-core/src/components/StepAvatar.tsx
  import { useState, useEffect } from "react";

  declare const window: Window & {
    vrcstudio: {
      getAvatars(projectPath: string, scenePath: string): Promise<Array<{ name: string; file_id: string }>>;
    }
  };

  interface Props {
    projectPath: string;
    scenePath: string;
    sceneName: string;
    onSelected: (avatarName: string) => void;
    onBack: () => void;
  }

  export function StepAvatar({ projectPath, scenePath, sceneName, onSelected, onBack }: Props) {
    const [avatars, setAvatars] = useState<Array<{ name: string; file_id: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      window.vrcstudio.getAvatars(projectPath, scenePath)
        .then(setAvatars)
        .catch((e: unknown) => setError(String(e)))
        .finally(() => setLoading(false));
    }, [projectPath, scenePath]);

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #27272a" }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 16 }}>←</button>
          <span style={{ fontSize: 12, color: "#71717a" }}>{sceneName}</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {loading && <p style={{ color: "#71717a", fontSize: 13 }}>Detectando avatares…</p>}
          {error && <p style={{ color: "#f87171", fontSize: 13 }}>{error}</p>}
          {!loading && !error && avatars.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#71717a" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#d4d4d8" }}>No se encontraron avatares</p>
              <p style={{ fontSize: 11, marginTop: 6 }}>
                La escena no contiene GameObjects con VRC_AvatarDescriptor.
              </p>
            </div>
          )}
          {avatars.map((av) => (
            <button
              key={av.file_id}
              onClick={() => onSelected(av.name)}
              style={{
                display: "flex", alignItems: "center", width: "100%", textAlign: "left",
                padding: "10px 12px", marginBottom: 6, background: "#18181b",
                border: "1px solid #27272a", borderRadius: 10, cursor: "pointer", color: "#e4e4e7",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 18 }}>🧍</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{av.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  ```

- [ ] **Commit**

  ```bash
  git add avatar-perf-core/src/components/
  git commit -m "feat(avatar-perf-frontend): step components (project, scene, avatar selection)"
  ```

---

## Task 6: ResultView component

**Files:**
- Create: `avatar-perf-core/src/components/ResultView.tsx`

- [ ] **Create `ResultView.tsx`**

  ```tsx
  // avatar-perf-core/src/components/ResultView.tsx
  import { AnalysisResult, VrcRank, Recommendation } from "../types";

  const RANK_COLOR: Record<VrcRank, string> = {
    Excellent: "#4ade80",
    Good:      "#a3e635",
    Medium:    "#facc15",
    Poor:      "#fb923c",
    VeryPoor:  "#f87171",
  };

  interface Props {
    result: AnalysisResult;
    onBack: () => void;
  }

  export function ResultView({ result, onBack }: Props) {
    const m = result.metrics;

    const formatBytes = (b: number) => {
      if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
      return `${b} B`;
    };

    const MetricRow = ({ label, value }: { label: string; value: string | number }) => (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #27272a", fontSize: 12 }}>
        <span style={{ color: "#a1a1aa" }}>{label}</span>
        <span style={{ color: "#e4e4e7", fontWeight: 600 }}>{value}</span>
      </div>
    );

    const RankBadge = ({ rank, platform }: { rank: VrcRank; platform: string }) => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10, color: "#71717a", textTransform: "uppercase", letterSpacing: 1 }}>{platform}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: RANK_COLOR[rank] }}>{rank}</span>
      </div>
    );

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #27272a" }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 16 }}>←</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e4e4e7" }}>{result.avatar_name}</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Rank badges */}
          <div style={{ display: "flex", justifyContent: "space-around", padding: "16px", background: "#18181b", borderRadius: 12, border: "1px solid #27272a" }}>
            <RankBadge rank={result.rank_pc} platform="PC" />
            <div style={{ width: 1, background: "#27272a" }} />
            <RankBadge rank={result.rank_quest} platform="Quest" />
          </div>

          {/* Metrics */}
          <div style={{ background: "#18181b", borderRadius: 12, border: "1px solid #27272a", padding: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Métricas</p>
            <MetricRow label="Triángulos"        value={m.triangle_count.toLocaleString()} />
            <MetricRow label="Materiales"        value={m.material_count} />
            <MetricRow label="Huesos"            value={m.bone_count} />
            <MetricRow label="PhysBones"         value={m.physbone_component_count} />
            <MetricRow label="PB Transforms"     value={m.physbone_affected_transforms} />
            <MetricRow label="PB Colliders"      value={m.physbone_colliders} />
            <MetricRow label="Meshes (skinned)"  value={m.skinned_mesh_count} />
            <MetricRow label="VRAM"              value={formatBytes(m.vram_bytes)} />
          </div>

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <div style={{ background: "#18181b", borderRadius: 12, border: "1px solid #27272a", padding: 14 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Recomendaciones</p>
              {result.recommendations.map((r, i) => (
                <RecommendationRow key={i} rec={r} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function RecommendationRow({ rec }: { rec: Recommendation }) {
    const color = rec.severity === "error" ? "#f87171" : rec.severity === "warning" ? "#facc15" : "#71717a";
    return (
      <div style={{ padding: "8px 0", borderBottom: "1px solid #27272a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color }}>{rec.metric}</span>
          <span style={{ fontSize: 10, color: "#52525b" }}>{rec.current} / {rec.limit}</span>
        </div>
        <p style={{ fontSize: 11, color: "#a1a1aa", lineHeight: 1.5 }}>{rec.message}</p>
      </div>
    );
  }
  ```

- [ ] **Commit**

  ```bash
  git add avatar-perf-core/src/components/ResultView.tsx
  git commit -m "feat(avatar-perf-frontend): ResultView with rank badges, metrics, recommendations"
  ```

---

## Task 7: First build test

- [ ] **Run the Vite build**

  ```bash
  cd avatar-perf-core/src && npm run build 2>&1
  ```

  Expected: `dist/ui.js` created at `avatar-perf-core/dist/ui.js`.

- [ ] **Check bundle size**

  ```bash
  ls -lh ../dist/ui.js
  ```

  Expected: ~300–600 KB (React + app code inlined).

- [ ] **Fix any TypeScript or build errors** before continuing.

- [ ] **Commit dist (for registry distribution)**

  ```bash
  cd ../..
  git add avatar-perf-core/dist/
  echo "!avatar-perf-core/dist/ui.js" >> .gitignore  # ensure it's tracked
  git commit -m "feat(avatar-perf-frontend): first compiled ui.js bundle"
  ```

---

## Task 8: Update `tool.json`

**Files:**
- Modify: `avatar-perf-core/tool.json`

- [ ] **Add `frontend` block and update download key**

  The `downloads` object currently has a `windows-amd64` key. The app-side code (`tools.rs`) reads `sidecar_windows`. Update to match:

  ```json
  {
    "id": "avatar-performance-analyzer",
    "name": "Avatar Performance Analyzer",
    "version": "1.0.2",
    "description": "Analiza proyectos Unity de VRChat y calcula el rank de rendimiento PC y Quest de tus avatares. Cuenta triángulos, PhysBones, materiales, VRAM y genera recomendaciones de optimización accionables.",
    "author": "s7lver",
    "author_avatar_url": "",
    "author_github": "s7lver2",
    "icon_url": "https://raw.githubusercontent.com/s7lver2/vrcstudio-tools/main/avatar-perf-core/assets/icon.png",
    "banner_url": "https://raw.githubusercontent.com/s7lver2/vrcstudio-tools/main/avatar-perf-core/assets/banner.png",
    "screenshots": [
      "https://raw.githubusercontent.com/s7lver2/vrcstudio-tools/main/avatar-perf-core/assets/screenshot-metrics.png",
      "https://raw.githubusercontent.com/s7lver2/vrcstudio-tools/main/avatar-perf-core/assets/screenshot-recommendations.png"
    ],
    "category": "performance",
    "tags": ["vrchat", "avatar", "performance", "optimization", "unity"],
    "featured": true,
    "requires_unity": true,
    "min_unity_version": "2022.3",
    "requirements": "Unity 2022.3+, VRChat SDK 3.x (Avatars)",
    "changelog": "1.0.2 — Frontend propio en React con SDK calls. 1.0.1 — Corrección de detección de avatares.",
    "sdk_calls": [
      { "method": "selectProject", "description": "Abre el selector de proyectos Unity" },
      { "method": "selectScene",   "description": "Lista las escenas del proyecto" },
      { "method": "selectAvatar",  "description": "Detecta avatares con VRC_AvatarDescriptor" },
      { "method": "runSidecar",    "description": "Ejecuta el análisis de rendimiento" }
    ],
    "frontend": {
      "entry": "src/main.tsx",
      "output": "dist/ui.js"
    },
    "downloads": {
      "ui_bundle": "https://github.com/s7lver2/vrcstudio-tools/releases/download/avatar-performance-analyzer-1.0.2/ui.js",
      "sidecar_windows": "https://github.com/s7lver2/vrcstudio-tools/releases/download/avatar-performance-analyzer-1.0.2/avatar-performance-analyzer-windows-amd64.exe"
    },
    "platforms": ["windows-amd64"],
    "dependencies": []
  }
  ```

- [ ] **Commit**

  ```bash
  git add avatar-perf-core/tool.json
  git commit -m "feat(avatar-perf): tool.json v1.0.2 — add frontend block, sdk_calls for runSidecar"
  ```

---

## Task 9: Update `build.py`

**Files:**
- Modify: `build.py`

- [ ] **Read `build.py` current content before editing**

  ```bash
  cat build.py
  ```

- [ ] **Add frontend build step**

  In `build.py`, in the per-tool build loop, add a frontend compilation step. After reading `tool.json`, before building the Rust binary:

  ```python
  import subprocess, os, shutil

  # After reading tool_json:
  frontend = tool_json.get("frontend")
  if frontend:
      src_dir = os.path.join(tool_dir, "src")
      print(f"[{tool_id}] Installing frontend deps…")
      subprocess.check_call(["npm", "install"], cwd=src_dir, shell=True)
      print(f"[{tool_id}] Building frontend bundle…")
      subprocess.check_call(["npm", "run", "build"], cwd=src_dir, shell=True)
      print(f"[{tool_id}] Frontend built: dist/ui.js")
  ```

  > **Note on `shell=True`:** Required on Windows for `npm` to resolve. On Unix, set `shell=False` and use `["npm", "install"]`. Use `sys.platform == "win32"` to conditionally set it.

  ```python
  _shell = sys.platform == "win32"
  if frontend:
      src_dir = os.path.join(tool_dir, "src")
      subprocess.check_call(["npm", "install"], cwd=src_dir, shell=_shell)
      subprocess.check_call(["npm", "run", "build"], cwd=src_dir, shell=_shell)
  ```

- [ ] **Update the release packager to include `dist/ui.js`**

  In the zip-creation section of `build.py`, after adding the sidecar binary, add:

  ```python
  ui_bundle = os.path.join(tool_dir, "dist", "ui.js")
  if os.path.exists(ui_bundle):
      zf.write(ui_bundle, "ui.js")
      print(f"  + ui.js ({os.path.getsize(ui_bundle) // 1024} KB)")
  ```

- [ ] **Also update `registry.json` generator** so the `ui_bundle` download URL is included for tools that have a `frontend` block.

- [ ] **Test the build script end-to-end**

  ```bash
  python build.py avatar-perf-core 2>&1 | tail -20
  ```

  Expected: `dist/ui.js` produced, zip contains both `core.exe` and `ui.js`.

- [ ] **Commit**

  ```bash
  git add build.py
  git commit -m "feat(build): detect frontend.entry, run Vite build, include ui.js in release zip"
  ```

---

## Task 10: Update `vrcstudio` installer to download `ui_bundle`

**Files (in `vrcstudio` repo):**
- Modify: `src-tauri/src/commands/tools.rs` (function `tools_install`)

- [ ] **Add `ui_bundle` download to `tools_install`**

  In `tools_install`, after the sidecar download block, add:

  ```rust
  // Download UI bundle if present
  if !entry.downloads.ui_bundle.is_empty() {
      let bundle_path = tool_dir.join("ui.js");
      emit_progress(&app, &entry.id, 0.87, "Descargando interfaz…");
      download_file(&app, &entry.id, &entry.downloads.ui_bundle, &bundle_path, 0.87, 0.93).await?;
  }
  ```

- [ ] **Verify the `InstalledTool` metadata stores the `ui_bundle` path**

  After installation, `tool.metadata.downloads.ui_bundle` will be the GitHub URL. `ToolRunner` resolves the local path as:
  `app_data/tools/{tool_id}/ui.js`

  Update `ToolRunner` to derive the local bundle path from the tool's install directory rather than from `metadata.downloads.ui_bundle` (which is a URL, not a local path):

  In `ToolRunner.tsx`, replace:

  ```typescript
  const bundlePath = tool.metadata?.downloads?.ui_bundle || "";
  ```

  With a Tauri invoke that resolves the app data dir, or store the local path in the DB. The simplest approach: use a new field `local_ui_bundle` set during installation, or resolve it via a `tools_get_bundle_path(id)` command.

  **Simpler approach:** Add a `tools_get_bundle_path` command to `tools.rs`:

  ```rust
  #[tauri::command]
  pub fn tools_get_bundle_path(app: tauri::AppHandle, id: String) -> Option<String> {
      let path = app.path().app_data_dir().ok()?
          .join("tools").join(&id).join("ui.js");
      if path.exists() { Some(path.to_string_lossy().to_string()) } else { None }
  }
  ```

  Register it in `lib.rs`. In `ToolRunner.tsx`, call it on mount to get the local bundle path.

- [ ] **Commit**

  ```bash
  git add src-tauri/src/commands/tools.rs src-tauri/src/lib.rs src/components/tools/ToolRunner.tsx
  git commit -m "feat(tools): download ui.js bundle on install; resolve local bundle path via Tauri"
  ```

---

## Task 11: Remove embedded AvatarPerf from `vrcstudio`

**Prerequisite:** The tool bundle (`ui.js`) must be deployed to the registry and downloadable before removing the embedded fallback. Do this task only after the release is published and the install flow is verified end-to-end.

**Files (in `vrcstudio` repo):**
- Delete: `src/components/tools/runners/AvatarPerf.tsx`
- Delete: `src/components/tools/runners/AvatarPerfMetrics.tsx`
- Delete: `src/components/tools/runners/AvatarPerfViewport.tsx`
- Delete: `src/components/tools/runners/AvatarPerfRecommendations.tsx`
- Modify: `src/components/tools/ToolRunner.tsx`

- [ ] **Remove the `isEmbedded` branch in `ToolRunner.tsx`**

  Delete the entire block:

  ```typescript
  // DELETE this block:
  const isEmbedded = !bundlePath || tool.id === "avatar-performance-analyzer";
  if (isEmbedded) { ... }
  ```

  The non-embedded (iframe) path is now the only path.

- [ ] **Delete the runner files**

  ```bash
  rm src/components/tools/runners/AvatarPerf.tsx
  rm src/components/tools/runners/AvatarPerfMetrics.tsx
  rm src/components/tools/runners/AvatarPerfViewport.tsx
  rm src/components/tools/runners/AvatarPerfRecommendations.tsx
  ```

- [ ] **Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Commit**

  ```bash
  git add -A
  git commit -m "feat(tools): remove embedded AvatarPerf runner — now loaded as SDK bundle"
  ```
