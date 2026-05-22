// src/components/inventory/ImportSourcePicker.tsx
import { HardDrive, Upload, Link, X } from "lucide-react";

export type ImportSource = "scan" | "local" | "url";

interface Props {
  onSelect: (source: ImportSource) => void;
  onClose: () => void;
}

const OPTIONS: { id: ImportSource; icon: React.ReactNode; label: string; sub: string }[] = [
  {
    id: "scan",
    icon: <HardDrive className="h-8 w-8 text-zinc-300" />,
    label: "Scan Hard Drive",
    sub: "Auto-detect assets",
  },
  {
    id: "local",
    icon: <Upload className="h-8 w-8 text-zinc-300" />,
    label: "Manual Import",
    sub: "Pick a .zip / .unitypackage",
  },
  {
    id: "url",
    icon: <Link className="h-8 w-8 text-zinc-300" />,
    label: "Import from URL",
    sub: "Pixeldrain, direct links…",
  },
];

export function ImportSourcePicker({ onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">Import Asset</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-500 -mt-2">Select where to find the file</p>
        <div className="grid grid-cols-3 gap-3">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className="flex flex-col items-center gap-3 py-6 px-3 rounded-xl border border-zinc-700 bg-zinc-900
                         hover:border-zinc-500 hover:bg-zinc-800 transition-all text-center group"
            >
              <div className="text-zinc-400 group-hover:text-zinc-200 transition-colors">
                {opt.icon}
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">
                  {opt.label}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">{opt.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}