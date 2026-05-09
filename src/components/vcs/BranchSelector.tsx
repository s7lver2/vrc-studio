import { useState } from "react";
import type { BranchInfo } from "@/types/vcs";
import { useT } from "@/i18n";

interface Props {
  branches: BranchInfo[];
  onSwitch: (name: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}

export function BranchSelector({ branches, onSwitch, onCreate }: Props) {
  const t = useT();
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = async (name: string) => {
    setLoading(true);
    setError(null);
    try { await onSwitch(name); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(newName.trim());
      setNewName("");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col gap-3 px-4">
      <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
        {branches.length === 0 && (
          <p className="text-xs text-zinc-500 px-2">{t("vcs_no_branches")}</p>
        )}
        {branches.map((b) => (
          <button
            key={b.name}
            onClick={() => !b.is_current && handleSwitch(b.name)}
            disabled={b.is_current || loading}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm text-left hover:bg-zinc-800 transition-colors ${
              b.is_current ? "font-semibold text-red-400" : "text-zinc-300"
            } disabled:cursor-default`}
          >
            {b.is_current && <span className="text-xs">●</span>}
            <span className="font-mono">{b.name}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder={t("vcs_branch_new_placeholder")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-red-600"
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim() || loading}
          className="rounded bg-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
        >
          {t("vcs_branch_create")}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}