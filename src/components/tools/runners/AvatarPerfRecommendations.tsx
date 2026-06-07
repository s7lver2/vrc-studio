// src/components/tools/runners/AvatarPerfRecommendations.tsx
import { Recommendation } from "../../../lib/tauri";

interface Props {
  recommendations: Recommendation[];
}

export function AvatarPerfRecommendations({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-green-400">
        ✓ No hay problemas detectados
      </div>
    );
  }

  const critical = recommendations.filter((r) => r.severity === "critical");
  const warnings = recommendations.filter((r) => r.severity === "warning");

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      {critical.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider px-1 pt-1">
            Críticos
          </p>
          {critical.map((rec, i) => (
            <RecommendationCard key={i} rec={rec} />
          ))}
        </>
      )}
      {warnings.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider px-1 pt-2">
            Advertencias
          </p>
          {warnings.map((rec, i) => (
            <RecommendationCard key={i} rec={rec} />
          ))}
        </>
      )}
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const isCritical = rec.severity === "critical";
  const borderColor = isCritical ? "border-red-700" : "border-yellow-600";
  const badgeStyle = isCritical
    ? "bg-red-950 text-red-400 border-red-800"
    : "bg-yellow-950 text-yellow-400 border-yellow-800";

  return (
    <div className={`bg-zinc-900 border border-zinc-800 border-l-2 ${borderColor} rounded-xl p-3 flex flex-col gap-1.5`}>
      <div className="flex items-center gap-2">
        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badgeStyle}`}>
          {isCritical ? "Crítico" : "Warning"}
        </span>
        <span className="text-[10px] font-semibold text-zinc-300 flex-1">
          {rec.current_value} <span className="text-zinc-600 font-normal">→ Good: {rec.limit_good}</span>
        </span>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">{rec.message}</p>
    </div>
  );
}