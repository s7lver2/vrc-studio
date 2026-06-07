// src/components/tools/SdkPickerModals.tsx
//
// Renders the correct picker modal for whichever interactive SDK call is pending.
// Used by both the iframe bridge (ToolRunner) and embedded tool components (useEmbeddedSdk).

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useProjectsStore } from "../../store/projects";
import { useInventoryStore } from "../../store/inventoryStore";
import { FileBrowserPicker } from "./FileBrowserPicker";
import { ImportSourcePicker } from "../inventory/ImportSourcePicker";
import { tauriToolsScanScenes, tauriToolsScanAvatars, SceneFile, AvatarDescriptor } from "../../lib/tauri";
import { toAssetUrl } from "../../lib/utils";

export interface PendingCall {
  callId: number;
  method: string;
  args: Record<string, unknown>;
}

interface Props {
  pending: PendingCall | null;
  onResolve: (callId: number, result: unknown) => void;
}

export function SdkPickerModals({ pending, onResolve }: Props) {
  // Resolve inventory item path at component level (hooks can't be called in switch cases).
  const inventoryItems = useInventoryStore((s) => s.items);
  const inventoryItemRoot =
    pending?.method === "browseInventoryItemFiles"
      ? (inventoryItems.find((i) => i.id === (pending.args.itemId as string))?.local_path ?? null)
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
      // Unknown interactive call — resolve with null immediately
      onResolve(pending.callId, null);
      return null;
  }
}

// ── Project picker ────────────────────────────────────────────────────────

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

// ── Scene picker ──────────────────────────────────────────────────────────

function ScenePicker({
  callId,
  projectPath,
  onResolve,
  onCancel,
}: {
  callId: number;
  projectPath: string;
  onResolve: (id: number, result: unknown) => void;
  onCancel: () => void;
}) {
  const [scenes, setScenes] = useState<SceneFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setLoading(false);
      setError("No se especificó ruta del proyecto.");
      return;
    }
    tauriToolsScanScenes(projectPath)
      .then(setScenes)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectPath]);

  return (
    <PickerModal title="Seleccionar escena" onCancel={onCancel}>
      {loading ? (
        <p className="text-sm text-zinc-500 py-6 text-center">Buscando escenas…</p>
      ) : error ? (
        <p className="text-sm text-red-400 py-3 px-2">{error}</p>
      ) : scenes.length === 0 ? (
        <p className="text-sm text-zinc-500 py-6 text-center">
          No se encontraron archivos .unity en el proyecto.
        </p>
      ) : (
        <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
          {scenes.map((s) => (
            <button
              key={s.path}
              onClick={() => onResolve(callId, { path: s.path, name: s.name })}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-800 text-left transition-colors"
            >
              <span className="text-base shrink-0">🎬</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-100 truncate">{s.name}</p>
                <p className="text-[10px] text-zinc-500 truncate">{s.path}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </PickerModal>
  );
}

// ── Avatar picker ─────────────────────────────────────────────────────────

function AvatarPicker({
  callId,
  projectPath,
  scenePath,
  onResolve,
  onCancel,
}: {
  callId: number;
  projectPath: string;
  scenePath: string;
  onResolve: (id: number, result: unknown) => void;
  onCancel: () => void;
}) {
  const [avatars, setAvatars] = useState<AvatarDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath || !scenePath) {
      setLoading(false);
      setError("Faltan parámetros de proyecto o escena.");
      return;
    }
    tauriToolsScanAvatars(projectPath, scenePath)
      .then(setAvatars)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectPath, scenePath]);

  return (
    <PickerModal title="Seleccionar avatar" onCancel={onCancel}>
      {loading ? (
        <p className="text-sm text-zinc-500 py-6 text-center">Detectando avatares…</p>
      ) : error ? (
        <p className="text-sm text-red-400 py-3 px-2">{error}</p>
      ) : avatars.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-2xl">
            🔍
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-300">No se encontraron avatares</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-xs px-2">
              La escena no contiene GameObjects con{" "}
              <span className="font-mono text-zinc-400">VRC_AvatarDescriptor</span>.
              Comprueba que el avatar está configurado con el SDK de VRChat.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
          {avatars.map((av) => (
            <button
              key={av.file_id}
              onClick={() => onResolve(callId, { name: av.name, file_id: av.file_id })}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-800 text-left transition-colors"
            >
              <span className="text-base shrink-0">🧍</span>
              <p className="text-sm font-medium text-zinc-100">{av.name}</p>
            </button>
          ))}
        </div>
      )}
    </PickerModal>
  );
}

// ── Import package picker ─────────────────────────────────────────────────

function ImportPackagePicker({
  callId,
  onResolve,
  onCancel,
}: {
  callId: number;
  onResolve: (id: number, result: unknown) => void;
  onCancel: () => void;
}) {
  const handleSelect = (_source: "scan" | "local" | "url") => {
    window.dispatchEvent(new CustomEvent("vrcstudio:import-package", { detail: { source: _source } }));
    onResolve(callId, null);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
      <ImportSourcePicker onSelect={handleSelect} onClose={onCancel} />
    </div>
  );
}

// ── Shared modal shell ────────────────────────────────────────────────────

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
      <div className={`${wide ? "w-[400px]" : "w-96"} bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <p className="text-sm font-semibold text-zinc-100">{title}</p>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}
