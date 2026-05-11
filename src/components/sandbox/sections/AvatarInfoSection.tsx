// src/components/sandbox/sections/AvatarInfoSection.tsx
import { User, Eye, Mic, CheckCircle, XCircle } from "lucide-react";
import { SectionBase } from "./SectionBase";
import { useSandboxStore } from "@/store/sandboxStore";

const LIP_SYNC_LABELS: Record<number, string> = {
  0: "VisemeBlendShape",
  1: "VisemeParameterOnly",
  2: "JawFlapBone",
  3: "JawFlapBlendShape",
};

export function AvatarInfoSection() {
  const { prefabScene } = useSandboxStore();

  if (!prefabScene?.avatar_info.has_vrc_descriptor) {
    return (
      <SectionBase title="Avatar Info" icon={<User className="h-3.5 w-3.5" />} defaultOpen={false}>
        <p className="px-3 py-3 text-[10px] text-zinc-700 italic">
          No VRC_AvatarDescriptor found in this prefab.
        </p>
      </SectionBase>
    );
  }

  const { avatar_info } = prefabScene;

  const rows: { label: string; value: string; icon: React.ReactNode }[] = [
    {
      label: "VRC Descriptor",
      value: "Detected",
      icon: <CheckCircle className="w-3 h-3 text-emerald-400" />,
    },
  ];

  if (avatar_info.view_position) {
    const [x, y, z] = avatar_info.view_position;
    rows.push({
      label: "View Position",
      value: `x:${x.toFixed(3)}  y:${y.toFixed(3)}  z:${z.toFixed(3)}`,
      icon: <Eye className="w-3 h-3 text-zinc-500" />,
    });
  }

  if (avatar_info.lip_sync_mode !== null && avatar_info.lip_sync_mode !== undefined) {
    rows.push({
      label: "Lip Sync",
      value: LIP_SYNC_LABELS[avatar_info.lip_sync_mode] ?? `Mode ${avatar_info.lip_sync_mode}`,
      icon: <Mic className="w-3 h-3 text-zinc-500" />,
    });
  }

  // Extraer estadísticas de jerarquía del prefab
  const prefab = prefabScene;
  function countNodes(nodes: typeof prefab.root_nodes): number {
    return nodes.reduce((acc, n) => acc + 1 + countNodes(n.children), 0);
  }
  const totalNodes = countNodes(prefab.root_nodes);
  const animLayerCount = prefab.anim_layers.length;
  const totalStates = prefab.anim_layers.reduce((acc, l) => acc + l.states.length, 0);

  return (
    <SectionBase title="Avatar Info" icon={<User className="h-3.5 w-3.5" />} defaultOpen>
      <div className="flex flex-col gap-px px-3 pb-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 py-1 border-b border-zinc-900 last:border-0">
            <span className="shrink-0">{row.icon}</span>
            <span className="text-[9px] text-zinc-600 w-20 shrink-0">{row.label}</span>
            <span className="text-[10px] text-zinc-300 font-mono truncate">{row.value}</span>
          </div>
        ))}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          {[
            { label: "Objects", value: totalNodes },
            { label: "Anim Layers", value: animLayerCount },
            { label: "States", value: totalStates },
          ].map((s) => (
            <div key={s.label} className="rounded-md bg-zinc-900/60 border border-zinc-800/60 px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-200">{s.value}</p>
              <p className="text-[8px] text-zinc-700 uppercase tracking-wide mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </SectionBase>
  );
}