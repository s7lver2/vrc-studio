import { useEffect, useState } from "react";
import { X, FlaskConical } from "lucide-react";
import { useShopStore } from "../../store/shopStore";
import { useBoothDepsStore } from "../../store/boothDepsStore";
import { BoothDepCard } from "./BoothDepCard";

interface Props {
  projectPath: string;
  onClose: () => void;
}

export function DependencyResolverModal({ projectPath, onClose }: Props) {
  const { boothOwnedIds } = useShopStore();
  const { deps, pending, loadDeps, resolveDep } = useBoothDepsStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadDeps(projectPath).finally(() => setLoading(false));
  }, [projectPath]);

  const unresolvedDeps = deps.filter((d) => pending.includes(d.source_id));
  const resolvedCount = deps.length - unresolvedDeps.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">Booth Dependencies</h2>
              <span
                className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                style={{
                  background: "rgba(251,191,36,0.12)",
                  border: "1px solid rgba(251,191,36,0.4)",
                  color: "#fbbf24",
                }}
              >
                <FlaskConical className="h-2 w-2" />β
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {loading
                ? "Loading dependencies…"
                : `${resolvedCount} of ${deps.length} resolved`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-zinc-500 text-center py-8">Loading…</p>
          ) : deps.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No dependencies found.</p>
          ) : (
            deps.map((dep) => (
              <BoothDepCard
                key={dep.source_id}
                dep={dep}
                owned={boothOwnedIds.has(dep.source_id)}
                onResolved={resolveDep}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          {unresolvedDeps.length > 0 && (
            <span className="text-xs text-zinc-500 mr-auto self-center">
              {unresolvedDeps.length} pending — you can resolve these later
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            {unresolvedDeps.length === 0 ? "Done" : "Resolve later"}
          </button>
        </div>
      </div>
    </div>
  );
}
