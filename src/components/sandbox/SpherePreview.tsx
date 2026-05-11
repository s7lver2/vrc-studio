import { useEffect, useRef } from "react";

interface Props {
  colorHex?: string;
  roughness?: number;
  metalness?: number;
  textureUrl?: string | null;
  emissiveHex?: string;
}

export function SpherePreview({
  colorHex = "#888888",
  roughness = 0.5,
  metalness = 0,
  textureUrl,
  emissiveHex,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    renderer: any;
    scene: any;
    camera: any;
    mesh: any;
    THREE: any;
    isDragging: boolean;
    lastX: number;
    lastY: number;
    animId: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;

    (async () => {
      const THREE = await import("three");
      if (!alive) return;

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setSize(180, 180);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const key = new THREE.DirectionalLight(0xffffff, 2.5);
      key.position.set(3, 5, 4);
      scene.add(key);

      const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
      camera.position.set(0, 0, 3);

      const geo = new THREE.SphereGeometry(1, 64, 64);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness,
        metalness,
        emissive: emissiveHex ? new THREE.Color(emissiveHex) : new THREE.Color(0x000000),
        emissiveIntensity: emissiveHex ? 0.5 : 0,
      });
      if (textureUrl) {
        const tex = await new THREE.TextureLoader().loadAsync(textureUrl);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);

      const state = { renderer, scene, camera, mesh, THREE, isDragging: false, lastX: 0, lastY: 0, animId: 0 };
      stateRef.current = state;

      const animate = () => {
        state.animId = requestAnimationFrame(animate);
        if (!state.isDragging) mesh.rotation.y += 0.005;
        renderer.render(scene, camera);
      };
      animate();

      canvas.addEventListener("mousedown", (e) => {
        state.isDragging = true;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
      });
      window.addEventListener("mousemove", (e) => {
        if (!state.isDragging) return;
        const dx = e.clientX - state.lastX;
        const dy = e.clientY - state.lastY;
        mesh.rotation.y += dx * 0.01;
        mesh.rotation.x += dy * 0.01;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
      });
      window.addEventListener("mouseup", () => { state.isDragging = false; });
    })();

    return () => {
      alive = false;
      if (stateRef.current) {
        cancelAnimationFrame(stateRef.current.animId);
        stateRef.current.renderer.dispose();
      }
    };
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (!s?.mesh) return;
    const mat = s.mesh.material as any;
    mat.color.set(colorHex);
    mat.roughness = roughness;
    mat.metalness = metalness;
    if (emissiveHex) {
      mat.emissive.set(emissiveHex);
      mat.emissiveIntensity = 0.5;
    }
    mat.needsUpdate = true;
  }, [colorHex, roughness, metalness, emissiveHex]);

  return (
    <div className="relative w-[180px] h-[180px] rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800">
      <canvas ref={canvasRef} width={180} height={180} className="cursor-grab active:cursor-grabbing" />
      <p className="absolute bottom-1 left-0 right-0 text-center text-[8px] text-zinc-700">Drag to rotate</p>
    </div>
  );
}