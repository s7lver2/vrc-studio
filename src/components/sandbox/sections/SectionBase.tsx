// src/components/sandbox/sections/SectionBase.tsx
/**
 * SectionBase — bloque colapsable estilo Unity Inspector.
 * Cada sección del panel lateral lo reutiliza.
 */
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface SectionBaseProps {
  title: string;
  icon?: React.ReactNode;
  /** Badge pequeño (número de slots, estado, etc.) */
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function SectionBase({ title, icon, badge, defaultOpen = true, children }: SectionBaseProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-900">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/60 transition-colors"
      >
        <span className="text-zinc-600 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        {icon && <span className="shrink-0 text-zinc-500">{icon}</span>}
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest flex-1 text-left">
          {title}
        </span>
        {badge && (
          <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

/** Input numérico de una componente (X/Y/Z) */
export function VectorInput({
  label, value, onChange, color = "text-zinc-400",
}: {
  label: string; value: number; onChange: (v: number) => void; color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <span className={`text-[10px] font-bold w-3 shrink-0 ${color}`}>{label}</span>
      <input
        type="number"
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-200 outline-none focus:border-zinc-600 tabular-nums"
      />
    </div>
  );
}

/** Fila de tres VectorInputs (X, Y, Z) */
export function Vector3Row({
  x, y, z, onX, onY, onZ,
}: {
  x: number; y: number; z: number;
  onX: (v: number) => void; onY: (v: number) => void; onZ: (v: number) => void;
}) {
  return (
    <div className="flex gap-1.5 px-3">
      <VectorInput label="X" value={x} onChange={onX} color="text-red-400" />
      <VectorInput label="Y" value={y} onChange={onY} color="text-green-400" />
      <VectorInput label="Z" value={z} onChange={onZ} color="text-blue-400" />
    </div>
  );
}