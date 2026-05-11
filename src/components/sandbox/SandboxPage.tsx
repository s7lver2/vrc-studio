// src/components/sandbox/SandboxPage.tsx
import { useState, useRef } from "react";
import { ChevronRight, FlaskConical, Play, Square } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { SandboxViewer, SandboxViewerHandle } from "./SandboxViewer";
import { SandboxSidePanel } from "./SandboxSidePanel";
import { InventoryPickerModal } from "./InventoryPickerModal";
import { usePhysicsStore } from "@/store/physicsStore";
import { PhysicsPanel } from "./PhysicsPanel";

export function SandboxPage() {
  const { baseItem, selectedFile } = useSandboxStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const viewerRef = useRef<SandboxViewerHandle>(null);
  const { active: physicsActive, setActive: setPhysicsActive } = usePhysicsStore();

  return (
    <div className="flex h-screen bg-black overflow-hidden">
      <div className="flex-1 relative">
        {selectedFile ? (
          <>
            <SandboxViewer ref={viewerRef} />
            <div className="absolute top-3 right-3 z-10">
              <button
                onClick={() => setPhysicsActive(!physicsActive)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                  physicsActive
                    ? "bg-red-950 border-red-800 text-red-300 hover:bg-red-900"
                    : "bg-zinc-900/80 border-zinc-700 text-zinc-300 hover:border-zinc-500 backdrop-blur"
                }`}
              >
                {physicsActive ? (
                  <><Square className="h-3 w-3" /> Stop</>
                ) : (
                  <><Play className="h-3 w-3" /> Physics</>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <FlaskConical className="h-12 w-12 text-zinc-800" />
            <p className="text-sm text-zinc-700">Nothing loaded</p>
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
            >
              Select from inventory
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
        {baseItem && (
          <div className="absolute top-3 left-3">
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur border border-zinc-800 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {baseItem.name}
              <ChevronRight className="h-3 w-3 text-zinc-600" />
              <span className="text-zinc-600">{selectedFile?.name ?? "select file…"}</span>
            </button>
          </div>
        )}
      </div>

      {physicsActive ? (
        <PhysicsPanel onStop={() => setPhysicsActive(false)} />
      ) : (
        <SandboxSidePanel viewerRef={viewerRef} onOpenPicker={() => setPickerOpen(true)} />
      )}

      {pickerOpen && <InventoryPickerModal onClose={() => setPickerOpen(false)} />}
    </div>
  );
}