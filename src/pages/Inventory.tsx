// 📁 src/pages/Inventory.tsx

import { useState, useRef, useEffect } from "react";
import {
  LayoutGrid, List, Upload, HardDrive, Search, X,
  Tag, User, FileText, ChevronDown, ChevronLeft,
  SortAsc, Archive, Globe, Shapes, FolderOpen 
} from "lucide-react";
import { InventoryGrid } from "../components/inventory/InventoryGrid";
import { InventoryItemDetail } from "../components/inventory/InventoryItemDetail";
import { ImportLocalDialog } from "../components/inventory/ImportLocalDialog";
import { ScanDriveWizard } from "../components/inventory/ScanDriveWizard";
import { useInventory } from "../hooks/useInventory";
import { useInventoryStore, parseSearchQuery } from "../store/inventoryStore";
import { SortModal } from "@/components/inventory/SortModal";
import { InventoryOptionsMenu } from "@/components/inventory/InventoryOptionsMenu";
import { MultiSelectToolbar } from "@/components/inventory/MultiSelectToolbar";
import { useTagStore } from "../store/tagStore";
import { useT } from "../i18n";

// ── Search suggestions ────────────────────────────────────────────────────────

interface Suggestion {
  text: string;
  completion: string;
  icon: React.ReactNode;
  description: string;
}

// ── Active filter chips ────────────────────────────────────────────────────────

function FilterChip({
  label, value, color, onRemove,
}: { label: string; value: string; color: string; onRemove: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${color}`}>
      <span className="font-semibold opacity-70">{label}:</span>
      <span>{value}</span>
      <button onClick={onRemove} className="ml-0.5 opacity-60 hover:opacity-100">
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ── Advanced search bar ────────────────────────────────────────────────────────

function AdvancedSearchBar({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const { allKnownTags } = useTagStore();
  const [focused, setFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);  // <- NUEVO

  const parsed = parseSearchQuery(value);
  const allTagIds = allKnownTags().map((m) => m.id);
  
  const buildSuggestions = (raw: string): Suggestion[] => {
    const lower = raw.toLowerCase();
    const syntaxSuggestions: Suggestion[] = [];
    if ("tags:".startsWith(lower) || lower === "") {
      syntaxSuggestions.push({
        text: "tags:",
        completion: "tags:",
        icon: <Tag className="h-3 w-3 text-amber-400" />,
        description: t("inventory_search_tip_tags"),
      });
    }
    if ("author:".startsWith(lower) || lower === "") {
      syntaxSuggestions.push({
        text: "author:",
        completion: "author:",
        icon: <User className="h-3 w-3 text-blue-400" />,
        description: t("inventory_search_tip_author"),
      });
    }
    if ("name:".startsWith(lower) || lower === "") {
      syntaxSuggestions.push({
        text: "name:",
        completion: "name:",
        icon: <FileText className="h-3 w-3 text-zinc-400" />,
        description: t("inventory_search_tip_name"),
      });
    }
    if (lower.startsWith("tags:") || lower.startsWith("tag:")) {
      const prefix = lower.includes("tags:") ? "tags:" : "tag:";
      const partial = lower.slice(prefix.length);
      return allTagIds
        .filter((tag) => tag.startsWith(partial))
        .slice(0, 8)
        .map((tag) => ({
          text: `tags:${tag}`,
          completion: `${prefix}${tag}`,
          icon: <Tag className="h-3 w-3 text-amber-400" />,
          description: tag,
        }));
    }
    const EXTRA_OPERATORS: Suggestion[] = [
      {
        text: "type:",
        completion: "type:",
        icon: <Shapes className="h-3 w-3 text-purple-400" />,
        description: "avatar · outfit · accessory · base",
      },
      {
        text: "source:",
        completion: "source:",
        icon: <Globe className="h-3 w-3 text-pink-400" />,
        description: "booth · local · riperstore",
      },
      {
        text: "compressed:yes",
        completion: "compressed:yes",
        icon: <Archive className="h-3 w-3 text-amber-400" />,
        description: "solo comprimidos",
      },
      {
        text: "size:>",
        completion: "size:>",
        icon: <HardDrive className="h-3 w-3 text-blue-400" />,
        description: "size:>10 · size:<100 (MB)",
      },
      {
        text: "folder:",
        completion: "folder:",
        icon: <FolderOpen className="h-3 w-3 text-amber-400" />,
        description: "nombre de carpeta",
      },
    ];

    const buildSuggestions = (raw: string): Suggestion[] => {
      const lower = raw.toLowerCase();
      const coreSuggestions = [...syntaxSuggestions]; // los existentes (tags:, author:, name:)

      // Completions para type: con valores
      if (lower.startsWith("type:")) {
        const partial = lower.slice(5);
        const types = ["avatar", "outfit", "accessory", "base", "shader", "animation", "texture", "material"];
        return types
          .filter((t) => t.startsWith(partial))
          .map((t) => ({
            text: `type:${t}`,
            completion: `type:${t}`,
            icon: <Shapes className="h-3 w-3 text-purple-400" />,
            description: t,
          }));
      }

      // Completions para source:
      if (lower.startsWith("source:")) {
        const partial = lower.slice(7);
        const sources = ["booth", "local", "riperstore"];
        return sources
          .filter((s) => s.startsWith(partial))
          .map((s) => ({
            text: `source:${s}`,
            completion: `source:${s}`,
            icon: <Globe className="h-3 w-3 text-pink-400" />,
            description: s,
          }));
      }

      // Mostrar todos los operadores cuando está vacío o hay coincidencia de prefijo
      const allOps = [...coreSuggestions, ...EXTRA_OPERATORS];
      if (!lower) return allOps.slice(0, 8);

      return allOps
        .filter((s) => s.text.startsWith(lower))
        .slice(0, 8);
    };
    
    return syntaxSuggestions.slice(0, 5);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const suggestions = buildSuggestions(value);

  const applySuggestion = (s: Suggestion) => {
    onChange(s.completion);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const hasFilters = parsed.tags.length > 0 || parsed.authors.length > 0 || parsed.names.length > 0;

  return (
    <div className="flex flex-col gap-2" ref={containerRef}>
      <div className="relative flex items-center">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
        <input
          ref={inputRef}
          className="w-full pl-9 pr-8 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors"
          placeholder={t("inventory_search_placeholder")}
          value={value}
          onChange={(e) => { onChange(e.target.value); setShowSuggestions(true); }}
          onFocus={() => { setFocused(true); setShowSuggestions(true); }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { onChange(""); setShowSuggestions(false); }
          }}
        />
        {value && (
          <button
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => { onChange(""); inputRef.current?.focus(); }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={menuRef}
            className="absolute top-full mt-1 left-0 right-0 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
          >
            <div className="px-3 py-1.5 border-b border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Suggestions</p>
            </div>
            {suggestions.map((s) => (
              <button
                key={s.completion}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
              >
                {s.icon}
                <span className="font-mono text-zinc-200">{s.text}</span>
                <span className="text-zinc-500 text-[10px] ml-auto">{s.description}</span>
              </button>
            ))}
            <div className="border-t border-zinc-800 px-3 py-1.5">
              <p className="text-[10px] text-zinc-600">
                <span className="font-mono text-zinc-500">tags:base</span> · <span className="font-mono text-zinc-500">author:yoshino</span> · <span className="font-mono text-zinc-500">name:shadowveil</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t("inventory_active_filters")}:</span>
          {parsed.tags.map((tag) => (
            <FilterChip key={`tag-${tag}`} label="Tag" value={tag} color="bg-amber-950/60 text-amber-400 border-amber-800/60" onRemove={() => onChange(value.replace(new RegExp(`\\s*tags:${tag}\\s*`, "g"), " ").trim())} />
          ))}
          {parsed.authors.map((author) => (
            <FilterChip key={`author-${author}`} label="Author" value={author} color="bg-blue-950/60 text-blue-400 border-blue-800/60" onRemove={() => onChange(value.replace(new RegExp(`\\s*author:${author}\\s*`, "g"), " ").trim())} />
          ))}
          {parsed.names.map((name) => (
            <FilterChip key={`name-${name}`} label="Name" value={name} color="bg-zinc-800 text-zinc-400 border-zinc-700/60" onRemove={() => onChange(value.replace(new RegExp(`\\s*name:${name}\\s*`, "g"), " ").trim())} />
          ))}
          <button
            className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
            onClick={() => onChange("")}
          >
            {t("inventory_clear_filters")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Inventory() {
  const t = useT();
  const { viewMode, setViewMode, searchQuery, setSearchQuery } = useInventory();
  const { selectedItem, selectItem, selectedFolderId, selectFolder, folders } = useInventoryStore();
  const [showImport, setShowImport] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const { sortField, sortDir } = useInventoryStore();
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  const currentFolder = folders.find((f) => f.id === selectedFolderId);

  return (
    <div className="flex h-full overflow-hidden">
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-8 py-5 shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">{t("inventory_title")}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowScan(true)}
              className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <HardDrive className="h-4 w-4" />
              {t("inventory_scan_drive")}
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <Upload className="h-4 w-4" />
              {t("inventory_import_local")}
            </button>
            <div className="flex items-center gap-1 ml-1">
              <button
                className={`h-9 w-9 flex items-center justify-center rounded-md border transition-colors ${
                  viewMode === "grid"
                    ? "bg-red-600 border-red-600 text-white"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                className={`h-9 w-9 flex items-center justify-center rounded-md border transition-colors ${
                  viewMode === "list"
                    ? "bg-red-600 border-red-600 text-white"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
              <InventoryOptionsMenu />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col gap-4 px-8 py-6 overflow-auto">
          {/* Search + Sort button row */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <AdvancedSearchBar value={searchQuery} onChange={setSearchQuery} />
            </div>
            <button
              ref={sortButtonRef}
              onClick={() => setShowSort((v) => !v)}
              className="shrink-0 h-10 px-3 flex items-center gap-1.5 rounded-lg border border-zinc-700
                         text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 text-xs transition-colors"
              title="Ordenar"
            >
              <SortAsc className="h-4 w-4" />
              <span className="hidden sm:inline">
                {sortField === "date"   && "Fecha"}
                {sortField === "name"   && "Nombre"}
                {sortField === "author" && "Autor"}
                {sortField === "size"   && "Tamaño"}
                {sortField === "custom" && "Manual"}
              </span>
            </button>
          </div>

          {/* Back button when inside a folder */}
          {currentFolder && (
            <button
              onClick={() => selectFolder(currentFolder.parent_id ?? null)}
              className="self-start flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>{currentFolder.name}</span>
            </button>
          )}

          <InventoryGrid />
        </div>
      </main>

      {selectedItem && (
        <InventoryItemDetail
          item={selectedItem}
          onClose={() => selectItem(null)}
        />
      )}

      {showImport && (
        <ImportLocalDialog
          onClose={() => setShowImport(false)}
          onImported={() => setShowImport(false)}
        />
      )}

      {showScan && (
        <ScanDriveWizard
          onClose={() => setShowScan(false)}
          onComplete={() => setShowScan(false)}
        />
      )}

      <MultiSelectToolbar />
      {showSort && (
        <SortModal anchorRef={sortButtonRef} onClose={() => setShowSort(false)} />
      )}
    </div>
  );
}