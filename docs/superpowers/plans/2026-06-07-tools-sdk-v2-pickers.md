# Tools SDK v2 + Picker Redesigns + Self-SDK Toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the VRC Studio SDK with 5 new methods, redesign the `selectProject()` picker as an image grid, add a visual file browser, and wire the embedded AvatarPerf tool to route interactive calls through the SDK with a debug bypass toggle.

**Architecture:** New Rust command `tools_list_dir` powers the file browser. All new SDK methods flow through the existing `SdkPickerModals` + `ToolRunner` dispatch pipeline. AvatarPerf gains an `onInteractive` prop and uses `useEmbeddedSdk`; a settings toggle (`use_sdk_internally`) allows bypassing the SDK for debugging.

**Tech Stack:** Rust (Tauri commands), React + TypeScript, Zustand, Tailwind CSS

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src-tauri/src/commands/tools.rs` | Add `tools_list_dir` command + `FileEntry` type |
| Modify | `src-tauri/src/commands/app_settings.rs` | Add `use_sdk_internally: bool` field |
| Modify | `src-tauri/src/lib.rs` | Register `tools_list_dir` |
| Modify | `src/lib/tauri.ts` | Add `FileEntry` type, `tauriListDir`, `use_sdk_internally` to `AppSettings` |
| Modify | `src/lib/vrcstudio-sdk.ts` | Add `SdkFileEntry` type + 5 new methods to `VrcStudioSdk` |
| Create | `src/components/tools/FileBrowserPicker.tsx` | File browser modal (breadcrumb + grid) |
| Modify | `src/components/tools/SdkPickerModals.tsx` | Redesign `ProjectPicker` as grid; add `importPackage`, `browseProjectFiles`, `browseInventoryItemFiles` cases |
| Modify | `src/components/tools/SdkBridge.tsx` | Inject `toolId` into preamble; add 5 new method stubs |
| Modify | `src/components/tools/ToolRunner.tsx` | Handle `runSidecar`, `getProjectFiles`, `importPackage`, `browseProjectFiles`, `browseInventoryItemFiles`; pass `bypassSdk` |
| Modify | `src/components/tools/runners/AvatarPerf.tsx` | Add `onInteractive` prop; route interactive calls through `useEmbeddedSdk`; respect `bypassSdk` |
| Create | `src/components/settings/DebugSection.tsx` | Debug settings panel with `use_sdk_internally` toggle |
| Modify | `src/components/settings/ToolsSection.tsx` | Mount `DebugSection` at the bottom |
| Modify | `src-tauri/src/tools/sdk_server.rs` | Add `POST /sdk/list-dir` route |

---

## Task 1: Rust — `FileEntry` type + `tools_list_dir` command

**Files:**
- Modify: `src-tauri/src/commands/tools.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Add `FileEntry` struct and `tools_list_dir` command to `tools.rs`**

  Add after the existing `AvatarDescriptor` struct (around line 255):

  ```rust
  #[derive(Debug, Serialize, Deserialize)]
  pub struct FileEntry {
      pub name: String,
      /// Path relative to the root passed to the command.
      pub path: String,
      pub is_dir: bool,
      pub extension: Option<String>,
      pub size_bytes: Option<u64>,
  }

  /// Lists the immediate children of `root/sub_path`.
  /// Returns entries sorted: directories first, then files, alphabetically.
  #[tauri::command]
  pub fn tools_list_dir(root: String, sub_path: String) -> Result<Vec<FileEntry>, AppError> {
      let full_path = if sub_path.is_empty() {
          std::path::PathBuf::from(&root)
      } else {
          std::path::Path::new(&root).join(&sub_path)
      };

      if !full_path.exists() {
          return Err(AppError::Io(format!("Path not found: {}", full_path.display())));
      }

      let mut entries: Vec<FileEntry> = std::fs::read_dir(&full_path)
          .map_err(|e| AppError::Io(e.to_string()))?
          .filter_map(|e| e.ok())
          .map(|e| {
              let meta = e.metadata().ok();
              let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
              let size_bytes = if is_dir { None } else { meta.map(|m| m.len()) };
              let name = e.file_name().to_string_lossy().to_string();
              let extension = if is_dir {
                  None
              } else {
                  std::path::Path::new(&name)
                      .extension()
                      .map(|x| x.to_string_lossy().to_string())
              };
              let rel = if sub_path.is_empty() {
                  name.clone()
              } else {
                  format!("{}/{}", sub_path, name)
              };
              FileEntry { name, path: rel, is_dir, extension, size_bytes }
          })
          .collect();

      entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
          (true, false) => std::cmp::Ordering::Less,
          (false, true) => std::cmp::Ordering::Greater,
          _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
      });

      Ok(entries)
  }
  ```

- [ ] **Register `tools_list_dir` in `src-tauri/src/lib.rs`**

  Find the `invoke_handler` block (around line 306) and add after `tools_clear_registry_cache`:

  ```rust
  commands::tools::tools_list_dir,
  ```

- [ ] **Build to confirm no compile errors**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -40
  ```

  Expected: no errors.

- [ ] **Commit**

  ```bash
  git add src-tauri/src/commands/tools.rs src-tauri/src/lib.rs
  git commit -m "feat(tools): add tools_list_dir Tauri command"
  ```

---

## Task 2: Rust — `use_sdk_internally` setting

**Files:**
- Modify: `src-tauri/src/commands/app_settings.rs`

- [ ] **Add field to `AppSettings` struct**

  In `app_settings.rs`, inside the `AppSettings` struct after `tools_registry_branch`:

  ```rust
  /// Si true, los tools embebidos (como AvatarPerf) usan el SDK interno
  /// en lugar de llamar a Tauri directamente. Por defecto true.
  #[serde(default = "default_use_sdk_internally")]
  pub use_sdk_internally: bool,
  ```

  And add the default function after `fn default_tools_registry_branch()`:

  ```rust
  fn default_use_sdk_internally() -> bool { true }
  ```

- [ ] **Build check**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -20
  ```

  Expected: no errors.

- [ ] **Commit**

  ```bash
  git add src-tauri/src/commands/app_settings.rs
  git commit -m "feat(settings): add use_sdk_internally debug flag"
  ```

---

## Task 3: Frontend — Type definitions

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/lib/vrcstudio-sdk.ts`

- [ ] **Add `FileEntry` type and `tauriListDir` to `tauri.ts`**

  After the `AppSettings` interface (after line 32), add:

  ```typescript
  export interface FileEntry {
    name: string;
    /** Path relative to the root passed to tools_list_dir */
    path: string;
    is_dir: boolean;
    extension: string | null;
    size_bytes: number | null;
  }
  ```

  Add `use_sdk_internally` to `AppSettings` (after `tools_registry_branch`):

  ```typescript
  /** Si true los tools embebidos usan el SDK interno. Por defecto true. */
  use_sdk_internally: boolean;
  ```

  Add the Tauri invoke near the other tools commands (around line 846):

  ```typescript
  export const tauriListDir = (root: string, subPath: string): Promise<FileEntry[]> =>
    invoke("tools_list_dir", { root, subPath });
  ```

- [ ] **Add `SdkFileEntry` type and new methods to `vrcstudio-sdk.ts`**

  After the `SdkNotifyOptions` interface, add:

  ```typescript
  export interface SdkFileEntry {
    name: string;
    /** Path relative to the browser root */
    path: string;
    is_dir: boolean;
    extension: string | null;
    size_bytes: number | null;
  }
  ```

  Add to the `VrcStudioSdk` interface, after `pickFolder`:

  ```typescript
  // ── Import ────────────────────────────────────────────────────────────────
  /**
   * Open the "Import package" picker (Scan drive / Local file / From URL).
   * Resolves when the user dismisses the modal.
   */
  importPackage(opts?: { title?: string }): Promise<void>;

  // ── File browser ──────────────────────────────────────────────────────────
  /** Open a visual file browser rooted at a Unity project. Returns selected absolute path or null. */
  browseProjectFiles(projectPath: string): Promise<string | null>;

  /** Open a visual file browser rooted at an inventory item's installed path. Returns selected absolute path or null. */
  browseInventoryItemFiles(itemId: number): Promise<string | null>;

  /** Return the file tree of a project directory without opening any UI. */
  getProjectFiles(projectPath: string, filter?: { extensions?: string[] }): Promise<SdkFileEntry[]>;

  // ── Sidecar ───────────────────────────────────────────────────────────────
  /**
   * Run this tool's own sidecar binary with the given args.
   * The parent app calls tools_run_sidecar(toolId, args) and resolves with the result.
   */
  runSidecar(args: Record<string, unknown>): Promise<unknown>;
  ```

- [ ] **Commit**

  ```bash
  git add src/lib/tauri.ts src/lib/vrcstudio-sdk.ts
  git commit -m "feat(sdk): add FileEntry types and 5 new SDK method signatures"
  ```

---

## Task 4: `FileBrowserPicker` component

**Files:**
- Create: `src/components/tools/FileBrowserPicker.tsx`

- [ ] **Create the file browser modal**

  ```typescript
  // src/components/tools/FileBrowserPicker.tsx
  import { useState, useEffect } from "react";
  import { X } from "lucide-react";
  import { tauriListDir, FileEntry } from "../../lib/tauri";

  interface Props {
    callId: number;
    root: string;
    title: string;
    onResolve: (callId: number, result: unknown) => void;
    onCancel: () => void;
  }

  function fileIcon(entry: FileEntry): string {
    if (entry.is_dir) return "📁";
    switch (entry.extension?.toLowerCase()) {
      case "unity":      return "🎬";
      case "anim":       return "🎞️";
      case "controller": return "⚙️";
      case "mat":        return "🎨";
      case "png": case "jpg": case "jpeg": return "🖼️";
      case "fbx": case "obj": return "📦";
      case "cs":         return "📝";
      case "prefab":     return "🧩";
      default:           return "📄";
    }
  }

  export function FileBrowserPicker({ callId, root, title, onResolve, onCancel }: Props) {
    const [subPath, setSubPath] = useState("");
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      setLoading(true);
      setError(null);
      tauriListDir(root, subPath)
        .then(setEntries)
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    }, [root, subPath]);

    const navigate = (entry: FileEntry) => {
      if (entry.is_dir) {
        setSubPath(entry.path);
        setSelected(null);
      } else {
        setSelected(entry.path);
      }
    };

    const breadcrumbs = subPath ? subPath.split("/") : [];

    const navigateTo = (index: number) => {
      setSubPath(index < 0 ? "" : breadcrumbs.slice(0, index + 1).join("/"));
      setSelected(null);
    };

    const confirm = () => {
      if (selected) onResolve(callId, `${root}/${selected}`);
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
        <div className="w-[420px] bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <p className="text-sm font-semibold text-zinc-100">{title}</p>
            <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 px-3 py-2 bg-zinc-800/50 text-xs text-zinc-500 flex-wrap min-h-[32px]">
            <button onClick={() => navigateTo(-1)} className="hover:text-zinc-200 transition-colors">
              Root
            </button>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-zinc-700">›</span>
                <button
                  onClick={() => navigateTo(i)}
                  className={`hover:text-zinc-200 transition-colors ${
                    i === breadcrumbs.length - 1 ? "text-zinc-200" : ""
                  }`}
                >
                  {crumb}
                </button>
              </span>
            ))}
          </div>

          {/* File grid */}
          <div className="p-3 min-h-[200px] max-h-[280px] overflow-y-auto">
            {loading ? (
              <p className="text-sm text-zinc-500 py-6 text-center">Cargando…</p>
            ) : error ? (
              <p className="text-sm text-red-400 py-3 px-2">{error}</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-zinc-500 py-6 text-center">Carpeta vacía</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => navigate(entry)}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border text-center transition-colors ${
                      selected === entry.path
                        ? "border-zinc-500 bg-zinc-700"
                        : "border-zinc-700 bg-zinc-800 hover:border-zinc-600 hover:bg-zinc-700/50"
                    }`}
                  >
                    <span className="text-lg leading-none">{fileIcon(entry)}</span>
                    <span className="text-[9px] text-zinc-400 leading-tight break-all line-clamp-2">
                      {entry.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
            <p className="text-[10px] text-zinc-600 truncate flex-1 mr-2">
              {selected ? selected : "Haz clic en un archivo para seleccionarlo"}
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={!selected}
                className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 rounded-lg transition-colors"
              >
                Seleccionar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Commit**

  ```bash
  git add src/components/tools/FileBrowserPicker.tsx
  git commit -m "feat(tools): FileBrowserPicker modal component"
  ```

---

## Task 5: `SdkPickerModals` — ProjectPicker grid + new cases

**Files:**
- Modify: `src/components/tools/SdkPickerModals.tsx`

- [ ] **Add imports at the top of SdkPickerModals.tsx**

  Add to the existing imports:

  ```typescript
  import { useState } from "react";
  import { FileBrowserPicker } from "./FileBrowserPicker";
  import { toAssetUrl } from "../../lib/tauri";
  import { useInventoryStore } from "../../store/inventoryStore";
  import { ImportSourcePicker } from "../inventory/ImportSourcePicker";
  ```

- [ ] **Rewrite `SdkPickerModals` component to resolve inventory path before the switch**

  The `browseInventoryItemFiles` case needs the item's `installed_path` from the store. Because React hooks cannot be called inside a `switch` case, resolve the value at the top of the component before branching. Replace the entire `SdkPickerModals` function:

  ```typescript
  export function SdkPickerModals({ pending, onResolve }: Props) {
    // Resolve inventory item path at component level (before any branching).
    // Will be null if no item is pending or the item has no installed_path.
    const inventoryItems = useInventoryStore((s) => s.items);
    const inventoryItemRoot =
      pending?.method === "browseInventoryItemFiles"
        ? (inventoryItems.find((i) => i.id === (pending.args.itemId as number))?.installed_path ?? null)
        : null;

    if (!pending) return null;

    const cancel = () => onResolve(pending.callId, null);

    switch (pending.method) {
      case "selectProject":
        return <ProjectPicker callId={pending.callId} onResolve={onResolve} onCancel={cancel} />;
      case "selectScene":
        return (
          <ScenePicker
            callId={pending.callId}
            projectPath={pending.args.projectPath as string}
            onResolve={onResolve}
            onCancel={cancel}
          />
        );
      case "selectAvatar":
        return (
          <AvatarPicker
            callId={pending.callId}
            projectPath={pending.args.projectPath as string}
            scenePath={pending.args.scenePath as string}
            onResolve={onResolve}
            onCancel={cancel}
          />
        );
      case "importPackage":
        return <ImportPackagePicker callId={pending.callId} onResolve={onResolve} onCancel={cancel} />;
      case "browseProjectFiles":
        return (
          <FileBrowserPicker
            callId={pending.callId}
            root={pending.args.projectPath as string}
            title="Project files"
            onResolve={onResolve}
            onCancel={cancel}
          />
        );
      case "browseInventoryItemFiles":
        if (!inventoryItemRoot) { onResolve(pending.callId, null); return null; }
        return (
          <FileBrowserPicker
            callId={pending.callId}
            root={inventoryItemRoot}
            title="Item files"
            onResolve={onResolve}
            onCancel={cancel}
          />
        );
      default:
        onResolve(pending.callId, null);
        return null;
    }
  }
  ```

- [ ] **Replace `ProjectPicker` with the grid version**

  Remove the existing `ProjectPicker` function and replace with:

  ```typescript
  function ProjectPicker({
    callId,
    onResolve,
    onCancel,
  }: {
    callId: number;
    onResolve: (id: number, result: unknown) => void;
    onCancel: () => void;
  }) {
    const projects = useProjectsStore((s) => s.projects);
    const [search, setSearch] = useState("");

    const filtered = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.unity_path.toLowerCase().includes(search.toLowerCase())
    );

    return (
      <PickerModal title="Select project" onCancel={onCancel} wide>
        <div className="flex flex-col gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name or path…"
            autoFocus
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 outline-none"
          />
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">
              {projects.length === 0 ? "No hay proyectos registrados." : "Sin resultados."}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-0.5">
              {filtered.map((p) => {
                const imgSrc =
                  p.cover_image_path
                    ? toAssetUrl(p.cover_image_path)
                    : p.last_screenshot
                    ? toAssetUrl(p.last_screenshot)
                    : null;
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      onResolve(callId, {
                        path: p.unity_path,
                        name: p.name,
                        unity_version: p.unity_version ?? "",
                      })
                    }
                    className="flex flex-col bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-xl overflow-hidden transition-colors text-left"
                  >
                    <div className="relative w-full aspect-video bg-zinc-800 flex items-center justify-center">
                      {imgSrc ? (
                        <img src={imgSrc} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">🎮</span>
                      )}
                      {p.unity_version && (
                        <span className="absolute bottom-1 right-1.5 text-[8px] font-bold bg-black/60 text-zinc-400 rounded px-1 py-px">
                          {p.unity_version}
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-[10px] font-semibold text-zinc-100 truncate">{p.name}</p>
                      <p className="text-[9px] text-zinc-600 truncate">{p.unity_path}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PickerModal>
    );
  }
  ```

- [ ] **Add `ImportPackagePicker` and `useInventoryItemPath` helper**

  Add after `AvatarPicker`:

  ```typescript
  function ImportPackagePicker({
    callId,
    onResolve,
    onCancel,
  }: {
    callId: number;
    onResolve: (id: number, result: unknown) => void;
    onCancel: () => void;
  }) {
    // Fire-and-forget: once user picks a source, hand off to the normal import
    // flow by dispatching to the global import state, then resolve void.
    const handleSelect = (source: "scan" | "local" | "url") => {
      // Emit a custom event that the Inventory / app shell listens to
      window.dispatchEvent(new CustomEvent("vrcstudio:import-package", { detail: { source } }));
      onResolve(callId, null);
    };
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
        <ImportSourcePicker onSelect={handleSelect} onClose={onCancel} />
      </div>
    );
  }

  /** Returns the installed_path of an inventory item by ID, or null. */
  function useInventoryItemPath(itemId: number): string | null {
    const items = useInventoryStore((s) => s.items);
    return items.find((i) => i.id === itemId)?.installed_path ?? null;
  }
  ```

- [ ] **Update `PickerModal` to support a `wide` prop (400px instead of 384px)**

  In the `PickerModal` function signature add:

  ```typescript
  function PickerModal({
    title,
    children,
    onCancel,
    wide = false,
  }: {
    title: string;
    children: React.ReactNode;
    onCancel: () => void;
    wide?: boolean;
  }) {
  ```

  And update the modal div:

  ```typescript
  <div className={`${wide ? "w-[400px]" : "w-96"} bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden`}>
  ```

- [ ] **Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit 2>&1 | head -30
  ```

  Fix any type errors before committing.

- [ ] **Commit**

  ```bash
  git add src/components/tools/SdkPickerModals.tsx
  git commit -m "feat(tools): redesign ProjectPicker as image grid; add importPackage, browseFiles pickers"
  ```

---

## Task 6: `SdkBridge` — toolId injection + new preamble stubs

**Files:**
- Modify: `src/components/tools/SdkBridge.tsx`

- [ ] **Convert `SDK_BRIDGE_PREAMBLE` to a function that takes `toolId`**

  Replace the `const SDK_BRIDGE_PREAMBLE = \`...\`` with a function:

  ```typescript
  function buildSdkPreamble(toolId: string): string {
    return `
  (function() {
    'use strict';
    const _toolId = ${JSON.stringify(toolId)};
    let _callId = 0;
    const _pending = new Map();

    window.addEventListener('message', function(e) {
      if (!e.data || e.data.__vrcstudio_type !== 'sdk_response') return;
      const entry = _pending.get(e.data.callId);
      if (!entry) return;
      _pending.delete(e.data.callId);
      if (e.data.error) { entry.reject(new Error(e.data.error)); }
      else { entry.resolve(e.data.result); }
    });

    function _call(method, args) {
      return new Promise(function(resolve, reject) {
        const id = ++_callId;
        _pending.set(id, { resolve, reject });
        window.parent.postMessage(
          { __vrcstudio_type: 'sdk_call', callId: id, method: method, args: args || null },
          '*'
        );
      });
    }

    function _fire(method, args) {
      window.parent.postMessage(
        { __vrcstudio_type: 'sdk_call', callId: -1, method: method, args: args || null },
        '*'
      );
    }

    window.vrcstudio = {
      _toolId: _toolId,

      getProjects:              function()         { return _call('getProjects', null); },
      selectProject:            function()         { return _call('selectProject', null); },
      openProject:              function(p)        { return _call('openProject', { path: p }); },

      getScenes:                function(p)        { return _call('getScenes', { projectPath: p }); },
      selectScene:              function(p)        { return _call('selectScene', { projectPath: p }); },

      getAvatars:               function(p, s)     { return _call('getAvatars', { projectPath: p, scenePath: s }); },
      selectAvatar:             function(p, s)     { return _call('selectAvatar', { projectPath: p, scenePath: s }); },

      getInventoryItems:        function(f)        { return _call('getInventoryItems', f || {}); },
      selectInventoryItem:      function(f)        { return _call('selectInventoryItem', f || {}); },
      importInventoryItem:      function(id)       { return _call('importInventoryItem', { itemId: id }); },

      pickFile:                 function(o)        { return _call('pickFile', o || {}); },
      pickFolder:               function(t)        { return _call('pickFolder', { title: t || '' }); },

      importPackage:            function(o)        { return _call('importPackage', o || {}); },
      browseProjectFiles:       function(p)        { return _call('browseProjectFiles', { projectPath: p }); },
      browseInventoryItemFiles: function(id)       { return _call('browseInventoryItemFiles', { itemId: id }); },
      getProjectFiles:          function(p, f)     { return _call('getProjectFiles', { projectPath: p, filter: f || {} }); },
      runSidecar:               function(a)        { return _call('runSidecar', { args: a }); },

      notify:                   function(msg, o)   { _fire('notify', { message: msg, options: o || {} }); },
      setProgress:              function(p, l)     { _fire('setProgress', { progress: p, label: l || '' }); },
    };

    console.log('[VRC Studio SDK] window.vrcstudio ready — toolId:', _toolId);
  })();
  `;
  }
  ```

- [ ] **Update `SdkBridge` props and srcdoc to pass `toolId`**

  Add `toolId` to `Props`:

  ```typescript
  interface Props {
    bundlePath: string;
    toolId: string;
    onSdkCall: (callId: number, method: string, args: unknown) => void;
    className?: string;
  }
  ```

  In the component body, replace the `SDK_BRIDGE_PREAMBLE` reference:

  ```typescript
  const srcdoc = `<!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: transparent; }
    body { font-family: system-ui, -apple-system, sans-serif; }
  </style>
  <script>${buildSdkPreamble(toolId)}</script>
  </head>
  <body>
  <div id="root"></div>
  <script src="${assetUrl}"></script>
  </body>
  </html>`;
  ```

- [ ] **Commit**

  ```bash
  git add src/components/tools/SdkBridge.tsx
  git commit -m "feat(sdk-bridge): inject toolId into preamble; add 5 new SDK method stubs"
  ```

---

## Task 7: `ToolRunner` — new SDK handlers + `bypassSdk` prop

**Files:**
- Modify: `src/components/tools/ToolRunner.tsx`

- [ ] **Add `bypassSdk` prop and new imports**

  Update `Props`:

  ```typescript
  interface Props {
    tool: InstalledTool;
    onBack: () => void;
    bypassSdk?: boolean;
  }
  ```

  Add imports:

  ```typescript
  import { tauriListDir } from "../../lib/tauri";
  import { useInventoryStore } from "../../store/inventoryStore";
  ```

- [ ] **Pass `toolId` to `SdkBridge`**

  In the iframe-based runner JSX, update `<SdkBridge>`:

  ```tsx
  <SdkBridge
    ref={bridgeRef}
    bundlePath={bundlePath}
    toolId={tool.id}
    onSdkCall={handleIframeSdkCall}
    className="flex-1"
  />
  ```

- [ ] **Add new non-interactive handlers in `handleIframeSdkCall`**

  In the `// Non-interactive → resolve immediately` section, add after the `getAvatars` block:

  ```typescript
  } else if (method === "getProjectFiles") {
    const entries = await tauriListDir(a.projectPath as string, "");
    const filter = a.filter as { extensions?: string[] } | undefined;
    result = filter?.extensions?.length
      ? entries.filter((e) => !e.is_dir && filter.extensions!.includes(e.extension ?? ""))
      : entries;
  } else if (method === "runSidecar") {
    result = await tauriToolsRunSidecar(tool.id, (a.args ?? {}) as Record<string, unknown>);
  }
  ```

- [ ] **Add new interactive methods to `INTERACTIVE_METHODS` set**

  ```typescript
  const INTERACTIVE_METHODS = new Set([
    "selectProject",
    "selectScene",
    "selectAvatar",
    "selectInventoryItem",
    "pickFile",
    "pickFolder",
    "importPackage",
    "browseProjectFiles",
    "browseInventoryItemFiles",
  ]);
  ```

- [ ] **Pass `bypassSdk` to embedded AvatarPerf**

  In the embedded runner JSX:

  ```tsx
  <AvatarPerf
    toolId={tool.id}
    onBack={onBack}
    onInteractive={handleEmbeddedInteractive}
    bypassSdk={bypassSdk ?? false}
  />
  ```

- [ ] **Commit**

  ```bash
  git add src/components/tools/ToolRunner.tsx
  git commit -m "feat(tools): ToolRunner handles runSidecar, getProjectFiles, browseFiles; passes bypassSdk"
  ```

---

## Task 8: `AvatarPerf` — use SDK internally + `bypassSdk`

**Files:**
- Modify: `src/components/tools/runners/AvatarPerf.tsx`

- [ ] **Add `onInteractive` and `bypassSdk` to Props**

  ```typescript
  interface Props {
    toolId: string;
    onBack: () => void;
    onInteractive: (method: string, args: Record<string, unknown>) => Promise<unknown>;
    bypassSdk?: boolean;
  }
  ```

- [ ] **Import `useEmbeddedSdk`**

  ```typescript
  import { useEmbeddedSdk } from "../../../hooks/useEmbeddedSdk";
  ```

- [ ] **Wire SDK in component body**

  At the top of `AvatarPerf`, after the state declarations:

  ```typescript
  const sdk = useEmbeddedSdk(onInteractive);
  ```

- [ ] **Replace direct Tauri calls with SDK calls (when `bypassSdk` is false)**

  Replace `handleSelectProject`:

  ```typescript
  const handleSelectProject = async () => {
    setError(null);
    setLoading(true);
    try {
      const selected = bypassSdk
        ? null  // fallback: keep old list UI below
        : await sdk.selectProject();
      if (!selected) { setLoading(false); return; }
      setSelectedProjectPath(selected.path);
      setSelectedProjectName(selected.name);
      const found = bypassSdk
        ? await tauriToolsScanScenes(selected.path)
        : await sdk.getScenes(selected.path);
      setScenes(found);
      setStep("scene");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  ```

  Replace `handleSelectScene`:

  ```typescript
  const handleSelectScene = async (scene: SceneFile) => {
    setSelectedScene(scene);
    setError(null);
    setLoading(true);
    try {
      const found = bypassSdk
        ? await tauriToolsScanAvatars(selectedProjectPath, scene.path)
        : await sdk.getAvatars(selectedProjectPath, scene.path);
      setAvatars(found);
      setStep("avatar");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  ```

  > **Note:** When `bypassSdk` is false and the user clicks a project button in the list, call `handleSelectProject()` instead of directly passing the path — the SDK picker handles project selection. Consider hiding the project list when `bypassSdk` is false and auto-triggering `handleSelectProject` on mount.

- [ ] **Update project selection step UI**

  When `!bypassSdk`, replace the project list with a single button:

  ```tsx
  {!loading && !error && step === "project" && (
    <div className="flex-1 flex items-center justify-center p-6">
      {bypassSdk ? (
        // existing project list JSX
        <div className="flex flex-col gap-2 max-w-xl w-full">
          {/* ... existing project list ... */}
        </div>
      ) : (
        <button
          onClick={handleSelectProject}
          className="px-6 py-3 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-xl text-sm font-medium text-zinc-200 transition-colors"
        >
          Seleccionar proyecto…
        </button>
      )}
    </div>
  )}
  ```

- [ ] **Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit 2>&1 | head -30
  ```

- [ ] **Commit**

  ```bash
  git add src/components/tools/runners/AvatarPerf.tsx
  git commit -m "feat(tools): AvatarPerf uses useEmbeddedSdk; bypassSdk prop for direct Tauri fallback"
  ```

---

## Task 9: Debug settings section

**Files:**
- Create: `src/components/settings/DebugSection.tsx`
- Modify: `src/components/settings/ToolsSection.tsx`

- [ ] **Create `DebugSection.tsx`**

  ```typescript
  // src/components/settings/DebugSection.tsx
  import { useState, useEffect } from "react";
  import { tauriGetAppSettings, tauriSetAppSettings } from "../../lib/tauri";

  export function DebugSection() {
    const [useSdkInternally, setUseSdkInternally] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      tauriGetAppSettings().then((s) => setUseSdkInternally(s.use_sdk_internally ?? true));
    }, []);

    const toggle = async () => {
      setSaving(true);
      try {
        const current = await tauriGetAppSettings();
        await tauriSetAppSettings({ ...current, use_sdk_internally: !useSdkInternally });
        setUseSdkInternally((v) => !v);
      } catch (e) {
        console.error("Failed to save use_sdk_internally:", e);
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Debug</p>
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl">
          <div>
            <p className="text-sm font-medium text-zinc-200">Use SDK internally</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Embedded tools (AvatarPerf) route calls through the SDK picker modals. Disable to revert to direct Tauri calls.
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={saving}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              useSdkInternally ? "bg-zinc-400" : "bg-zinc-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                useSdkInternally ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Mount `DebugSection` in `ToolsSection.tsx`**

  At the bottom of the `ToolsSection` component return, after the registry branch input:

  ```tsx
  <DebugSection />
  ```

  And add the import:

  ```typescript
  import { DebugSection } from "./DebugSection";
  ```

- [ ] **Commit**

  ```bash
  git add src/components/settings/DebugSection.tsx src/components/settings/ToolsSection.tsx
  git commit -m "feat(settings): add Debug section with use_sdk_internally toggle"
  ```

---

## Task 10: `ToolRunner` — read `use_sdk_internally` from settings

**Files:**
- Modify: `src/components/tools/ToolRunner.tsx`

- [ ] **Read setting and pass to AvatarPerf**

  Add to `ToolRunner`:

  ```typescript
  import { useState, useEffect } from "react";
  import { tauriGetAppSettings } from "../../lib/tauri";

  // Inside ToolRunner component:
  const [useSdkInternally, setUseSdkInternally] = useState(true);

  useEffect(() => {
    tauriGetAppSettings()
      .then((s) => setUseSdkInternally(s.use_sdk_internally ?? true))
      .catch(() => {});
  }, []);
  ```

  Then pass `bypassSdk={!useSdkInternally}` to the embedded `AvatarPerf`.

- [ ] **Verify full TypeScript compile**

  ```bash
  npx tsc --noEmit 2>&1 | head -40
  ```

  Fix all type errors.

- [ ] **Commit**

  ```bash
  git add src/components/tools/ToolRunner.tsx
  git commit -m "feat(tools): ToolRunner reads use_sdk_internally and passes bypassSdk to embedded tools"
  ```

---

## Task 11: SDK HTTP server — `list-dir` route

**Files:**
- Modify: `src-tauri/src/tools/sdk_server.rs`

- [ ] **Add `/sdk/list-dir` route**

  In `sdk_server.rs`, add the route to the router:

  ```rust
  .route("/sdk/list-dir", post(handle_list_dir))
  ```

  Add the handler:

  ```rust
  #[derive(Deserialize)]
  struct ListDirBody {
      root: String,
      #[serde(default)]
      sub_path: String,
  }

  async fn handle_list_dir(
      State(state): State<Arc<SdkServerState>>,
      headers: HeaderMap,
      Json(body): Json<ListDirBody>,
  ) -> Result<Json<serde_json::Value>, StatusCode> {
      if !check_token(&headers, &state.token) {
          return Err(StatusCode::UNAUTHORIZED);
      }
      use crate::commands::tools::{FileEntry, tools_list_dir};
      match tools_list_dir(body.root, body.sub_path) {
          Ok(entries) => Ok(Json(serde_json::json!({ "entries": entries }))),
          Err(e) => Ok(Json(serde_json::json!({ "error": e.to_string() }))),
      }
  }
  ```

  > **Note:** `tools_list_dir` is a sync function. Calling it inside an async handler is fine for filesystem ops — no need to spawn a blocking task for directory listings.

- [ ] **Build check**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -20
  ```

- [ ] **Commit**

  ```bash
  git add src-tauri/src/tools/sdk_server.rs
  git commit -m "feat(sdk-server): add /sdk/list-dir route for sidecar file browsing"
  ```

---

## Task 12 (Block F): Fix avatar detection bug

**Files:**
- Modify: `src-tauri/src/commands/tools.rs`

**Context:** The current `tools_scan_avatars` heuristic checks `viewPosition:` + `lipSync:` to identify `VRC_AvatarDescriptor` components (class ID 114). This misses avatars where `lipSync` mode is set to 0 (VisemeParameterOnly) or where the field order differs. A more reliable check adds `VRC_AvatarDescriptor` script name detection and removes the dependency on `lipSync:`.

- [ ] **Update `tools_scan_avatars` in `tools.rs`**

  Replace the `is_avatar_descriptor` line inside `tools_scan_avatars`:

  ```rust
  // OLD (fragile):
  // let is_avatar_descriptor = doc_text.contains("viewPosition:")
  //     && (doc_text.contains("lipSync:") || doc_text.contains("customEyeLookSettings:"));

  // NEW: check for VRC_AvatarDescriptor by script name OR by the viewPosition field
  // combined with at least one other avatar-specific field.
  let is_avatar_descriptor = doc_text.contains("VRC_AvatarDescriptor")
      || (doc_text.contains("viewPosition:")
          && (doc_text.contains("lipSync:")
              || doc_text.contains("customEyeLookSettings:")
              || doc_text.contains("enableEyeLook:")
              || doc_text.contains("AnimationLayers:")));
  ```

- [ ] **Build and run unit check**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -20
  ```

- [ ] **Commit**

  ```bash
  git add src-tauri/src/commands/tools.rs
  git commit -m "fix(tools): improve VRC_AvatarDescriptor detection for Unity 2022 scene files"
  ```

---

## Task 13: Final integration build

- [ ] **Run full Tauri build check**

  ```bash
  cd src-tauri && cargo check 2>&1 | tail -5
  ```

  Expected: `Finished` with 0 errors.

- [ ] **Run TypeScript check**

  ```bash
  npx tsc --noEmit 2>&1 | tail -10
  ```

  Expected: 0 errors.

- [ ] **Dev run — smoke test**

  Start the app in dev mode and verify:
  - `selectProject()` picker opens as a 3-column image grid with search
  - Projects with cover images show them; those without show the 🎮 emoji
  - `browseProjectFiles()` (trigger via AvatarPerf if SDK mode is on) opens the file browser
  - Settings → Debug shows the "Use SDK internally" toggle, persists across restart
  - AvatarPerf respects the toggle (SDK mode opens pickers; bypass calls Tauri directly)

- [ ] **Final commit**

  ```bash
  git add -A
  git commit -m "chore(tools): SDK v2 — integration complete (pickers, self-SDK, bug fix)"
  ```
