import { useState } from "react";
import { GitBranch, ChevronDown, ChevronRight, Play, Square } from "lucide-react";
import { usePhysicsStore } from "@/store/physicsStore";
import { useSandboxStore } from "@/store/sandboxStore";
import { SectionBase } from "./SectionBase";
import type { VrcAnimLayerName } from "@/types/vrcAnimTree";

interface Props {
  viewerRef: React.RefObject<any>;
}

const LAYER_COLORS: Record<VrcAnimLayerName, string> = {
  Base: "text-blue-400",
  Additive: "text-cyan-400",
  Gesture: "text-emerald-400",
  Action: "text-violet-400",
  FX: "text-amber-400",
};

export function AnimationTreeSection({ viewerRef }: Props) {
  const { animTree, setAnimLayerState, setAnimLayerWeight } = usePhysicsStore();
  const { modelClips } = useSandboxStore();
  const [openLayers, setOpenLayers] = useState<Set<string>>(new Set(["Base", "Action"]));

  // Open the section automatically when there are prefab-sourced layers (no embedded clips)
  const hasPrefabLayers = animTree.layers.some((l) => l.states.length > 0) && modelClips.length === 0;

  const toggleLayer = (name: string) =>
    setOpenLayers((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });

  const activateState = (layerName: VrcAnimLayerName, stateName: string) => {
    const viewer = viewerRef.current;
    if (!viewer?.model || !viewer?.THREE) {
      // Viewer no inicializado, al menos actualizar el indicador visual
      setAnimLayerState(layerName, stateName);
      return;
    }

    const rawClips: any[] = (viewer.model as any).animations ?? [];

    // Busca el clipName definido en el estado, o usa stateName como fallback
    const layer = animTree.layers.find((l) => l.name === layerName);
    const stateObj = layer?.states.find((s) => s.name === stateName);
    const searchTerms = [stateObj?.clipName, stateName].filter(Boolean) as string[];

    const match =
      rawClips.length > 0
        ? rawClips.find((c: any) =>
            searchTerms.some((term) => c.name?.toLowerCase().includes(term.toLowerCase()))
          )
        : undefined;

    // Actualizar estado activo (feedback visual independientemente de si hay clip)
    setAnimLayerState(layerName, stateName);

    if (match) {
      viewer.resetClock?.();
      const mixer = new viewer.THREE.AnimationMixer(viewer.model);
      const action = mixer.clipAction(match);
      action.reset().setLoop(viewer.THREE.LoopRepeat, Infinity).play();
      viewer.setMixer(mixer);
    }
  };

  const stopLayer = (layerName: VrcAnimLayerName) => {
    setAnimLayerState(layerName, null);
    viewerRef.current?.setMixer(null);
  };

  return (
    <SectionBase title="Animation Tree" icon={<GitBranch className="h-3.5 w-3.5" />} defaultOpen={hasPrefabLayers}>
      <div className="flex flex-col">
        {animTree.layers.every((l) => l.states.length === 0) ? (
          <div className="px-3 py-3 flex flex-col gap-1">
            <p className="text-[10px] text-zinc-600 italic">No embedded animations found.</p>
            <p className="text-[9px] text-zinc-700">
              Load a model with embedded clips, or use the Animation section to attach an external file.
            </p>
          </div>
        ) : (
          animTree.layers.map((layer) => {
          const isOpen = openLayers.has(layer.name);
          const color = LAYER_COLORS[layer.name as VrcAnimLayerName] ?? "text-zinc-400";
          return (
            <div key={layer.name} className="border-b border-zinc-900 last:border-0">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/50 transition-colors"
                onClick={() => toggleLayer(layer.name)}
              >
                <span className="text-zinc-600 shrink-0">
                  {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </span>
                <span className={`text-[11px] font-semibold uppercase tracking-widest flex-1 text-left ${color}`}>
                  {layer.name}
                </span>
                {layer.activeState && (
                  <span className="text-[9px] text-zinc-500 font-mono truncate max-w-[80px]">{layer.activeState}</span>
                )}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={layer.weight}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setAnimLayerWeight(layer.name as VrcAnimLayerName, parseFloat(e.target.value))}
                  className="w-12 h-1 accent-zinc-500 shrink-0"
                  title={`Weight: ${layer.weight.toFixed(2)}`}
                />
              </button>

              {isOpen && (
                <div className="pb-2 flex flex-col gap-0.5">
                  {layer.states.map((state) => {
                    const isActive = layer.activeState === state.name;
                    return (
                      <div key={state.name} className="flex items-center gap-2 px-3 py-1">
                        <button
                          onClick={() =>
                            isActive
                              ? stopLayer(layer.name as VrcAnimLayerName)
                              : activateState(layer.name as VrcAnimLayerName, state.name)
                          }
                          className={`flex items-center gap-1.5 flex-1 py-1 px-2 rounded-md text-[10px] transition-colors ${
                            isActive
                              ? "bg-zinc-700 text-zinc-100"
                              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                          }`}
                        >
                          {isActive ? <Square className="h-2.5 w-2.5 shrink-0" /> : <Play className="h-2.5 w-2.5 shrink-0" />}
                          <span className="truncate">{state.name}</span>
                          {state.isBlendTree && (
                            <span className="text-[8px] text-zinc-700 ml-auto">blend</span>
                          )}
                        </button>
                      </div>
                    );
                  })}

                  {modelClips.filter((c) =>
                    layer.states.some((s) => c.toLowerCase().includes(s.name.toLowerCase()))
                  ).length > 0 && (
                    <p className="text-[9px] text-zinc-700 px-3 mt-1 italic">
                      {modelClips.filter((c) =>
                        layer.states.some((s) => c.toLowerCase().includes(s.name.toLowerCase()))
                      ).length}{" "}
                      model clips matched
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })
        )}
      </div>
    </SectionBase>
  );
}