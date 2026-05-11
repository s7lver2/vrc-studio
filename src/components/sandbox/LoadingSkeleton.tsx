// src/components/sandbox/LoadingSkeleton.tsx
/**
 * LoadingSkeleton — pulso de carga reutilizable para Sandbox.
 * Úsalo mientras se leen archivos del disco o se carga Three.js.
 */

interface SkeletonProps {
  className?: string;
}

function Bone({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-zinc-800 ${className}`}
      style={{ animationDuration: "1.4s" }}
    />
  );
}

/** Esqueleto para tarjeta de item (80x120) */
export function ItemCardSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-1">
      <Bone className="w-full aspect-square rounded-lg" />
      <Bone className="h-2.5 w-3/4 rounded" />
      <Bone className="h-2 w-1/2 rounded" />
    </div>
  );
}

export function LoadingProgressBar({
  label = "Loading…",
  progress = 0,   // 0-100
}: {
  label?: string;
  progress?: number;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
      {/* Icono */}
      <div className="w-8 h-8 rounded-full border-2 border-zinc-800 border-t-zinc-500 animate-spin" />
      {/* Label */}
      <p className="text-xs text-zinc-500 tracking-wide">{label}</p>
      {/* Barra */}
      <div className="w-48 h-1 bg-zinc-900 rounded-full overflow-hidden">
        <div
          className="h-full bg-zinc-500 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.max(4, progress)}%` }}
        />
      </div>
      {/* Porcentaje */}
      <span className="text-[10px] text-zinc-700 font-mono">{Math.round(progress)}%</span>
    </div>
  );
}

/** Esqueleto para fila de lista */
export function ItemRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <Bone className="w-9 h-9 rounded shrink-0" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Bone className="h-3 w-2/3 rounded" />
        <Bone className="h-2.5 w-1/3 rounded" />
      </div>
    </div>
  );
}

/** Esqueleto para el viewer 3D (pantalla completa) */
export function ViewerSkeleton({ label = "Loading model…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
      {/* Anillo giratorio minimalista */}
      <div className="w-10 h-10 rounded-full border-2 border-zinc-800 border-t-zinc-500 animate-spin" />
      <p className="text-xs text-zinc-600 tracking-wide">{label}</p>
    </div>
  );
}

/** Esqueleto para esfera de material */
export function SphereSkeleton() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Bone className="w-[72px] h-[72px] rounded-full" />
      <Bone className="h-2 w-12 rounded" />
    </div>
  );
}