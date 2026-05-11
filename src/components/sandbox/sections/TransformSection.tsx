import { Move } from "lucide-react";
import { useSandboxStore } from "@/store/sandboxStore";
import { SectionBase, Vector3Row } from "./SectionBase";

function safeNum(v: number): number {
  return isFinite(v) ? v : 0;
}

interface Props {
  viewerRef: React.RefObject<any>;
}

export function TransformSection({ viewerRef }: Props) {
  const { transform, setTransform } = useSandboxStore();

  const applyToModel = (partial: Partial<typeof transform>) => {
    setTransform(partial);
    const model = viewerRef.current?.model;
    if (!model) return;
    const next = { ...transform, ...partial };
    model.position.set(safeNum(next.px), safeNum(next.py), safeNum(next.pz));
    const toRad = (d: number) => (safeNum(d) * Math.PI) / 180;
    model.rotation.set(toRad(next.rx), toRad(next.ry), toRad(next.rz));
    model.scale.set(safeNum(next.sx), safeNum(next.sy), safeNum(next.sz));
  };

  const resetTransform = () => applyToModel({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });

  return (
    <SectionBase title="Transform" icon={<Move className="h-3.5 w-3.5" />} defaultOpen={true}>
      <div className="px-3 pt-1 pb-0.5">
        <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-semibold">Position</span>
      </div>
      <Vector3Row
        x={safeNum(transform.px)} y={safeNum(transform.py)} z={safeNum(transform.pz)}
        onX={(v) => applyToModel({ px: v })}
        onY={(v) => applyToModel({ py: v })}
        onZ={(v) => applyToModel({ pz: v })}
      />
      <div className="px-3 pt-2 pb-0.5">
        <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-semibold">Rotation</span>
      </div>
      <Vector3Row
        x={safeNum(transform.rx)} y={safeNum(transform.ry)} z={safeNum(transform.rz)}
        onX={(v) => applyToModel({ rx: v })}
        onY={(v) => applyToModel({ ry: v })}
        onZ={(v) => applyToModel({ rz: v })}
      />
      <div className="px-3 pt-2 pb-0.5">
        <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-semibold">Scale</span>
      </div>
      <Vector3Row
        x={safeNum(transform.sx)} y={safeNum(transform.sy)} z={safeNum(transform.sz)}
        onX={(v) => applyToModel({ sx: v })}
        onY={(v) => applyToModel({ sy: v })}
        onZ={(v) => applyToModel({ sz: v })}
      />
      <div className="px-3 pt-2">
        <button onClick={resetTransform} className="text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors">
          Reset transform
        </button>
      </div>
    </SectionBase>
  );
}