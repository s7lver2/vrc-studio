import { useState, useRef, useEffect } from "react";
import { Lock, ShieldAlert, X, Loader2 } from "lucide-react";
import { unlockUntrustedSources } from "@/hooks/useUntrustedSources";

interface DeveloperCodeModalProps {
  onClose: () => void;
  onUnlocked: () => void;
}

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function DeveloperCodeModal({ onClose, onUnlocked }: DeveloperCodeModalProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = async () => {
    if (!code.trim() || loading) return;
    setLoading(true);
    const ok = await unlockUntrustedSources(code);
    setLoading(false);
    if (ok) {
      onUnlocked();
      onClose();
    } else {
      setError(true);
      setShaking(true);
      setCode("");
      setTimeout(() => setShaking(false), 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div
        className={cn(
          "w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden",
          shaking && "animate-[shake_0.4s_ease-in-out]"
        )}
        style={shaking ? { animation: "shake 0.4s ease-in-out" } : {}}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800/80 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Developer Access Required</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">Enter your developer code to continue</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors ml-2 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-4">
            <p className="text-xs text-zinc-500 leading-relaxed">
              This section contains experimental integrations with third-party platforms.
              Access requires a developer code.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <Lock className="h-3 w-3" /> Developer Code
            </label>
            <input
              ref={inputRef}
              type="password"
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              placeholder="Enter code…"
              disabled={loading}
              className={cn(
                "w-full bg-zinc-900 border rounded-xl px-4 py-3 text-sm text-zinc-200 font-mono tracking-widest",
                "focus:outline-none transition-colors placeholder-zinc-700 disabled:opacity-50",
                error
                  ? "border-red-500/60 focus:border-red-500/80"
                  : "border-zinc-700 focus:border-zinc-500"
              )}
              autoComplete="off"
              spellCheck={false}
            />
            {error && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <span className="text-red-500">✕</span> Invalid code. Please try again.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 border-t border-zinc-800 px-6 py-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!code.trim() || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm font-medium text-zinc-200 transition-colors disabled:opacity-40"
          >
            {loading
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…</>
              : <><Lock className="h-3.5 w-3.5" /> Unlock</>}
          </button>
        </div>
      </div>
    </div>
  );
}