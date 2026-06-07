// src/components/tools/SdkBridge.tsx
//
// Renders an iframe with the tool's ui.js bundle.
// Injects `window.vrcstudio` via a preamble script before the bundle runs.
// SDK calls come in as postMessage events; responses go back the same way.

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";

export interface SdkBridgeHandle {
  /** Send a SDK response back to the iframe */
  respond(callId: number, result: unknown): void;
  /** Send an error response back to the iframe */
  respondError(callId: number, error: string): void;
}

interface Props {
  /** Absolute path to the tool's ui.js bundle on disk (AppData) */
  bundlePath: string;
  /** Tool identifier injected into the SDK preamble */
  toolId: string;
  /** Called when the iframe posts an SDK call */
  onSdkCall: (callId: number, method: string, args: unknown) => void;
  className?: string;
}

/** Prevents a JSON-stringified value from breaking out of a <script> tag in srcdoc HTML. */
function escapeScriptTag(jsonStr: string): string {
  return jsonStr.replace(/<\//gi, "<\\/");
}

/**
 * Builds the JavaScript preamble injected BEFORE the tool's ui.js runs inside the iframe.
 * Sets up window.vrcstudio with all SDK methods as postMessage bridges.
 * Injects the toolId into the preamble so tools can identify themselves.
 */
function buildSdkPreamble(toolId: string): string {
  return `
(function() {
  'use strict';
  const _toolId = ${escapeScriptTag(JSON.stringify(toolId))};
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

export const SdkBridge = forwardRef<SdkBridgeHandle, Props>(
  ({ bundlePath, toolId, onSdkCall, className }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useImperativeHandle(ref, () => ({
      respond(callId: number, result: unknown) {
        iframeRef.current?.contentWindow?.postMessage(
          { __vrcstudio_type: "sdk_response", callId, result },
          "*"
        );
      },
      respondError(callId: number, error: string) {
        iframeRef.current?.contentWindow?.postMessage(
          { __vrcstudio_type: "sdk_response", callId, result: null, error },
          "*"
        );
      },
    }));

    // Listen for SDK calls from the iframe
    const handleMessage = useCallback(
      (e: MessageEvent) => {
        if (!e.data || e.data.__vrcstudio_type !== "sdk_call") return;
        const { callId, method, args } = e.data;
        onSdkCall(callId as number, method as string, args);
      },
      [onSdkCall]
    );

    useEffect(() => {
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [handleMessage]);

    // Build the srcdoc: inject preamble then load ui.js via asset:// protocol.
    // Tauri's asset protocol serves files from disk: asset://localhost/{absolute_path}
    // Memoized so React doesn't reload the iframe on unrelated re-renders.
    const srcdoc = useMemo(() => {
      const normalizedPath = bundlePath.replace(/\\/g, "/");
      const assetUrl = `asset://localhost/${normalizedPath}`;
      return `<!DOCTYPE html>
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
    }, [bundlePath, toolId]);

    return (
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-same-origin"
        className={className}
        style={{ border: "none", background: "transparent", width: "100%", height: "100%" }}
        title="Tool UI"
      />
    );
  }
);

SdkBridge.displayName = "SdkBridge";