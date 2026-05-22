// src/pages/Creators.tsx
import { useEffect, useState } from "react";
import { Github, Twitter, Globe, ExternalLink } from "lucide-react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useT } from "../i18n";

// ── Lanyard types ─────────────────────────────────────────────────────────────
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

// ── Obfuscation helpers ───────────────────────────────────────────────────────
// Discord IDs are stored as base64 to avoid plaintext exposure in the bundle.
// They are decoded at runtime only when needed by the Lanyard API.
// To encode a new ID: btoa("YOUR_DISCORD_ID_HERE")
function decodeId(b64: string): string {
  try { return atob(b64); } catch { return ""; }
}

// ── Data types ────────────────────────────────────────────────────────────────
interface CreatorDef {
  /** base64-encoded Discord User ID */
  discordIdB64: string;
  fallbackName: string;
  fallbackAvatar: string;
  role: string;
  github?: string;
  twitter?: string;
  web?: string;
}

interface CollaboratorDef {
  name: string;
  role: string;
  /** base64-encoded Discord User ID — encodes live status dot */
  discordIdB64?: string;
  /** Static avatar fallback when discordId is absent or Lanyard fails. */
  avatar?: string;
}

// ── !! EDIT THESE !! ─────────────────────────────────────────────────────────
const CREATORS: CreatorDef[] = [
  {
    discordIdB64:   "MTAyMzYyODY0NDIxMzU4Nzk5OA==",
    fallbackName:   "s7lver",
    fallbackAvatar: "https://github.com/s7lver.png",
    role:           "Lead developer & designer · VRC Studio",
    github:         "https://github.com/s7lver",
  },
  {
    discordIdB64:   "MTE1MjkzMTU4MjU2NzUyNjQzMQ==",
    fallbackName:   "Reokiy",
    fallbackAvatar: "https://ui-avatars.com/api/?name=Reokiy&background=dc2626&color=fff&size=256",
    role:           "Emotional support · VRC Studio",
  },
];

const COLLABORATORS: CollaboratorDef[] = [
  { name: "Panda",   role: "Tester", discordIdB64: "MTAxNzEyNzgwMDI5MDk1NTQ3NA==" },
  { name: "Specu",   role: "Tester", discordIdB64: "MjQ5ODU3NjQ0Nzk2NDQ0Njcy" },
  { name: "Mel",     role: "Tester", discordIdB64: "MzE3Mzg3NjgyNDYyNDMzMjgw" },
  { name: "Pancake", role: "Tester", discordIdB64: "NzE3ODc1ODc0Mzg4NjM5Nzk0" },
];
// ─────────────────────────────────────────────────────────────────────────────

// ── Lanyard WebSocket hook ────────────────────────────────────────────────────
function useLanyardStatus(discordId: string) {
  const [data, setData] = useState<LanyardData | null>(null);
  const [error, setError] = useState(false);
  const isPlaceholder = !discordId || discordId === "";

  useEffect(() => {
    if (isPlaceholder) return;
    let heartbeat: ReturnType<typeof setInterval>;
    const ws = new WebSocket("wss://api.lanyard.rest/socket");

    ws.onopen = () =>
      ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: discordId } }));

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.op === 1)
        heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 3 })), msg.d.heartbeat_interval);
      if (msg.op === 0 && msg.d) setData(msg.d);
    };

    ws.onerror = () => setError(true);
    ws.onclose  = () => clearInterval(heartbeat);

    return () => { clearInterval(heartbeat); ws.close(); };
  }, [discordId, isPlaceholder]);

  return { data, error, isPlaceholder };
}

// ── Status palette ────────────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  online:  "bg-green-500",
  idle:    "bg-amber-400",
  dnd:     "bg-red-500",
  offline: "bg-zinc-600",
};
const STATUS_TEXT: Record<string, string> = {
  online:  "Online",
  idle:    "Idle",
  dnd:     "Do Not Disturb",
  offline: "Offline",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className="relative flex h-3 w-3 shrink-0">
      {status === "online" && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${STATUS_DOT[status] ?? "bg-zinc-600"}`} />
    </span>
  );
}

// ── Full creator card ─────────────────────────────────────────────────────────
function CreatorCard({ creator, openLink }: { creator: CreatorDef; openLink: (u: string) => void }) {
  const discordId = decodeId(creator.discordIdB64);
  const { data: lanyard, error, isPlaceholder } = useLanyardStatus(discordId);

  const status      = lanyard?.discord_status ?? "offline";
  const displayName = lanyard?.discord_user?.global_name
                   ?? lanyard?.discord_user?.username
                   ?? creator.fallbackName;
  const avatarHash  = lanyard?.discord_user?.avatar;
  const userId      = lanyard?.discord_user?.id ?? discordId;

  const avatarUrl = (avatarHash && !isPlaceholder)
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=256`
    : creator.fallbackAvatar;

  const activity = lanyard?.activities?.find((a) => a.type !== 4);

  return (
    <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-6 overflow-hidden">
      <div className="absolute top-0 left-0 w-64 h-64 bg-red-600/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-start gap-5">
        <div className="relative shrink-0">
          <img
            src={avatarUrl}
            alt={creator.fallbackName}
            className="w-20 h-20 rounded-2xl object-cover border-2 border-zinc-700"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                `https://ui-avatars.com/api/?name=${encodeURIComponent(creator.fallbackName)}&background=dc2626&color=fff&size=80`;
            }}
          />
          {!isPlaceholder && (
            <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-zinc-900 ${STATUS_DOT[status]}`} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-zinc-100 leading-snug">
              {isPlaceholder ? creator.fallbackName : displayName}
            </h2>
            {!isPlaceholder && !error && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700/60">
                <StatusDot status={status} />
                <span className="text-[10px] text-zinc-400 font-medium leading-none">
                  {STATUS_TEXT[status]}
                </span>
              </div>
            )}
          </div>

          <p className="text-xs text-zinc-400 mt-1">{creator.role}</p>

          {activity && (
            <p className="mt-1.5 text-[11px] text-zinc-500">
              <span className="font-semibold text-zinc-600 uppercase tracking-wider mr-1">
                {activity.type === 0 ? "Playing" : "Listening to"}
              </span>
              {activity.name}
              {activity.details && <span className="text-zinc-700"> — {activity.details}</span>}
            </p>
          )}

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {creator.github && (
              <button onClick={() => openLink(creator.github!)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white transition-all text-xs font-medium">
                <Github className="h-3.5 w-3.5" /> GitHub
              </button>
            )}
            {creator.twitter && (
              <button onClick={() => openLink(creator.twitter!)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white transition-all text-xs font-medium">
                <Twitter className="h-3.5 w-3.5" /> Twitter
              </button>
            )}
            {creator.web && (
              <button onClick={() => openLink(creator.web!)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white transition-all text-xs font-medium">
                <Globe className="h-3.5 w-3.5" /> Website
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Minimal collaborator chip ─────────────────────────────────────────────────
// Intentionally tiny: just avatar + name + live status dot.
// The role is available as a tooltip (title).
function CollaboratorChip({ collab }: { collab: CollaboratorDef }) {
  const discordId  = collab.discordIdB64 ? decodeId(collab.discordIdB64) : "";
  const hasDiscord = discordId !== "";
  const { data: lanyard, error } = useLanyardStatus(discordId);

  const status = hasDiscord && !error ? (lanyard?.discord_status ?? "offline") : null;
  const displayName =
    (hasDiscord && !error && (lanyard?.discord_user?.global_name ?? lanyard?.discord_user?.username))
    || collab.name;

  const avatarHash = lanyard?.discord_user?.avatar;
  const userId     = lanyard?.discord_user?.id ?? discordId;

  const avatarUrl = (hasDiscord && avatarHash)
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=64`
    : collab.avatar
    ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(collab.name)}&background=27272a&color=a1a1aa&size=64`;

  return (
    <div
      title={`${displayName} · ${collab.role}`}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-800/60 transition-colors group cursor-default select-none"
    >
      {/* Avatar + status dot */}
      <div className="relative shrink-0">
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-6 h-6 rounded-full object-cover border border-zinc-700/60"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              `https://ui-avatars.com/api/?name=${encodeURIComponent(collab.name)}&background=27272a&color=a1a1aa&size=64`;
          }}
        />
        {status && (
          <span className={`absolute -bottom-px -right-px w-2 h-2 rounded-full border border-zinc-900 ${STATUS_DOT[status]}`} />
        )}
      </div>

      {/* Name */}
      <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors leading-none">
        {displayName}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Creators() {
  const t = useT();
  const openLink = (url: string) =>
    openShell(url).catch(() => window.open(url, "_blank"));

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-950 to-zinc-900 px-6 py-10">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-zinc-100">Creators</h1>
          <p className="text-sm text-zinc-500 mt-1">The people behind VRC Studio</p>
        </div>

        {/* Main creator cards */}
        <div className="grid gap-4 md:grid-cols-2 mb-10">
          {CREATORS.map((c) => (
            <CreatorCard key={c.discordIdB64} creator={c} openLink={openLink} />
          ))}
        </div>

        {/* Collaborators — minimal chips */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Contributors
          </h3>

          {COLLABORATORS.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {COLLABORATORS.map((c) => (
                <CollaboratorChip key={c.name} collab={c} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center">
              <p className="text-sm text-zinc-600">{t("creators_no_contributors")}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-zinc-800/50 flex items-center justify-between">
          <p className="text-xs text-zinc-700">{t("creators_footer")}</p>
          <button
            onClick={() => openLink("https://github.com/s7lver/vrc-studio")}
            className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> {t("creators_source")}
          </button>
        </div>

      </div>
    </div>
  );
}