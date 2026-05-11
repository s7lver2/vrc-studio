// src/components/sandbox/PhysicsPanel.tsx
import { useState } from "react";
import { Square, Sliders, Bone, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { usePhysicsStore } from "@/store/physicsStore";
import { useSandboxStore } from "@/store/sandboxStore";
import { RadialWheel } from "./RadialMenu";
import { parseVrcMenuAsset } from "./VrcMenuExtractor";
import { VrcMenuPanel } from "./VrcMenuPanel";

interface Props {
  onStop: () => void;
}

export function PhysicsPanel({ onStop }: Props) {
  const {
    morphTargets, toggleMorph, setMorphValue,
    bones, expressionParams, setExpressionParamValue,
  } = usePhysicsStore();
  const { vrcMenuTree, setVrcMenuTree } = useSandboxStore();

  const [bonesOpen, setBonesOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(true);
  const [morphsOpen, setMorphsOpen] = useState(true);
  const [morphSearch, setMorphSearch] = useState("");
  const [morphCategoryFilter, setMorphCategoryFilter] = useState<"all" | "face" | "body" | "clothing" | "other">("all");

  // ── VRC Menu state ────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLoading, setMenuLoading] = useState(false);

  const loadMenu = async () => {
    setMenuLoading(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ filters: [{ name: "VRC Menu", extensions: ["asset"] }] });
      if (!path || typeof path !== "string") return;
      const tree = await parseVrcMenuAsset(path);
      setVrcMenuTree(tree);
      setMenuOpen(true);
    } catch (e) {
      console.error("Failed to load VRC menu:", e);
    } finally {
      setMenuLoading(false);
    }
  };

  return (
    <aside className="w-[268px] shrink-0 flex flex-col bg-zinc-950 border-l border-zinc-900 overflow-y-auto">
      {/* Header */}
      <div className="px-3 py-3 border-b border-zinc-900 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">Physics Mode</span>
          </div>
          <button
            onClick={onStop}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        </div>
      </div>

      {/* Radial wheel */}
      <div className="px-3 py-4 border-b border-zinc-900 flex flex-col items-center">
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 self-start">Expression Wheel</p>
        <RadialWheel />
      </div>

      {/* Expression Params */}
      <div className="border-b border-zinc-900">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/50 transition-colors"
          onClick={() => setParamsOpen((v) => !v)}
        >
          <span className="text-zinc-600 shrink-0">
            {paramsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          <Sliders className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest flex-1 text-left">Parameters</span>
          <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1.5 py-0.5 font-mono">{expressionParams.length}</span>
        </button>
        {paramsOpen && (
          <div className="pb-2 max-h-[220px] overflow-y-auto">
            {expressionParams.length === 0 ? (
              <p className="px-3 py-1 text-[10px] text-zinc-700 italic">No expression params found</p>
            ) : (
              expressionParams.map((param) => (
                <div key={param.name} className="flex items-center gap-2 px-3 py-1">
                  <button
                    onClick={() => setExpressionParamValue(param.name, param.value > 0 ? 0 : 1)}
                    className={`w-2.5 h-2.5 rounded-full border shrink-0 transition-colors ${param.value > 0 ? "bg-zinc-300 border-zinc-500" : "bg-transparent border-zinc-700"}`}
                  />
                  <span className="text-[10px] text-zinc-400 flex-1 truncate">{param.name}</span>
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={param.value}
                    onChange={(e) => setExpressionParamValue(param.name, parseFloat(e.target.value))}
                    className="w-16 h-1 accent-zinc-500"
                  />
                  <span className="text-[9px] text-zinc-600 w-7 text-right font-mono">{param.value.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Blendshapes */}
      <div className="border-b border-zinc-900">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/50 transition-colors"
          onClick={() => setMorphsOpen((v) => !v)}
        >
          <span className="text-zinc-600 shrink-0">
            {morphsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          <Sliders className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest flex-1 text-left">Blendshapes</span>
          <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1.5 py-0.5 font-mono">{morphTargets.length}</span>
        </button>
        {morphsOpen && (
          <div className="pb-2">
            <div className="px-3 pb-2">
              <input
                type="text"
                placeholder="Filter shapes…"
                value={morphSearch}
                onChange={(e) => setMorphSearch(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-[10px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600"
              />
            </div>
            <div className="flex gap-1 px-3 pb-2 flex-wrap">
              {(["all", "face", "body", "clothing", "other"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setMorphCategoryFilter(cat)}
                  className={`text-[9px] px-2 py-0.5 rounded-full border transition-colors capitalize ${
                    morphCategoryFilter === cat
                      ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                      : "border-zinc-800 text-zinc-600 hover:text-zinc-300"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="max-h-[220px] overflow-y-auto">
              {morphTargets
                .filter((m) => {
                  const matchSearch = !morphSearch || m.name.toLowerCase().includes(morphSearch.toLowerCase());
                  const matchCat = morphCategoryFilter === "all" || m.category === morphCategoryFilter;
                  return matchSearch && matchCat;
                })
                .map((morph) => (
                  <div key={morph.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-900/40">
                    <button
                      onClick={() => toggleMorph(morph.name)}
                      className={`w-2.5 h-2.5 rounded-full border shrink-0 transition-colors ${morph.enabled ? "bg-zinc-300 border-zinc-500" : "bg-transparent border-zinc-700"}`}
                    />
                    <span className="text-[10px] text-zinc-400 flex-1 truncate" title={morph.name}>{morph.name}</span>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={morph.value}
                      onChange={(e) => setMorphValue(morph.name, parseFloat(e.target.value))}
                      className="w-16 h-1 accent-zinc-500"
                    />
                    <span className={`text-[9px] w-7 text-right font-mono tabular-nums shrink-0 ${morph.value > 0 ? "text-zinc-300" : "text-zinc-700"}`}>
                      {morph.value.toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Bones */}
      <div className="border-b border-zinc-900">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/50 transition-colors"
          onClick={() => setBonesOpen((v) => !v)}
        >
          <span className="text-zinc-600 shrink-0">
            {bonesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          <Bone className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest flex-1 text-left">Bones</span>
          <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1.5 py-0.5 font-mono">{bones.length}</span>
        </button>
        {bonesOpen && (
          <div className="pb-2 max-h-[200px] overflow-y-auto">
            {bones.length === 0 ? (
              <p className="px-3 py-1 text-[10px] text-zinc-700 italic">No skeleton bones found</p>
            ) : (
              bones.map((bone) => (
                <div key={bone.name} className="flex items-center gap-2 px-3 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-700 shrink-0" />
                  <span className="text-[9px] text-zinc-500 flex-1 truncate">{bone.name}</span>
                  {bone.humanoidRole && <span className="text-[9px] text-zinc-600 font-mono">{bone.humanoidRole}</span>}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── VRC Menu Extractor ────────────────────────────────────────── */}
      <div>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/50 transition-colors"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="text-zinc-600 shrink-0">
            {menuOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          <Layers className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest flex-1 text-left">VRC Menu</span>
        </button>
        {menuOpen && (
          <div className="px-3 pb-3 flex flex-col gap-2">
            {!vrcMenuTree ? (
              <button
                onClick={loadMenu}
                disabled={menuLoading}
                className="w-full py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                {menuLoading ? "Loading…" : "Load .asset menu"}
              </button>
            ) : (
              <>
                <VrcMenuPanel tree={vrcMenuTree} />
                <button
                  onClick={() => setVrcMenuTree(null)}
                  className="text-[9px] text-zinc-700 hover:text-zinc-400 text-left transition-colors"
                >
                  Clear menu
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}