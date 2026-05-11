// src/components/sandbox/sections/HierarchySection.tsx
import { Layers, Eye, EyeOff, ChevronRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import { SectionBase } from "./SectionBase";
import { useSandboxStore } from "@/store/sandboxStore";
import type { PrefabNode } from "@/types/prefab";

interface Props {
  viewerRef: React.RefObject<any>;
}

export function HierarchySection({ viewerRef }: Props) {
  const { prefabScene, hierarchyVisibility, setNodeVisibility } = useSandboxStore();

  if (!prefabScene || prefabScene.root_nodes.length === 0) {
    return (
      <SectionBase title="Hierarchy" icon={<Layers className="h-3.5 w-3.5" />} defaultOpen={false}>
        <p className="px-3 py-3 text-[10px] text-zinc-700 italic">
          Load a .prefab to explore the scene hierarchy.
        </p>
      </SectionBase>
    );
  }

  return (
    <SectionBase title="Hierarchy" icon={<Layers className="h-3.5 w-3.5" />} defaultOpen>
      <div className="flex flex-col pb-1">
        {prefabScene.root_nodes.map((node) => (
          <HierarchyNode
            key={node.file_id}
            node={node}
            depth={0}
            visibility={hierarchyVisibility}
            onToggle={setNodeVisibility}
          />
        ))}
      </div>
    </SectionBase>
  );
}

function HierarchyNode({
  node,
  depth,
  visibility,
  onToggle,
}: {
  node: PrefabNode;
  depth: number;
  visibility: Record<number, boolean>;
  onToggle: (fileId: number, visible: boolean) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const visible = visibility[node.file_id] ?? node.is_active;

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 hover:bg-zinc-900/50 group rounded"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {/* Expand chevron */}
        <button
          className="w-3.5 h-3.5 shrink-0 flex items-center justify-center text-zinc-700"
          onClick={() => hasChildren && setOpen((o) => !o)}
        >
          {hasChildren ? (
            open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
          ) : (
            <span className="w-1 h-1 rounded-full bg-zinc-800 inline-block" />
          )}
        </button>

        {/* Node name */}
        <span
          className={`flex-1 text-[10px] truncate cursor-default select-none ${
            visible ? "text-zinc-300" : "text-zinc-700 line-through"
          }`}
          title={node.name}
        >
          {node.name}
        </span>

        {/* Visibility toggle — solo visible on hover */}
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mr-1"
          onClick={() => onToggle(node.file_id, !visible)}
          title={visible ? "Hide" : "Show"}
        >
          {visible ? (
            <Eye className="w-3 h-3 text-zinc-500 hover:text-zinc-200" />
          ) : (
            <EyeOff className="w-3 h-3 text-zinc-700 hover:text-zinc-400" />
          )}
        </button>
      </div>

      {open && hasChildren && node.children.map((child) => (
        <HierarchyNode
          key={child.file_id}
          node={child}
          depth={depth + 1}
          visibility={visibility}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}