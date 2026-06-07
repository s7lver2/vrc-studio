// src/components/tools/FeaturedCarousel.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ToolRegistryEntry } from "../../lib/tauri";

interface Props {
  tools: ToolRegistryEntry[];
  onSelect: (tool: ToolRegistryEntry) => void;
}

export function FeaturedCarousel({ tools, onSelect }: Props) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((index: number) => {
    setCurrent(((index % tools.length) + tools.length) % tools.length);
  }, [tools.length]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  useEffect(() => {
    if (paused || tools.length <= 1) return;
    timerRef.current = setInterval(next, 4000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [paused, next, tools.length]);

  if (tools.length === 0) return null;

  const tool = tools[current];

  return (
    <div
      className="relative w-full h-52 rounded-2xl overflow-hidden cursor-pointer group select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => onSelect(tool)}
    >
      {/* Background image */}
      {tool.banner_url ? (
        <img
          src={tool.banner_url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-800" />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/50 to-transparent" />

      {/* Tool info */}
      <div className="absolute bottom-0 left-0 right-0 p-5 flex items-end gap-4">
        {/* Icon */}
        <div className="w-12 h-12 rounded-xl bg-zinc-900/80 border border-zinc-700 flex items-center justify-center shrink-0 backdrop-blur-sm">
          {tool.icon_url ? (
            <img src={tool.icon_url} alt="" className="w-8 h-8 object-contain" />
          ) : <span className="text-xl">🛠</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[9px] font-bold tracking-widest uppercase text-zinc-400">Destacada</span>
            {tool.category && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 backdrop-blur-sm">
                {tool.category}
              </span>
            )}
          </div>
          <p className="text-base font-bold text-zinc-100 truncate">{tool.name}</p>
          <p className="text-xs text-zinc-400 truncate">{tool.description}</p>
        </div>
      </div>

      {/* Prev / Next arrows — visible on hover */}
      <button
        className="absolute left-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-zinc-900/70 border border-zinc-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800 backdrop-blur-sm z-10"
        onClick={(e) => { e.stopPropagation(); prev(); }}
        aria-label="Anterior"
      >
        <ChevronLeft className="h-3.5 w-3.5 text-zinc-200" />
      </button>
      <button
        className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-zinc-900/70 border border-zinc-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800 backdrop-blur-sm z-10"
        onClick={(e) => { e.stopPropagation(); next(); }}
        aria-label="Siguiente"
      >
        <ChevronRight className="h-3.5 w-3.5 text-zinc-200" />
      </button>

      {/* Dot indicators */}
      {tools.length > 1 && (
        <div className="absolute bottom-3 right-4 flex gap-1.5 z-10">
          {tools.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goTo(i); }}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current
                  ? "w-4 bg-zinc-100"
                  : "w-1.5 bg-zinc-500 hover:bg-zinc-400"
              }`}
              aria-label={`Ir a ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}