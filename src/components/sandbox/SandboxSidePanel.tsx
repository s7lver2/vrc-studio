import { FlaskConical } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { TransformSection } from "./sections/TransformSection";
import { MaterialSection } from "./sections/MaterialSection";
import { AnimationSection } from "./sections/AnimationSection";
import { ClothingSection } from "./sections/ClothingSection";
import { AnimationTreeSection } from "./sections/AnimationTreeSection";
import { HierarchySection } from "./sections/HierarchySection";
import { AvatarInfoSection } from "./sections/AvatarInfoSection";

interface Props {
  viewerRef: React.RefObject<any>;
  onOpenPicker: () => void;
}

export function SandboxSidePanel({ viewerRef, onOpenPicker }: Props) {
  const { baseItem, selectedFile } = useSandboxStore();

  return (
    <aside className="w-[268px] shrink-0 flex flex-col bg-zinc-950 border-l border-zinc-900 overflow-y-auto">
      <div className="px-3 py-3 border-b border-zinc-900 shrink-0">
        <div className="flex items-center gap-1.5 mb-2">
          <FlaskConical className="h-3.5 w-3.5 text-zinc-600" />
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Inspector</span>
        </div>
        {baseItem ? (
          <button
            onClick={onOpenPicker}
            className="w-full flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-2 hover:border-zinc-700 transition-colors text-left"
          >
            {baseItem.thumbnail_url && (
              <img src={baseItem.thumbnail_url} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-zinc-200 truncate">{baseItem.name}</p>
              <p className="text-[9px] text-zinc-600 truncate">{selectedFile?.name ?? "no file"}</p>
            </div>
          </button>
        ) : (
          <button
            onClick={onOpenPicker}
            className="w-full text-xs text-zinc-600 hover:text-zinc-300 transition-colors py-1"
          >
            + Select item from inventory
          </button>
        )}
      </div>

      {selectedFile ? (
        <div className="flex-1">
          <TransformSection viewerRef={viewerRef} />
          <MaterialSection viewerRef={viewerRef} />
          <AnimationSection viewerRef={viewerRef} />
          <HierarchySection viewerRef={viewerRef} />
          <AvatarInfoSection />
          <AnimationTreeSection viewerRef={viewerRef} />
          <ClothingSection viewerRef={viewerRef} />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-[10px] text-zinc-700 text-center leading-relaxed">
            Select an item and a compatible file to start editing
          </p>
        </div>
      )}
    </aside>
  );
}