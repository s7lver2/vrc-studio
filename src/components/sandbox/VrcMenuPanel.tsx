import { useState } from "react";
import { ChevronRight, ChevronLeft, ToggleLeft, Circle, Layers, Sliders } from "lucide-react";
import type { VrcMenuControl, VrcMenuTree } from "@/store/sandboxStore";

interface Props {
  tree: VrcMenuTree;
}

const typeIcon: Record<string, React.ReactNode> = {
  Button: <Circle className="h-3 w-3" />,
  Toggle: <ToggleLeft className="h-3 w-3" />,
  SubMenu: <Layers className="h-3 w-3" />,
  RadialPuppet: <Sliders className="h-3 w-3" />,
  TwoAxisPuppet: <Sliders className="h-3 w-3" />,
  FourAxisPuppet: <Sliders className="h-3 w-3" />,
};

const typeColor: Record<string, string> = {
  Button: "text-zinc-400",
  Toggle: "text-emerald-400",
  SubMenu: "text-violet-400",
  RadialPuppet: "text-amber-400",
  TwoAxisPuppet: "text-amber-400",
  FourAxisPuppet: "text-amber-400",
};

export function VrcMenuPanel({ tree }: Props) {
  const [path, setPath] = useState<VrcMenuControl[][]>([tree.controls]);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([tree.name]);

  const current = path[path.length - 1];

  const enter = (ctrl: VrcMenuControl) => {
    if (ctrl.type !== "SubMenu" || !ctrl.subMenu?.length) return;
    setPath((p) => [...p, ctrl.subMenu!]);
    setBreadcrumb((b) => [...b, ctrl.name]);
  };

  const back = () => {
    if (path.length <= 1) return;
    setPath((p) => p.slice(0, -1));
    setBreadcrumb((b) => b.slice(0, -1));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 px-1 flex-wrap">
        {breadcrumb.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-700" />}
            <span className={`text-[10px] ${i === breadcrumb.length - 1 ? "text-zinc-200 font-semibold" : "text-zinc-600"}`}>{seg}</span>
          </span>
        ))}
      </div>

      {path.length > 1 && (
        <button
          onClick={back}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Back
        </button>
      )}

      {current.length === 0 ? (
        <p className="text-[10px] text-zinc-700 italic px-2">Empty menu</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {current.map((ctrl, i) => (
            <button
              key={i}
              onClick={() => enter(ctrl)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-900 transition-colors text-left ${
                ctrl.type === "SubMenu" ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <span className={`shrink-0 ${typeColor[ctrl.type] ?? "text-zinc-500"}`}>
                {typeIcon[ctrl.type]}
              </span>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[11px] text-zinc-200 truncate">{ctrl.name}</span>
                {ctrl.parameter && (
                  <span className="text-[9px] text-zinc-600 font-mono truncate">
                    {ctrl.parameter}
                    {ctrl.value !== undefined ? ` = ${ctrl.value}` : ""}
                  </span>
                )}
              </div>
              {ctrl.type === "SubMenu" && <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}