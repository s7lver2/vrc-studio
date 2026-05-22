import { Eye, Grid3x3, Layers } from "lucide-react";
import { useSandboxStore, type ViewportMode } from "@/store/sandboxStore";

const MODES: { id: ViewportMode; icon: React.ReactNode; label: string }[] = [
  { id: "normal",    icon: <Eye className="h-3.5 w-3.5" />,      label: "Normal" },
  { id: "wireframe", icon: <Grid3x3 className="h-3.5 w-3.5" />, label: "Wireframe" },
  { id: "skeleton",  icon: <Layers className="h-3.5 w-3.5" />,  label: "Skeleton" },
];

export function ViewportModeBar() {
  const { viewportMode, setViewportMode } = useSandboxStore();

  return (
    <div className="absolute top-3 right-3 z-10 flex gap-0.5 bg-zinc-950/80 border border-zinc-800 rounded-lg p-0.5 backdrop-blur-sm">
      {MODES.map(({ id, icon, label }) => (
        <button
          key={id}
          onClick={() => setViewportMode(id)}
          title={label}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors ${
            viewportMode === id
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
          }`}
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}