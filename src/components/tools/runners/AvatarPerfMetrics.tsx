// src/components/tools/runners/AvatarPerfMetrics.tsx
import { AnalysisResult, AvatarMetrics, VrcRank } from "../../../lib/tauri";

const RANK_COLORS: Record<VrcRank, { bg: string; text: string }> = {
  Excellent: { bg: "bg-blue-950 border-blue-700", text: "text-blue-300" },
  Good:      { bg: "bg-green-950 border-green-700", text: "text-green-300" },
  Medium:    { bg: "bg-yellow-950 border-yellow-700", text: "text-yellow-300" },
  Poor:      { bg: "bg-orange-950 border-orange-700", text: "text-orange-300" },
  VeryPoor:  { bg: "bg-red-950 border-red-800", text: "text-red-300" },
};

const RANK_LABELS: Record<VrcRank, string> = {
  Excellent: "Excellent",
  Good:      "Good",
  Medium:    "Medium",
  Poor:      "Poor",
  VeryPoor:  "Very Poor",
};

interface MetricDef {
  key: keyof AvatarMetrics;
  label: string;
  icon: string;
  limitGood: number;
  limitPoor: number;
  unit?: string;
}

const PC_METRICS: MetricDef[] = [
  { key: "triangles",              label: "Triángulos",              icon: "🔺", limitGood: 70_000, limitPoor: 70_000 },
  { key: "skinned_mesh_renderers", label: "Skinned Meshes",          icon: "🧊", limitGood: 2,      limitPoor: 8      },
  { key: "mesh_renderers",         label: "Mesh Renderers",          icon: "📐", limitGood: 2,      limitPoor: 8      },
  { key: "material_slots",         label: "Material Slots",          icon: "🎨", limitGood: 8,      limitPoor: 32     },
  { key: "bones",                  label: "Bones",                   icon: "🦴", limitGood: 150,    limitPoor: 400    },
  { key: "physbone_components",    label: "PhysBone Components",     icon: "🌀", limitGood: 8,      limitPoor: 32     },
  { key: "physbone_transforms",    label: "PhysBone Transforms",     icon: "🔗", limitGood: 64,     limitPoor: 256    },
  { key: "physbone_colliders",     label: "PhysBone Colliders",      icon: "⭕", limitGood: 8,      limitPoor: 32     },
  { key: "particle_systems",       label: "Particle Systems",        icon: "✨", limitGood: 8,      limitPoor: 32     },
  { key: "trail_renderers",        label: "Trail / Line Renderers",  icon: "〰️", limitGood: 2,     limitPoor: 8      },
  { key: "lights",                 label: "Realtime Lights",         icon: "💡", limitGood: 0,      limitPoor: 8      },
  { key: "audio_sources",          label: "Audio Sources",           icon: "🔊", limitGood: 4,      limitPoor: 8      },
  { key: "vram_mb",                label: "VRAM estimada",           icon: "🖼", limitGood: 75,     limitPoor: 150, unit: " MB" },
];

function getStatus(value: number, limitGood: number, limitPoor: number): "pass" | "warn" | "fail" {
  if (value <= limitGood) return "pass";
  if (value <= limitPoor) return "warn";
  return "fail";
}

function formatValue(value: number, unit?: string): string {
  if (unit === " MB") return `${value.toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

interface Props {
  result: AnalysisResult;
  activeTab: "metrics" | "recommendations";
  onTabChange: (tab: "metrics" | "recommendations") => void;
}

export function AvatarPerfMetrics({ result, activeTab, onTabChange }: Props) {
  const rank = result.rank_pc;
  const rankStyle = RANK_COLORS[rank];
  const criticalCount = result.recommendations.filter((r) => r.severity === "critical").length;
  const warnCount = result.recommendations.filter((r) => r.severity === "warning").length;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Platform tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-950 shrink-0">
        <button
          onClick={() => onTabChange("metrics")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "metrics"
              ? "text-zinc-100 border-red-500"
              : "text-zinc-500 border-transparent hover:text-zinc-300"
          }`}
        >
          💻 PC &nbsp;
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${rankStyle.bg} ${rankStyle.text}`}>
            {RANK_LABELS[rank]}
          </span>
        </button>
        <button
          className="px-4 py-2.5 text-xs font-semibold text-zinc-600 border-b-2 border-transparent cursor-not-allowed"
          disabled
          title="Quest rank — coming soon"
        >
          📱 Quest &nbsp;
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${RANK_COLORS[result.rank_quest].bg} ${RANK_COLORS[result.rank_quest].text}`}>
            {RANK_LABELS[result.rank_quest]}
          </span>
        </button>
        <button
          onClick={() => onTabChange("recommendations")}
          className={`ml-auto px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "recommendations"
              ? "text-zinc-100 border-red-500"
              : "text-zinc-500 border-transparent hover:text-zinc-300"
          }`}
        >
          💡 Fixes ({criticalCount + warnCount})
        </button>
      </div>

      {/* Metrics list */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
        {PC_METRICS.map((def) => {
          const raw = result.metrics[def.key] as number;
          const status = getStatus(raw, def.limitGood, def.limitPoor);
          const statusIcon = status === "pass" ? "✅" : status === "warn" ? "⚠️" : "❌";
          const borderColor = status === "pass" ? "border-green-600" : status === "warn" ? "border-yellow-500" : "border-red-500";
          const barWidth = Math.min(100, (raw / (def.limitPoor * 1.5)) * 100);
          const barColor = status === "pass" ? "bg-green-500" : status === "warn" ? "bg-yellow-400" : "bg-red-500";

          return (
            <div
              key={def.key}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 border-l-[3px] ${borderColor}`}
            >
              <span className="text-sm flex-shrink-0">{def.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-zinc-400 leading-none mb-0.5">{def.label}</p>
                <p className="text-[10px] text-zinc-600">Good ≤ {def.limitGood.toLocaleString()}{def.unit ?? ""}</p>
              </div>
              <div className="w-14 h-1.5 bg-zinc-800 rounded-full flex-shrink-0">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
              </div>
              <span className="text-xs font-bold text-zinc-200 flex-shrink-0 w-16 text-right tabular-nums">
                {formatValue(raw, def.unit)}
              </span>
              <span className="text-sm flex-shrink-0">{statusIcon}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-3 py-2.5 flex items-center gap-2 shrink-0 bg-zinc-950">
        <p className="text-xs text-zinc-500">
          {criticalCount > 0 && <span className="text-red-400 font-semibold">{criticalCount} crítico{criticalCount !== 1 ? "s" : ""}</span>}
          {criticalCount > 0 && warnCount > 0 && <span className="text-zinc-600"> · </span>}
          {warnCount > 0 && <span className="text-yellow-400">{warnCount} advertencia{warnCount !== 1 ? "s" : ""}</span>}
          {criticalCount === 0 && warnCount === 0 && <span className="text-green-400">Todo bien ✓</span>}
        </p>
        {(criticalCount + warnCount) > 0 && (
          <button
            onClick={() => onTabChange("recommendations")}
            className="ml-auto text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Ver fixes →
          </button>
        )}
      </div>
    </div>
  );
}
