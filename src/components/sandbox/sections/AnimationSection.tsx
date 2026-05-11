import { useState } from "react";
import { Play, Pause, Film, X } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { SectionBase } from "./SectionBase";
import { AssetSourcePicker } from "../AssetSourcePicker";
import { readFile } from "@tauri-apps/plugin-fs";

interface Props {
  viewerRef: React.RefObject<any>;
}

export function AnimationSection({ viewerRef }: Props) {
  const {
    baseItem, animFile, setAnimFile,
    animClipIndex, setAnimClipIndex,
    isPlaying, setIsPlaying,
    modelClips, activeModelClip, setActiveModelClip,
    prefabScene,
  } = useSandboxStore();
  const [tab, setTab] = useState<"model" | "external">("model");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [externalClips, setExternalClips] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playModelClip = (index: number) => {
    const viewer = viewerRef.current;
    if (!viewer?.model || !viewer?.THREE) return;
    const THREE = viewer.THREE;
    const rawClips: any[] = (viewer.model as any).animations ?? [];
    if (!rawClips[index]) return;

    // Resetear el clock antes de crear el mixer para evitar saltos de tiempo acumulado
    viewer.resetClock?.();

    const mixer = new THREE.AnimationMixer(viewer.model);
    const action = mixer.clipAction(rawClips[index]);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    viewer.setMixer(mixer);
    setActiveModelClip(index);
    setIsPlaying(true);
  };

  const stopModelClip = () => {
    viewerRef.current?.setMixer(null);
    setActiveModelClip(-1);
    setIsPlaying(false);
  };

  const loadExternalAnimation = async (path: string, name: string, ext: string) => {
    if (!viewerRef.current?.model || !viewerRef.current?.THREE) return;
    setLoading(true);
    setError(null);
    try {
      const THREE = viewerRef.current.THREE;
      const bytes = await readFile(path);
      const mime = ext === "fbx" ? "application/octet-stream" : "model/gltf-binary";
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      let loadedClips: any[] = [];
      if (ext === "fbx") {
        const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js" as any);
        const fbx = await new Promise<any>((res, rej) => new FBXLoader().load(url, res, undefined, rej));
        loadedClips = fbx.animations ?? [];
      } else {
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js" as any);
        const gltf = await new Promise<any>((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
        loadedClips = gltf.animations ?? [];
      }
      URL.revokeObjectURL(url);
      if (loadedClips.length === 0) { setError("No clips found."); setLoading(false); return; }

      const model = viewerRef.current.model;
      viewerRef.current.resetClock?.();
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(loadedClips[0]);
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      viewerRef.current.setMixer(mixer);
      setExternalClips(loadedClips.map((c: any, i: number) => c.name || `Clip ${i + 1}`));
      setAnimFile({ path, name, type: "animation", ext });
      setAnimClipIndex(0);
      setIsPlaying(true);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <SectionBase title="Animation" icon={<Film className="h-3.5 w-3.5" />} defaultOpen={false}>
      <div className="flex gap-0 px-3 pb-2 border-b border-zinc-900 mb-2">
        {(["model", "external"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1 text-[10px] font-medium capitalize rounded transition-colors ${
              tab === t ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            {t === "model" ? "Model Clips" : "External File"}
          </button>
        ))}
      </div>

      {tab === "model" && (
        <div className="px-3 flex flex-col gap-1">
          {modelClips.length === 0 ? (
            <div className="flex flex-col gap-2 py-2">
              <p className="text-[10px] text-zinc-600 italic">No embedded animations.</p>
              {prefabScene ? (
                <p className="text-[9px] text-zinc-500 leading-relaxed">
                  This prefab's animator layers are available in the{" "}
                  <span className="text-zinc-400 font-medium">Animation Tree</span> section below.
                </p>
              ) : (
                <p className="text-[9px] text-zinc-700">
                  VRChat avatars use separate animation files. Use the External File tab or the Animation Tree.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-0.5 max-h-[160px] overflow-y-auto">
                {modelClips.map((name, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      onClick={() => activeModelClip === i ? stopModelClip() : playModelClip(i)}
                      className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] transition-colors ${
                        activeModelClip === i
                          ? "bg-zinc-700 text-zinc-100"
                          : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {activeModelClip === i && isPlaying
                        ? <Pause className="h-3 w-3 shrink-0" />
                        : <Play className="h-3 w-3 shrink-0" />}
                      <span className="truncate flex-1 text-left">{name}</span>
                    </button>
                  </div>
                ))}
              </div>
              {activeModelClip >= 0 && (
                <button onClick={stopModelClip} className="text-[9px] text-zinc-600 hover:text-zinc-400 text-left mt-1">
                  Stop animation
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === "external" && (
        <div className="px-3 flex flex-col gap-2">
          {!animFile ? (
            <>
              <button
                onClick={() => setPickerOpen(true)}
                disabled={!baseItem}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors disabled:opacity-40"
              >
                <Film className="h-3.5 w-3.5" />
                Attach animation
              </button>
              {error && <p className="text-[10px] text-red-400">{error}</p>}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Film className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                <span className="flex-1 text-[11px] text-zinc-300 truncate">{animFile.name}</span>
                <button
                  onClick={() => { viewerRef.current?.setMixer(null); setAnimFile(null); setExternalClips([]); setIsPlaying(false); }}
                  className="text-zinc-600 hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {externalClips.length > 1 && (
                <select
                  value={animClipIndex}
                  onChange={(e) => setAnimClipIndex(parseInt(e.target.value))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 outline-none"
                >
                  {externalClips.map((n, i) => <option key={i} value={i}>{n}</option>)}
                </select>
              )}
            </div>
          )}
          {loading && <p className="text-[10px] text-zinc-500 animate-pulse">Loading…</p>}
        </div>
      )}

      {pickerOpen && (
        <AssetSourcePicker
          title="Attach Animation"
          filterExts={["fbx", "glb", "gltf", "anim"]}
          diskFilterExts={["fbx", "glb", "gltf", "anim"]}
          onSelect={(file) => { setPickerOpen(false); loadExternalAnimation(file.path, file.name, file.ext); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </SectionBase>
  );
}