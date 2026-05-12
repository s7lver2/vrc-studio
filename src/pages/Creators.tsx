// src/pages/Creators.tsx
import { useEffect, useState } from "react";
import { Github, Twitter, Globe, ExternalLink } from "lucide-react";
import { open as openShell } from "@tauri-apps/plugin-shell";

// ── Tipos Lanyard ─────────────────────────────────────────────────────────────
interface LanyardActivity {
  name: string;
  details?: string;
  state?: string;
  type: number;
}

interface LanyardData {
  discord_status: "online" | "idle" | "dnd" | "offline";
  activities: LanyardActivity[];
  discord_user: {
    username: string;
    global_name: string | null;
    avatar: string | null;
    id: string;
  };
}

// ── Datos hardcodeados de creadores ──────────────────────────────────────────
// Reemplaza DISCORD_ID_S7LVER con tu Discord User ID (número de 18 dígitos)
const DISCORD_ID_S7LVER = "1023628644213587998";

const COLLABORATORS: {
  name: string;
  role: string;
  github?: string;
  twitter?: string;
  web?: string;
  avatar?: string;
}[] = [
  // Añade colaboradores reales aquí:
  // { name: "Nombre", role: "UI/UX", github: "https://github.com/..." },
];

// ── Hook Lanyard ──────────────────────────────────────────────────────────────
function useLanyardStatus(discordId: string) {
  const [data, setData] = useState<LanyardData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!discordId || discordId.startsWith("REEMPLAZA")) return;

    // WebSocket de Lanyard para actualizaciones en tiempo real
    const ws = new WebSocket("wss://api.lanyard.rest/socket");
    let heartbeatInterval: ReturnType<typeof setInterval>;

    ws.onopen = () => {
      ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: discordId } }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      // op 1 = hello (heartbeat interval)
      if (msg.op === 1) {
        heartbeatInterval = setInterval(() => {
          ws.send(JSON.stringify({ op: 3 }));
        }, msg.d.heartbeat_interval);
      }
      // op 0 = event data
      if (msg.op === 0 && msg.d) {
        setData(msg.d);
      }
    };

    ws.onerror = () => setError(true);
    ws.onclose = () => clearInterval(heartbeatInterval);

    return () => {
      clearInterval(heartbeatInterval);
      ws.close();
    };
  }, [discordId]);

  return { data, error };
}

// ── Status dot ────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-amber-400",
  dnd: "bg-red-500",
  offline: "bg-zinc-600",
};
const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className="relative flex h-3 w-3">
      {status === "online" && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${STATUS_COLORS[status] ?? "bg-zinc-600"}`} />
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Creators() {
  const { data: lanyard, error: lanyardError } = useLanyardStatus(DISCORD_ID_S7LVER);

  const status = lanyard?.discord_status ?? "offline";
  const globalName = lanyard?.discord_user?.global_name ?? lanyard?.discord_user?.username ?? "s7lver";
  const avatarHash = lanyard?.discord_user?.avatar;
  const discordUserId = lanyard?.discord_user?.id ?? DISCORD_ID_S7LVER;

  // Avatar: usa Lanyard si disponible, fallback a GitHub
  const avatarUrl = avatarHash && !avatarHash.startsWith("REEMPLAZA")
    ? `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.webp?size=256`
    : "https://github.com/s7lver.png";

  // Actividad actual (juego, música, etc.)
  const currentActivity = lanyard?.activities?.find((a) => a.type !== 4); // type 4 = custom status

  const openLink = (url: string) => {
    openShell(url).catch(() => window.open(url, "_blank"));
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-950 to-zinc-900 px-6 py-10">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-zinc-100">Creators</h1>
          <p className="text-sm text-zinc-500 mt-1">The people behind VRC Studio</p>
        </div>

        {/* Perfil principal */}
        <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-6 mb-6 overflow-hidden">
          {/* Glow decorativo */}
          <div className="absolute top-0 left-0 w-64 h-64 bg-red-600/5 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex items-start gap-6">
            {/* Avatar con anillo de status */}
            <div className="relative shrink-0">
              <img
                src={avatarUrl}
                alt={globalName}
                className="w-24 h-24 rounded-2xl object-cover border-2 border-zinc-700"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=s7lver&background=dc2626&color=fff&size=96`;
                }}
              />
              {/* Status badge */}
              <span className={`absolute -bottom-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full border-2 border-zinc-900 ${STATUS_COLORS[status]}`} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-zinc-100">{globalName}</h2>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700">
                  <StatusDot status={status} />
                  <span className="text-[11px] text-zinc-400 font-medium">{STATUS_LABELS[status]}</span>
                </div>
                {lanyardError && (
                  <span className="text-[10px] text-zinc-600">(estado no disponible — únete a discord.gg/lanyard)</span>
                )}
              </div>

              <p className="text-sm text-zinc-400 mt-1">Lead developer & designer · VRC Studio</p>

              {/* Actividad */}
              {currentActivity && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">
                    {currentActivity.type === 0 ? "Playing" : "Listening to"}
                  </span>
                  <span className="text-xs text-zinc-400 font-medium">{currentActivity.name}</span>
                  {currentActivity.details && (
                    <span className="text-[11px] text-zinc-600">— {currentActivity.details}</span>
                  )}
                </div>
              )}

              {/* Links */}
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => openLink("https://github.com/s7lver")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white transition-all text-xs font-medium"
                >
                  <Github className="h-3.5 w-3.5" /> GitHub
                </button>
                {/* Añadir más links aquí según tu perfil */}
              </div>
            </div>
          </div>
        </div>

        {/* Colaboradores */}
        {COLLABORATORS.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
              Contributors
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {COLLABORATORS.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 hover:border-zinc-700 transition-colors"
                >
                  <img
                    src={c.avatar ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=3f3f46&color=e4e4e7&size=64`}
                    alt={c.name}
                    className="w-10 h-10 rounded-full object-cover border border-zinc-700 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{c.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{c.role}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.github && (
                      <button onClick={() => openLink(c.github!)} className="text-zinc-600 hover:text-zinc-300 transition-colors">
                        <Github className="h-4 w-4" />
                      </button>
                    )}
                    {c.twitter && (
                      <button onClick={() => openLink(c.twitter!)} className="text-zinc-600 hover:text-zinc-300 transition-colors">
                        <Twitter className="h-4 w-4" />
                      </button>
                    )}
                    {c.web && (
                      <button onClick={() => openLink(c.web!)} className="text-zinc-600 hover:text-zinc-300 transition-colors">
                        <Globe className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center">
            <p className="text-sm text-zinc-600">No contributors listed yet.</p>
            <p className="text-xs text-zinc-700 mt-1">Add collaborators to the COLLABORATORS array in Creators.tsx</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-zinc-800/50 flex items-center justify-between">
          <p className="text-xs text-zinc-700">VRC Studio · Made with ❤️ for the VRChat creator community</p>
          <button
            onClick={() => openLink("https://github.com/s7lver/vrc-studio")}
            className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Source
          </button>
        </div>
      </div>
    </div>
  );
}