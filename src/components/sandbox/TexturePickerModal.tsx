// src/components/sandbox/TexturePickerModal.tsx
/**
 * TexturePickerModal — muestra las texturas disponibles en el item base
 * representadas como esferas con la textura aplicada usando Three.js offscreen.
 */
import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useSandboxStore, SandboxFile } from "@/store/sandboxStore";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { join as joinPath } from "@tauri-apps/api/path";

const TEX_EXTS = new Set(["png", "jpg", "jpeg", "bmp", "tga"]);

interface TexturePickerModalProps {
  onClose: () => void;
}

async function walkDir(dirPath: string): Promise<{ name: string; fullPath: string; isDir: boolean }[]> {
  const entries = await readDir(dirPath);
  const results: { name: string; fullPath: string; isDir: boolean }[] = [];
  for (const entry of entries) {
    const fullPath = await joinPath(dirPath, entry.name);
    results.push({ name: entry.name, fullPath, isDir: entry.isDirectory });
    if (entry.isDirectory) {
      const sub = await walkDir(fullPath);
      results.push(...sub);
    }
  }
  return results;
}

function TextureSphere({ file }: { file: SandboxFile }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    let alive = true;
    (async () => {
      try {
        const THREE = await import("three");
        const bytes = await readFile(file.path);
        const blob = new Blob([bytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);

        const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current!, antialias: true, alpha: true });
        renderer.setSize(72, 72);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
        camera.position.z = 2;
        const light = new THREE.DirectionalLight(0xffffff, 1.5);
        light.position.set(1, 1, 2);
        scene.add(light, new THREE.AmbientLight(0xffffff, 0.4));
        const tex = new THREE.TextureLoader().load(url, () => {
          if (!alive) return;
          const geo = new THREE.SphereGeometry(0.7, 32, 32);
          const mat = new THREE.MeshStandardMaterial({ map: tex });
          const sphere = new THREE.Mesh(geo, mat);
          scene.add(sphere);
          renderer.render(scene, camera);
          URL.revokeObjectURL(url);
          setReady(true);
        });
      } catch {}
    })();
    return () => { alive = false; };
  }, [file.path]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-[72px] h-[72px] rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
          </div>
        )}
        <canvas ref={canvasRef} width={72} height={72} className="rounded-lg" />
      </div>
      <span className="text-[9px] text-zinc-600 text-center max-w-[72px] truncate">{file.name}</span>
    </div>
  );
}

export function TexturePickerModal({ onClose }: TexturePickerModalProps) {
  const { baseItem, setAppliedTexture } = useSandboxStore();
  const [textures, setTextures] = useState<SandboxFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!baseItem) return;
    (async () => {
      try {
        const allEntries = await walkDir(baseItem.local_path);
        const found: SandboxFile[] = [];
        for (const entry of allEntries) {
          if (!entry.isDir) {
            const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
            if (TEX_EXTS.has(ext)) {
              found.push({
                path: entry.fullPath,
                name: entry.name,
                type: "texture",
                ext,
              });
            }
          }
        }
        setTextures(found);
      } catch (err) {
        console.error("Failed to scan textures:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [baseItem]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-[480px] max-h-[60vh] flex flex-col rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-medium text-zinc-200">Select texture</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          )}
          {!loading && textures.length === 0 && (
            <p className="text-center text-xs text-zinc-600 py-8">No textures found in this item</p>
          )}
          {!loading && (
            <div className="flex flex-wrap gap-3">
              {textures.map((tex, i) => (
                <button
                  key={i}
                  onClick={() => { setAppliedTexture(tex); onClose(); }}
                  className="hover:ring-2 hover:ring-zinc-600 rounded-lg transition-all"
                >
                  <TextureSphere file={tex} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}