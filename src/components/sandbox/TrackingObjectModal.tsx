import { X, Box, MapPin, Layers, Bone } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";

export function TrackingObjectModal() {
  const { trackedObjectInfo, setTrackedObjectInfo } = useSandboxStore();
  if (!trackedObjectInfo) return null;

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <Box className="h-3 w-3" />, label: "Object", value: trackedObjectInfo.name },
    { icon: <Layers className="h-3 w-3" />, label: "Mesh", value: trackedObjectInfo.meshName },
    {
      icon: <MapPin className="h-3 w-3" />,
      label: "Position",
      value: `X ${trackedObjectInfo.position.x}  Y ${trackedObjectInfo.position.y}  Z ${trackedObjectInfo.position.z}`,
    },
    { icon: <Layers className="h-3 w-3" />, label: "Material", value: trackedObjectInfo.materialName },
    ...(trackedObjectInfo.boneLinked
      ? [{ icon: <Bone className="h-3 w-3" />, label: "Bone", value: trackedObjectInfo.boneLinked }]
      : []),
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto bg-zinc-950/95 border border-zinc-800 rounded-xl shadow-2xl w-[280px] backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest">Object Info</span>
          <button
            onClick={() => setTrackedObjectInfo(null)}
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="px-4 py-3 flex flex-col gap-2.5">
          {rows.map(({ icon, label, value }) => (
            <div key={label} className="flex items-start gap-2.5">
              <span className="text-zinc-600 mt-0.5 shrink-0">{icon}</span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[9px] text-zinc-600 uppercase tracking-widest">{label}</span>
                <span className="text-[11px] text-zinc-200 font-mono truncate">{value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}