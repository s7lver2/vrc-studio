import { useState, useRef, useEffect } from "react";
import {
  LayoutGrid, List, Upload, HardDrive, Search, X,
  Tag, User, FileText, ChevronDown,
} from "lucide-react";
import { FolderTree } from "../components/inventory/FolderTree";
import { InventoryGrid } from "../components/inventory/InventoryGrid";
import { InventoryItemDetail } from "../components/inventory/InventoryItemDetail";
import { ImportLocalDialog } from "../components/inventory/ImportLocalDialog";
import { ScanDriveWizard } from "../components/inventory/ScanDriveWizard";
import { useInventory } from "../hooks/useInventory";
import { useInventoryStore, parseSearchQuery } from "../store/inventoryStore";
import { useTagStore } from "../store/tagStore";
import { useT } from "../i18n";

// ── Search suggestions ────────────────────────────────────────────────────────

interface Suggestion {
  text: string;
  completion: string;
  icon: React.ReactNode;
  description: string;
}

function buildSuggestions(raw: string, allTags: string[]): Suggestion[] {
  const lower = raw.toLowerCase();

  // Suggest syntax keywords when user starts typing
  const syntaxSuggestions: Suggestion[] = [];

  if ("tags:".startsWith(lower) || lower === "") {
    syntaxSuggestions.push({
      text: "tags:",
      completion: "tags:",
      icon: <Tag className="h-3 w-3 text-amber-400" />,
      description: "Filter by tag",
    });
  }
  if ("author:".startsWith(lower) || lower === "") {
    syntaxSuggestions.push({
      text: "author:",
      completion: "author:",
      icon: <User className="h-3 w-3 text-blue-400" />,
      description: "Filter by author",
    });
  }
  if ("name:".startsWith(lower) || lower === "") {
    syntaxSuggestions.push({
      text: "name:",
      completion: "name:",
      icon: <FileText className="h-3 w-3 text-zinc-400" />,
      description: "Filter by name",
    });
  }

  // After typing "tags:" suggest known tags
  if (lower.startsWith("tags:") || lower.startsWith("tag:")) {
    const prefix = lower.includes("tags:") ? "tags:" : "tag:";
    const partial = lower.slice(prefix.length);
    return allTags
      .filter((t) => t.startsWith(partial))
      .slice(0, 8)
      .map((t) => ({
        text: `tags:${t}`,
        completion: `${prefix}${t}`,
        icon: <Tag className="h-3 w-3 text-amber-400" />,
        description: t,
      }));
  }

  return syntaxSuggestions.slice(0, 5);
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
    
    return syntaxSuggestions.slice(0, 5);
  };

  const suggestions = buildSuggestions(value);

  // ... resto igual, pero el texto de "Suggestions" se puede traducir:
  // En el dropdown, cambia "Suggestions" -> t("inventory_search_suggestions") (hay que agregar esa clave)
  // Y el label de filtros activos ya usa t("inventory_active_filters").
  // El botón de limpiar ya usa t("inventory_clear_filters").

  const hasFilters = parsed.tags.length > 0 || parsed.authors.length > 0 || parsed.names.length > 0;

  return (
    <div className="flex flex-col gap-2">
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
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t("inventory_search_suggestions")}</p>
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
          {/* chips igual */}
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
  const { selectedItem, selectItem } = useInventoryStore();
  const [showImport, setShowImport] = useState(false);
  const [showScan, setShowScan] = useState(false);

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="p-4 border-r border-zinc-800 overflow-auto">
        <FolderTree />
      </aside>

      <main className="flex-1 flex flex-col gap-4 p-6 overflow-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-100">{t("inventory_title")}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowScan(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs transition-colors"
            >
              <HardDrive className="h-3.5 w-3.5" />
              {t("inventory_scan_drive")}
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              {t("inventory_import_local")}
            </button>
            <div className="flex items-center gap-1">
              <button
                className={`h-8 w-8 flex items-center justify-center rounded transition-colors ${
                  viewMode === "grid"
                    ? "bg-red-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                className={`h-8 w-8 flex items-center justify-center rounded transition-colors ${
                  viewMode === "list"
                    ? "bg-red-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <AdvancedSearchBar value={searchQuery} onChange={setSearchQuery} />

        <InventoryGrid />
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
    </div>
  );
}