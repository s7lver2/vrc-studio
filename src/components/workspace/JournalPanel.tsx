import { useState, useEffect } from "react";
import type { Project, JournalEntry } from "@/lib/tauri";
import { journal } from "@/lib/tauri";
import { Plus, Trash2, Save, PenLine } from "lucide-react";
import { useT } from "@/i18n";

interface Props {
  project: Project;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function JournalPanel({ project }: Props) {
  const t = useT();
  const [entries, setEntries]     = useState<JournalEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<JournalEntry | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving]       = useState(false);
  const [dirty, setDirty]         = useState(false);

  const load = () => {
    journal.list(project.id)
      .then((e) => { setEntries(e); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [project.id]);

  const selectEntry = (entry: JournalEntry) => {
    setSelected(entry);
    setEditContent(entry.content);
    setDirty(false);
  };

  const createEntry = async () => {
    const entry = await journal.create(project.id, "");
    setEntries((prev) => [entry, ...prev]);
    selectEntry(entry);
  };

  const saveEntry = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await journal.update(selected.id, editContent);
      setEntries((prev) =>
        prev.map((e) => e.id === selected.id ? { ...e, content: editContent } : e)
      );
      setSelected((s) => s ? { ...s, content: editContent } : s);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (id: string) => {
    await journal.delete(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selected?.id === id) { setSelected(null); setEditContent(""); }
  };

  return (
    <div className="flex h-full">
      {/* Entry list */}
      <div className="w-64 shrink-0 flex flex-col border-r border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-xs font-semibold text-zinc-300">{t("ws_journal_title")}</span>
          <button
            onClick={createEntry}
            className="text-zinc-500 hover:text-red-400 transition-colors"
            title={t("ws_journal_new")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="text-xs text-zinc-600 p-4 animate-pulse">{t("ws_journal_loading")}</p>}
          {!loading && entries.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
              <PenLine className="h-6 w-6 text-zinc-700" />
              <p className="text-xs text-zinc-600">{t("ws_journal_empty")}</p>
              <button
                onClick={createEntry}
                className="text-xs text-red-400 hover:text-red-300"
              >
                + {t("ws_journal_create_first")}
              </button>
            </div>
          )}
          {entries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => selectEntry(entry)}
              className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors ${
                selected?.id === entry.id ? "bg-zinc-800/60 border-l-2 border-l-red-500" : ""
              }`}
            >
              <p className="text-xs text-zinc-200 truncate">
                {entry.content.split("\n")[0] || t("ws_journal_untitled")}
              </p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{formatDate(entry.created_at)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 shrink-0">
              <span className="text-[10px] text-zinc-500">{formatDate(selected.created_at)}</span>
              <div className="ml-auto flex items-center gap-2">
                {dirty && <span className="text-[10px] text-zinc-600">{t("ws_journal_unsaved")}</span>}
                <button
                  onClick={saveEntry}
                  disabled={!dirty || saving}
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200 disabled:opacity-30 transition-colors border border-zinc-700 rounded px-2 py-0.5"
                >
                  <Save className="h-3 w-3" />
                  {saving ? t("ws_journal_saving") : t("ws_journal_save")}
                </button>
                <button
                  onClick={() => deleteEntry(selected.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                  title={t("ws_journal_delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <textarea
              value={editContent}
              onChange={(e) => { setEditContent(e.target.value); setDirty(true); }}
              onKeyDown={(e) => {
                if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  saveEntry();
                }
              }}
              placeholder={t("ws_journal_placeholder")}
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-700 resize-none focus:outline-none p-5 leading-relaxed font-mono"
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
            <PenLine className="h-10 w-10" />
            <p className="text-sm">{t("ws_journal_select_or_create")}</p>
          </div>
        )}
      </div>
    </div>
  );
}