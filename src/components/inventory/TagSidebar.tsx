import { useState, useRef, useEffect } from "react";
import { Tag, Plus, Pin, PinOff, X, Pencil, Check } from "lucide-react";
import { useTagStore, SYSTEM_TAGS, TagMeta } from "../../store/tagStore";
import { useInventoryStore } from "../../store/inventoryStore";
import { useT } from "../../i18n";

function TagDot({ color }: { color: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

function TagRow({
  meta,
  count,
  selected,
  pinned,
  onSelect,
  onTogglePin,
  onDelete,
  onRename,
}: {
  meta: TagMeta;
  count: number;
  selected: boolean;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete?: () => void;
  onRename?: (newId: string) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meta.id);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commitEdit = () => {
    if (draft.trim() && onRename) onRename(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
        selected
          ? "bg-zinc-700 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => { if (!editing) onSelect(); }}
    >
      <TagDot color={meta.color} />

      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-red-500"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.stopPropagation(); commitEdit(); }
            if (e.key === "Escape") { setEditing(false); setDraft(meta.id); }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 min-w-0 truncate text-xs">
          {meta.label ?? meta.id}
        </span>
      )}

      <span className="text-[10px] text-zinc-600 shrink-0">{count}</span>

      {hovering && !editing && (
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {onRename && (
            <button
              className="h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
              onClick={() => setEditing(true)}
              title="Rename tag"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
          )}
          <button
            className={`h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 ${pinned ? "text-red-400" : "text-zinc-500 hover:text-zinc-300"}`}
            onClick={onTogglePin}
            title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
          >
            {pinned ? <PinOff className="h-2.5 w-2.5" /> : <Pin className="h-2.5 w-2.5" />}
          </button>
          {onDelete && (
            <button
              className="h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400"
              onClick={onDelete}
              title="Delete tag"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      )}

      {editing && (
        <button
          className="h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 text-green-400 shrink-0"
          onClick={(e) => { e.stopPropagation(); commitEdit(); }}
        >
          <Check className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

export function TagSidebar() {
  const {
    pinnedTags, selectedTag, customTags,
    togglePin, pinTag, selectTag,
    addCustomTag, removeCustomTag, renameCustomTag, getTagMeta,
  } = useTagStore();
  const { items } = useInventoryStore();
  const [creating, setCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const t = useT();

  // Contar tags en uso
  const tagCounts = new Map<string, number>();
  items.forEach((item) => {
    item.tags.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    });
  });

  // System tags: mostrar siempre las que tienen count > 0, el resto con count 0 pero visibles
  const systemTagsWithCount = SYSTEM_TAGS.map((t) => ({
    meta: t,
    count: tagCounts.get(t.id) ?? 0,
  }));

  // Custom tags: todas las conocidas + las que aparecen en ítems pero no están definidas
  const knownCustomIds = new Set(customTags.map((t) => t.id));
  const orphanedCustomTags: { meta: ReturnType<typeof getTagMeta>; count: number }[] = [];
  tagCounts.forEach((count, id) => {
    if (!SYSTEM_TAGS.find((s) => s.id === id) && !knownCustomIds.has(id)) {
      orphanedCustomTags.push({ meta: getTagMeta(id), count });
    }
  });
  const allCustomWithCount = [
    ...customTags.map((t) => ({ meta: t, count: tagCounts.get(t.id) ?? 0 })),
    ...orphanedCustomTags,
  ];

  const handleCreate = () => {
    const name = newTagName.trim();
    if (name) {
      addCustomTag(name);
      const cleanId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (cleanId) pinTag(cleanId);
      setNewTagName("");
    }
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-0.5 mt-4 pt-3 border-t border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 mb-0.5">
        <div className="flex items-center gap-1.5">
          <Tag className="h-3 w-3 text-zinc-500" />
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            {t("tags_title")}
          </span>
        </div>
        <button
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => setCreating(true)}
          title={t("tags_create")}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* New tag input */}
      {creating && (
        <div className="px-2 mb-1">
          <input
            autoFocus
            className="w-full text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200 outline-none focus:border-red-500"
            placeholder={t("tags_placeholder")}
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setCreating(false); setNewTagName(""); }
            }}
            onBlur={() => {
              if (newTagName.trim()) handleCreate();
              else setCreating(false);
            }}
          />
        </div>
      )}

      {/* "All items" row */}
      <button
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
          selectedTag === null
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
        onClick={() => selectTag(null)}
      >
        <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-zinc-500" />
        <span className="flex-1 truncate">{t("tag_sidebar_all_items")}</span>
        <span className="text-[10px] text-zinc-600">{items.length}</span>
      </button>

      {/* ── Sistema ─────────────────────────────────────── */}
      <div className="mt-2 mb-0.5 px-2">
        <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-widest">
          Sistema
        </span>
      </div>
      {systemTagsWithCount.map(({ meta, count }) => (
        <TagRow
          key={meta.id}
          meta={meta}
          count={count}
          selected={selectedTag === meta.id}
          pinned={pinnedTags.includes(meta.id)}
          onSelect={() => selectTag(selectedTag === meta.id ? null : meta.id)}
          onTogglePin={() => togglePin(meta.id)}
        />
      ))}

      {/* ── Custom ──────────────────────────────────────── */}
      {allCustomWithCount.length > 0 && (
        <>
          <div className="mt-2 mb-0.5 px-2">
            <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-widest">
              Custom
            </span>
          </div>
          {allCustomWithCount.map(({ meta, count }) => (
            <TagRow
              key={meta.id}
              meta={meta}
              count={count}
              selected={selectedTag === meta.id}
              pinned={pinnedTags.includes(meta.id)}
              onSelect={() => selectTag(selectedTag === meta.id ? null : meta.id)}
              onTogglePin={() => togglePin(meta.id)}
              onDelete={meta.isSystem ? undefined : () => removeCustomTag(meta.id)}
              onRename={meta.isSystem ? undefined : (newId) => renameCustomTag(meta.id, newId)}
            />
          ))}
        </>
      )}
    </div>
  );
}