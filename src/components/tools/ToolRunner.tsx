// src/components/tools/ToolRunner.tsx
//
// Top-level runner for installed tools.
// - Tools with a downloaded ui.js bundle → rendered in an iframe via SdkBridge.
// - Embedded tools (like AvatarPerf, which has no separate bundle) → rendered inline,
//   but still get SDK picker support via the same SdkPickerModals.

import { useRef, useCallback, useState, useEffect } from "react";
import { SdkBridge, SdkBridgeHandle } from "./SdkBridge";
import { SdkPickerModals, PendingCall } from "./SdkPickerModals";
import {
  tauriToolsScanScenes,
  tauriToolsScanAvatars,
  tauriListDir,
  tauriToolsRunSidecar,
  tauriGetAppSettings,
  InstalledTool,
} from "../../lib/tauri";
import { useProjectsStore } from "../../store/projects";

interface Props {
  tool: InstalledTool;
  onBack: () => void;
  bypassSdk?: boolean;
}

// Methods that require interactive picker UI in the parent app.
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

export function ToolRunner({ tool, onBack, bypassSdk }: Props) {
  const bridgeRef = useRef<SdkBridgeHandle>(null);
  const projects = useProjectsStore((s) => s.projects);

  // ── Task 10: read use_sdk_internally from settings ────────────────────
  const [useSdkInternally, setUseSdkInternally] = useState(true);

  useEffect(() => {
    tauriGetAppSettings()
      .then((s) => setUseSdkInternally(s.use_sdk_internally ?? true))
      .catch(() => {});
  }, []);

  // ── State for iframe SDK calls ─────────────────────────────────────────
  const [iframePending, setIframePending] = useState<PendingCall | null>(null);

  // ── State for embedded tool SDK calls ─────────────────────────────────
  const [embeddedPending, setEmbeddedPending] = useState<{
    callId: number;
    method: string;
    args: Record<string, unknown>;
    resolve: (result: unknown) => void;
  } | null>(null);

  // ── Handler for iframe bridge SDK calls ───────────────────────────────
  const handleIframeSdkCall = useCallback(
    async (callId: number, method: string, args: unknown) => {
      const a = (args ?? {}) as Record<string, unknown>;

      // Fire-and-forget (callId === -1)
      if (callId === -1) {
        if (method === "notify") {
          console.info("[SDK notify]", (a as { message?: unknown }).message);
        }
        if (method === "setProgress") {
          // Progress updates forwarded via Tauri events from the sidecar; handled in toolsStore
        }
        return;
      }

      // Interactive → show picker modal
      if (INTERACTIVE_METHODS.has(method)) {
        setIframePending({ callId, method, args: a });
        return;
      }

      // Non-interactive → resolve immediately
      try {
        let result: unknown = null;

        if (method === "getProjects") {
          result = projects.map((p) => ({
            path: p.unity_path,
            name: p.name,
            unity_version: p.unity_version ?? "",
          }));
        } else if (method === "getScenes") {
          result = await tauriToolsScanScenes(a.projectPath as string);
        } else if (method === "getAvatars") {
          result = await tauriToolsScanAvatars(
            a.projectPath as string,
            a.scenePath as string
          );
        } else if (method === "openProject") {
          // TODO: call tauriOpenInUnity once that command is available
          result = null;
        } else if (method === "getProjectFiles") {
          const { projectPath, filter } = a as { projectPath: string; filter?: { extensions?: string[] } };
          const entries = await tauriListDir(projectPath, "");
          result = filter?.extensions?.length
            ? entries.filter((e) => !e.is_dir && filter.extensions!.includes(e.extension ?? ""))
            : entries;
        } else if (method === "runSidecar") {
          result = await tauriToolsRunSidecar(tool.id, (a as { args: Record<string, unknown> }).args ?? {});
        }

        bridgeRef.current?.respond(callId, result);
      } catch (e) {
        bridgeRef.current?.respondError(callId, String(e));
      }
    },
    [projects, tool.id]
  );

  // ── Resolver for iframe picker selections ─────────────────────────────
  const handleIframePickerResolve = useCallback(
    (callId: number, result: unknown) => {
      setIframePending(null);
      bridgeRef.current?.respond(callId, result);
    },
    []
  );

  // ── Handler for embedded tool interactive SDK calls ───────────────────
  const handleEmbeddedInteractive = useCallback(
    (method: string, args: Record<string, unknown>): Promise<unknown> => {
      return new Promise((resolve) => {
        // Use a stable pseudo callId for embedded modals
        setEmbeddedPending({ callId: 0, method, args, resolve });
      });
    },
    []
  );

  // ── Resolver for embedded picker selections ───────────────────────────
  const handleEmbeddedPickerResolve = useCallback(
    (_callId: number, result: unknown) => {
      if (embeddedPending) {
        embeddedPending.resolve(result);
        setEmbeddedPending(null);
      }
    },
    [embeddedPending]
  );

  // ── Determine which runner to use ─────────────────────────────────────
  // If the tool has no downloaded ui.js bundle (or is a known embedded tool),
  // fall back to the embedded React component.
  const bundlePath = tool.metadata?.downloads?.ui_bundle || "";
  const isEmbedded = !bundlePath || tool.id === "avatar-performance-analyzer";

  if (isEmbedded) {
    // Lazy import to avoid circular dependency issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AvatarPerf } = require("./runners/AvatarPerf") as {
      AvatarPerf: React.ComponentType<{
        toolId: string;
        onBack: () => void;
        onInteractive: (method: string, args: Record<string, unknown>) => Promise<unknown>;
        bypassSdk?: boolean;
      }>;
    };

    const embeddedPickerPending = embeddedPending
      ? { callId: embeddedPending.callId, method: embeddedPending.method, args: embeddedPending.args }
      : null;

    return (
      <div className="flex flex-col h-full relative">
        <SdkPickerModals
          pending={embeddedPickerPending}
          onResolve={handleEmbeddedPickerResolve}
        />
        <AvatarPerf
          toolId={tool.id}
          onBack={onBack}
          onInteractive={handleEmbeddedInteractive}
          bypassSdk={!useSdkInternally}
        />
      </div>
    );
  }

  // Iframe-based runner for tools with a downloaded bundle
  return (
    <div className="flex flex-col h-full relative">
      {/* Picker modals rendered above the iframe */}
      <SdkPickerModals
        pending={iframePending}
        onResolve={handleIframePickerResolve}
      />

      <SdkBridge
        ref={bridgeRef}
        bundlePath={bundlePath}
        toolId={tool.id}
        onSdkCall={handleIframeSdkCall}
        className="flex-1"
      />
    </div>
  );
}