// src/components/sandbox/sections/ClothingSection.tsx
/**
 * ClothingSection — adjunta un modelo de ropa al avatar base y linkea armatures.
 *
 * Armature linking: se itera sobre los SkinnedMesh del outfit y se intenta
 * hacer que sus bones apunten a los bones del skeleton del modelo base
 * buscando por nombre. Si no se encuentran coincidencias, el outfit se añade
 * a la escena sin linking (modo "rigid attach").
 */
import { useState } from "react";
import { Shirt, X, Link, Link2Off } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { SectionBase } from "./SectionBase";
import { AssetSourcePicker } from "../AssetSourcePicker";
import { readFile } from "@tauri-apps/plugin-fs";

const CLOTHING_EXTS = new Set(["fbx", "glb", "gltf", "vrm"]);

interface Props {
  viewerRef: React.RefObject<any>;
}

// Guarda una referencia al objeto de ropa para poder quitarlo después
let clothingObject: any = null;

export function ClothingSection({ viewerRef }: Props) {
  const {
    baseItem, clothingFile, setClothingFile,
    clothingLinked, setClothingLinked,
  } = useSandboxStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boneMatches, setBoneMatches] = useState(0);

  const attachClothing = async (path: string, name: string, ext: string) => {
    if (!viewerRef.current?.model) return;
    setLoading(true);
    setError(null);

    try {
      const THREE = viewerRef.current.THREE;
      const bytes = await readFile(path);
      const mime = ext === "fbx" ? "application/octet-stream" : "model/gltf-binary";
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));

      let outfitRoot: any;
      if (ext === "fbx") {
        const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js" as any);
        outfitRoot = await new Promise<any>((res, rej) => new FBXLoader().load(url, res, undefined, rej));
      } else {
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js" as any);
        const gltf = await new Promise<any>((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
        outfitRoot = gltf.scene;
      }
      URL.revokeObjectURL(url);

      // ── Armature linking ──────────────────────────────────────
      // Construir mapa de huesos del modelo base (por nombre)
      const baseBones: Map<string, any> = new Map();
      viewerRef.current.model.traverse((child: any) => {
        if (child.isBone) baseBones.set(child.name, child);
      });

      let matches = 0;
      outfitRoot.traverse((child: any) => {
        if (!child.isSkinnedMesh) return;
        const skeleton = child.skeleton;
        if (!skeleton) return;
        skeleton.bones = skeleton.bones.map((bone: any) => {
          const base = baseBones.get(bone.name);
          if (base) { matches++; return base; }
          return bone;
        });
        skeleton.calculateInverses();
      });

      setBoneMatches(matches);
      setClothingLinked(matches > 0);

      // Añadir a escena como hijo del modelo base para que herede transforms
      viewerRef.current.model.add(outfitRoot);
      clothingObject = outfitRoot;

      setClothingFile({ path, name, type: "clothing", ext });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const detach = () => {
    if (clothingObject && viewerRef.current?.model) {
      viewerRef.current.model.remove(clothingObject);
      clothingObject = null;
    }
    setClothingFile(null);
    setClothingLinked(false);
    setBoneMatches(0);
  };

  return (
    <SectionBase title="Clothing" icon={<Shirt className="h-3.5 w-3.5" />} defaultOpen={false}>
      {!clothingFile ? (
        <div className="px-3 py-1">
          <button
            onClick={() => setPickerOpen(true)}
            disabled={!baseItem}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Shirt className="h-3.5 w-3.5" />
            Attach clothing
          </button>
          {!baseItem && (
            <p className="text-[9px] text-zinc-600 text-center mt-1">Load an item first</p>
          )}
        </div>
      ) : (
        <div className="px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Shirt className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            <span className="flex-1 text-[11px] text-zinc-300 truncate">{clothingFile.name}</span>
            <button onClick={detach} className="text-zinc-600 hover:text-red-400 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Armature link status */}
          <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[10px] ${
            clothingLinked
              ? "bg-green-950/30 border-green-800/40 text-green-400"
              : "bg-zinc-900 border-zinc-800 text-zinc-500"
          }`}>
            {clothingLinked ? <Link className="h-3 w-3 shrink-0" /> : <Link2Off className="h-3 w-3 shrink-0" />}
            {clothingLinked
              ? `Armature linked — ${boneMatches} bones matched`
              : "No matching bones found — rigid attach"}
          </div>
        </div>
      )}

      {loading && (
        <p className="px-3 pb-2 text-[10px] text-zinc-500 animate-pulse">Loading clothing…</p>
      )}
      {error && <p className="px-3 pb-2 text-[10px] text-red-400">{error}</p>}

      {pickerOpen && (
        <AssetSourcePicker
          title="Attach Clothing"
          filterExts={["fbx", "glb", "gltf", "vrm"]}
          diskFilterExts={["fbx", "glb", "gltf", "vrm"]}
          onSelect={(file) => {
            setPickerOpen(false);
            attachClothing(file.path, file.name, file.ext);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </SectionBase>
  );
}