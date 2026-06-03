import { AlertTriangle } from "lucide-react";
import { useBoothDepsStore } from "../../store/boothDepsStore";

interface Props {
  onOpenResolver: () => void;
}

export function DependencyStatusPanel({ onOpenResolver }: Props) {
  const { pending } = useBoothDepsStore();

  if (pending.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
      <p className="text-sm text-amber-300 flex-1">
        <span className="font-medium">
          {pending.length} Booth {pending.length === 1 ? "dependency" : "dependencies"} pending.
        </span>
        {" "}Some assets may be missing from this project.
      </p>
      <button
        onClick={onOpenResolver}
        className="text-xs px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors flex-shrink-0"
      >
        Resolve
      </button>
    </div>
  );
}
