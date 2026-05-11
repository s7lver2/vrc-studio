import { create } from "zustand";

// System-defined tags with associated styles
export interface TagMeta {
  id: string;           // the tag string itself
  isSystem: boolean;
  color: string;        // tailwind bg class for the dot
  label?: string;       // display name if different from id
}

export const SYSTEM_TAGS: TagMeta[] = [
  { id: "avatar",    isSystem: true, color: "bg-blue-400",   label: "Avatar" },
  { id: "outfit",    isSystem: true, color: "bg-pink-400",   label: "Outfit" },
  { id: "accessory", isSystem: true, color: "bg-purple-400", label: "Accessory" },
  { id: "base",      isSystem: true, color: "bg-amber-400",  label: "Base" },
  { id: "shader",    isSystem: true, color: "bg-green-400",  label: "Shader" },
  { id: "animation", isSystem: true, color: "bg-cyan-400",   label: "Animation" },
  { id: "texture",   isSystem: true, color: "bg-orange-400", label: "Texture" },
  { id: "material",  isSystem: true, color: "bg-lime-400",   label: "Material" },
];

const CUSTOM_COLORS = [
  "bg-red-400", "bg-rose-400", "bg-fuchsia-400", "bg-violet-400",
  "bg-indigo-400", "bg-sky-400", "bg-teal-400", "bg-emerald-400",
  "bg-lime-400", "bg-yellow-400",
];

// ── Behavior labels ───────────────────────────────────────────────────────────
export type BehaviorSlot = "base" | "outfit" | "accessory";

export interface BehaviorLabels {
  base: string;      // default: "base"
  outfit: string;    // default: "outfit"
  accessory: string; // default: "accessory"
}

const DEFAULT_BEHAVIOR_LABELS: BehaviorLabels = {
  base: "base",
  outfit: "outfit",
  accessory: "accessory",
};

const BEHAVIOR_LABELS_KEY = "inventory:behaviorLabels";

function loadBehaviorLabels(): BehaviorLabels {
  try {
    const raw = localStorage.getItem(BEHAVIOR_LABELS_KEY);
    if (raw) return { ...DEFAULT_BEHAVIOR_LABELS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_BEHAVIOR_LABELS };
}

function saveBehaviorLabels(labels: BehaviorLabels) {
  try { localStorage.setItem(BEHAVIOR_LABELS_KEY, JSON.stringify(labels)); } catch {}
}

const SIDEBAR_KEY = "inventory:pinnedTags";
const CUSTOM_TAGS_KEY = "inventory:customTags";

function loadPinned(): string[] {
  try { return JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? "[]"); } catch { return []; }
}
function savePinned(tags: string[]) {
  try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(tags)); } catch {}
}
function loadCustomTags(): TagMeta[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TAGS_KEY) ?? "[]"); } catch { return []; }
}
function saveCustomTags(tags: TagMeta[]) {
  try { localStorage.setItem(CUSTOM_TAGS_KEY, JSON.stringify(tags)); } catch {}
}

interface TagState {
  pinnedTags: string[];
  customTags: TagMeta[];
  selectedTag: string | null;
  behaviorLabels: BehaviorLabels;

  pinTag: (id: string) => void;
  unpinTag: (id: string) => void;
  togglePin: (id: string) => void;
  selectTag: (id: string | null) => void;
  addCustomTag: (id: string) => void;
  removeCustomTag: (id: string) => void;
  renameCustomTag: (oldId: string, newId: string) => void;
  setBehaviorLabel: (slot: BehaviorSlot, value: string) => void;

  getTagMeta: (id: string) => TagMeta;
  allKnownTags: () => TagMeta[];
  resolveItemBehavior: (tags: string[]) => BehaviorSlot | "material" | "shader" | null;
}

export const useTagStore = create<TagState>((set, get) => {
  const initPinned = loadPinned();
  const initCustom = loadCustomTags();
  const initBehavior = loadBehaviorLabels();

  return {
    pinnedTags: initPinned,
    customTags: initCustom,
    selectedTag: null,
    behaviorLabels: initBehavior,

    pinTag: (id) => set((s) => {
      if (s.pinnedTags.includes(id)) return s;
      const next = [...s.pinnedTags, id];
      savePinned(next);
      return { pinnedTags: next };
    }),

    unpinTag: (id) => set((s) => {
      const next = s.pinnedTags.filter((t) => t !== id);
      savePinned(next);
      return { pinnedTags: next, selectedTag: s.selectedTag === id ? null : s.selectedTag };
    }),

    togglePin: (id) => {
      const s = get();
      if (s.pinnedTags.includes(id)) s.unpinTag(id);
      else s.pinTag(id);
    },

    selectTag: (id) => set({ selectedTag: id }),

    addCustomTag: (id) => {
      const clean = id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (!clean) return;
      const s = get();
      if (s.customTags.some((t) => t.id === clean) || SYSTEM_TAGS.some((t) => t.id === clean)) return;
      const color = CUSTOM_COLORS[s.customTags.length % CUSTOM_COLORS.length];
      const next: TagMeta[] = [...s.customTags, { id: clean, isSystem: false, color }];
      saveCustomTags(next);
      set({ customTags: next });
    },

    addUserTag: (id: string) => {
      const clean = id.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (!clean) return;
      set((s) => {
        if (s.userTags?.some((t) => t.id === clean)) return s;
        return {
          userTags: [...(s.userTags ?? []), { id: clean, label: clean, isSystem: false, color: "bg-zinc-400" }],
        };
      });
    },

    removeCustomTag: (id) => set((s) => {
      const next = s.customTags.filter((t) => t.id !== id);
      saveCustomTags(next);
      const pinnedNext = s.pinnedTags.filter((t) => t !== id);
      savePinned(pinnedNext);
      return { customTags: next, pinnedTags: pinnedNext, selectedTag: s.selectedTag === id ? null : s.selectedTag };
    }),

    renameCustomTag: (oldId, newId) => {
      const clean = newId.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (!clean || clean === oldId) return;
      set((s) => {
        const next = s.customTags.map((t) => t.id === oldId ? { ...t, id: clean } : t);
        saveCustomTags(next);
        const pinnedNext = s.pinnedTags.map((t) => t === oldId ? clean : t);
        savePinned(pinnedNext);
        return { customTags: next, pinnedTags: pinnedNext, selectedTag: s.selectedTag === oldId ? clean : s.selectedTag };
      });
    },

    setBehaviorLabel: (slot, value) => {
      const clean = value.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (!clean) return;
      set((s) => {
        const next = { ...s.behaviorLabels, [slot]: clean };
        saveBehaviorLabels(next);
        return { behaviorLabels: next };
      });
    },

    getTagMeta: (id) => {
      const sys = SYSTEM_TAGS.find((t) => t.id === id);
      if (sys) return sys;
      const custom = get().customTags.find((t) => t.id === id);
      if (custom) return custom;
      return { id, isSystem: false, color: "bg-zinc-400" };
    },

    allKnownTags: () => {
      return [...SYSTEM_TAGS, ...get().customTags];
    },

    resolveItemBehavior: (tags) => {
      const { behaviorLabels } = get();
      if (tags.includes(behaviorLabels.base)) return "base";
      if (tags.includes(behaviorLabels.outfit)) return "outfit";
      if (tags.includes(behaviorLabels.accessory)) return "accessory";
      if (tags.includes("material") || tags.includes("texture")) return "material";
      if (tags.includes("shader")) return "shader";
      return null;
    },
  };
});