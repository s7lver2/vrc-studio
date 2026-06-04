import React, { useState, useEffect, useCallback } from "react";
import {
  LogOut, ExternalLink, Loader2,
  AlertTriangle, Copy, Check, Wifi,
} from "lucide-react";
import { useBoothStatus } from "@/hooks/useBoothStatus";
import {
  github, GithubUserInfo,
  tauriDiscordAuthorize, tauriDiscordLogout, tauriDiscordRpcSetEnabled,
} from "@/lib/tauri";
import { useAppearanceStore } from "@/store/appearanceStore";
import { useAppStore } from "@/store/app";
import { useT } from "@/i18n";

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

function DeviceFlowPanel({
  userCode,
  verificationUri,
  onCancel,
}: {
  userCode: string;
  verificationUri: string;
  onCancel: () => void;
}) {
  const t = useT();
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
        <span>{t("conn_github_waiting")}</span>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-zinc-500">
          Open{" "}
          <a href={verificationUri} target="_blank" rel="noreferrer"
            className="underline hover:text-zinc-300 transition-colors"
            style={{ color: "var(--accent-color)" }}>
            {verificationUri}
          </a>{" "}{t("conn_github_enter_code")}
        </p>
        <div className="flex items-center gap-2">
          <div className="font-mono text-xl font-bold tracking-[0.3em] text-zinc-100 px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 flex-1 text-center">
            {userCode}
          </div>
          <button onClick={copyCode}
            className="p-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all shrink-0">
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <button onClick={onCancel} className="self-start text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">{t("conn_github_cancel")}</button>
      </div>
    </div>
  );
}

interface CardConfig {
  id: string;
  name: string;
  description: string;
  logo: React.ReactNode;
  status: ConnectionStatus;
  accountLine?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  connectingState?: "idle" | "waiting" | "done";
  devicePrompt?: { user_code: string; verification_uri: string } | null;
  expandedContent?: React.ReactNode;
}

function ConnectionCard({ card }: { card: CardConfig }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const { animSpeed } = useAppearanceStore();

  const isConnected = card.status === "connected";
  const isExpired   = card.status === "expired";
  const isUnknown   = card.status === "unknown";
  const isWaiting   = card.connectingState === "waiting";
  const statusColor = STATUS_COLOR[card.status];

  return (
    <div
      className={cn("relative rounded-2xl border overflow-hidden",
        isConnected ? "border-emerald-800/60" : isExpired ? "border-amber-900/50" : "border-zinc-800"
      )}
      style={{
        background: isConnected
          ? "radial-gradient(ellipse at 0% 0%, rgba(52,211,153,0.06) 0%, #09090b 60%)"
          : "#0f0f11",
        boxShadow: isConnected
          ? "0 0 0 1px rgba(52,211,153,0.12), 0 4px 24px rgba(52,211,153,0.07)"
          : isExpired ? "0 0 0 1px rgba(245,158,11,0.12)" : "none",
        transition: "box-shadow 0.3s ease, border-color 0.3s ease",
      }}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-zinc-900 border border-zinc-800"
            style={isConnected ? { borderColor: "rgba(52,211,153,0.25)" } : {}}>
            {card.logo}
          </div>
          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-zinc-950"
            style={{ background: statusColor }}>
            {isConnected && animSpeed !== "off" && (
              <span className="absolute inset-0 rounded-full animate-ping" style={{ background: statusColor, opacity: 0.4 }} />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-zinc-100">{card.name}</p>
            <span className="text-[10px] font-medium" style={{ color: statusColor }}>
              {STATUS_LABEL[card.status]}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed truncate">{card.description}</p>
          {card.accountLine && isConnected && (
            <p className="text-[11px] mt-1 font-mono" style={{ color: "var(--accent-color)" }}>{card.accountLine}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isConnected ? (
            <>
              {card.expandedContent && (
                <button onClick={() => setExpanded(e => !e)}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all">
                  {expanded ? t("conn_discord_less") : t("conn_discord_details")}
                </button>
              )}
              <button onClick={card.onDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-red-400 hover:border-red-900 transition-all">
                <LogOut className="h-3.5 w-3.5" /> {t("conn_btn_disconnect")}
              </button>
            </>
          ) : isExpired ? (
            <button onClick={card.onConnect}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold text-amber-300 border border-amber-900/60 bg-amber-950/30 hover:bg-amber-950/50 transition-all">
              <AlertTriangle className="h-3.5 w-3.5" /> {t("conn_status_reconnect")}
            </button>
          ) : isUnknown && !isWaiting ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
          ) : isWaiting ? (
            <span className="text-[10px] text-zinc-600 italic">{t("conn_status_waiting")}</span>
          ) : (
            <button onClick={card.onConnect}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold text-zinc-100 transition-all"
              style={{ background: "var(--accent-color)", boxShadow: "0 0 14px hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.3)" }}>
              {t("conn_btn_connect")}
            </button>
          )}
        </div>
      </div>

      {isWaiting && card.devicePrompt && !isConnected && (
        <DeviceFlowPanel
          userCode={card.devicePrompt.user_code}
          verificationUri={card.devicePrompt.verification_uri}
          onCancel={card.onConnect}
        />
      )}

      {expanded && card.expandedContent && (
        <div className="border-t border-zinc-800/60 px-5 py-4">{card.expandedContent}</div>
      )}
    </div>
  );
}

const DISCORD_LOGO = (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#5865F2">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

function DiscordConnectionCard() {
  const discordUser = useAppStore((s) => s.discordUser);
  const setDiscordUser = useAppStore((s) => s.setDiscordUser);
  const setDiscordAccessToken = useAppStore((s) => s.setDiscordAccessToken);
  const discordRpcEnabled = useAppStore((s) => s.discordRpcEnabled);
  const setDiscordRpcEnabled = useAppStore((s) => s.setDiscordRpcEnabled);
  const { animSpeed } = useAppearanceStore();

  const t = useT();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const isConnected = discordUser != null;
  const statusColor = isConnected ? "#34d399" : "#52525b";

  const accountLine = discordUser
    ? (discordUser.discriminator === "0" || discordUser.discriminator === "")
      ? `@${discordUser.username}`
      : `@${discordUser.username}#${discordUser.discriminator}`
    : undefined;

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const result = await tauriDiscordAuthorize();
      setDiscordUser(result.user);
      setDiscordAccessToken(result.access_token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [setDiscordUser, setDiscordAccessToken]);

  const handleDisconnect = useCallback(async () => {
    try {
      await tauriDiscordLogout();
    } catch {}
    setDiscordUser(null);
    setDiscordAccessToken(null);
  }, [setDiscordUser, setDiscordAccessToken]);

  const handleToggleRpc = useCallback(async (v: boolean) => {
    setDiscordRpcEnabled(v);
    try {
      await tauriDiscordRpcSetEnabled(v);
    } catch {}
  }, [setDiscordRpcEnabled]);

  return (
    <div
      className={cn("relative rounded-2xl border overflow-hidden",
        isConnected ? "border-indigo-800/60" : "border-zinc-800"
      )}
      style={{
        background: isConnected
          ? "radial-gradient(ellipse at 0% 0%, rgba(88,101,242,0.06) 0%, #09090b 60%)"
          : "#0f0f11",
        boxShadow: isConnected
          ? "0 0 0 1px rgba(88,101,242,0.12), 0 4px 24px rgba(88,101,242,0.07)"
          : "none",
        transition: "box-shadow 0.3s ease, border-color 0.3s ease",
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="relative shrink-0">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center bg-zinc-900 border border-zinc-800"
            style={isConnected ? { borderColor: "rgba(88,101,242,0.3)" } : {}}
          >
            {DISCORD_LOGO}
          </div>
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

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-zinc-100">{t("conn_discord_title")}</p>
            <span className="text-[10px] font-medium" style={{ color: statusColor }}>
              {isConnected ? t("conn_discord_status_connected") : connecting ? t("conn_discord_status_connecting") : t("conn_discord_status_disconnected")}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            {t("conn_discord_desc")}
          </p>
          {accountLine && (
            <p className="text-[11px] mt-1 font-mono" style={{ color: "#5865F2" }}>{accountLine}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isConnected ? (
            <>
              <button
                onClick={() => setExpanded(e => !e)}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all"
              >
                {expanded ? t("conn_discord_less") : t("conn_discord_details")}
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-red-400 hover:border-red-900 transition-all"
              >
                <LogOut className="h-3.5 w-3.5" /> {t("conn_discord_disconnect")}
              </button>
            </>
          ) : connecting ? (
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
          ) : (
            <button
              onClick={handleConnect}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold text-white transition-all"
              style={{ background: "#5865F2", boxShadow: "0 0 14px rgba(88,101,242,0.3)" }}
            >
              {t("conn_discord_connect")}
            </button>
          )}
        </div>
      </div>

      {/* Connecting hint panel */}
      {connecting && (
        <div className="border-t border-zinc-800 px-5 py-4 flex items-center gap-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 shrink-0" />
          <p className="text-[11px] text-zinc-400">
            {t("conn_discord_popup_hint")}
          </p>
        </div>
      )}

      {/* Error panel */}
      {error && !connecting && (
        <div className="border-t border-zinc-800 px-5 py-4">
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-950/30 border border-red-900/40">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Expanded: avatar + username + Rich Presence toggle */}
      {expanded && isConnected && discordUser && (
        <div className="border-t border-zinc-800/60 px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {discordUser.avatar_url ? (
              <img
                src={discordUser.avatar_url}
                className="w-10 h-10 rounded-full ring-2 ring-indigo-700/40"
                alt=""
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-indigo-900/40 border border-indigo-800/40 flex items-center justify-center">
                {DISCORD_LOGO}
              </div>
            )}
            <div>
              <p className="text-sm font-bold text-zinc-100">{discordUser.username}</p>
              {discordUser.discriminator !== "0" && discordUser.discriminator !== "" && (
                <p className="text-xs text-zinc-500">#{discordUser.discriminator}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-300">{t("conn_discord_rpc_label")}</p>
              <p className="text-[11px] text-zinc-500">{t("conn_discord_rpc_desc")}</p>
            </div>
            <button
              onClick={() => handleToggleRpc(!discordRpcEnabled)}
              className={cn(
                "overflow-hidden w-9 h-5 rounded-full transition-colors relative shrink-0",
                discordRpcEnabled ? "bg-indigo-600" : "bg-zinc-700"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white transition-transform",
                  discordRpcEnabled ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConnectionHub() {
  const t = useT();
  const showAdultContent = useAppStore((s) => s.showAdultContent);
  const setShowAdultContent = useAppStore((s) => s.setShowAdultContent);
  const [githubUser, setGithubUser] = useState<GithubUserInfo | null>(null);
  const [githubStep, setGithubStep] = useState<"idle" | "waiting" | "done">("idle");
  const [devicePrompt, setDevicePrompt] = useState<{ user_code: string; verification_uri: string } | null>(null);

  const { status: boothStatus, purchaseCount, connect: boothConnect, disconnect: boothDisconnect } = useBoothStatus();

  useEffect(() => {
    github.getUser().then(setGithubUser).catch(() => setGithubUser(null));
  }, []);

  const startGithubAuth = useCallback(async () => {
    if (githubStep === "waiting") {
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
      name: t("conn_github_title"),
      description: t("conn_github_desc"),
      logo: githubLogo,
      status: githubUser ? "connected" : githubStep === "waiting" ? "unknown" : "disconnected",
      accountLine: githubUser ? `@${githubUser.login}` : undefined,
      onConnect: startGithubAuth,
      onDisconnect: async () => { await github.logout(); setGithubUser(null); },
      connectingState: githubStep,
      devicePrompt: devicePrompt,
      expandedContent: githubUser ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {githubUser.avatar_url && (
              <img src={githubUser.avatar_url} className="w-10 h-10 rounded-full ring-2 ring-emerald-700/40" alt="" />
            )}
            <div>
              <p className="text-sm font-bold text-zinc-100">{githubUser.name ?? githubUser.login}</p>
              <p className="text-xs text-zinc-500">@{githubUser.login}</p>
            </div>
          </div>
          <a href={`https://github.com/${githubUser.login}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity"
            style={{ color: "var(--accent-color)" }}>
            <ExternalLink className="h-3 w-3" /> {t("conn_github_profile")}
          </a>
        </div>
      ) : undefined,
    },
    {
      id: "booth",
      name: t("conn_booth_title"),
      description: t("conn_booth_desc"),
      logo: <span className="text-2xl leading-none">🛒</span>,
      status: boothStatus === "connected" ? "connected" : boothStatus === "unknown" ? "unknown" : "disconnected",
      accountLine: boothStatus === "connected" && purchaseCount != null
        ? `${purchaseCount} purchased item${purchaseCount !== 1 ? "s" : ""}`
        : undefined,
      onConnect: boothConnect,
      onDisconnect: boothDisconnect,
      expandedContent: boothStatus === "connected" ? (
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-xs font-medium text-zinc-300">{t("conn_booth_adult_label")}</p>
            <p className="text-xs text-zinc-500">{t("conn_booth_adult_desc")}</p>
          </div>
          <button
            onClick={() => setShowAdultContent(!showAdultContent)}
            className={cn("w-9 h-5 rounded-full transition-colors relative", showAdultContent ? "bg-emerald-600" : "bg-zinc-700")}
          >
            <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform", showAdultContent ? "translate-x-4" : "translate-x-0.5")} />
          </button>
        </div>
      ) : undefined,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Wifi className="h-3.5 w-3.5 text-zinc-500" />
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("conn_integrations_title")}</p>
      </div>
      <div className="flex flex-col gap-3">
        {cards.map((card) => (
          <ConnectionCard key={card.id} card={card} />
        ))}
        <DiscordConnectionCard />
      </div>
    </div>
  );
}
