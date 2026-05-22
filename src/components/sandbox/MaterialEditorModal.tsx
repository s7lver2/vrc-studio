// src/components/sandbox/MaterialEditorModal.tsx
/**
 * MaterialEditorModal — editor completo de materiales.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │ Header: nombre del slot + acciones           │
 *   ├──────────────┬──────────────────────────────┤
 *   │              │                              │
 *   │  3D Viewer   │   Node Editor (canvas SVG)   │
 *   │  (esquina)   │                              │
 *   │              │                              │
 *   └──────────────┴──────────────────────────────┘
 *
 * El visor 3D es una esfera que refleja los cambios del nodo Output.
 * El editor de nodos permite conectar color, texturas y parámetros PBR.
 */
import { useState, useRef, useEffect } from "react";
import { X, Save, HardDrive, Package, Upload } from "lucide-react";
import { useMaterialEditorStore } from "@/store/materialEditorStore";
import { MaterialNodeEditor } from "./MaterialNodeEditor";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { useSandboxStore } from "@/store/sandboxStore";
import type { VrcSmatFile } from "@/types/vrcsmat";
import type { VrcSmatNode, VrcSmatConnection } from "@/types/vrcsmat";

interface Props {
  slotIndex: number;
  viewerRef: React.RefObject<any>;
  onClose: () => void;
}

/** Picker de fuente de textura: disco duro vs. asset del inventario */
function TextureSourcePicker({
  onFromDisk,
  onFromAsset,
  onCancel,
}: {
  onFromDisk: () => void;
  onFromAsset: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[480px] rounded-2xl border border-zinc-800 bg-zinc-950 p-8 flex flex-col items-center gap-6">
        <h3 className="text-sm font-semibold text-zinc-200">Import Texture</h3>
        <p className="text-xs text-zinc-500">Where do you want to import the texture from?</p>
        <div className="flex gap-6 w-full">
          {/* Disco duro */}
          <button
            onClick={onFromDisk}
            className="flex-1 flex flex-col items-center gap-4 p-6 rounded-2xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-all group"
          >
            <HardDrive className="h-12 w-12 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-300">My Computer</p>
              <p className="text-[10px] text-zinc-600 mt-1">Browse local files</p>
            </div>
          </button>
          {/* Asset del inventario */}
          <button
            onClick={onFromAsset}
            className="flex-1 flex flex-col items-center gap-4 p-6 rounded-2xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-all group"
          >
            <Package className="h-12 w-12 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-300">Inventory Asset</p>
              <p className="text-[10px] text-zinc-600 mt-1">Files from the item</p>
            </div>
          </button>
        </div>
        <button onClick={onCancel} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Mini visor 3D de la esfera de material */
function MaterialPreviewSphere({
  viewerRef,
  slotIndex,
}: {
  viewerRef: React.RefObject<any>;
  slotIndex: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const THREE = viewerRef.current?.THREE;
    const model = viewerRef.current?.model;
    if (!canvasRef.current || !THREE || !model) return;
    let alive = true;

    (async () => {
      try {
        // Obtener el material del slot
        let sourceMat: any = null;
        let idx = 0;
        model.traverse((child: any) => {
          if (!child.isMesh) return;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m: any) => {
            if (idx === slotIndex) sourceMat = m;
            idx++;
          });
        });
        if (!sourceMat) return;

        const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current!, antialias: true, alpha: true });
        renderer.setSize(180, 180);
        renderer.setPixelRatio(1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
        camera.position.z = 2.2;
        scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        const key = new THREE.DirectionalLight(0xffffff, 2.5);
        key.position.set(2, 3, 3);
        scene.add(key);

        const mat = sourceMat.clone();
        const TEX_PROPS = ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','alphaMap','bumpMap'];
        TEX_PROPS.forEach((p) => { if (mat[p]?.isTexture) mat[p].needsUpdate = true; });
        mat.needsUpdate = true;

        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromScene(new (THREE as any).RoomEnvironment()).texture;
        scene.environment = env;
        if (mat.isMeshStandardMaterial) { mat.envMap = env; mat.envMapIntensity = 0.7; }

        const geo = new THREE.SphereGeometry(0.75, 64, 64);
        scene.add(new THREE.Mesh(geo, mat));

        // Render + OrbitControls ligero para rotar
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js" as any);
        const orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableZoom = false;
        orbit.enablePan = false;
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.1;

        const loop = () => {
          if (!alive) return;
          requestAnimationFrame(loop);
          orbit.update();
          renderer.render(scene, camera);
        };
        loop();

        return () => {
          alive = false;
          renderer.dispose();
          geo.dispose();
          pmrem.dispose();
        };
      } catch {}
    })();

    return () => { alive = false; };
  }, [viewerRef, slotIndex]);

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={180}
      className="rounded-xl border border-zinc-800"
    />
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function MaterialEditorModal({ slotIndex, viewerRef, onClose }: Props) {
  const { slotName, dirty, close } = useMaterialEditorStore();
  const { baseItem } = useSandboxStore();
  const [showTexturePicker, setShowTexturePicker] = useState(false);
  const [showAssetFilePicker, setShowAssetFilePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleClose = () => {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Close anyway?")) return;
    }
    close();
    onClose();
  };

  // ── Initialize nodes from the actual model material ──────────────────────
  useEffect(() => {
    const model = viewerRef.current?.model;
    if (!model) return;

    // Find the material at slotIndex
    let sourceMat: any = null;
    let idx = 0;
    model.traverse((child: any) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m: any) => {
        if (idx === slotIndex && sourceMat === null) sourceMat = m;
        idx++;
      });
    });
    if (!sourceMat) return;

    const newNodes: VrcSmatNode[] = [];
    const newConns: VrcSmatConnection[] = [];

    // Output node — always present
    newNodes.push({ id: "output", type: "output", pos: { x: 520, y: 180 }, data: {} });

    let y = 60;

    // Color
    const colorHex = sourceMat.color ? "#" + sourceMat.color.getHexString() : "#888888";
    newNodes.push({ id: "color-1", type: "color", pos: { x: 80, y }, data: { hex: colorHex } });
    newConns.push({ fromNodeId: "color-1", fromOutput: "color", toNodeId: "output", toInput: "albedo" });
    y += 130;

    // Albedo texture map
    if (sourceMat.map) {
      // Try to get original filename from Texture.name (set by FBXLoader/GLTFLoader)
      // or fall back to extracting it from the image src blob URL userData
      const rawName: string = sourceMat.map.name ?? sourceMat.map.userData?.filename ?? "";
      const filename = rawName.split("/").pop()?.split("\\").pop()?.replace(/\?.*$/, "") || "Albedo Texture";
      newNodes.push({ id: "tex-albedo", type: "texture", pos: { x: 80, y }, data: { filename } });
      newConns.push({ fromNodeId: "tex-albedo", fromOutput: "texture", toNodeId: "output", toInput: "albedo" });
      y += 130;
    }

    // Normal map
    if (sourceMat.normalMap) {
      const rawName: string = sourceMat.normalMap.name ?? sourceMat.normalMap.userData?.filename ?? "";
      const filename = rawName.split("/").pop()?.split("\\").pop()?.replace(/\?.*$/, "") || "Normal Map";
      newNodes.push({ id: "normal-1", type: "normal_map", pos: { x: 300, y: 60 }, data: { filename } });
      newConns.push({ fromNodeId: "normal-1", fromOutput: "normal", toNodeId: "output", toInput: "normal" });
    }

    // Roughness
    if (typeof sourceMat.roughness === "number") {
      newNodes.push({ id: "rough-1", type: "roughness", pos: { x: 80, y }, data: { value: sourceMat.roughness } });
      newConns.push({ fromNodeId: "rough-1", fromOutput: "value", toNodeId: "output", toInput: "roughness" });
      y += 130;
    }

    // Metalness
    if (typeof sourceMat.metalness === "number") {
      newNodes.push({ id: "metal-1", type: "metalness", pos: { x: 80, y }, data: { value: sourceMat.metalness } });
      newConns.push({ fromNodeId: "metal-1", fromOutput: "value", toNodeId: "output", toInput: "metalness" });
      y += 130;
    }

    // Emission
    if (sourceMat.emissive && typeof sourceMat.emissiveIntensity === "number" && sourceMat.emissiveIntensity > 0) {
      const emHex = "#" + sourceMat.emissive.getHexString();
      newNodes.push({ id: "emission-1", type: "emission", pos: { x: 300, y: 200 }, data: { hex: emHex, intensity: sourceMat.emissiveIntensity } });
      newConns.push({ fromNodeId: "emission-1", fromOutput: "color", toNodeId: "output", toInput: "emission" });
    }

    useMaterialEditorStore.getState().setNodes(newNodes);
    useMaterialEditorStore.getState().setConnections(newConns);
  }, [slotIndex, viewerRef]);

  const handleImportTextureFromDisk = async () => {
    setShowTexturePicker(false);
    try {
      const selected = await tauriOpen({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "tga"] }],
      });
      if (!selected || typeof selected !== "string") return;
      // TODO: añadir nodo texture con la ruta seleccionada
    } catch (e) {
      console.error(e);
    }
  };

  const handleImportTextureFromAsset = () => {
    setShowTexturePicker(false);
    setShowAssetFilePicker(true);
  };

  const handleSave = async () => {
    if (!baseItem) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { nodes, connections } = useMaterialEditorStore.getState();
      const smat: VrcSmatFile = {
        version: 1,
        name: slotName,
        sourceSlotName: slotName,
        nodes,
        connections,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Resolve parent dir without using ../ (Tauri 2 blocks path traversal)
      const sep = baseItem.local_path.includes("/") ? "/" : "\\";
      const parentDir = baseItem.local_path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      const materialsDir = `${parentDir}/materials`;
      // Ensure the materials directory exists
      try { await mkdir(materialsDir, { recursive: true }); } catch { /* already exists */ }
      const savePath = `${materialsDir}/${slotName.replace(/[^a-z0-9_-]/gi, "_")}.vrcsmat`;
      await writeTextFile(savePath, JSON.stringify(smat, null, 2));
      useMaterialEditorStore.getState().markClean();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[80] flex items-stretch bg-zinc-950">
        {/* Header */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-950 z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-100">Material Editor</h2>
            <span className="text-xs text-zinc-500">—</span>
            <span className="text-xs text-zinc-400 font-mono">{slotName}</span>
            {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
          </div>
          <div className="flex items-center gap-2">
            {saveError && <p className="text-[10px] text-red-400">{saveError}</p>}
            <button
              onClick={() => setShowTexturePicker(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-xs text-zinc-300 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Import Texture
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !baseItem}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs text-zinc-200 transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save .vrcsmat"}
            </button>
            <button onClick={handleClose} className="text-zinc-600 hover:text-zinc-300 transition-colors ml-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="relative w-full h-full pt-[52px]">
          {/* Node editor — full width */}
          <div className="w-full h-full">
            <MaterialNodeEditor />
          </div>

          {/* Preview sphere — floating top-left corner overlay */}
          <div className="absolute top-3 left-3 z-30 flex flex-col items-center gap-1 pointer-events-none">
            <div className="pointer-events-auto">
              <MaterialPreviewSphere viewerRef={viewerRef} slotIndex={slotIndex} />
            </div>
            <span className="text-[9px] text-zinc-700">Drag to rotate</span>
          </div>
        </div>
      </div>

      {/* Texture source picker */}
      {showTexturePicker && (
        <TextureSourcePicker
          onFromDisk={handleImportTextureFromDisk}
          onFromAsset={handleImportTextureFromAsset}
          onCancel={() => setShowTexturePicker(false)}
        />
      )}
    </>
  );
}