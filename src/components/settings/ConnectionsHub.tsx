import React, { useState, useEffect, useCallback } from "react";
import {
  Lock, LogOut, ExternalLink, Loader2,
  AlertTriangle, Copy, Check, Wifi,
} from "lucide-react";
import { useBoothStatus } from "@/hooks/useBoothStatus";
import { useRipperStatus } from "@/hooks/useRipperStatus";
import { github, GithubUserInfo } from "@/lib/tauri";
import { useAppStore } from "@/store/app";
import { useAppearanceStore } from "@/store/appearanceStore";
import { DeveloperCodeModal } from "./DeveloperCodeModal";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type ConnectionStatus = "connected" | "disconnected" | "unknown" | "expired";

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected:    "#34d399",
  disconnected: "#52525b",
  unknown:      "#a16207",
  expired:      "#f59e0b",
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected:    "Connected",
  disconnected: "Disconnected",
  unknown:      "Checking…",
  expired:      "Session expired",
};

// ── DeviceFlowPanel ─────────────────────────────────────────────────────────

function DeviceFlowPanel({
  userCode,
  verificationUri,
  onCancel,
}: {
  userCode: string;
  verificationUri: string;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(userCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-t border-zinc-800 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500 shrink-0" />
        <span>Waiting for GitHub authorization…</span>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-zinc-500">
          Open{" "}
          <a
            href={verificationUri}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zinc-300 transition-colors"
            style={{ color: "var(--accent-color)" }}
          >
            {verificationUri}
          </a>{" "}
          and enter this code:
        </p>
        <div className="flex items-center gap-2">
          <div className="font-mono text-xl font-bold tracking-[0.3em] text-zinc-100 px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 flex-1 text-center">
            {userCode}
          </div>
          <button
            onClick={copyCode}
            className="p-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all shrink-0"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <button
          onClick={onCancel}
          className="self-start text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── ConnectionCard ───────────────────────────────────────────────────────────

interface CardConfig {
  id: string;
  name: string;
  description: string;
  logo: React.ReactNode;
  status: ConnectionStatus;
  accountLine?: string;
  requiresDevCode: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  connectingState?: "idle" | "waiting" | "done";
  devicePrompt?: { user_code: string; verification_uri: string } | null;
  expandedContent?: React.ReactNode;
}

function ConnectionCard({
  card,
  isLocked,
  onLockedClick,
}: {
  card: CardConfig;
  isLocked: boolean;
  onLockedClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { animSpeed } = useAppearanceStore();

  const isConnected = card.status === "connected";
  const isExpired   = card.status === "expired";
  const isUnknown   = card.status === "unknown";
  const isWaiting   = card.connectingState === "waiting";

  const statusColor = STATUS_COLOR[card.status];

  return (
    <div
      className={cn(
        "relative rounded-2xl border overflow-hidden",
        isConnected ? "border-emerald-800/60" : isExpired ? "border-amber-900/50" : "border-zinc-800"
      )}
      style={{
        background: isConnected
          ? "radial-gradient(ellipse at 0% 0%, rgba(52,211,153,0.06) 0%, #09090b 60%)"
          : "#0f0f11",
        boxShadow: isConnected
          ? "0 0 0 1px rgba(52,211,153,0.12), 0 4px 24px rgba(52,211,153,0.07)"
          : isExpired
            ? "0 0 0 1px rgba(245,158,11,0.12)"
            : "none",
        transition: "box-shadow 0.3s ease, border-color 0.3s ease",
      }}
    >
      {/* Lock overlay */}
      {isLocked && (
        <button
          onClick={onLockedClick}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950/80 backdrop-blur-[2px] transition-all hover:bg-zinc-950/70"
        >
          <Lock className="h-5 w-5 text-zinc-400" />
          <div className="text-center">
            <p className="text-xs font-semibold text-zinc-300">Dev Code Required</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">Tap to unlock with developer code</p>
          </div>
        </button>
      )}

      {/* Main row */}
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Logo + status ring */}
        <div className="relative shrink-0">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center bg-zinc-900 border border-zinc-800"
            style={isConnected ? { borderColor: "rgba(52,211,153,0.25)" } : {}}
          >
            {card.logo}
          </div>
          {/* Status dot */}
          <div
            className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-zinc-950"
            style={{ background: statusColor }}
          >
            {isConnected && animSpeed !== "off" && (
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ background: statusColor, opacity: 0.4 }}
              />
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-zinc-100">{card.name}</p>
            <span className="text-[10px] font-medium" style={{ color: statusColor }}>
              {STATUS_LABEL[card.status]}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed truncate">{card.description}</p>
          {card.accountLine && isConnected && (
            <p className="text-[11px] mt-1 font-mono" style={{ color: "var(--accent-color)" }}>
              {card.accountLine}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isConnected ? (
            <>
              {card.expandedContent && (
                <button
                  onClick={() => setExpanded((e) => !e)}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all"
                >
                  {expanded ? "Less" : "Details"}
                </button>
              )}
              <button
                onClick={card.onDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-red-400 hover:border-red-900 transition-all"
              >
                <LogOut className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </>
          ) : isExpired ? (
            <button
              onClick={card.onConnect}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold text-amber-300 border border-amber-900/60 bg-amber-950/30 hover:bg-amber-950/50 transition-all"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Reconnect
            </button>
          ) : isUnknown && !isWaiting ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
          ) : isWaiting ? (
            <span className="text-[10px] text-zinc-600 italic">Waiting…</span>
          ) : (
            <button
              onClick={card.onConnect}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold text-zinc-100 transition-all"
              style={{
                background: "var(--accent-color)",
                boxShadow: "0 0 14px hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.3)",
              }}
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* GitHub device flow inline */}
      {isWaiting && card.devicePrompt && !isConnected && (
        <DeviceFlowPanel
          userCode={card.devicePrompt.user_code}
          verificationUri={card.devicePrompt.verification_uri}
          onCancel={card.onConnect}
        />
      )}

      {/* Expanded content */}
      {expanded && card.expandedContent && (
        <div className="border-t border-zinc-800/60 px-5 py-4">
          {card.expandedContent}
        </div>
      )}
    </div>
  );
}

// ── ConnectionHub ────────────────────────────────────────────────────────────

export function ConnectionHub() {
  const { untrustedSourcesUnlocked, setUntrustedSourcesUnlocked } = useAppStore();
  const { riperstoreExperimental, setRiperstoreExperimental } = useAppStore();
  const [showCodeModal, setShowCodeModal] = useState(false);

  // GitHub state
  const [githubUser, setGithubUser]     = useState<GithubUserInfo | null>(null);
  const [githubStep, setGithubStep]     = useState<"idle" | "waiting" | "done">("idle");
  const [devicePrompt, setDevicePrompt] = useState<{ user_code: string; verification_uri: string } | null>(null);

  // Booth + Ripper
  const { status: boothStatus, purchaseCount, connect: boothConnect, disconnect: boothDisconnect } = useBoothStatus();
  const { status: ripperStatus, connect: ripperConnect, disconnect: ripperDisconnect, reconnect: ripperReconnect } = useRipperStatus();

  useEffect(() => {
    github.getUser().then(setGithubUser).catch(() => setGithubUser(null));
  }, []);

  const startGithubAuth = useCallback(async () => {
    if (githubStep === "waiting") {
      // Cancel
      setGithubStep("idle");
      setDevicePrompt(null);
      return;
    }
    setGithubStep("waiting");
    try {
      const prompt = await github.startDeviceAuth();
      setDevicePrompt(prompt);
      const info = await github.pollToken();
      setGithubUser(info);
      setGithubStep("done");
      setDevicePrompt(null);
    } catch {
      setGithubStep("idle");
      setDevicePrompt(null);
    }
  }, [githubStep]);

  const githubLogo = (
    <svg viewBox="0 0 98 96" className="w-6 h-6 text-zinc-300" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" />
    </svg>
  );

  const cards: CardConfig[] = [
    {
      id: "github",
      name: "GitHub",
      description: "Link your GitHub account to unlock repository integrations and private package sources.",
      logo: githubLogo,
      status: githubUser ? "connected" : githubStep === "waiting" ? "unknown" : "disconnected",
      accountLine: githubUser ? `@${githubUser.login}` : undefined,
      requiresDevCode: false,
      onConnect: startGithubAuth,
      onDisconnect: async () => { await github.logout(); setGithubUser(null); },
      connectingState: githubStep,
      devicePrompt: devicePrompt,
      expandedContent: githubUser ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {githubUser.avatar_url && (
              <img
                src={githubUser.avatar_url}
                className="w-10 h-10 rounded-full ring-2 ring-emerald-700/40"
                alt=""
              />
            )}
            <div>
              <p className="text-sm font-bold text-zinc-100">{githubUser.name ?? githubUser.login}</p>
              <p className="text-xs text-zinc-500">@{githubUser.login}</p>
            </div>
          </div>
          <a
            href={`https://github.com/${githubUser.login}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity"
            style={{ color: "var(--accent-color)" }}
          >
            <ExternalLink className="h-3 w-3" /> Profile
          </a>
        </div>
      ) : undefined,
    },
    {
      id: "booth",
      name: "Booth.pm",
      description: "Browse and import your Booth.pm purchases directly into your asset library.",
      logo: <span className="text-2xl leading-none">🛒</span>,
      status: boothStatus === "connected" ? "connected" : boothStatus === "unknown" ? "unknown" : "disconnected",
      accountLine: boothStatus === "connected" && purchaseCount != null
        ? `${purchaseCount} purchased item${purchaseCount !== 1 ? "s" : ""}`
        : undefined,
      requiresDevCode: false,
      onConnect: boothConnect,
      onDisconnect: boothDisconnect,
    },
    {
      id: "riperstore",
      name: "Riperstore",
      description: "Experimental integration with Riperstore forums for extended asset discovery.",
      logo: <span className="text-2xl leading-none">🔮</span>,
      status: ripperStatus === "connected"
        ? "connected"
        : ripperStatus === "expired"
          ? "expired"
          : "disconnected",
      requiresDevCode: true,
      onConnect: () => { setRiperstoreExperimental(true); ripperConnect(); },
      onDisconnect: () => { ripperDisconnect(); setRiperstoreExperimental(false); },
    },
  ];

  return (
    <>
      {showCodeModal && (
        <DeveloperCodeModal
          onClose={() => setShowCodeModal(false)}
          onUnlocked={() => { setUntrustedSourcesUnlocked(true); setShowCodeModal(false); }}
        />
      )}

      <div className="flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-zinc-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Integrations</p>
          </div>
          {untrustedSourcesUnlocked ? (
            <button
              onClick={() => setUntrustedSourcesUnlocked(false)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Lock className="h-2.5 w-2.5" /> Lock Dev Mode
            </button>
          ) : (
            <p className="flex items-center gap-1 text-[10px] text-zinc-700">
              <Lock className="h-3 w-3" />
              Some integrations require a dev code
            </p>
          )}
        </div>

        {/* Cards */}
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <ConnectionCard
              key={card.id}
              card={card}
              isLocked={card.requiresDevCode && !untrustedSourcesUnlocked}
              onLockedClick={() => setShowCodeModal(true)}
            />
          ))}
        </div>
      </div>
    </>
  );
}