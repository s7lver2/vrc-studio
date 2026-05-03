/**
 * Preview3D — Visor 3D BETA para paquetes de inventario.
 *
 * Soporta FBX, VRM (a través de GLTFLoader + @pixiv/three-vrm), GLB/GLTF.
 * Usa convertFileSrc de Tauri para acceder a los archivos locales.
 * Para la preview de outfits, permite seleccionar un avatar del inventario.
 *
 * Dependencias necesarias (añadir a package.json):
 *   three, @types/three, @pixiv/three-vrm
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Loader2, RotateCcw, User, ChevronDown, AlertTriangle, Info,
} from "lucide-react";
import { InventoryItem } from "../../lib/tauri";
// Type-only import: gives us THREE.* in type positions without a runtime bundle.
import type * as THREE from "three";

// ── Lazy Three.js loader ──────────────────────────────────────────────────────

type ThreeModule = typeof import("three");
type LoaderModule = { FBXLoader: any; GLTFLoader: any; OrbitControls: any };

let threeCache: ThreeModule | null = null;
let loaderCache: LoaderModule | null = null;

async function loadThree(): Promise<{ THREE: ThreeModule; loaders: LoaderModule }> {
  if (!threeCache) {
    threeCache = await import("three");
  }
  if (!loaderCache) {
    const [fbx, gltf, orbit] = await Promise.all([
      import("three/examples/jsm/loaders/FBXLoader.js" as any).catch(() => null),
      import("three/examples/jsm/loaders/GLTFLoader.js" as any).catch(() => null),
      import("three/examples/jsm/controls/OrbitControls.js" as any).catch(() => null),
    ]);
    loaderCache = {
      FBXLoader: fbx?.FBXLoader ?? null,
      GLTFLoader: gltf?.GLTFLoader ?? null,
      OrbitControls: orbit?.OrbitControls ?? null,
    };
  }
  return { THREE: threeCache, loaders: loaderCache };
}

// ── Blob URL helper (Tauri 2) ─────────────────────────────────────────────────
const MIME: Record<string, string> = {
  fbx:  "application/octet-stream",
  glb:  "model/gltf-binary",
  gltf: "model/gltf+json",
  vrm:  "model/gltf-binary",
};

// Detect image MIME type from the first bytes of a file.
// Needed for Unity-exported GUIDs (no extension) that are just PNG/JPEG textures.
function detectMimeMagic(bytes: Uint8Array): string {
  if (bytes.length >= 4 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";  // PNG
  if (bytes.length >= 3 &&
      bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg"; // JPEG
  if (bytes.length >= 2 &&
      bytes[0] === 0x42 && bytes[1] === 0x4D) return "image/bmp";  // BMP
  if (bytes.length >= 4 &&
      bytes[0] === 0x44 && bytes[1] === 0x44 &&
      bytes[2] === 0x53 && bytes[3] === 0x20) return "image/vnd.ms-dds"; // DDS
  return "application/octet-stream";
}

interface BlobHandle {
  url: string;
  revoke: () => void;
}

async function toBlobUrl(localPath: string): Promise<BlobHandle> {
  const inTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

  if (inTauri) {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(localPath);
    const ext   = localPath.split(".").pop()?.toLowerCase() ?? "";
    const mime  = MIME[ext] ?? "application/octet-stream";
    const url   = URL.createObjectURL(new Blob([bytes], { type: mime }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }

  const url = `file:///${localPath.replace(/\\/g, "/")}`;
  return { url, revoke: () => {} };
}

// ── Shader mode ───────────────────────────────────────────────────────────────

export type ShaderMode = "pbr" | "liltoon" | "poiyomi";

function makeToonGradient(lib: ThreeModule, mode: "liltoon" | "poiyomi"): THREE.DataTexture {
  const W = 256;
  const data = new Uint8Array(W * 4);
  for (let i = 0; i < W; i++) {
    const t = i / (W - 1);
    let v: number;
    if (mode === "liltoon") {
      if      (t < 0.35) v = 88;
      else if (t < 0.50) v = Math.round(88  + ((t - 0.35) / 0.15) ** 1.5 * (175 - 88));
      else if (t < 0.65) v = Math.round(175 + ((t - 0.50) / 0.15)        * (222 - 175));
      else if (t < 0.75) v = Math.round(222 + ((t - 0.65) / 0.10)        * (255 - 222));
      else               v = 255;
    } else {
      if      (t < 0.42) v = 115;
      else if (t < 0.55) v = Math.round(115 + ((t - 0.42) / 0.13) ** 0.6 * (255 - 115));
      else               v = 255;
    }
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new lib.DataTexture(data, W, 1, lib.RGBAFormat);
  tex.minFilter = tex.magFilter = lib.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates an outline ShaderMaterial with a per-instance GL program cache key.
 *
 * WHY: Three.js caches WebGL programs by shader source. Without a unique key,
 * all outline materials share the same GL program object. When a SkinnedMesh
 * (with its own skinning program) is rendered adjacent to an outline mesh,
 * Three.js's uniform cache ends up using WebGLUniformLocations from program A
 * while program B is bound → INVALID_OPERATION: uniformMatrix4fv.
 * The `customProgramCacheKey` forces a separate program per outline instance,
 * eliminating the location cross-contamination entirely.
 */
function makeOutlineMaterial(lib: ThreeModule, meshUuid: string, width = 0.0035): THREE.ShaderMaterial {
  return new lib.ShaderMaterial({
    side: lib.BackSide,
    transparent: false,
    depthWrite: true,
    uniforms: { outlineWidth: { value: width }, outlineColor: { value: new lib.Color(0x0a0a0a) } },
    vertexShader: /* glsl */`
      uniform float outlineWidth;
      void main() {
        vec3 pos = position + normalize(normal) * outlineWidth;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 outlineColor;
      void main() { gl_FragColor = vec4(outlineColor, 1.0); }
    `,
    // Unique key → unique GL program per outline mesh → no uniform location cross-contamination.
    // @ts-expect-error customProgramCacheKey exists at runtime but may not be in older @types/three
    customProgramCacheKey: () => `outline-${meshUuid}`,
  });
}


interface SceneHandle {
  dispose: () => void;
  resetCamera: () => void;
  setBackground: (dark: boolean) => void;
  setShaderMode: (mode: ShaderMode) => void;
}

async function createScene(
  canvas: HTMLCanvasElement,
  modelPath: string,
  initialShaderMode: ShaderMode,
  onProgress: (pct: number) => void,
  onError: (msg: string) => void,
  onReady: () => void,
): Promise<SceneHandle> {
  const { THREE, loaders } = await loadThree();

  if (!THREE) {
    onError("Three.js no disponible. Ejecuta: npm install three @types/three");
    return { dispose: () => {}, resetCamera: () => {}, setBackground: () => {}, setShaderMode: () => {} };
  }

  const blobHandle = await toBlobUrl(modelPath);

  const liltoonGrad  = makeToonGradient(THREE, "liltoon");
  const poiyomiGrad  = makeToonGradient(THREE, "poiyomi");

  const originalMats = new Map<THREE.Mesh, THREE.Material[]>();
  const outlineMeshes = new Set<THREE.Mesh>();
  let modelRoot: THREE.Object3D | null = null;

  const convertMat = (mat: THREE.Material, mode: ShaderMode): THREE.Material => {
    const p = mat instanceof THREE.MeshPhongMaterial ? mat : null;

    // ── Material color fix ────────────────────────────────────────────────────
    // VRChat FBX exports often have materials with a black base color because
    // the original shader (lilToon / Poiyomi) drives color entirely through the
    // texture map. When Three.js converts these to phong/standard/toon materials
    // the black color multiplies with the texture and the mesh appears completely
    // black. Fix: if a diffuse map is present and the source color is effectively
    // black (all channels < 0.08), replace it with white so the texture renders
    // at full brightness.
    const rawColor = p?.color ?? new THREE.Color(0xcccccc);
    const hasMap = !!(p?.map);
    const colorIsBlack = rawColor.r < 0.08 && rawColor.g < 0.08 && rawColor.b < 0.08;
    // VRChat FBX exports almost always have black base color because lilToon/Poiyomi
    // drive color entirely through the texture map.  For PBR we only fix when a map
    // is present (so untextured geo stays dark).  For toon modes we ALWAYS fix to
    // white, because MeshToonMaterial multiplies the gradient result by the base
    // color, so black × anything = black — the mesh becomes invisible.
    const resolvedColor = colorIsBlack && (hasMap || mode !== "pbr")
      ? new THREE.Color(0xffffff)
      : rawColor.clone();

    const base = {
      name:              mat.name,
      color:             resolvedColor,
      map:               p?.map              ?? null,
      normalMap:         p?.normalMap        ?? null,
      alphaMap:          p?.alphaMap         ?? null,
      emissiveMap:       p?.emissiveMap      ?? null,
      emissive:          (p?.emissive ?? new THREE.Color(0, 0, 0)).clone(),
      emissiveIntensity: p?.emissiveIntensity ?? 1,
      transparent:       mat.transparent,
      opacity:           mat.opacity,
      side:              mat.side,
      depthWrite:        mat.depthWrite,
    };

    if (mode === "pbr") {
      // Keep metalness very low — almost all avatar/outfit meshes are non-metallic.
      // A high metalness (original 0.28) made everything look like brushed steel.
      return new THREE.MeshStandardMaterial({
        ...base,
        roughness: 0.72,
        metalness: p?.specular
          ? Math.min(0.06, p.specular.r * 0.06)
          : 0.02,
      });
    }
    return new THREE.MeshToonMaterial({
      ...base,
      gradientMap: mode === "liltoon" ? liltoonGrad : poiyomiGrad,
    });
  };

  const applyShader = (mode: ShaderMode) => {
    if (!modelRoot) return;

    outlineMeshes.forEach((o) => o.parent?.remove(o));
    outlineMeshes.clear();

    modelRoot.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || outlineMeshes.has(mesh)) return;

      if (!originalMats.has(mesh)) {
        const mats = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
        originalMats.set(mesh, mats);
      }

      const originals = originalMats.get(mesh)!;
      const converted = originals.map((m) => convertMat(m, mode));
      mesh.material = converted.length === 1 ? converted[0] : converted;

      if (mode !== "pbr") {
        // Skip SkinnedMesh: outline added as a child of a SkinnedMesh causes
        // Three.js to attempt setting skinning uniforms (bindMatrix, boneMatrices)
        // on the outline's ShaderMaterial program using locations from the parent
        // SkinnedMesh program → INVALID_OPERATION: uniformMatrix4fv.
        // The outline effect on GPU-skinned meshes also requires the vertex shader
        // to include skinning chunks, making a plain ShaderMaterial insufficient.
        if ((mesh as any).isSkinnedMesh) return;

        const outline = new THREE.Mesh(mesh.geometry, makeOutlineMaterial(THREE, mesh.uuid));
        outline.renderOrder = mesh.renderOrder - 1;
        mesh.add(outline);
        outlineMeshes.add(outline as THREE.Mesh);
      }
    });
  };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18181b);

  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.01, 1000);
  camera.position.set(0, 1.5, 3);

  const ambient = new THREE.AmbientLight(0xffffff, 1.8);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff4e0, 4.5);
  keyLight.position.set(3, 6, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 50;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xb8d0ff, 2.0);
  fillLight.position.set(-4, 3, 1);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 2.5);
  rimLight.position.set(0, 4, -5);
  scene.add(rimLight);

  const bounceLight = new THREE.DirectionalLight(0xffeedd, 0.8);
  bounceLight.position.set(0, -3, 2);
  scene.add(bounceLight);

  const grid = new THREE.GridHelper(10, 20, 0x333333, 0x222222);
  scene.add(grid);

  canvas.style.touchAction = "none";

  let controls: any = null;
  if (loaders.OrbitControls) {
    controls = new loaders.OrbitControls(camera, canvas);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.18;
    controls.rotateSpeed    = 0.8;
    controls.zoomSpeed      = 1.0;
    controls.panSpeed       = 0.8;
    controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
    controls.target.set(0, 1, 0);
    controls.update();
  }

  const url = blobHandle.url;
  const ext = modelPath.split(".").pop()?.toLowerCase() ?? "";

  let loadedMixer: THREE.AnimationMixer | null = null;
  const clock = new THREE.Clock();

  const fitCamera = (object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2;
    camera.position.set(center.x, center.y + size.y * 0.4, center.z + dist);
    if (controls) { controls.target.copy(center); controls.update(); }
    grid.position.y = box.min.y;
  };

  // ── FBX texture fix ────────────────────────────────────────────────────────
  // FBXLoader resolves textures relative to the blob URL which has no directory.
  // Fix: pre-cache all image files from the FBX's parent folder as blob URLs,
  // then intercept every texture load via LoadingManager.setURLModifier.
  const textureBlobCache = new Map<string, string>(); // filename.lower() → blob URL
  const inTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const parentDir = modelPath.replace(/[\\/][^\\/]+$/, "");

  // Note: we intentionally do NOT use convertFileSrc as a fallback here.
  // In Tauri 2 the asset:// protocol requires an explicit capability grant, and
  // when it is absent it produces ERR_CONNECTION_REFUSED.  Textures that aren't
  // in the blob cache simply won't load — which is better than a noisy error.

  if (ext === "fbx") {
    if (inTauri) {
      try {
        const { readDir, readFile } = await import("@tauri-apps/plugin-fs");
        const sep = parentDir.includes("\\") ? "\\" : "/";
        const imgExts = new Set(["png", "jpg", "jpeg", "tga", "bmp", "tiff", "psd"]);
        const MIME_IMG: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          tga: "image/x-tga", bmp: "image/bmp", tiff: "image/tiff", psd: "application/octet-stream",
        };

        // Helper: read all image files from a single directory into the cache.
        const cacheDir = async (dir: string) => {
          const entries = await readDir(dir).catch(() => [] as any[]);
          for (const entry of entries as any[]) {
            const name: string = entry.name ?? "";
            const fileExt = name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
            const isGuid  = !name.includes(".");
            if (!imgExts.has(fileExt) && !isGuid) continue;
            const bytes = await readFile(`${dir}${sep}${name}`).catch(() => null);
            if (!bytes) continue;
            const mime = isGuid ? detectMimeMagic(bytes) : (MIME_IMG[fileExt] ?? "application/octet-stream");
            textureBlobCache.set(name.toLowerCase(), URL.createObjectURL(new Blob([bytes], { type: mime })));
          }
        };

        // Scan: current dir, its parent, and one level of subdirectories in each.
        // Common VRChat package layout: textures live in a sibling folder of the FBX.
        const grandParentDir = parentDir.replace(/[/\\][^/\\]+$/, "");
        const dirsToScan = [parentDir];
        if (grandParentDir && grandParentDir !== parentDir) dirsToScan.push(grandParentDir);

        for (const dir of dirsToScan) {
          await cacheDir(dir);
          // Also one level of subdirectories (textures/, Textures/, Assets/, etc.)
          const entries = await readDir(dir).catch(() => [] as any[]);
          for (const entry of entries as any[]) {
            if (!(entry.isDirectory ?? false)) continue;
            await cacheDir(`${dir}${sep}${entry.name}`);
          }
        }
      } catch { /* non-fatal */ }
    }
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((rawUrl: string) => {
    // Extract filename from any URL/path form:
    //   blob:http://localhost/uuid  →  "uuid"
    //   C:\...\Karin_Face.png       →  "karin_face.png"
    //   textures/Karin_Face.png    →  "karin_face.png"
    const filename = rawUrl.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    const cached = textureBlobCache.get(filename);
    if (cached) return cached;
    // No convertFileSrc fallback: asset:// requires a Tauri capability not
    // always present. Return rawUrl; fetch will fail gracefully for uncached
    // textures rather than producing ERR_CONNECTION_REFUSED.
    return rawUrl;
  });

  if ((ext === "fbx") && loaders.FBXLoader) {
    const loader = new loaders.FBXLoader(manager);
    loader.load(
      url,
      (fbx: THREE.Group) => {
        fbx.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
        });
        modelRoot = fbx;
        scene.add(fbx);
        // Defer applyShader by one frame — if called immediately, Three.js tries to
        // set uniforms (uniformMatrix4fv) before the ShaderMaterial programs are
        // linked on the GPU, producing INVALID_OPERATION spam in the console.
        requestAnimationFrame(() => applyShader(initialShaderMode));
        fitCamera(fbx);
        if (fbx.animations?.length > 0) {
          loadedMixer = new THREE.AnimationMixer(fbx);
          loadedMixer.clipAction(fbx.animations[0]).play();
        }
        onReady();
      },
      (xhr: any) => onProgress(Math.round((xhr.loaded / (xhr.total || 1)) * 100)),
      (err: any) => onError(`FBX load error: ${err.message ?? err}`),
    );
  } else if ((ext === "glb" || ext === "gltf" || ext === "vrm") && loaders.GLTFLoader) {
    const loader = new loaders.GLTFLoader();
    if (ext === "vrm") {
      try {
        const { VRMLoaderPlugin } = await import("@pixiv/three-vrm" as any);
        loader.register((parser: any) => new VRMLoaderPlugin(parser));
      } catch { /* VRM plugin not installed — will still load as GLTF */ }
    }
    loader.load(
      url,
      (gltf: any) => {
        const model = gltf.scene ?? gltf.userData?.vrm?.scene ?? gltf;
        model.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
        });
        modelRoot = model;
        scene.add(model);
        requestAnimationFrame(() => applyShader(initialShaderMode));
        fitCamera(model);
        if (gltf.animations?.length > 0) {
          loadedMixer = new THREE.AnimationMixer(model);
          loadedMixer.clipAction(gltf.animations[0]).play();
        }
        onReady();
      },
      (xhr: any) => onProgress(Math.round((xhr.loaded / (xhr.total || 1)) * 100)),
      (err: any) => onError(`GLTF/VRM load error: ${err.message ?? err}`),
    );
  } else {
    onError(
      loaders.FBXLoader || loaders.GLTFLoader
        ? `Formato no soportado: .${ext}`
        : "Three.js loaders no disponibles. Instala: npm install three @types/three",
    );
  }

  let animId: number;
  const animate = () => {
    animId = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    loadedMixer?.update(delta);
    controls?.update();
    renderer.render(scene, camera);
  };
  animate();

  const ro = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  ro.observe(canvas);

  return {
    dispose: () => {
      cancelAnimationFrame(animId);
      controls?.dispose();
      renderer.dispose();
      ro.disconnect();
      blobHandle.revoke();
      liltoonGrad.dispose();
      poiyomiGrad.dispose();
      // Revoke all pre-cached texture blob URLs
      textureBlobCache.forEach((url) => URL.revokeObjectURL(url));
      textureBlobCache.clear();
    },
    resetCamera: () => {
      camera.position.set(0, 1.5, 3);
      if (controls) { controls.target.set(0, 1, 0); controls.update(); }
    },
    setBackground: (dark: boolean) => {
      scene.background = new THREE.Color(dark ? 0x18181b : 0x2c2c32);
    },
    setShaderMode: (mode: ShaderMode) => requestAnimationFrame(() => applyShader(mode)),
  };
}

// ── Helpers: avatar vs outfit detection ──────────────────────────────────────

// Keywords in tags that identify an item as an avatar base.
const AVATAR_TAG_KEYWORDS = ["avatar", "base", "vrchat_avatar", "avatar_base", "vrm"];
// Keywords in tags that identify an item as wearable/outfit.
const OUTFIT_TAG_KEYWORDS = [
  "outfit", "clothing", "clothes", "costume", "wearable",
  "prenda", "ropa", "dress", "accessory", "accessories",
];

/**
 * Returns true when the inventory item is likely an avatar base.
 * Uses tags first; falls back to checking 3D file extensions.
 */
function itemIsAvatar(item: InventoryItem, modelPaths: string[]): boolean {
  const lowerTags = item.tags.map((t) => t.toLowerCase());
  if (lowerTags.some((t) => AVATAR_TAG_KEYWORDS.includes(t))) return true;
  // VRM files are almost always full avatar exports.
  if (modelPaths.some((p) => p.toLowerCase().endsWith(".vrm"))) return true;
  return false;
}

/**
 * Returns true when the item is likely a wearable / outfit.
 */
function itemIsOutfit(item: InventoryItem, modelPaths: string[]): boolean {
  const lowerTags = item.tags.map((t) => t.toLowerCase());
  if (lowerTags.some((t) => OUTFIT_TAG_KEYWORDS.some((k) => t.includes(k)))) return true;
  // If the item is not an avatar and has 3D files, treat it as outfit.
  return !itemIsAvatar(item, modelPaths);
}

/**
 * Extract the avatar "base name" from a file path.
 * e.g. "C:\\..\\Karin_Costume.fbx"  → "karin"
 *      "Manuka_Body.fbx"             → "manuka"
 * Returns the lowercased prefix before the first underscore or space.
 */
function avatarNameFromPath(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const base = fileName.replace(/\.[^.]+$/, ""); // remove extension
  return base.split(/[_ ]/)[0].toLowerCase();
}

/**
 * Given all 3D model paths in an outfit package, return the set of
 * lowercase avatar names the package provides meshes for.
 * e.g. ["Karin_Costume.fbx", "Manuka_Costume.fbx"] → Set(["karin", "manuka"])
 */
function extractSupportedAvatarNames(modelPaths: string[]): Set<string> {
  return new Set(modelPaths.map(avatarNameFromPath).filter(Boolean));
}

/**
 * Derive a short lowercase search key from an inventory item name.
 * "Karin - Suzuha outfit" → "karin"
 * "Manuka"                → "manuka"
 */
function inventoryAvatarKey(item: InventoryItem): string {
  return item.name.split(/[\s\-_]/)[0].toLowerCase();
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  modelPaths: string[];
  localBasePath: string;
  /** All items in the user's inventory — used to populate the avatar selector. */
  inventoryItems: InventoryItem[];
  /** The inventory item currently being previewed — needed for avatar/outfit detection. */
  currentItem: InventoryItem;
}

export function Preview3D({ modelPaths, inventoryItems, currentItem }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);

  const [selectedModel, setSelectedModel] = useState(modelPaths[0]);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shaderMode, setShaderMode] = useState<ShaderMode>("pbr");

  // Avatar selector (outfit mode)
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

  // ── Determine if this item is an outfit or an avatar ──────────────────────
  const isOutfit = useMemo(
    () => itemIsOutfit(currentItem, modelPaths),
    [currentItem, modelPaths],
  );

  // The set of avatar base names the outfit package contains meshes for.
  const supportedAvatarNames = useMemo(
    () => (isOutfit ? extractSupportedAvatarNames(modelPaths) : new Set<string>()),
    [isOutfit, modelPaths],
  );

  // Items in inventory that look like avatar bases (excluding the current item).
  const avatarItems = useMemo(
    () => inventoryItems.filter((it) => {
      if (it.id === currentItem.id) return false;
      const lowerTags = it.tags.map((t) => t.toLowerCase());
      return lowerTags.some((t) => AVATAR_TAG_KEYWORDS.includes(t));
    }),
    [inventoryItems, currentItem.id],
  );

  const loadModel = useCallback(async (modelPath: string, mode: ShaderMode) => {
    if (!canvasRef.current) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!canvasRef.current) return;

    sceneRef.current?.dispose();
    sceneRef.current = null;

    setError(null);
    setReady(false);
    setLoading(true);
    setLoadProgress(0);

    try {
      const handle = await createScene(
        canvasRef.current,
        modelPath,
        mode,
        setLoadProgress,
        (msg) => { setError(msg); setLoading(false); },
        () => { setLoading(false); setReady(true); },
      );
      sceneRef.current = handle;
    } catch (e: any) {
      setError(e.message ?? String(e));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModel(selectedModel, shaderMode);
    return () => { sceneRef.current?.dispose(); };
  }, [selectedModel, loadModel]);

  // Live shader switch — no reload needed when only the mode changes.
  useEffect(() => {
    if (ready) sceneRef.current?.setShaderMode(shaderMode);
  }, [shaderMode, ready]);

  const modelName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Model picker */}
      {modelPaths.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {modelPaths.map((p) => (
            <button
              key={p}
              onClick={() => setSelectedModel(p)}
              className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                selectedModel === p
                  ? "bg-red-900/50 border-red-700 text-red-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {modelName(p)}
            </button>
          ))}
        </div>
      )}

      {/* Shader picker */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 shrink-0">Shader</span>
        <div className="flex rounded-md overflow-hidden border border-zinc-700 text-[10px]">
          {([
            { id: "pbr",     label: "PBR"     },
            { id: "liltoon", label: "lilToon" },
            { id: "poiyomi", label: "Poiyomi" },
          ] as { id: ShaderMode; label: string }[]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setShaderMode(id)}
              className={`px-2.5 py-1 transition-colors ${
                shaderMode === id
                  ? "bg-zinc-100 text-zinc-900 font-semibold"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {shaderMode !== "pbr" && (
          <span className="text-[9px] text-zinc-600">outline + toon shading</span>
        )}
      </div>

      {/* ── OUTFIT MODE: avatar selector shown BEFORE the 3D canvas ───────── */}
      {isOutfit && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3 flex flex-col gap-2.5">
          {/* Header */}
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <span className="text-xs font-semibold text-zinc-300">Avatar para esta prenda</span>
            <span className="text-[9px] bg-amber-900/50 text-amber-300 border border-amber-800 rounded-full px-1.5 py-px ml-auto shrink-0">
              BETA
            </span>
          </div>

          {/* Supported avatars info */}
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Este ítem es una prenda de ropa. Selecciona un avatar de tu inventario para
            previsualizar la compatibilidad.
            {supportedAvatarNames.size > 0 && (
              <> El paquete incluye tallas para:{" "}
                <span className="text-zinc-400 font-medium">
                  {[...supportedAvatarNames]
                    .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
                    .join(", ")}
                </span>.
              </>
            )}
          </p>

          {/* Avatar dropdown */}
          <div className="relative">
            <button
              onClick={() => setAvatarMenuOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-xs text-zinc-300 transition-colors"
            >
              <span className="truncate">
                {selectedAvatarId
                  ? (avatarItems.find((i) => i.id === selectedAvatarId)?.name ?? "Avatar seleccionado")
                  : "Seleccionar avatar del inventario…"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            </button>

            {avatarMenuOpen && (
              <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 max-h-52 overflow-y-auto">
                {avatarItems.length === 0 ? (
                  <p className="text-xs text-zinc-600 px-3 py-2 text-center">
                    No hay avatares en el inventario (añade la etiqueta "avatar")
                  </p>
                ) : (
                  avatarItems.map((it) => {
                    const key = inventoryAvatarKey(it);
                    const hasSize =
                      supportedAvatarNames.size === 0 || supportedAvatarNames.has(key);
                    return (
                      <button
                        key={it.id}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-zinc-800 transition-colors"
                        onClick={() => { setSelectedAvatarId(it.id); setAvatarMenuOpen(false); }}
                      >
                        {it.thumbnail_url ? (
                          <img
                            src={it.thumbnail_url}
                            alt=""
                            className="w-7 h-7 rounded-md object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-md bg-zinc-700 shrink-0 flex items-center justify-center">
                            <User className="h-3.5 w-3.5 text-zinc-500" />
                          </div>
                        )}
                        <span className={`truncate flex-1 ${hasSize ? "text-zinc-300" : "text-zinc-500"}`}>
                          {it.name}
                        </span>
                        {!hasSize && (
                          <span
                            className="flex items-center gap-1 shrink-0 text-[9px] text-amber-400 bg-amber-900/40 border border-amber-800/60 rounded-full px-1.5 py-0.5"
                            title="Este paquete no incluye una talla para este avatar"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Sin talla
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Inline warning when selected avatar has no size in this package */}
          {selectedAvatarId && supportedAvatarNames.size > 0 && (() => {
            const sel = avatarItems.find((i) => i.id === selectedAvatarId);
            if (!sel) return null;
            const hasSize = supportedAvatarNames.has(inventoryAvatarKey(sel));
            if (hasSize) return null;
            return (
              <div className="flex items-start gap-2 rounded-lg bg-amber-950/40 border border-amber-800/50 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-px" />
                <p className="text-[11px] text-amber-300 leading-snug">
                  El paquete no incluye ningún archivo específico para{" "}
                  <span className="font-semibold">{sel.name}</span>. La prenda puede no ser
                  compatible con este avatar.
                </p>
              </div>
            );
          })()}

          {/* Rig compatibility note */}
          {selectedAvatarId && (
            <div className="flex items-start gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700/40 px-3 py-2">
              <Info className="h-3.5 w-3.5 text-zinc-500 shrink-0 mt-px" />
              <p className="text-[11px] text-zinc-500 leading-snug">
                La preview combinada requiere que avatar y prenda compartan el mismo rig.
                Si los modelos no son compatibles puede que se vea incorrectamente.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Canvas area */}
      <div
        className="relative w-full rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800"
        style={{ height: 380 }}
      >
        <canvas ref={canvasRef} className="w-full h-full" style={{ display: "block" }} />

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/80 pointer-events-none">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            <p className="text-xs text-zinc-500">
              Loading {modelName(selectedModel)}… {loadProgress > 0 ? `${loadProgress}%` : ""}
            </p>
          </div>
        )}

        {/* Error overlay */}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 pointer-events-none">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <p className="text-xs text-amber-400 text-center">{error}</p>
            {error.includes("npm install") && (
              <code className="text-[10px] bg-zinc-800 text-amber-300 px-3 py-1.5 rounded-lg font-mono">
                npm install three @types/three @pixiv/three-vrm
              </code>
            )}
          </div>
        )}

        {/* Camera reset button */}
        {ready && (
          <div className="absolute top-2 right-2 flex flex-col gap-1 pointer-events-none">
            <button
              onClick={() => sceneRef.current?.resetCamera()}
              className="h-7 w-7 flex items-center justify-center rounded-lg bg-black/50 hover:bg-black/70 text-zinc-300 transition-colors pointer-events-auto"
              title="Reset camera"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Controls hint */}
        {ready && !error && (
          <div className="absolute bottom-2 left-2 text-[10px] text-zinc-600 pointer-events-none">
            Click + drag: rotar · Scroll: zoom · Right click + drag: mover
          </div>
        )}
      </div>
    </div>
  );
}