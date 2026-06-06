// src/components/tools/InstallProgress.tsx
interface Props {
  progress: number; // 0–1
  step: string;
}

export function InstallProgress({ progress, step }: Props) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-400">{step}</span>
        <span className="text-xs text-zinc-500 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-red-500 rounded-full transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
