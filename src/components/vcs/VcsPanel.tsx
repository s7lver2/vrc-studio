import { useEffect, useState, useCallback } from "react";
import { useVcsStore } from "@/store/vcsStore";
import { CommitHistory } from "./CommitHistory";
import { CommitDiffView } from "./CommitDiffView";
import { BranchSelector } from "./BranchSelector";
import { ConflictResolverTab } from "./ConflictResolverTab";
import { FileTypeIcon } from "./FileTypeIcon";
import { vcs, github, type GithubUserInfo } from "@/lib/tauri";
import type { CommitEntry } from "@/types/vcs";
import { RefreshCw } from "lucide-react";
import { useT } from "@/i18n";

interface Props {
  projectPath: string;
}

type Tab = "changes" | "history" | "branches" | "conflicts";

// ── GitHub Auth hook ──────────────────────────────────────────────────────────

type OAuthStep = "idle" | "awaiting_user" | "polling" | "done";

interface GitHubAuthState {
  step: OAuthStep;
  userCode: string | null;
  verificationUri: string | null;
  error: string | null;
  user: GithubUserInfo | null;
}

function useGithubAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [auth, setAuth] = useState<GitHubAuthState>({
    step: "idle",
    userCode: null,
    verificationUri: null,
    error: null,
    user: null,
  });

  // Intentar recuperar sesión existente al montar
  useEffect(() => {
    github.getUser().then((user) => {
      if (user) {
        setAuth((a) => ({ ...a, step: "done", user }));
        github.getToken().then(setToken).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const startAuth = useCallback(async () => {
    setAuth({ step: "idle", userCode: null, verificationUri: null, error: null, user: null });
    try {
      const prompt = await github.startDeviceAuth();
      setAuth({
        step: "awaiting_user",
        userCode: prompt.user_code,
        verificationUri: prompt.verification_uri,
        error: null,
        user: null,
      });
      // Abrir la URL en el navegador por defecto
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(prompt.verification_uri);
      } catch {
        // Si no está disponible el plugin-shell, el usuario puede abrir la URL manualmente
      }
      // Iniciar polling
      setAuth((a) => ({ ...a, step: "polling" }));
      const user = await github.pollToken();
      const tok = await github.getToken();
      setToken(tok);
      setAuth({ step: "done", userCode: null, verificationUri: null, error: null, user });
    } catch (e) {
      setAuth((a) => ({ ...a, step: "idle", error: String(e) }));
    }
  }, []);

  const logout = useCallback(async () => {
    await github.logout().catch(() => {});
    setToken(null);
    setAuth({ step: "idle", userCode: null, verificationUri: null, error: null, user: null });
  }, []);

  return { token, auth, startAuth, logout };
}

// ── GitHub auth sub-widget ────────────────────────────────────────────────────

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GithubAuthWidget({
  auth,
  onStart,
}: {
  auth: GitHubAuthState;
  onStart: () => void;
}) {
  const t = useT();

  if (auth.step === "idle") {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          onClick={onStart}
          className="flex items-center gap-2 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <GithubIcon />
          {t("vcs_github_connect")}
        </button>
        {auth.error && <p className="text-xs text-red-400">{auth.error}</p>}
      </div>
    );
  }

  if (auth.step === "awaiting_user" || auth.step === "polling") {
    return (
      <div className="flex flex-col gap-2 rounded border border-zinc-700 bg-zinc-900 p-3">
        <p className="text-xs text-zinc-400">
          {t("vcs_github_step1", { url: auth.verificationUri ?? "#" })}
        </p>
        <p className="text-xs text-zinc-400">{t("vcs_github_step2")}</p>
        <span className="font-mono text-base font-bold tracking-widest text-zinc-100 text-center py-1.5 bg-zinc-800 rounded select-all">
          {auth.userCode}
        </span>
        {auth.step === "polling" && (
          <p className="text-xs text-zinc-500 text-center animate-pulse">
            {t("vcs_github_waiting")}
          </p>
        )}
      </div>
    );
  }

  return null;
}

// ── Main VcsPanel ─────────────────────────────────────────────────────────────

export function VcsPanel({ projectPath }: Props) {
  const t = useT();
  const {
    status, log, branches, isLoading, error,
    loadStatus, loadLog, loadBranches, commit,
    createBranch, switchBranch,
  } = useVcsStore();

  const { token: githubToken, auth, startAuth, logout } = useGithubAuth();

  const [tab, setTab] = useState<Tab>("changes");
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pushPullLoading, setPushPullLoading] = useState(false);
  const [pushPullError, setPushPullError] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [showAddRemote, setShowAddRemote] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<CommitEntry | null>(null);

  useEffect(() => {
    loadStatus(projectPath);
    loadLog(projectPath);
    loadBranches(projectPath);
    setSelectedCommit(null);
  }, [projectPath]);

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await commit(projectPath, commitMsg.trim());
      setCommitMsg("");
    } catch (e) {
      setCommitError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    if (!githubToken) return;
    setPushPullLoading(true);
    setPushPullError(null);
    try {
      await vcs.push(projectPath, githubToken);
      await loadStatus(projectPath);
    } catch (e) {
      setPushPullError(String(e));
    } finally {
      setPushPullLoading(false);
    }
  };

  const handlePull = async () => {
    if (!githubToken) return;
    setPushPullLoading(true);
    setPushPullError(null);
    try {
      await vcs.pull(projectPath, githubToken);
      await loadStatus(projectPath);
    } catch (e) {
      setPushPullError(String(e));
    } finally {
      setPushPullLoading(false);
    }
  };

  const handleAddRemote = async () => {
    if (!remoteUrl.trim()) return;
    setPushPullError(null);
    try {
      await vcs.addRemote(projectPath, remoteUrl.trim());
      setShowAddRemote(false);
      setRemoteUrl("");
      await loadStatus(projectPath);
    } catch (e) {
      setPushPullError(String(e));
    }
  };

  if (isLoading && !status) {
    return <div className="p-4 text-sm text-zinc-500">{t("vcs_loading")}</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-red-400">{t("vcs_error", { error })}</div>;
  }
  if (!status) return null;

  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;

  const tabDefinitions: [Tab, string][] = [
    ["changes", totalChanges > 0 ? t("vcs_tab_changes_count", { count: totalChanges }) : t("vcs_tab_changes")],
    ["history", t("vcs_tab_history")],
    ["branches", t("vcs_tab_branches")],
    ["conflicts", t("vcs_tab_conflicts")],
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex gap-0 border-b border-zinc-800 px-3">
        {tabDefinitions.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs transition-colors ${
              tab === id
                ? "border-b-2 border-red-500 font-medium text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => { loadStatus(projectPath); loadLog(projectPath); }}
          className="ml-auto text-xs text-zinc-600 hover:text-zinc-400 py-2 px-2"
          title={t("vcs_refresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Branch + upstream info */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <span className="text-xs font-mono bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">
          {status.branch}
        </span>
        {status.has_upstream && (
          <span className="text-xs text-zinc-500">
            {status.ahead > 0 && `↑${status.ahead} `}
            {status.behind > 0 && `↓${status.behind}`}
          </span>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "changes" && (
          <div className="flex flex-col gap-4 p-4">
            {/* Changed files list */}
            {totalChanges === 0 ? (
              <p className="text-sm text-zinc-500">{t("vcs_no_changes")}</p>
            ) : (
              <div className="flex flex-col gap-0 rounded-lg border border-zinc-800 overflow-hidden">
                {status.staged.map((f) => (
                  <div key={f} className="flex items-center gap-2 px-3 py-1.5 bg-green-950/20 border-b border-zinc-800/50 last:border-0">
                    <FileTypeIcon path={f} className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[10px] font-mono text-zinc-300 flex-1 truncate">{f}</span>
                    <span className="text-[9px] font-bold text-green-400 bg-green-950/60 border border-green-900/40 rounded px-1">S</span>
                  </div>
                ))}
                {status.unstaged.map((f) => (
                  <div key={f} className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                    <FileTypeIcon path={f} className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[10px] font-mono text-zinc-300 flex-1 truncate">{f}</span>
                    <span className="text-[9px] font-bold text-yellow-400 bg-yellow-950/60 border border-yellow-900/40 rounded px-1">M</span>
                  </div>
                ))}
                {status.untracked.map((f) => (
                  <div key={f} className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                    <FileTypeIcon path={f} className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    <span className="text-[10px] font-mono text-zinc-500 flex-1 truncate">{f}</span>
                    <span className="text-[9px] font-bold text-zinc-500 bg-zinc-800 border border-zinc-700 rounded px-1">?</span>
                  </div>
                ))}
              </div>
            )}

            {/* Commit form */}
            {totalChanges > 0 && (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  placeholder={t("vcs_commit_placeholder")}
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCommit()}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-red-600"
                />
                {commitError && <p className="text-xs text-red-400">{commitError}</p>}
                <button
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || committing}
                  className="rounded bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {committing ? t("vcs_committing") : t("vcs_commit_button")}
                </button>
              </div>
            )}

            {/* Remote / Push / Pull */}
            {status.has_upstream ? (
              <div className="flex flex-col gap-2">
                {auth.step === "done" && githubToken ? (
                  <>
                    <div className="flex gap-2">
                      <button
                        onClick={handlePush}
                        disabled={pushPullLoading}
                        className="flex-1 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        ↑ {t("vcs_push")}
                      </button>
                      <button
                        onClick={handlePull}
                        disabled={pushPullLoading}
                        className="flex-1 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        ↓ {t("vcs_pull")}
                      </button>
                    </div>
                    {pushPullError && <p className="text-xs text-red-400">{pushPullError}</p>}
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span className="flex items-center gap-1">
                        <GithubIcon />
                        {auth.user?.login ?? t("vcs_github_authenticated")}
                      </span>
                      <button onClick={logout} className="hover:text-zinc-300">
                        {t("vcs_github_logout")}
                      </button>
                    </div>
                  </>
                ) : (
                  <GithubAuthWidget auth={auth} onStart={startAuth} />
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {showAddRemote ? (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={t("vcs_remote_placeholder")}
                        value={remoteUrl}
                        onChange={(e) => setRemoteUrl(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddRemote()}
                        className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-red-600"
                      />
                      <button
                        onClick={handleAddRemote}
                        className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
                      >
                        {t("vcs_add")}
                      </button>
                      <button
                        onClick={() => setShowAddRemote(false)}
                        className="text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        ✕
                      </button>
                    </div>
                    {pushPullError && <p className="text-xs text-red-400">{pushPullError}</p>}
                  </>
                ) : (
                  <button
                    onClick={() => setShowAddRemote(true)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 text-left"
                  >
                    + {t("vcs_remote_add")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "history" && (
          selectedCommit ? (
            <CommitDiffView
              projectPath={projectPath}
              commitSha={selectedCommit.id}
              commitMessage={selectedCommit.message}
              onBack={() => setSelectedCommit(null)}
            />
          ) : (
            <CommitHistory entries={log} onSelect={setSelectedCommit} />
          )
        )}

        {tab === "branches" && (
          <div className="py-4">
            <BranchSelector
              branches={branches}
              onSwitch={(name) => switchBranch(projectPath, name)}
              onCreate={(name) => createBranch(projectPath, name)}
            />
          </div>
        )}
        {tab === "conflicts" && (
          <ConflictResolverTab
            projectPath={projectPath}
            onResolved={() => { setTab("changes"); loadStatus(projectPath); }}
          />
        )}
      </div>
    </div>
  );
}