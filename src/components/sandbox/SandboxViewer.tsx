import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { Move, RotateCw as RotateCwAlt, Maximize2, Bone, Layers } from "lucide-react";
import { useSandboxStore, MaterialSlot } from "@/store/sandboxStore";
import { usePhysicsStore, MorphTarget, AvatarBone, ExpressionParam } from "@/store/physicsStore";
import { readFile, readDir } from "@tauri-apps/plugin-fs";
import { LoadingProgressBar } from "./LoadingSkeleton";
import { tauriParsePrefab } from "@/lib/tauri";

export interface SandboxViewerHandle {
  scene: any;
  model: any;
  THREE: any;
  mixer: any | null;
  setMixer: (m: any | null) => void;
  addObject: (obj: any) => void;
  removeObject: (obj: any) => void;
  resetClock: () => void;
}

// Helper for suffix-based texture lookup (e.g. _albedo, _metallic)
function findTextureBySuffix(
  map: Map<string, string>,
  lowerName: string
): string | undefined {
  const needle = "_" + lowerName;
  for (const [key, val] of map) {
    if (key.toLowerCase().endsWith(needle)) return val;
  }
  return undefined;
}

function findPathBySuffix(
  map: Map<string, string>,
  lowerName: string
): string | undefined {
  const needle = "_" + lowerName;
  for (const [key, val] of map) {
    if (key.toLowerCase().endsWith(needle)) return val;
  }
  return undefined;
}

/**
 * Stem-based texture lookup.
 * Used when FBX references non-web formats like .psd — strips the extension,
 * then tries: exact stem match, then suffix match (stem → *_stem.ext).
 * Example: "face.psd" stem "face" → finds "Plum_Face.png" via "_face" suffix.
 */
function findTextureByStem(
  map: Map<string, string>,
  stem: string          // lowercase, no extension
): string | undefined {
  if (stem.length < 2) return undefined;
  // 1. Exact stem match: "face" -> "face.png"
  for (const [key, val] of map) {
    const keyStem = key.toLowerCase().replace(/\.[^.]+$/, "");
    if (keyStem === stem) return val;
  }
  // 2. Suffix match: "face" -> "plum_face.png"  (_face suffix)
  const needle = "_" + stem;
  for (const [key, val] of map) {
    const keyStem = key.toLowerCase().replace(/\.[^.]+$/, "");
    if (keyStem.endsWith(needle)) return val;
  }
  // 3. Segment-prefix match: "cos" -> "plum_costume.png"
  //    Splits each key by "_" and checks if any segment starts with the stem.
  //    Requires stem >= 3 chars to avoid false positives.
  if (stem.length >= 3) {
    for (const [key, val] of map) {
      const keyStem = key.toLowerCase().replace(/\.[^.]+$/, "");
      const segments = keyStem.split("_");
      if (segments.some((seg) => seg.startsWith(stem) && seg.length > stem.length)) return val;
    }
  }
  return undefined;
}

function findPathByStem(
  map: Map<string, string>,
  stem: string          // lowercase, no extension
): string | undefined {
  if (stem.length < 2) return undefined;
  for (const [key, val] of map) {
    const keyStem = key.toLowerCase().replace(/\.[^.]+$/, "");
    if (keyStem === stem) return val;
  }
  const needle = "_" + stem;
  for (const [key, val] of map) {
    const keyStem = key.toLowerCase().replace(/\.[^.]+$/, "");
    if (keyStem.endsWith(needle)) return val;
  }
  if (stem.length >= 3) {
    for (const [key, val] of map) {
      const keyStem = key.toLowerCase().replace(/\.[^.]+$/, "");
      const segments = keyStem.split("_");
      if (segments.some((seg) => seg.startsWith(stem) && seg.length > stem.length)) return val;
    }
  }
  return undefined;
}

type TransformMode = "translate" | "rotate" | "scale";

const MIME: Record<string, string> = {
  fbx: "application/octet-stream",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  vrm: "model/gltf-binary",
};

const TEX_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "lightMap"];

const TEX_EXT = /\.(png|jpe?g|bmp|tga|dds|tiff?|webp|gif|exr|hdr)$/i;

const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  bmp: "image/bmp", webp: "image/webp", gif: "image/gif",
  tiff: "image/tiff", tif: "image/tiff",
};

function boneColor(THREE: any, index: number, total: number): any {
  return new THREE.Color().setHSL((index / Math.max(total, 1)) * 0.85, 1.0, 0.58);
}

async function fileToBlob(path: string, ext: string): Promise<string> {
  const bytes = await readFile(path);
  const blob = new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" });
  return URL.createObjectURL(blob);
}

function colorToHex(color: any): string {
  if (!color) return "#888888";
  try { return "#" + color.getHexString(); } catch { return "#888888"; }
}

// Returns { dir: string, sep: string } where dir is the parent directory
// of filePath WITHOUT trailing separator, using the OS-native separator.
// Using native separators is critical for Tauri scope checks on Windows.
function getModelDir(filePath: string): { dir: string; sep: string } {
  const sep = filePath.includes("\\") ? "\\" : "/";
  const lastSep = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return { dir: filePath.substring(0, lastSep), sep };
}

// ── Unity .mat / .meta texture resolution ────────────────────────────────────
//
// Unity .mat files reference textures by GUID (_MainTex: {guid: abc...}).
// Each texture file has a sidecar .meta with its GUID.
// This builds an authoritative matName -> {threeSlot -> blobURL} map.

const UNITY_TO_THREE: Record<string, string> = {
  _MainTex:          "map",
  _BumpMap:          "normalMap",
  _NormalMap:        "normalMap",
  _EmissionMap:      "emissiveMap",
  _MetallicGlossMap: "metalnessMap",
  _SpecGlossMap:     "metalnessMap",
  _OcclusionMap:     "aoMap",
  _AlphaMap:         "alphaMap",
};

function parseMetaGuid(text: string): string | null {
  for (const line of text.split("\n")) {
    const m = line.match(/^guid:\s*([0-9a-f]{16,})/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

interface MatTexEnv { slot: string; guid: string; }
interface ParsedMat  { name: string; texEnvs: MatTexEnv[]; }

function parseMatFile(text: string): ParsedMat | null {
  let name = "";
  const texEnvs: MatTexEnv[] = [];
  let currentSlot = "";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    if (!name) {
      const nm = line.match(/^\s+m_Name:\s+(.+)/);
      if (nm) { name = nm[1].trim(); continue; }
    }

    const slotM = line.match(/^\s+-\s+(_\w+):\s*$/);
    if (slotM) { currentSlot = slotM[1]; continue; }

    if (currentSlot) {
      const guidM = line.match(/m_Texture:\s*\{[^}]*guid:\s*([0-9a-f]+)/i);
      if (guidM) {
        const guid = guidM[1].toLowerCase();
        if (guid.length >= 16 && !/^0+$/.test(guid)) {
          texEnvs.push({ slot: currentSlot, guid });
        }
        currentSlot = "";
      }
    }
  }

  return name ? { name, texEnvs } : null;
}

async function buildMatTexMap(
  packageRoot: string,
  sep: string,
  textureBlobMap: Map<string, string>,
  blobsRef: React.MutableRefObject<string[]>
): Promise<Map<string, Map<string, string>>> {
  const matTexMap = new Map<string, Map<string, string>>();

  // 1. guid -> abs path from .meta sidecar files
  const guidToPath = new Map<string, string>();

  async function scanMeta(dir: string, depth = 0) {
    try {
      const entries = await readDir(dir);
      for (const e of entries) {
        if (!e.name) continue;
        if (e.isDirectory && depth < 3) { await scanMeta(dir + sep + e.name, depth + 1); continue; }
        if (!e.name.endsWith(".meta")) continue;
        const texName = e.name.slice(0, -5);
        if (!TEX_EXT.test(texName)) continue;
        try {
          const bytes = await readFile(dir + sep + e.name);
          const guid  = parseMetaGuid(new TextDecoder().decode(bytes));
          if (guid) guidToPath.set(guid, dir + sep + texName);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  await scanMeta(packageRoot + sep + "Texture");

  if (guidToPath.size === 0) {
    console.warn("[MatParser] No .meta files found under Texture/ — skipping");
    return matTexMap;
  }
  console.log(`[MatParser] GUID map size: ${guidToPath.size}`);

  // 2. Parse .mat files
  try {
    const matEntries = await readDir(packageRoot + sep + "Material");
    for (const e of matEntries) {
      if (!e.name?.toLowerCase().endsWith(".mat") || e.isDirectory) continue;
      try {
        const bytes  = await readFile(packageRoot + sep + "Material" + sep + e.name);
        const parsed = parseMatFile(new TextDecoder().decode(bytes));
        if (!parsed) continue;

        const slotMap = new Map<string, string>();

        for (const { slot, guid } of parsed.texEnvs) {
          const threeSlot = UNITY_TO_THREE[slot];
          if (!threeSlot) continue;
          const texPath = guidToPath.get(guid);
          if (!texPath) continue;
          const texName    = texPath.split(/[/\\]/).pop() ?? "";
          const texNameLow = texName.toLowerCase();

          let blobUrl = textureBlobMap.get(texNameLow) ?? textureBlobMap.get(texName);
          if (!blobUrl) {
            try {
              const tb  = await readFile(texPath);
              const ext = texNameLow.split(".").pop() ?? "png";
              blobUrl   = URL.createObjectURL(new Blob([tb], { type: IMG_MIME[ext] ?? "image/png" }));
              textureBlobMap.set(texNameLow, blobUrl);
              textureBlobMap.set(texName,    blobUrl);
              blobsRef.current.push(blobUrl);
            } catch { continue; }
          }

          slotMap.set(threeSlot, blobUrl);
        }

        if (slotMap.size > 0) {
          matTexMap.set(parsed.name,               slotMap);
          matTexMap.set(parsed.name.toLowerCase(), slotMap);
          console.log(`[MatParser] "${parsed.name}": ${slotMap.size} slot(s)`);
        }
      } catch { /* skip unreadable .mat */ }
    }
  } catch { console.warn("[MatParser] Could not read Material/ dir"); }

  return matTexMap;
}

export const SandboxViewer = forwardRef<SandboxViewerHandle, {}>(function SandboxViewer(_, ref) {
  const {
    selectedFile, setMaterialSlots, setTransform, setSelectedMeshName,
    setModelClips, viewportMode, setViewportMode, setTrackedObjectInfo,
  } = useSandboxStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadLabel, setLoadLabel] = useState("Initializing Three.js…");
  const [error, setError] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [loadProgress, setLoadProgress] = useState(0);
  const [prefabOnlyMode, setPrefabOnlyMode] = useState(false);
  const { setPrefabScene, prefabScene, hierarchyVisibility } = useSandboxStore();

  const threeRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const orbitRef = useRef<any>(null);
  const tcRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const mixerRef = useRef<any | null>(null);
  const clockRef = useRef<any>(null);
  const blobsRef = useRef<string[]>([]);
  const rafRef = useRef<number>(0);
  const nameToObjectRef = useRef<Map<string, any>>(new Map());

  // Internal auto-scale factor applied to oversized models (hidden from user)
  const autoScaleRef = useRef<number>(1);

  // Bone-view state
  const boneGroupRef = useRef<any>(null);
  const boneSavedMatsRef = useRef<Map<any, any>>(new Map());

  useImperativeHandle(ref, () => ({
    get scene() { return sceneRef.current; },
    get model() { return modelRef.current; },
    get THREE() { return threeRef.current; },
    get mixer() { return mixerRef.current; },
    setMixer: (m) => { mixerRef.current = m; },
    addObject: (obj) => sceneRef.current?.add(obj),
    removeObject: (obj) => sceneRef.current?.remove(obj),
    resetClock: () => { if (clockRef.current) clockRef.current.start(); },
  }));

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    blobsRef.current.forEach(URL.revokeObjectURL);
    blobsRef.current = [];
    if (rendererRef.current) {
      rendererRef.current.forceContextLoss();
      rendererRef.current.dispose();
      rendererRef.current.domElement?.remove();
      rendererRef.current = null;
    }
    sceneRef.current = null;
    modelRef.current = null;
    mixerRef.current = null;
    tcRef.current = null;
    clockRef.current = null;
    boneGroupRef.current = null;
    boneSavedMatsRef.current.clear();
  }, []);

  // ── Bone-view setup / teardown ──────────────────────────────────────────

  const teardownBoneView = useCallback(() => {
    const scene = sceneRef.current;

    const existing = scene?.getObjectByName("__bone_view__");
    if (existing) scene.remove(existing);
    boneGroupRef.current = null;

    const lines = scene?.getObjectByName("__bone_view_lines__");
    if (lines) scene.remove(lines);

    boneSavedMatsRef.current.forEach((origMat, mesh) => {
      mesh.material = origMat;
      mesh.visible = true;
    });
    boneSavedMatsRef.current.clear();
  }, []);

  const setupBoneView = useCallback(() => {
    const scene = sceneRef.current;
    const model = modelRef.current;
    const THREE = threeRef.current;
    if (!scene || !model || !THREE) return;

    teardownBoneView();

    const bones: any[] = [];
    model.traverse((child: any) => { if (child.isBone) bones.push(child); });
    if (bones.length === 0) return;

    model.traverse((child: any) => {
      if (!child.isMesh) return;
      boneSavedMatsRef.current.set(child, child.material);
      const makeTransparent = (m: any) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.07;
        c.depthWrite = false;
        c.wireframe = false;
        return c;
      };
      child.material = Array.isArray(child.material)
        ? child.material.map(makeTransparent)
        : makeTransparent(child.material);
      child.visible = true;
    });

    const skHelper = new THREE.SkeletonHelper(model);
    skHelper.name = "__bone_view_lines__";
    (skHelper.material as any).color = new THREE.Color(0x3399ff);
    (skHelper.material as any).linewidth = 2;
    scene.add(skHelper);

    const group = new THREE.Group();
    group.name = "__bone_view__";
    const sphereGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const tmpPos = new THREE.Vector3();
    bones.forEach((bone, i) => {
      const mat = new THREE.MeshBasicMaterial({
        color: boneColor(THREE, i, bones.length),
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const sphere = new THREE.Mesh(sphereGeo, mat);
      sphere.renderOrder = 999;
      sphere.userData.bone = bone;
      bone.getWorldPosition(tmpPos);
      sphere.position.copy(tmpPos);
      group.add(sphere);
    });
    scene.add(group);
    boneGroupRef.current = group;
  }, [teardownBoneView]);

  // ── Single applyViewportMode ─────────────────────────────────────────────

  const applyViewportMode = useCallback((mode: string) => {
    const model = modelRef.current;
    const scene = sceneRef.current;
    const THREE = threeRef.current;
    if (!model || !scene || !THREE) return;

    if (mode !== "bone") teardownBoneView();

    if (mode !== "skeleton") {
      const h = scene.getObjectByName("__skeleton_helper__");
      if (h) scene.remove(h);
    }

    switch (mode) {
      case "normal":
        model.traverse((child: any) => {
          if (!child.isMesh) return;
          child.visible = true;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m: any) => { if (m) { m.wireframe = false; } });
        });
        break;

      case "wireframe":
        model.traverse((child: any) => {
          if (!child.isMesh) return;
          child.visible = true;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m: any) => { if (m) m.wireframe = true; });
        });
        break;

      case "skeleton":
        model.traverse((child: any) => {
          if (!child.isMesh) return;
          child.visible = false;
        });
        if (!scene.getObjectByName("__skeleton_helper__")) {
          const helper = new THREE.SkeletonHelper(model);
          helper.name = "__skeleton_helper__";
          (helper.material as any).linewidth = 2;
          scene.add(helper);
        }
        break;

      case "bone":
        setupBoneView();
        break;
    }
  }, [setupBoneView, teardownBoneView]);

   // Aplicar cambios de visibilidad de jerarquía a Three.js
  useEffect(() => {
    if (!prefabScene || nameToObjectRef.current.size === 0) return;

    // Función recursiva para aplicar visibility de un nodo y sus hijos
    function applyVisibility(node: import("@/types/prefab").PrefabNode) {
      const visible = hierarchyVisibility[node.file_id] ?? node.is_active;
      const obj = nameToObjectRef.current.get(node.name);
      if (obj) obj.visible = visible;
      for (const child of node.children) applyVisibility(child);
    }

    for (const root of prefabScene.root_nodes) applyVisibility(root);
  }, [hierarchyVisibility, prefabScene]);

  // ── Main model loading effect ────────────────────────────────────────────

  useEffect(() => {
    setLoadProgress(0);
    if (!selectedFile || !containerRef.current) return;
    let alive = true;
    setLoading(true);
    setPrefabOnlyMode(false);
    setError(null);
    setPrefabScene(null);
    cleanup();

    (async () => {
      try {
        setLoadLabel("Loading Three.js…");
        setLoadProgress(10);
        const THREE = await import("three");
        threeRef.current = THREE;

        setLoadLabel("Loading model loaders…");
        setLoadProgress(20);
        const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js" as any).catch(() => ({ FBXLoader: null }));
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js" as any).catch(() => ({ GLTFLoader: null }));
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js" as any).catch(() => ({ OrbitControls: null }));
        const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js" as any).catch(() => ({ TransformControls: null }));

        if (!alive || !containerRef.current) return;

        setLoadLabel("Setting up scene…");
        setLoadProgress(35);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        sceneRef.current = scene;
        const grid = new THREE.GridHelper(20, 20, 0x1a1a1a, 0x111111);
        scene.add(grid);

        scene.add(new THREE.AmbientLight(0xffffff, 1.4));
        const key = new THREE.DirectionalLight(0xffffff, 2.8);
        key.position.set(4, 8, 5);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xb0c8ff, 1.2);
        fill.position.set(-4, 3, 1);
        scene.add(fill);

        const rect = containerRef.current.getBoundingClientRect();
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(rect.width, rect.height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.001, 5000);
        camera.position.set(0, 2, 5);
        cameraRef.current = camera;

        let orbit: any = null;
        if (OrbitControls) {
          orbit = new OrbitControls(camera, renderer.domElement);
          orbit.enableDamping = true;
          orbit.dampingFactor = 0.18;
          orbit.screenSpacePanning = true;
          orbit.target.set(0, 1, 0);
          orbit.minDistance = 0.001; // allow zooming into the model
          orbit.maxDistance = 4000;
          orbit.update();
          orbitRef.current = orbit;
        }

        let tc: any = null;
        if (TransformControls) {
          tc = new TransformControls(camera, renderer.domElement);
          tc.setMode(transformMode);
          tc.setSpace("world");
          tc.size = 1.2;
          tc.addEventListener("dragging-changed", (e: any) => {
            if (orbit) orbit.enabled = !e.value;
          });
          tc.addEventListener("objectChange", () => {
            const obj = tc.object;
            if (!obj) return;
            const pos = obj.position;
            const rot = obj.rotation;
            const scl = obj.scale;
            const toDeg = (r: number) => (r * 180) / Math.PI;
            // Normalize scale: divide by the internal auto-scale factor so user always sees "1" as natural size
            const inv = 1 / (autoScaleRef.current || 1);
            setTransform({
              px: +pos.x.toFixed(3), py: +pos.y.toFixed(3), pz: +pos.z.toFixed(3),
              rx: +toDeg(rot.x).toFixed(1), ry: +toDeg(rot.y).toFixed(1), rz: +toDeg(rot.z).toFixed(1),
              sx: +(scl.x * inv).toFixed(3), sy: +(scl.y * inv).toFixed(3), sz: +(scl.z * inv).toFixed(3),
            });
          });
          tcRef.current = tc;
        }

        setLoadLabel("Reading file from disk…");
        setLoadProgress(55);

        // ── Prefab detection ─────────────────────────────────────────────
        // Use a mutable local variable to avoid mutating store state
        let activeFile = selectedFile;

        if (selectedFile.ext === "prefab") {
          setLoadLabel("Parsing Unity prefab…");
          setLoadProgress(30);
          try {
            const parsedScene = await tauriParsePrefab(selectedFile.path);
            setPrefabScene(parsedScene);

            // Populate AnimationTree from prefab layers
            if (parsedScene.anim_layers && parsedScene.anim_layers.length > 0) {
              const layers = parsedScene.anim_layers.map((l: any) => ({
                name: l.name as import("@/types/vrcAnimTree").VrcAnimLayerName,
                weight: 1.0,
                states: l.states.map((s: any) => ({
                  name: s.name,
                  clipName: s.clip_name,
                  isBlendTree: s.is_blend_tree,
                  isDefault: s.is_default,
                  children: [],
                })),
                activeState: null,
              }));
              usePhysicsStore.getState().setAnimTree({ layers });
            }

            if (parsedScene.suggested_mesh_file) {
              const meshExt = parsedScene.suggested_mesh_file.split(".").pop()?.toLowerCase() ?? "fbx";
              // Redirect loading to the mesh file
              activeFile = {
                path: parsedScene.suggested_mesh_file,
                ext: meshExt,
                name: parsedScene.suggested_mesh_file.split(/[\\/]/).pop() ?? "model",
                type: "model",
              };
            } else {
              // Hierarchy-only prefab: show a clear message and stop
              setLoadLabel("Prefab hierarchy loaded (no mesh found)");
              setPrefabOnlyMode(true);
              setLoading(false);
              return;
            }
          } catch (e) {
            console.warn("[Prefab] parse failed:", e);
            if (alive) {
              setError(`Could not parse prefab: ${String(e)}`);
              setLoading(false);
            }
            return;
          }
        }

        // From this point, we always have a mesh file to load (activeFile)
        const blobUrl = await fileToBlob(activeFile.path, activeFile.ext);
        blobsRef.current.push(blobUrl);

        // ── Texture pre-loading ──────────────────────────────────────────
        const { dir: modelDirRaw, sep } = getModelDir(activeFile.path);

        setLoadLabel("Loading textures…");
        setLoadProgress(60);

        const textureBlobMap = new Map<string, string>();
        const texturePathMap = new Map<string, string>();

        async function loadTexDir(dirPath: string, depth = 0) {
          try {
            const entries = await readDir(dirPath);
            console.log(`[Textures] readDir OK: "${dirPath}" — ${entries.length} entries (depth ${depth})`);
            for (const entry of entries) {
              if (!entry.name) continue;

              if (entry.isDirectory && depth < 3) {
                await loadTexDir(dirPath + sep + entry.name, depth + 1);
                continue;
              }

              if (!TEX_EXT.test(entry.name)) continue;
              if (textureBlobMap.has(entry.name.toLowerCase())) continue;

              const fullPath = dirPath + sep + entry.name;
              texturePathMap.set(entry.name.toLowerCase(), fullPath);
              texturePathMap.set(entry.name, fullPath);

              try {
                const bytes = await readFile(fullPath);
                const ext = entry.name.split(".").pop()?.toLowerCase() ?? "png";
                const blob = URL.createObjectURL(
                  new Blob([bytes], { type: IMG_MIME[ext] ?? "image/png" })
                );
                textureBlobMap.set(entry.name.toLowerCase(), blob);
                textureBlobMap.set(entry.name, blob);
                blobsRef.current.push(blob);
                console.log(`[Textures] Loaded: ${entry.name} (from ${dirPath})`);
              } catch (e) {
                console.warn(`[Textures] readFile failed: "${fullPath}"`, e);
              }
            }
          } catch (e) {
            if (depth === 0) console.error(`[Textures] readDir failed: "${dirPath}"`, e);
          }
        }

        // Strategy: prefer packageRoot/Texture/ (canonical Unity layout),
        // then the model's own dir, then full package root as last resort.
        const lastSep2 = Math.max(modelDirRaw.lastIndexOf("\\"), modelDirRaw.lastIndexOf("/"));
        const packageRoot = lastSep2 > 0 ? modelDirRaw.substring(0, lastSep2) : modelDirRaw;
        {
          const textureDirCandidate = packageRoot + sep + "Texture";

          // 1. Canonical Texture/ sub-directory
          await loadTexDir(textureDirCandidate);

          // 2. Model's own directory (for flat layouts)
          if (textureBlobMap.size === 0) await loadTexDir(modelDirRaw);

          // 3. Full package root recursive scan
          if (textureBlobMap.size === 0) {
            console.log(`[Textures] Texture/ empty -- scanning package root: "${packageRoot}"`);
            await loadTexDir(packageRoot);
          }
        }

        console.log(`[Textures] Map size after scan: ${textureBlobMap.size}`);

        // Build authoritative material->texture map from .mat + .meta files
        setLoadLabel("Reading material definitions...");
        const matTexMap = await buildMatTexMap(packageRoot, sep, textureBlobMap, blobsRef);

        // Reverse map: blob URL → original filename (for PostFix broken-texture detection)
        const blobToNameMap = new Map<string, string>();
        for (const [name, url] of textureBlobMap) {
          // Only keep the lowercase variant to avoid duplicate entries
          if (name === name.toLowerCase() && !blobToNameMap.has(url)) {
            blobToNameMap.set(url, name);
          }
        }

        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url: string) => {
          if (url.startsWith("data:")) return url;
          const filename = url.split(/[/\\]/).pop() ?? "";
          if (!filename) return url;

          const lowerName = filename.toLowerCase();

          // 1. Web-native formats: direct name / suffix lookup first
          if (TEX_EXT.test(filename)) {
            const mapped =
              textureBlobMap.get(filename) ??
              textureBlobMap.get(lowerName) ??
              findTextureBySuffix(textureBlobMap, lowerName);
            if (mapped) {
              textureBlobMap.set(lowerName, mapped);
              console.log(`[URLModifier] ${filename} → resolved`);
              return mapped;
            }
          }

          // 2. Non-web formats (.psd, .psb, etc.) OR unresolved web formats:
          //    strip extension and do a stem-based lookup so that e.g.
          //    "face.psd" resolves to "Plum_Face.png" in the map.
          const dotIdx = lowerName.lastIndexOf(".");
          const stem = dotIdx > 0 ? lowerName.substring(0, dotIdx) : lowerName;
          const stemMapped = findTextureByStem(textureBlobMap, stem);
          if (stemMapped) {
            // Cache under both names for future hits
            textureBlobMap.set(lowerName, stemMapped);
            textureBlobMap.set(filename, stemMapped);
            console.log(`[URLModifier] ${filename} → stem-resolved via "${stem}"`);
            return stemMapped;
          }

          console.warn(`[URLModifier] ${filename} — NOT in map (map size: ${textureBlobMap.size})`);
          return url;
        });

        setLoadLabel("Parsing model…");
        setLoadProgress(70);
        let model: any;
        let clips: any[] = [];

        if (activeFile.ext === "fbx" && FBXLoader) {
          model = await new Promise<any>((res, rej) =>
            new FBXLoader(manager).load(blobUrl, res, undefined, rej)
          );
          clips = model.animations ?? [];
        } else if (GLTFLoader) {
          const gltf = await new Promise<any>((res, rej) =>
            new GLTFLoader(manager).load(blobUrl, res, undefined, rej)
          );
          model = gltf.scene;
          clips = gltf.animations ?? [];
          if (gltf.userData?.vrm) model.userData.vrm = gltf.userData.vrm;
        } else {
          throw new Error("No suitable loader found for " + activeFile.ext);
        }

        setModelClips(clips.map((c: any, i: number) => c.name || `Clip ${i + 1}`));

        if (clips.length > 0) {
          (model as any).animations = clips;

          const { setAnimTree } = usePhysicsStore();
          const clipNames: string[] = clips.map((c: any) => c.name ?? "");
          const modelLayer = {
            name: "Base" as const,
            weight: 1,
            activeState: null as string | null,
            states: clipNames
              .filter((cn) => cn)
              .map((cn) => ({ name: cn, clipName: cn, isBlendTree: false as const })),
          };
          const currentTree = usePhysicsStore.getState().animTree;
          setAnimTree({
            layers: [modelLayer, ...currentTree.layers.filter((l) => l.name !== "Base")],
          });
        }

        // ── Auto-scale: silently normalize oversized models ──────────────────
        // Avatars in Unity/VRChat are typically ~1.7 m. Some FBX files export
        // in centimeters (170 units tall) or other unit systems. We scale them
        // down transparently so the viewport always shows the model at a sane
        // size. The user sees scale (1, 1, 1) via the normalized objectChange
        // handler; they can freely zoom in without hitting clipping planes.
        {
          const AUTO_SCALE_THRESHOLD = 3;   // models larger than 3 units get rescaled
          const AUTO_SCALE_TARGET    = 1.7;  // target max dimension (metres equivalent)
          const rawBox  = new THREE.Box3().setFromObject(model);
          const rawSize = rawBox.getSize(new THREE.Vector3());
          const rawMax  = Math.max(
            isFinite(rawSize.x) && rawSize.x > 0 ? rawSize.x : 0,
            isFinite(rawSize.y) && rawSize.y > 0 ? rawSize.y : 0,
            isFinite(rawSize.z) && rawSize.z > 0 ? rawSize.z : 0,
          );
          if (rawMax > AUTO_SCALE_THRESHOLD) {
            const s = AUTO_SCALE_TARGET / rawMax;
            model.scale.setScalar(s);
            autoScaleRef.current = s;
          } else {
            autoScaleRef.current = 1;
          }
        }

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const safeVec = (v: any) => (isFinite(v) ? v : 0);
        const safeSize = new THREE.Vector3(
          isFinite(size.x) && size.x > 0 ? size.x : 1,
          isFinite(size.y) && size.y > 0 ? size.y : 2,
          isFinite(size.z) && size.z > 0 ? size.z : 1,
        );
        const safeCenter = new THREE.Vector3(safeVec(center.x), safeVec(center.y), safeVec(center.z));
        model.position.sub(safeCenter);
        model.position.y += safeSize.y / 2;
        scene.add(model);
        modelRef.current = model;
        grid.position.y = isFinite(box.min.y - safeCenter.y) ? box.min.y - safeCenter.y : 0;

        const maxDim = Math.max(safeSize.x, safeSize.y, safeSize.z);
        const fov = camera.fov * (Math.PI / 180);
        const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.2;
        camera.position.set(0, safeSize.y * 0.5, dist);
        if (orbit) { orbit.target.set(0, safeSize.y * 0.5, 0); orbit.update(); }

        if (tc) tc.attach(model);
        if (tc) {
          if (typeof tc.getHelper === "function") {
            scene.add(tc.getHelper());
          } else {
            try { scene.add(tc); } catch { /* fallback */ }
          }
        }

        setLoadLabel("Processing materials…");
        setLoadProgress(88);
        const slots: MaterialSlot[] = [];
        let slotIndex = 0;
        model.traverse((child: any) => {
          if (!child.isMesh) return;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat: any, matIdx: number) => {
            if (!mat) return;
            slots.push({
              index: slotIndex++,
              name: mat.name || `${child.name || "Mesh"}_mat${matIdx}`,
              colorHex: colorToHex(mat.color),
              hasMap: !!mat.map,
            });
          });
        });
        setMaterialSlots(slots);

        // Map prefab hierarchy → Three.js nodes
        const nameToObject = new Map<string, any>();
        if (model) {
          model.traverse((obj: any) => {
            if (obj.name) nameToObject.set(obj.name, obj);
          });
        }
        nameToObjectRef.current = nameToObject;

        // Null out texture slots with no image data
        model.traverse((child: any) => {
          if (!child.isMesh) return;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat: any) => {
            if (!mat) return;
            TEX_SLOTS.forEach((slot) => {
              const tex = mat[slot];
              if (tex && !tex.image) {
                mat[slot] = null;
                mat.needsUpdate = true;
              }
            });
          });
        });

        // Apply .mat-derived textures (authoritative, GUID-based)
        // Overwrites whatever Three.js decoded from FBX embedded paths.
        if (matTexMap.size > 0) {
          const texLoader = new THREE.TextureLoader();
          model.traverse((child: any) => {
            if (!child.isMesh) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat: any) => {
              if (!mat?.name) return;
              const slotMap = matTexMap.get(mat.name) ?? matTexMap.get(mat.name.toLowerCase());
              if (!slotMap) return;
              slotMap.forEach((blobUrl: string, threeSlot: string) => {
                const tex = texLoader.load(blobUrl);
                if (threeSlot === "map" || threeSlot === "emissiveMap") {
                  tex.colorSpace = THREE.SRGBColorSpace;
                }
                mat[threeSlot] = tex;
                mat.needsUpdate = true;
              });
            });
          });
          console.log("[MatParser] Textures applied from .mat definitions");
        }

        // Post-load texture recovery:
        //   • Detects textures whose images failed to decode (naturalWidth === 0).
        //     This catches TGA / DDS files that browsers cannot display natively.
        //   • For TGA files: decodes via Three.js TGALoader (pure-JS parser).
        //   • For other formats: re-creates the Blob with the correct MIME type.
        //   • Also normalises colorSpace on successfully loaded colour textures.

        setTimeout(async () => {
          if (!modelRef.current) return;

          const { TGALoader } = await import("three/examples/jsm/loaders/TGALoader.js" as any)
            .catch(() => ({ TGALoader: null }));

          const reloadCache = new Map<string, any>(); // filename → THREE.Texture | null

          const fixTex = async (mat: any, slot: string) => {
            const tex = mat[slot];
            if (!tex) return;
            const img = tex.image as HTMLImageElement | undefined;

            // Fix colorSpace for already-working colour textures
            if (img?.complete && (img.naturalWidth ?? 0) > 0) {
              if (slot === "map" || slot === "emissiveMap") {
                tex.colorSpace = THREE.SRGBColorSpace;
                mat.needsUpdate = true;
              }
              return;
            }

            // Image is broken (not decoded or missing)
            if (!img?.src) return;

            // Identify original filename via the reverse blob-URL map,
            // falling back to extracting the filename from the src URL.
            const filename =
              blobToNameMap.get(img.src) ??
              img.src.split(/[/\\]/).pop()?.split("?")[0]?.toLowerCase();
            if (!filename) return;

            console.log(`[PostFix] Broken texture: "${filename}" in slot "${slot}"`);

            if (!reloadCache.has(filename)) {
              const lowerFilename = filename.toLowerCase();
              const pDotIdx = lowerFilename.lastIndexOf(".");
              const pStem = pDotIdx > 0 ? lowerFilename.substring(0, pDotIdx) : lowerFilename;
              const filePath =
                texturePathMap.get(filename) ??
                texturePathMap.get(lowerFilename) ??
                findPathBySuffix(texturePathMap, lowerFilename) ??
                findPathByStem(texturePathMap, pStem);

              if (!filePath) {
                reloadCache.set(filename, null);
                return;
              }

              const ext = filename.split(".").pop()?.toLowerCase() ?? "";

              try {
                const bytes = await readFile(filePath);

                if (ext === "tga" && TGALoader) {
                  // TGALoader.parse() does a pure-JS decode → DataTexture
                  const loader = new TGALoader();
                  const newTex = loader.parse(bytes.buffer as ArrayBuffer);
                  newTex.colorSpace = THREE.SRGBColorSpace;
                  newTex.needsUpdate = true;
                  reloadCache.set(filename, newTex);
                  console.log(`[PostFix] TGA decoded OK: "${filename}"`);
                } else {
                  // Re-create Blob with the correct MIME type
                  const correctMime = IMG_MIME[ext] ?? "image/png";
                  const newBlobUrl = URL.createObjectURL(
                    new Blob([bytes], { type: correctMime })
                  );
                  blobsRef.current.push(newBlobUrl);

                  await new Promise<void>((resolve) => {
                    const loader = new THREE.TextureLoader();
                    loader.load(
                      newBlobUrl,
                      (t: any) => {
                        if (slot === "map" || slot === "emissiveMap") {
                          t.colorSpace = THREE.SRGBColorSpace;
                        }
                        reloadCache.set(filename, t);
                        console.log(`[PostFix] Reloaded OK: "${filename}"`);
                        resolve();
                      },
                      undefined,
                      () => { reloadCache.set(filename, null); resolve(); }
                    );
                  });
                }
              } catch (e) {
                console.warn(`[PostFix] readFile failed for "${filename}":`, e);
                reloadCache.set(filename, null);
              }
            }

            const newTex = reloadCache.get(filename);
            if (newTex) {
              mat[slot] = newTex;
              mat.needsUpdate = true;
              console.log(`[PostFix] Applied "${filename}" → slot "${slot}"`);
            }
          };

          const fixPromises: Promise<void>[] = [];
          modelRef.current.traverse((child: any) => {
            if (!child.isMesh) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat: any) => {
              if (!mat) return;
              TEX_SLOTS.forEach((slot) => {
                fixPromises.push(fixTex(mat, slot));
              });
            });
          });
          await Promise.all(fixPromises);
        }, 800);

        // Morph targets
        const { setMorphTargets, setBones, setExpressionParams } = usePhysicsStore.getState();
        const morphMap = new Map<string, number>();
        model.traverse((child: any) => {
          if (!child.isMesh || !child.morphTargetDictionary) return;
          Object.entries(child.morphTargetDictionary).forEach(([name, idx]) => {
            if (!morphMap.has(name)) morphMap.set(name, idx as number);
          });
        });
        const morphTargets: MorphTarget[] = Array.from(morphMap.entries()).map(([name, index]) => {
          const low = name.toLowerCase();
          let category: MorphTarget["category"] = "other";
          if (low.includes("eye") || low.includes("mouth") || low.includes("brow") || low.includes("lip") || low.includes("jaw") || low.includes("cheek") || low.includes("nose")) category = "face";
          else if (low.includes("breast") || low.includes("belly") || low.includes("body") || low.includes("muscle")) category = "body";
          else if (low.includes("cloth") || low.includes("shirt") || low.includes("skirt") || low.includes("jacket") || low.includes("dress") || low.includes("outfit")) category = "clothing";
          return { name, index, value: 0, enabled: false, category };
        });
        setMorphTargets(morphTargets);

        const bonesFound: AvatarBone[] = [];
        model.traverse((child: any) => {
          if (!child.isBone) return;
          const path: string[] = [];
          let cur: any = child;
          while (cur && cur !== model) {
            if (cur.name) path.unshift(cur.name);
            cur = cur.parent;
          }
          bonesFound.push({ name: child.name, humanoidRole: null, path: path.join(".") });
        });
        const vrm = (model as any).userData?.vrm;
        if (vrm?.humanoid) {
          const humanBones: Record<string, any> = vrm.humanoid.humanBones ?? {};
          Object.entries(humanBones).forEach(([role, boneData]: [string, any]) => {
            const boneName: string = boneData?.node?.name ?? boneData?.name ?? "";
            const match = bonesFound.find((b) => b.name === boneName);
            if (match) match.humanoidRole = role;
          });
        }
        setBones(bonesFound);

        let exprParams: ExpressionParam[] = [];
        if (vrm?.expressionManager) {
          const expManager = vrm.expressionManager;
          const exprNames: string[] = Object.keys(expManager.expressionMap ?? {});
          exprParams = exprNames.map((name) => {
            const expr = expManager.expressionMap[name];
            const linkedMorphs: string[] = (expr?.morphTargetBinds ?? []).map((b: any) => b.name ?? "");
            return { name, type: "float" as const, value: 0, linkedMorphs };
          });
        } else {
          exprParams = morphTargets.map((mt) => ({ name: mt.name, type: "float" as const, value: 0, linkedMorphs: [mt.name] }));
        }
        setExpressionParams(exprParams);

        // Raycaster
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const handleClick = (e: MouseEvent) => {
          if (!modelRef.current || !cameraRef.current || !containerRef.current) return;
          const r = containerRef.current.getBoundingClientRect();
          mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
          mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
          raycaster.setFromCamera(mouse, cameraRef.current);
          const hits = raycaster.intersectObjects(modelRef.current.children, true);
          if (hits.length > 0) {
            const obj = hits[0].object as any;
            const pos = obj.getWorldPosition(new THREE.Vector3());
            useSandboxStore.getState().setTrackedObjectInfo({
              name: obj.name || "(unnamed)",
              meshName: obj.isMesh ? obj.name : obj.parent?.name ?? "(root)",
              position: { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), z: +pos.z.toFixed(3) },
              materialName: obj.material ? (Array.isArray(obj.material) ? obj.material[0]?.name : obj.material?.name) ?? "unknown" : "none",
              boneLinked: obj.isSkinnedMesh ? (obj.skeleton?.bones?.[0]?.name ?? null) : null,
            });
          } else {
            useSandboxStore.getState().setTrackedObjectInfo(null);
          }
        };
        renderer.domElement.addEventListener("click", handleClick);

        applyViewportMode(useSandboxStore.getState().viewportMode);

        // ── Render loop ──────────────────────────────────────────────────
        const clock = new THREE.Clock();
        clockRef.current = clock;
        const tmpBonePos = new THREE.Vector3();

        const animate = () => {
          if (!alive) return;
          rafRef.current = requestAnimationFrame(animate);
          orbit?.update();

          const dt = clock.getDelta();
          if (mixerRef.current) mixerRef.current.update(dt);

          const { active: physicsActive, morphTargets: morphs } = usePhysicsStore.getState();
          if (physicsActive && modelRef.current) {
            modelRef.current.traverse((child: any) => {
              if (!child.isMesh || !child.morphTargetDictionary || !child.morphTargetInfluences) return;
              morphs.forEach((m: MorphTarget) => {
                const idx = child.morphTargetDictionary[m.name];
                if (idx !== undefined) child.morphTargetInfluences[idx] = m.value;
              });
            });
          }

          const { expressionParams } = usePhysicsStore.getState();
          expressionParams.forEach((param) => {
            if (param.value === 0) return;
            modelRef.current?.traverse((child: any) => {
              if (!child.isMesh || !child.morphTargetDictionary || !child.morphTargetInfluences) return;
              param.linkedMorphs.forEach((morphName) => {
                const idx = child.morphTargetDictionary[morphName];
                if (idx !== undefined) {
                  child.morphTargetInfluences[idx] = Math.max(child.morphTargetInfluences[idx], param.value);
                }
              });
            });
          });

          if (boneGroupRef.current) {
            boneGroupRef.current.children.forEach((sphere: any) => {
              const bone = sphere.userData.bone;
              if (bone) {
                bone.getWorldPosition(tmpBonePos);
                sphere.position.copy(tmpBonePos);
              }
            });
          }

          renderer.render(scene, camera);
        };
        animate();

        const ro = new ResizeObserver(() => {
          if (!containerRef.current || !alive) return;
          const r = containerRef.current.getBoundingClientRect();
          renderer.setSize(r.width, r.height);
          camera.aspect = r.width / r.height;
          camera.updateProjectionMatrix();
        });
        ro.observe(containerRef.current);

        if (alive) setLoading(false);
      } catch (e) {
        if (alive) { setError(String(e)); setLoading(false); }
      }
      setLoadProgress(100);
      setLoading(false);
    })();

    return () => {
      alive = false;
      cleanup();
    };
  }, [selectedFile]);

  useEffect(() => {
    applyViewportMode(viewportMode);
  }, [viewportMode, applyViewportMode]);

  useEffect(() => {
    tcRef.current?.setMode(transformMode);
  }, [transformMode]);

  return (
    <div className="relative w-full h-full bg-black select-none">
      <div ref={containerRef} className="w-full h-full" />
      {loading && <LoadingProgressBar label={loadLabel} progress={loadProgress} />}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90">
          <p className="text-xs text-red-400 max-w-sm text-center px-6">{error}</p>
        </div>
      )}
      {!loading && !error && prefabOnlyMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/90 backdrop-blur border border-zinc-700 text-[11px] text-zinc-400">
          <Layers className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          Prefab hierarchy loaded — no mesh file found alongside this prefab
        </div>
      )}
      {!loading && !error && (
        <>
          {/* Transform controls — bottom center */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-xl bg-zinc-950/80 backdrop-blur border border-zinc-800">
            {(
              [
                { mode: "translate" as const, icon: Move, label: "Move", shortcut: "W" },
                { mode: "rotate" as const, icon: RotateCwAlt, label: "Rotate", shortcut: "E" },
                { mode: "scale" as const, icon: Maximize2, label: "Scale", shortcut: "R" },
              ] as const
            ).map(({ mode, icon: Icon, label, shortcut }) => (
              <button
                key={mode}
                onClick={() => setTransformMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  transformMode === mode ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <span className="text-[10px] text-zinc-600 font-mono ml-0.5">{shortcut}</span>
              </button>
            ))}
          </div>

          {/* Bone view toggle — bottom right corner */}
          <button
            onClick={() => setViewportMode(viewportMode === "bone" ? "normal" : "bone")}
            title={viewportMode === "bone" ? "Exit Bone View" : "Bone View — show skeleton with colors"}
            className={`absolute bottom-5 right-4 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border backdrop-blur transition-all duration-150 ${
              viewportMode === "bone"
                ? "bg-violet-600/90 border-violet-500 text-white shadow-lg shadow-violet-900/50"
                : "bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
            }`}
          >
            <Bone className="h-3.5 w-3.5" />
            <span>Bones</span>
          </button>
        </>
      )}
      <KeyboardShortcuts onMode={setTransformMode} />
    </div>
  );
});

function KeyboardShortcuts({ onMode }: { onMode: (m: TransformMode) => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "w" || e.key === "W") onMode("translate");
      if (e.key === "e" || e.key === "E") onMode("rotate");
      if (e.key === "r" || e.key === "R") onMode("scale");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onMode]);
  return null;
}