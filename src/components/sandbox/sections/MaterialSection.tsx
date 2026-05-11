// src/components/sandbox/sections/MaterialSection.tsx
import { useState, useRef, useEffect } from "react";
import { Layers } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { SectionBase } from "./SectionBase";
import { MaterialPickerModal } from "../MaterialPickerModal";
import { useMaterialEditorStore } from "@/store/materialEditorStore";
import { MaterialEditorModal } from "../MaterialEditorModal";

interface Props {
  viewerRef: React.RefObject<any>;
}

interface ContextMenu {
  slotIndex: number;
  slotName: string;
  x: number;
  y: number;
}

export function MaterialSection({ viewerRef }: Props) {
  const { materialSlots } = useSandboxStore();
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [ctx, setCtx] = useState<ContextMenu | null>(null);
  const { open: openEditor, slotIndex: editorSlotIndex } = useMaterialEditorStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctx) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtx(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctx]);

  const handleSlotClick = (e: React.MouseEvent, slot: { index: number; name: string }) => {
    e.stopPropagation();
    setCtx({ slotIndex: slot.index, slotName: slot.name, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <SectionBase
        title="Materials"
        icon={<Layers className="h-3.5 w-3.5" />}
        badge={String(materialSlots.length)}
        defaultOpen={true}
      >
        {materialSlots.length === 0 && (
          <p className="px-3 py-2 text-[10px] text-zinc-600">
            No materials detected. Load a model first.
          </p>
        )}
        {materialSlots.map((slot) => (
          <button
            key={slot.index}
            onClick={(e) => handleSlotClick(e, slot)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-zinc-900 transition-colors text-left"
          >
            <div
              className="w-5 h-5 rounded border border-zinc-700 shrink-0"
              style={{ backgroundColor: slot.colorHex }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-zinc-300 truncate">{slot.name}</p>
              <p className="text-[9px] text-zinc-600">
                {slot.hasMap ? "Has texture map" : "No texture"}
              </p>
            </div>
          </button>
        ))}
      </SectionBase>

      {ctx && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[170px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl py-1 text-xs"
          style={{ left: ctx.x, top: ctx.y }}
        >
          <div className="px-3 py-1.5 border-b border-zinc-800 mb-1">
            <p className="text-[10px] text-zinc-400 font-mono truncate max-w-[150px]">{ctx.slotName}</p>
          </div>
          <button
            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
            onClick={() => {
              openEditor(ctx.slotIndex, ctx.slotName);
              setEditorOpen(true);
              setCtx(null);
            }}
          >
            Open Material Editor
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
            onClick={() => { setPickerSlot(ctx.slotIndex); setCtx(null); }}
          >
            Replace Material
          </button>
        </div>
      )}

      {pickerSlot !== null && (
        <MaterialPickerModal
          slotIndex={pickerSlot}
          viewerRef={viewerRef}
          onClose={() => setPickerSlot(null)}
        />
      )}
      {editorOpen && editorSlotIndex !== null && (
        <MaterialEditorModal
          slotIndex={editorSlotIndex}
          viewerRef={viewerRef}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}