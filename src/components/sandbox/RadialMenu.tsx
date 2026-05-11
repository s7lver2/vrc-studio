// src/components/sandbox/RadialMenu.tsx
/**
 * RadialWheel — rueda radial estilo VRChat, embebida en el sidebar.
 * Muestra 8 segmentos con los primeros 8 expression params.
 */
import { usePhysicsStore } from "@/store/physicsStore";

const WHEEL_SIZE = 240;
const CENTER = WHEEL_SIZE / 2;
const R_OUTER = 108;
const R_INNER = 40;

interface Segment {
  name: string;
  value: number;
  index: number;
}

function buildArcPath(
  cx: number, cy: number,
  r1: number, r2: number,
  startAngle: number, endAngle: number
): string {
  const cos = Math.cos, sin = Math.sin;
  return [
    `M ${cx + r1 * cos(startAngle)} ${cy + r1 * sin(startAngle)}`,
    `L ${cx + r2 * cos(startAngle)} ${cy + r2 * sin(startAngle)}`,
    `A ${r2} ${r2} 0 0 1 ${cx + r2 * cos(endAngle)} ${cy + r2 * sin(endAngle)}`,
    `L ${cx + r1 * cos(endAngle)} ${cy + r1 * sin(endAngle)}`,
    `A ${r1} ${r1} 0 0 0 ${cx + r1 * cos(startAngle)} ${cy + r1 * sin(startAngle)}`,
    "Z",
  ].join(" ");
}

export function RadialWheel() {
  const { expressionParams, setExpressionParamValue, morphTargets, toggleMorph } = usePhysicsStore();

  const source: Segment[] = (expressionParams.length > 0 ? expressionParams : morphTargets)
    .slice(0, 8)
    .map((p, i) => ({ name: p.name, value: p.value, index: i }));

  const handleClick = (seg: Segment) => {
    if (expressionParams.length > 0) {
      const param = expressionParams[seg.index];
      setExpressionParamValue(param.name, param.value > 0 ? 0 : 1);
    } else {
      const mt = morphTargets[seg.index];
      toggleMorph(mt.name);
    }
  };

  const count = source.length || 8;
  const sliceAngle = (2 * Math.PI) / count;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
        {source.map((seg, i) => {
          const start = i * sliceAngle - Math.PI / 2;
          const end = start + sliceAngle - 0.04;
          const mid = start + sliceAngle / 2;
          const lx = CENTER + ((R_INNER + R_OUTER) / 2) * Math.cos(mid);
          const ly = CENTER + ((R_INNER + R_OUTER) / 2) * Math.sin(mid);
          const active = seg.value > 0;

          return (
            <g key={seg.name} onClick={() => handleClick(seg)} style={{ cursor: "pointer" }}>
              <path
                d={buildArcPath(CENTER, CENTER, R_INNER, R_OUTER, start, end)}
                fill={active ? "#52525b" : "#18181b"}
                stroke={active ? "#71717a" : "#27272a"}
                strokeWidth="1"
                className="transition-all duration-150"
              />
              <circle
                cx={CENTER + (R_OUTER - 10) * Math.cos(mid)}
                cy={CENTER + (R_OUTER - 10) * Math.sin(mid)}
                r={active ? 4 : 2.5}
                fill={active ? "#e4e4e7" : "#3f3f46"}
              />
              {count <= 8 && (
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={active ? "#e4e4e7" : "#52525b"}
                  fontSize="7.5"
                  fontWeight={active ? "600" : "400"}
                  fontFamily="system-ui, sans-serif"
                >
                  {seg.name.length > 9 ? seg.name.slice(0, 9) + "…" : seg.name}
                </text>
              )}
            </g>
          );
        })}
        {Array.from({ length: Math.max(0, 8 - source.length) }).map((_, i) => {
          const idx = source.length + i;
          const start = idx * sliceAngle - Math.PI / 2;
          const end = start + sliceAngle - 0.04;
          return (
            <path
              key={`empty-${i}`}
              d={buildArcPath(CENTER, CENTER, R_INNER, R_OUTER, start, end)}
              fill="#0f0f10"
              stroke="#1c1c1e"
              strokeWidth="1"
              opacity="0.5"
            />
          );
        })}
        <circle cx={CENTER} cy={CENTER} r={R_INNER - 4} fill="#09090b" stroke="#27272a" strokeWidth="1.5" />
        <text x={CENTER} y={CENTER - 5} textAnchor="middle" fill="#3f3f46" fontSize="8" fontFamily="system-ui">VRC</text>
        <text x={CENTER} y={CENTER + 6} textAnchor="middle" fill="#3f3f46" fontSize="8" fontFamily="system-ui">Studio</text>
      </svg>
      <p className="text-[9px] text-zinc-700">Click segment to toggle</p>
    </div>
  );
}

// Legacy export for backward compat – no overlay
export function RadialMenu({ onClose }: { onClose: () => void }) {
  return null;
}