// src/components/sandbox/MaterialPickerModal.tsx
/**
 * MaterialPickerModal — intercambia materiales entre slots del modelo cargado.
 *
 * No carga texturas externas — trabaja con los materiales que Three.js ya
 * extrajo del FBX/GLB al cargar el modelo. Renderiza cada material como
 * una esfera offscreen usando un WebGLRenderer temporal de 80x80px.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { SphereSkeleton } from "./LoadingSkeleton";

interface MaterialPickerModalProps {
  slotIndex: number;
  viewerRef: React.RefObject<any>;
  onClose: () => void;
}

interface LiveMaterial {
  name: string;
  material: any; // THREE.Material
}

const TEX_PROPS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'envMap',
  'lightMap', 'specularMap', 'gradientMap',
] as const;

/** Renderiza una esfera offscreen con un material Three.js dado */
function MaterialSphere({ material, THREE }: { material: any; THREE: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !material || !THREE) return;
    let alive = true;

    (async () => {
      try {
        const renderer = new THREE.WebGLRenderer({
          canvas: canvasRef.current!,
          antialias: true,
          alpha: true,
        });
        renderer.setSize(80, 80);
        renderer.setPixelRatio(1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
        camera.position.z = 2.2;

        scene.add(new THREE.AmbientLight(0xffffff, 1.8));
        const key = new THREE.DirectionalLight(0xffffff, 2.0);
        key.position.set(2, 3, 3);
        scene.add(key);

        // Clonar el material para no modificar el del modelo
        const sphereMat = material.clone();

        // Las texturas del clone apuntan a los mismos objetos THREE.Texture que el modelo.
        // Si hacemos tex.needsUpdate = true sobre ellas, afectamos al renderer principal.
        // Solución: clonar cada textura individualmente.
        // Solo las texturas que YA tienen imagen se intentan re-subir al contexto offscreen.
        // Las que no tienen imagen se ponen a null para evitar el warning del renderer.
        TEX_PROPS.forEach((prop) => {
          const tex = (sphereMat as any)[prop];
          if (!tex || !tex.isTexture) return;
          if (tex.image) {
            // Clonar para que needsUpdate sea independiente del original
            const cloned = tex.clone();
            cloned.needsUpdate = true;
            (sphereMat as any)[prop] = cloned;
          } else {
            // Sin imagen → null para no disparar el warning en este renderer
            (sphereMat as any)[prop] = null;
          }
        });
        sphereMat.needsUpdate = true;

        const geo = new THREE.SphereGeometry(0.75, 48, 48);
        const mesh = new THREE.Mesh(geo, sphereMat);
        scene.add(mesh);

        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const neutralEnv = pmrem.fromScene(new (THREE as any).RoomEnvironment()).texture;
        scene.environment = neutralEnv;
        if (sphereMat.isMeshStandardMaterial) {
          sphereMat.envMap = neutralEnv;
          sphereMat.envMapIntensity = 0.6;
          sphereMat.needsUpdate = true;
        }
        renderer.render(scene, camera);
        pmrem.dispose();

        renderer.render(scene, camera);
        if (alive) setReady(true);

        // Cleanup del renderer temporal
        renderer.dispose();
        geo.dispose();
        // Limpiar texturas clonadas para no dejar leaks
        TEX_PROPS.forEach((prop) => {
          const tex = (sphereMat as any)[prop];
          if (tex && tex.isTexture && tex !== material[prop]) tex.dispose();
        });
        sphereMat.dispose();
      } catch {}
    })();

    return () => { alive = false; };
  }, [material, THREE]);

  return (
    <div className="relative w-[80px] h-[80px]">
      {!ready && <SphereSkeleton />}
      <canvas
        ref={canvasRef}
        width={80}
        height={80}
        className={`rounded-full transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

export function MaterialPickerModal({ slotIndex, viewerRef, onClose }: MaterialPickerModalProps) {
  const { materialSlots } = useSandboxStore();
  const [liveMaterials, setLiveMaterials] = useState<LiveMaterial[]>([]);
  const THREE = viewerRef.current?.THREE;

  // Recopilar todos los materiales únicos del modelo cargado
  useEffect(() => {
    const model = viewerRef.current?.model;
    if (!model) return;
    const seen = new Map<string, any>();
    model.traverse((child: any) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m: any) => {
        if (m && !seen.has(m.uuid)) seen.set(m.uuid, m);
      });
    });
    setLiveMaterials(
      Array.from(seen.values()).map((m) => ({ name: m.name || m.uuid.slice(0, 8), material: m }))
    );
  }, [viewerRef]);

  const applyMaterial = (newMaterial: any) => {
    const model = viewerRef.current?.model;
    if (!model) return;
    let appliedCount = 0;
    model.traverse((child: any) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      // Aplicar al slot correspondiente (por posición en el array o por index global)
      if (Array.isArray(child.material)) {
        if (slotIndex < child.material.length) {
          child.material[slotIndex] = newMaterial;
          child.material.needsUpdate = true;
          appliedCount++;
        }
      } else if (slotIndex === 0) {
        child.material = newMaterial;
        child.material.needsUpdate = true;
        appliedCount++;
      }
    });
    onClose();
  };

  const currentSlot = materialSlots[slotIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-[520px] max-h-[70vh] flex flex-col rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              Material slot: <span className="text-zinc-400">{currentSlot?.name}</span>
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Click a material to apply it to this slot
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Materials grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {liveMaterials.length === 0 && (
            <p className="text-center text-xs text-zinc-600 py-8">No materials found in model</p>
          )}
          <div className="flex flex-wrap gap-4">
            {liveMaterials.map((lm, i) => (
              <button
                key={i}
                onClick={() => applyMaterial(lm.material)}
                className="flex flex-col items-center gap-1.5 group"
                title={`Apply "${lm.name}"`}
              >
                <div className="rounded-full ring-2 ring-transparent group-hover:ring-zinc-500 transition-all">
                  {THREE ? (
                    <MaterialSphere material={lm.material} THREE={THREE} />
                  ) : (
                    <SphereSkeleton />
                  )}
                </div>
                <span className="text-[9px] text-zinc-600 group-hover:text-zinc-400 max-w-[80px] truncate text-center transition-colors">
                  {lm.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}