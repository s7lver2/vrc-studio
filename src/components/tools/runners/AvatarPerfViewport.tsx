// src/components/tools/runners/AvatarPerfViewport.tsx
import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";
import { AnalysisResult } from "../../../lib/tauri";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  result: AnalysisResult;
  projectPath: string;
}

export function AvatarPerfViewport({ result, projectPath: _ }: Props) {
  const hasImage = !!result.thumbnail_path;
  const hasGltf = !!result.gltf_path;

  return (
    <div className="w-72 flex-shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      {/* 3D / image area */}
      <div className="flex-1 relative overflow-hidden">
        {hasImage ? (
          <ImageViewport thumbnailPath={result.thumbnail_path!} />
        ) : hasGltf ? (
          <GltfViewport gltfPath={result.gltf_path!} />
        ) : (
          <PlaceholderViewport />
        )}
      </div>

      {/* Info strip */}
      <div className="px-4 py-3 border-t border-zinc-800 shrink-0">
        <p className="text-sm font-bold text-zinc-100 truncate">{result.avatar_name}</p>
        <p className="text-[10px] text-zinc-500 truncate mt-0.5">{result.scene}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Chip>
            {result.metrics.triangles >= 1000
              ? `${(result.metrics.triangles / 1000).toFixed(1)}k`
              : result.metrics.triangles} tris
          </Chip>
          <Chip>{result.metrics.material_slots} mats</Chip>
          <Chip>{result.metrics.skinned_mesh_renderers} SMR</Chip>
          <Chip>PC</Chip>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-400">
      {children}
    </span>
  );
}

function ImageViewport({ thumbnailPath }: { thumbnailPath: string }) {
  const src = convertFileSrc(thumbnailPath);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
      <img
        src={src}
        alt="Avatar render"
        className="max-w-full max-h-full object-contain"
      />
      <div className="absolute bottom-2 right-2 text-[9px] text-zinc-600">Unity render</div>
    </div>
  );
}

function GltfViewport({ gltfPath }: { gltfPath: string }) {
  const src = convertFileSrc(gltfPath);
  return (
    <div className="absolute inset-0">
      <Canvas camera={{ position: [0, 1, 3], fov: 45 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={1} />
          <RotatingModel url={src} />
          <OrbitControls enableZoom={true} enablePan={false} />
        </Suspense>
      </Canvas>
      <div className="absolute bottom-2 right-2 text-[9px] text-zinc-600 pointer-events-none">
        Drag para rotar
      </div>
    </div>
  );
}

function RotatingModel({ url }: { url: string }) {
  // @ts-ignore
  const { scene } = useGLTF(url);
  const ref = useRef<any>(null);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.4;
    }
  });

  // @ts-ignore
  return <primitive ref={ref} object={scene} />;
}

function PlaceholderViewport() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900">
      <div className="text-6xl">👤</div>
      <p className="text-[10px] text-zinc-600 text-center px-4">
        Vista 3D no disponible.<br />Unity no encontrado o FBX no localizado.
      </p>
    </div>
  );
}