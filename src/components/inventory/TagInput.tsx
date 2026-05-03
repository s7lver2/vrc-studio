/**
 * TagInput — Smart tag input with autocomplete from existing tags + system tags.
 * Reusable across InventoryItemCard context menu and ScanDriveWizard.
 */

import { useState, useRef, useEffect } from "react";
import { X, Plus, Tag } from "lucide-react";
import { useTagStore, SYSTEM_TAGS } from "../../store/tagStore";
import { useT } from "../../i18n";

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}

// Colors for system tag dots
const SYSTEM_TAG_COLORS: Record<string, string> = {
  avatar:    "bg-blue-400",
  outfit:    "bg-pink-400",
  accessory: "bg-purple-400",
  base:      "bg-amber-400",
  shader:    "bg-green-400",
  animation: "bg-cyan-400",
  texture:   "bg-orange-400",
  material:  "bg-lime-400",
};

export function TagInput({ tags, onChange, placeholder, className = "" }: Props) {
  const t = useT();
  const { allKnownTags, behaviorLabels } = useTagStore();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const allTags = allKnownTags();
  const lowerInput = input.trim().toLowerCase();
  const suggestions = allTags
    .filter((m) => {
      if (tags.includes(m.id)) return false;
      if (!lowerInput) return true;
      return m.id.includes(lowerInput) || (m.label ?? "").toLowerCase().includes(lowerInput);
    })
    .sort((a, b) => {
      if (a.isSystem && !b.isSystem) return -1;
      if (!a.isSystem && b.isSystem) return 1;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 8);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropRef.current?.contains(e.target as Node) || inputRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const addTag = (raw: string) => {
    const clean = raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!clean || tags.includes(clean)) return;
    onChange([...tags, clean]);
    setInput("");
    setOpen(false);
    setHighlightIdx(0);
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => onChange(tags.filter((t) => t !== tag));

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && suggestions[highlightIdx]) addTag(suggestions[highlightIdx].id);
      else if (input.trim()) addTag(input);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const isBehaviorTag = (id: string) =>
    id === behaviorLabels.base || id === behaviorLabels.outfit || id === behaviorLabels.accessory;

  const getTagColor = (id: string) => {
    if (SYSTEM_TAG_COLORS[id]) return SYSTEM_TAG_COLORS[id];
    const meta = allTags.find((m) => m.id === id);
    return meta?.color ?? "bg-zinc-400";
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 min-h-[24px]">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors
                ${isBehaviorTag(tag)
                  ? "border-amber-600/50 bg-amber-950/40 text-amber-200"
                  : "border-zinc-700 bg-zinc-800 text-zinc-300"}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getTagColor(tag)}`} />
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="ml-0.5 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 focus-within:border-zinc-500 transition-colors">
          <Tag className="h-3 w-3 text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setOpen(true); setHighlightIdx(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKey}
            placeholder={placeholder ?? t("tag_input_placeholder")}
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none min-w-0"
          />
          {input.trim() && (
            <button
              onMouseDown={(e) => { e.preventDefault(); addTag(input); }}
              className="shrink-0 h-4 w-4 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          )}
        </div>

        {open && suggestions.length > 0 && (
          <div
            ref={dropRef}
            className="absolute top-full mt-1 left-0 right-0 z-[9999] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
          >
            {suggestions.some((s) => s.isSystem) && !lowerInput && (
              <div className="px-2.5 py-1 border-b border-zinc-800">
                <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">{t("tag_sidebar_system_tags")}</p>
              </div>
            )}
            {suggestions.map((s, i) => {
              const isSystem = s.isSystem;
              const prevSystem = i > 0 && suggestions[i - 1].isSystem;
              const showCustomHeader = !isSystem && (i === 0 || prevSystem) && !lowerInput;
              return (
                <div key={s.id}>
                  {showCustomHeader && (
                    <div className="px-2.5 py-1 border-t border-zinc-800">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">{t("tag_sidebar_custom_tags")}</p>
                    </div>
                  )}
                  <button
                    onMouseDown={(e) => { e.preventDefault(); addTag(s.id); }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                      i === highlightIdx ? "bg-zinc-700 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} />
                    <span className="flex-1 font-mono">{s.id}</span>
                    {s.label && s.label !== s.id && (
                      <span className="text-zinc-500 text-[10px]">{s.label}</span>
                    )}
                    {isSystem && (
                      <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1 ml-auto">{t("tag_sidebar_system")}</span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}