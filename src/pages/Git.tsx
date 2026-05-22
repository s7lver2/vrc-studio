// src/pages/Git.tsx — Git management panel
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    GitBranch, GitCommit, GitMerge, GitPullRequest,
    AlertTriangle, CheckCircle2, Plus, Trash2,
    RefreshCw, Loader2, ArrowUp, ArrowDown, 
    ExternalLink,
    Circle, X, Check, Upload,
    FolderOpen, Eye, Layers, Cpu, LogOut,
    Zap, Star, Hash, User, GitFork,
    Pencil
} from "lucide-react";
import { GitTreePage } from "@/components/git/tree/GitTreePage";
import { useAppStore } from "@/store/app";
import { createPortal } from "react-dom";
import { Project } from "@/lib/tauri";
import { vcs, github, GithubUserInfo, GithubRepo } from "@/lib/tauri";
import type { GitStatus, CommitEntry, BranchInfo, FileDiff, CommitDiffFile } from "@/types/vcs";
import { GlobalProjectPickerModal } from "@/components/shared/GlobalProjectPickerModal";
import { FileTypeIcon } from "@/components/vcs/FileTypeIcon";
import { useVcsStore, } from "@/store/vcsStore";



// ── helpers ─────────────────────────────────────────────────────────────────

function cn(...c: (string | boolean | undefined)[]) {
    return c.filter(Boolean).join(" ");
}

function fmtShort(ts: number) {
    const d = new Date(ts * 1000);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// ── Sub-page type ─────────────────────────────────────────────────────────────

type GitPage = "overview" | "changes" | "tree" | "conflicts" | "branches" | "github";

const GIT_TABS: { id: GitPage; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Eye },
    { id: "changes", label: "Changes", icon: GitCommit },
    { id: "tree", label: "Tree", icon: Layers },
    { id: "conflicts", label: "Conflicts", icon: AlertTriangle },
    { id: "branches", label: "Branches", icon: GitBranch },
    { id: "github", label: "GitHub", icon: GitPullRequest },
];

// ── Empty state (no project selected) ────────────────────────────────────────

function NoProjectSelected({ onOpen }: { onOpen: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center flex-1 gap-8 px-8">
            <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                    <GitBranch className="h-8 w-8 text-zinc-600" />
                </div>
                <h2 className="text-lg font-semibold text-zinc-100">No project selected</h2>
                <p className="text-sm text-zinc-500 text-center max-w-xs">
                    Choose a project with Git enabled to manage version control, commits, branches, and GitHub sync.
                </p>
            </div>
            <button
                onClick={onOpen}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
            >
                <FolderOpen className="h-4 w-4" />
                Select Project
            </button>
        </div>
    );
}

// ── Overview page ─────────────────────────────────────────────────────────────

function CommitHeatmap({ commits }: { commits: CommitEntry[] }) {
    const weeks = 52;
    const days = 7;

    // Build a day → count map for the last 52 weeks
    const counts: Record<string, number> = {};
    const now = Date.now();
    commits.forEach((c) => {
        const d = new Date(c.timestamp * 1000);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        counts[key] = (counts[key] ?? 0) + 1;
    });

    const cells: { date: Date; count: number }[][] = Array.from({ length: weeks }, (_, wi) =>
        Array.from({ length: days }, (_, di) => {
            const msAgo = ((weeks - 1 - wi) * 7 + (days - 1 - di)) * 86400 * 1000;
            const date = new Date(now - msAgo);
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            return { date, count: counts[key] ?? 0 };
        })
    );

    const maxCount = Math.max(...Object.values(counts), 1);

    function cellColor(count: number) {
        if (count === 0) return "bg-zinc-800/60";
        const pct = count / maxCount;
        if (pct < 0.25) return "bg-emerald-900";
        if (pct < 0.5) return "bg-emerald-700";
        if (pct < 0.75) return "bg-emerald-500";
        return "bg-emerald-400";
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const DAY_LABELS = ["", "M", "", "W", "", "F", ""];

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <div className="flex flex-col gap-1 mr-1.5">
                    {DAY_LABELS.map((l, i) => (
                        <div key={i} className="h-2.5 w-3 text-[8px] text-zinc-700 flex items-center">{l}</div>
                    ))}
                </div>
                {cells.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-1">
                        {week.map((cell, di) => (
                            <div
                                key={di}
                                title={`${cell.date.toLocaleDateString()}: ${cell.count} commits`}
                                className={cn("w-2.5 h-2.5 rounded-[2px] transition-colors", cellColor(cell.count))}
                            />
                        ))}
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-1 ml-4 mt-1">
                <span className="text-[9px] text-zinc-600">Less</span>
                {["bg-zinc-800/60", "bg-emerald-900", "bg-emerald-700", "bg-emerald-500", "bg-emerald-400"].map((c, i) => (
                    <div key={i} className={cn("w-2.5 h-2.5 rounded-[2px]", c)} />
                ))}
                <span className="text-[9px] text-zinc-600">More</span>
            </div>
        </div>
    );
}

function OverviewPage({ project }: { project: Project }) {
    const [commits, setCommits] = useState<CommitEntry[]>([]);
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(true);

    // ── Expanded commit state ─────────────────────────────────────────────────
    const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null);
    const [commitFilesMap, setCommitFilesMap] = useState<Record<string, CommitDiffFile[]>>({});
    const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
    const [expandedFileKey, setExpandedFileKey] = useState<string | null>(null); // "sha:filepath"
    const [fileDiffMap, setFileDiffMap] = useState<Record<string, FileDiff | null>>({});
    const [loadingDiff, setLoadingDiff] = useState<Set<string>>(new Set());

    // ── Gitignore state ───────────────────────────────────────────────────────
    const [gitignoreContent, setGitignoreContent] = useState<string | null>(null);
    const [gitignoreSaving, setGitignoreSaving] = useState(false);
    const [newPattern, setNewPattern] = useState("");

    useEffect(() => {
        Promise.all([
            vcs.getLog(project.path, 365),
            vcs.getStatus(project.path),
        ]).then(([c, s]) => { setCommits(c); setStatus(s); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [project.path]);

    useEffect(() => {
        vcs.readGitignore(project.path)
            .then(setGitignoreContent)
            .catch(() => setGitignoreContent(""));
    }, [project.path]);

    const handleCommitToggle = async (commitId: string) => {
        if (expandedCommitId === commitId) {
            setExpandedCommitId(null);
            setExpandedFileKey(null);
            return;
        }
        setExpandedCommitId(commitId);
        setExpandedFileKey(null);
        if (!commitFilesMap[commitId] && !loadingFiles.has(commitId)) {
            setLoadingFiles((prev) => new Set(prev).add(commitId));
            try {
                const files = await vcs.getCommitDiff(project.path, commitId);
                setCommitFilesMap((prev) => ({ ...prev, [commitId]: files }));
            } catch {
                setCommitFilesMap((prev) => ({ ...prev, [commitId]: [] }));
            } finally {
                setLoadingFiles((prev) => { const s = new Set(prev); s.delete(commitId); return s; });
            }
        }
    };

    const handleFileToggle = async (commitId: string, filePath: string) => {
        const key = `${commitId}:${filePath}`;
        if (expandedFileKey === key) {
            setExpandedFileKey(null);
            return;
        }
        setExpandedFileKey(key);
        if (fileDiffMap[key] === undefined && !loadingDiff.has(key)) {
            setLoadingDiff((prev) => new Set(prev).add(key));
            try {
                const diff = await vcs.getFileDiff(project.path, commitId, filePath);
                setFileDiffMap((prev) => ({ ...prev, [key]: diff }));
            } catch {
                setFileDiffMap((prev) => ({ ...prev, [key]: null }));
            } finally {
                setLoadingDiff((prev) => { const s = new Set(prev); s.delete(key); return s; });
            }
        }
    };

    const handleAddPattern = async () => {
        const trimmed = newPattern.trim();
        if (!trimmed || gitignoreContent === null) return;
        const lines = gitignoreContent.split("\n").map((l) => l.trim());
        if (lines.includes(trimmed)) { setNewPattern(""); return; }
        const updated = gitignoreContent
            ? gitignoreContent.trimEnd() + "\n" + trimmed + "\n"
            : trimmed + "\n";
        setGitignoreSaving(true);
        try {
            await vcs.writeGitignore(project.path, updated);
            setGitignoreContent(updated);
            setNewPattern("");
        } catch (e) {
            console.error("Failed to write .gitignore:", e);
        } finally {
            setGitignoreSaving(false);
        }
    };

    if (loading) {
        return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;
    }

    const totalFiles = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
    const authors = [...new Set(commits.map((c) => c.author))].length;

    const stats = [
        { label: "Total Commits", value: commits.length, icon: GitCommit, color: "text-violet-400" },
        { label: "Branch", value: status?.branch ?? "—", icon: GitBranch, color: "text-emerald-400" },
        { label: "Contributors", value: authors, icon: User, color: "text-blue-400" },
        { label: "Pending Changes", value: totalFiles, icon: AlertTriangle, color: totalFiles > 0 ? "text-amber-400" : "text-zinc-600" },
    ];

    return (
        <div className="flex flex-col gap-6 p-6 overflow-y-auto flex-1">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
                {stats.map((s) => (
                    <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <s.icon className={cn("h-3.5 w-3.5", s.color)} />
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{s.label}</span>
                        </div>
                        <p className="text-xl font-bold text-zinc-100 font-mono">{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Heatmap */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Commit Activity</p>
                <CommitHeatmap commits={commits} />
            </div>

            {/* Recent commits — expandable */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Recent Commits</p>
                </div>
                <div className="divide-y divide-zinc-800/60 max-h-[480px] overflow-y-auto">
                    {commits.slice(0, 20).map((c) => {
                        const isExpanded = expandedCommitId === c.id;
                        const files = commitFilesMap[c.id] ?? [];
                        const isLoadingFiles = loadingFiles.has(c.id);

                        return (
                            <div key={c.id}>
                                {/* ── Commit row ── */}
                                <button
                                    onClick={() => handleCommitToggle(c.id)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/40 transition-colors text-left"
                                >
                                    {/* Chevron */}
                                    <svg
                                        width="10" height="10" viewBox="0 0 10 10"
                                        style={{ flexShrink: 0, transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                                    >
                                        <path d="M3 2 L7 5 L3 8" stroke="#52525b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                                    </svg>
                                    <span className="font-mono text-[10px] text-zinc-600 w-14 shrink-0">{c.id.slice(0, 7)}</span>
                                    <p className="flex-1 text-xs text-zinc-300 truncate">{c.message}</p>
                                    {/* Commit weight badge — only when expanded and files loaded */}
                                    {isExpanded && !isLoadingFiles && files.length > 0 && (() => {
                                        const totalIns = files.reduce((acc, f) => acc + f.insertions, 0);
                                        const totalDel = files.reduce((acc, f) => acc + f.deletions, 0);
                                        return (
                                            <span className="text-[9px] shrink-0 font-mono">
                                                <span className="text-emerald-600">+{totalIns}</span>
                                                {" "}
                                                <span className="text-red-700">-{totalDel}</span>
                                            </span>
                                        );
                                    })()}
                                    <span className="text-[10px] text-zinc-600 shrink-0">{c.author}</span>
                                    <span className="text-[10px] text-zinc-600 shrink-0">{fmtShort(c.timestamp)}</span>
                                </button>

                                {/* ── Expanded: file list ── */}
                                {isExpanded && (
                                    <div className="bg-zinc-950/60 border-t border-zinc-800/50">
                                        {isLoadingFiles && (
                                            <div className="flex items-center gap-2 px-8 py-3">
                                                <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
                                                <span className="text-[10px] text-zinc-600">Loading files…</span>
                                            </div>
                                        )}
                                        {!isLoadingFiles && files.length === 0 && (
                                            <p className="text-[10px] text-zinc-600 px-8 py-3">No file changes</p>
                                        )}
                                        {files.map((f) => {
                                            const fileKey = `${c.id}:${f.path}`;
                                            const isFileExpanded = expandedFileKey === fileKey;
                                            const diff = fileDiffMap[fileKey];
                                            const isLoadingFileDiff = loadingDiff.has(fileKey);

                                            const statusColors: Record<string, string> = {
                                                added: "text-emerald-400", deleted: "text-red-400",
                                                modified: "text-amber-400", renamed: "text-blue-400",
                                            };

                                            return (
                                                <div key={f.path}>
                                                    {/* File row */}
                                                    <button
                                                        onClick={() => handleFileToggle(c.id, f.path)}
                                                        className="w-full flex items-center gap-2 px-8 py-1.5 hover:bg-zinc-800/30 transition-colors text-left"
                                                    >
                                                        <svg width="8" height="8" viewBox="0 0 10 10" style={{ flexShrink: 0, transition: "transform 0.15s", transform: isFileExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                                                            <path d="M3 2 L7 5 L3 8" stroke="#52525b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                                                        </svg>
                                                        <span className={cn("text-[9px] font-bold w-3 shrink-0", statusColors[f.status] ?? "text-zinc-500")}>
                                                            {f.status[0].toUpperCase()}
                                                        </span>
                                                        <span className="font-mono text-[10px] text-zinc-400 truncate flex-1">{f.path}</span>
                                                        <span className="text-[9px] text-emerald-600 shrink-0">+{f.insertions}</span>
                                                        <span className="text-[9px] text-red-700 shrink-0 ml-1">-{f.deletions}</span>
                                                    </button>

                                                    {/* Diff viewer */}
                                                    {isFileExpanded && (
                                                        <div className="mx-8 mb-2 rounded-lg border border-zinc-800 overflow-hidden">
                                                            {isLoadingFileDiff && (
                                                                <div className="flex items-center gap-2 px-4 py-3">
                                                                    <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
                                                                    <span className="text-[10px] text-zinc-600">Loading diff…</span>
                                                                </div>
                                                            )}
                                                            {!isLoadingFileDiff && diff && <DiffViewer diff={diff} />}
                                                            {!isLoadingFileDiff && !diff && (
                                                                <p className="text-[10px] text-zinc-600 px-4 py-3">Diff unavailable</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {commits.length === 0 && (
                        <p className="text-xs text-zinc-600 text-center py-6">No commits yet</p>
                    )}
                </div>
            </div>

            {/* .gitignore viewer */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex-1">.gitignore</p>
                    {gitignoreSaving && <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />}
                </div>

                {/* Current contents */}
                {gitignoreContent !== null && (
                    <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800/40">
                        {gitignoreContent.split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((line, i) => (
                            <div key={i} className="flex items-center gap-2 px-4 py-1.5 group">
                                <span className="font-mono text-[10px] text-zinc-400 flex-1">{line.trim()}</span>
                            </div>
                        ))}
                        {gitignoreContent.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length === 0 && (
                            <p className="text-[10px] text-zinc-600 px-4 py-3">No entries yet</p>
                        )}
                    </div>
                )}
                {gitignoreContent === null && (
                    <div className="flex items-center gap-2 px-4 py-3">
                        <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
                        <span className="text-[10px] text-zinc-600">Loading…</span>
                    </div>
                )}

                {/* Add pattern */}
                <div className="px-4 py-3 border-t border-zinc-800 flex gap-2">
                    <input
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddPattern(); }}
                        placeholder="Add pattern (e.g. *.log, /Temp/)"
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-[11px] text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-violet-600 transition-colors"
                    />
                    <button
                        onClick={handleAddPattern}
                        disabled={!newPattern.trim() || gitignoreSaving}
                        className="px-3 py-1.5 bg-violet-900/50 hover:bg-violet-800/60 border border-violet-700/40 text-violet-300 text-[11px] font-semibold rounded-md disabled:opacity-40 transition-colors"
                    >
                        Add
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Changes page ──────────────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: FileDiff | null }) {
    if (!diff) {
        return (
            <div className="flex flex-1 items-center justify-center text-zinc-600 text-sm">
                Select a file to see its diff
            </div>
        );
    }
    return (
        <div className="flex-1 overflow-y-auto font-mono text-[11px]">
            {diff.hunks.map((hunk, hi) => (
                <div key={hi}>
                    <div className="px-3 py-1 bg-zinc-800/80 text-zinc-500 sticky top-0">{hunk.header}</div>
                    {hunk.lines.map((line, li) => (
                        <div
                            key={li}
                            className={cn(
                                "flex px-3 py-px",
                                line.origin === "+" && "bg-emerald-950/30 text-emerald-300",
                                line.origin === "-" && "bg-red-950/30 text-red-300",
                                line.origin === " " && "text-zinc-400",
                            )}
                        >
                            <span className="w-6 text-zinc-700 select-none shrink-0">{line.origin}</span>
                            <span className="flex-1 whitespace-pre">{line.content}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function MiniCommitTree({ commits }: { commits: CommitEntry[] }) {
    const shown = commits.slice(0, 8);
    return (
        <div className="flex flex-col gap-0">
            {shown.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/30">
                    <div className="flex flex-col items-center shrink-0">
                        <div className={cn("w-2.5 h-2.5 rounded-full border-2", i === 0 ? "border-violet-500 bg-violet-900" : "border-zinc-600 bg-zinc-800")} />
                        {i < shown.length - 1 && <div className="w-px h-4 bg-zinc-700" />}
                    </div>
                    <span className="font-mono text-[9px] text-zinc-700 w-10 shrink-0">{c.id}</span>
                    <span className="text-[10px] text-zinc-400 truncate flex-1">{c.message}</span>
                    <span className="text-[9px] text-zinc-600 shrink-0">{fmtShort(c.timestamp)}</span>
                </div>
            ))}
        </div>
    );
}

function ChangesPage({ project }: { project: Project }) {
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [commits, setCommits] = useState<CommitEntry[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [diff, setDiff] = useState<FileDiff | null>(null);
    const [commitMsg, setCommitMsg] = useState("");
    const [committing, setCommitting] = useState(false);
    const [commitResult, setCommitResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const [s, log] = await Promise.all([
                vcs.getStatus(project.path),
                vcs.getLog(project.path, 10),
            ]);
            setStatus(s);
            setCommits(log);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [project.path]);

    useEffect(() => { refresh(); }, [refresh]);

    const handleSelectFile = async (file: string) => {
        setSelectedFile(file);
        try {
            const d = await vcs.getFileDiff(project.path, "HEAD", file);
            setDiff(d);
        } catch { setDiff(null); }
    };

    const handleCommit = async () => {
        if (!commitMsg.trim()) return;
        setCommitting(true);
        setCommitResult(null);
        try {
            const sha = await vcs.commit(project.path, commitMsg);
            setCommitResult({ ok: true, msg: `Committed: ${sha}` });
            setCommitMsg("");
            await refresh();
        } catch (e) {
            setCommitResult({ ok: false, msg: String(e) });
        } finally {
            setCommitting(false);
        }
    };

    const allChanged = [...(status?.staged ?? []), ...(status?.unstaged ?? []), ...(status?.untracked ?? [])];

    if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left: file list + commit form */}
            <div className="w-64 shrink-0 flex flex-col border-r border-zinc-800">
                {/* Commit form */}
                <div className="p-3 border-b border-zinc-800 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Commit</span>
                        <div className="flex-1 h-px bg-zinc-800" />
                        <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                            <GitBranch className="h-3 w-3" />{status?.branch ?? "—"}
                        </div>
                    </div>
                    <textarea
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2.5 py-2 resize-none focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
                        rows={3}
                        placeholder="Commit message…"
                        value={commitMsg}
                        onChange={(e) => setCommitMsg(e.target.value)}
                    />
                    <button
                        onClick={handleCommit}
                        disabled={committing || !commitMsg.trim()}
                        className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommit className="h-3 w-3" />}
                        {committing ? "Committing…" : "Commit All"}
                    </button>
                    {commitResult && (
                        <div className={cn("text-[10px] px-2 py-1.5 rounded flex items-center gap-1.5",
                            commitResult.ok ? "text-emerald-300 bg-emerald-950/40" : "text-red-300 bg-red-950/40"
                        )}>
                            {commitResult.ok ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
                            {commitResult.msg}
                        </div>
                    )}
                </div>

                {/* File list */}
                <div className="flex-1 overflow-y-auto">
                    {status?.staged.length ? (
                        <>
                            <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600">Staged ({status.staged.length})</div>
                            {status.staged.map((f) => (
                                <button key={f} onClick={() => handleSelectFile(f)}
                                    className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-zinc-800/50", selectedFile === f && "bg-zinc-800")}>
                                    <span className="relative flex items-center shrink-0">
                                        <FileTypeIcon path={f} className="h-3.5 w-3.5 shrink-0" />
                                        <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    </span>
                                    <span className="text-zinc-300 truncate">{f}</span>
                                </button>
                            ))}
                        </>
                    ) : null}
                    {status?.unstaged.length ? (
                        <>
                            <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600">Modified ({status.unstaged.length})</div>
                            {status.unstaged.map((f) => (
                                <button key={f} onClick={() => handleSelectFile(f)}
                                    className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-zinc-800/50", selectedFile === f && "bg-zinc-800")}>
                                    <span className="relative flex items-center shrink-0">
                                        <FileTypeIcon path={f} className="h-3.5 w-3.5 shrink-0" />
                                        <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    </span>
                                    <span className="text-zinc-300 truncate">{f}</span>
                                </button>
                            ))}
                        </>
                    ) : null}
                    {status?.untracked.length ? (
                        <>
                            <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600">Untracked ({status.untracked.length})</div>
                            {status.untracked.map((f) => (
                                <button key={f} onClick={() => handleSelectFile(f)}
                                    className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-zinc-800/50", selectedFile === f && "bg-zinc-800")}>
                                    <span className="relative flex items-center shrink-0">
                                        <FileTypeIcon path={f} className="h-3.5 w-3.5 shrink-0 opacity-50" />
                                        <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-zinc-500" />
                                    </span>
                                    <span className="text-zinc-500 truncate">{f}</span>
                                </button>
                            ))}
                        </>
                    ) : null}
                    {allChanged.length === 0 && (
                        <div className="flex flex-col items-center gap-2 py-8 text-zinc-700">
                            <CheckCircle2 className="h-6 w-6 text-emerald-700/50" />
                            <p className="text-xs">Working tree clean</p>
                        </div>
                    )}
                </div>

                {/* Mini tree */}
                <div className="border-t border-zinc-800">
                    <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600">Recent</div>
                    <MiniCommitTree commits={commits} />
                </div>
            </div>

            {/* Right: diff viewer */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selectedFile && (
                    <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono text-zinc-400">{selectedFile}</span>
                    </div>
                )}
                <DiffViewer diff={diff} />
            </div>
        </div>
    );
}



// ── Conflicts page ────────────────────────────────────────────────────────────

function ConflictsPage({ project }: { project: Project }) {
    const [conflicts, setConflicts] = useState<{ path: string; ours: string; theirs: string }[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [resolving, setResolving] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        vcs.getConflicts(project.path)
            .then((files) => {
                setConflicts(files.map((f: any) => ({
                    path: f.path,
                    ours: f.ours_content ?? "",
                    theirs: f.theirs_content ?? "",
                })));
            })
            .catch(() => setConflicts([]))
            .finally(() => setLoading(false));
    }, [project.path]);

    const resolve = async (path: string, strategy: "ours" | "theirs") => {
        setResolving(path);
        try {
            await vcs.resolveConflict(project.path, path, strategy === "ours" ? "ours" : "theirs");
            setConflicts((prev) => prev.filter((c) => c.path !== path));
            if (selected === path) setSelected(null);
        } catch (e) { console.error(e); }
        finally { setResolving(null); }
    };

    if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;

    if (conflicts.length === 0) {
        return (
            <div className="flex flex-col flex-1 items-center justify-center gap-3 text-zinc-600">
                <CheckCircle2 className="h-10 w-10 text-emerald-700/40" />
                <p className="text-sm font-medium">No conflicts detected</p>
                <p className="text-xs text-zinc-700">Your working tree is clean</p>
            </div>
        );
    }

    const sel = conflicts.find((c) => c.path === selected);

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* File list */}
            <div className="w-56 shrink-0 border-r border-zinc-800 flex flex-col">
                <div className="px-3 py-2 border-b border-zinc-800">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">
                        {conflicts.length} Conflict{conflicts.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {conflicts.map((c) => (
                        <button
                            key={c.path}
                            onClick={() => setSelected(c.path)}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors",
                                selected === c.path ? "bg-zinc-800" : "hover:bg-zinc-800/50"
                            )}
                        >
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="text-zinc-300 truncate">{c.path}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Conflict viewer */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {sel ? (
                    <>
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0">
                            <span className="text-xs font-mono text-zinc-400">{sel.path}</span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => resolve(sel.path, "ours")}
                                    disabled={resolving === sel.path}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700/40 hover:bg-blue-600/50 text-xs text-blue-300 border border-blue-700/30 transition-colors disabled:opacity-40"
                                >
                                    {resolving === sel.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUp className="h-3 w-3" />}
                                    Accept Ours
                                </button>
                                <button
                                    onClick={() => resolve(sel.path, "theirs")}
                                    disabled={resolving === sel.path}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700/40 hover:bg-violet-600/50 text-xs text-violet-300 border border-violet-700/30 transition-colors disabled:opacity-40"
                                >
                                    {resolving === sel.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDown className="h-3 w-3" />}
                                    Accept Theirs
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-1 overflow-hidden">
                            <div className="flex-1 flex flex-col overflow-hidden border-r border-zinc-800">
                                <div className="px-3 py-1.5 bg-blue-950/30 text-[10px] font-semibold text-blue-400 border-b border-zinc-800">OURS (current)</div>
                                <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap leading-5">{sel.ours || "(empty)"}</pre>
                            </div>
                            <div className="flex-1 flex flex-col overflow-hidden">
                                <div className="px-3 py-1.5 bg-violet-950/30 text-[10px] font-semibold text-violet-400 border-b border-zinc-800">THEIRS (incoming)</div>
                                <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap leading-5">{sel.theirs || "(empty)"}</pre>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-1 items-center justify-center text-zinc-600 text-sm">
                        Select a file to resolve
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Branches page ─────────────────────────────────────────────────────────────

function BranchesPage({ project }: { project: Project }) {
    const { branchColors, setBranchColor } = useVcsStore();
    const [branches, setBranches] = useState<BranchInfo[]>([]);
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [switching, setSwitching] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [branchIcons, setBranchIcons] = useState<Record<string, string>>({});
    const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
    const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [lastCommit, setLastCommit] = useState<CommitEntry | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);

    const BRANCH_EMOJI_OPTIONS = [
        "🌿", "🚀", "🐛", "✨", "🔧", "🎨", "🔥", "🧪",
        "📦", "🛡️", "🌍", "🎯", "⚡", "💡", "🔑", "🏗️",
        "🧹", "📝", "🔬", "🎉",
    ];

    const refresh = useCallback(async () => {
        try {
            const [b, log, s] = await Promise.all([
                vcs.listBranches(project.path),
                vcs.getLog(project.path, 1),
                vcs.getStatus(project.path),
            ]);
            setBranches(b);
            setLastCommit(log[0] ?? null);
            setStatus(s);
        } catch (e: any) { setError(String(e)); }
        finally { setLoading(false); }
    }, [project.path]);

    useEffect(() => { refresh(); }, [refresh]);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        setError(null);
        try {
            await vcs.createBranch(project.path, newName.trim());
            setNewName("");
            setShowNew(false);
            await refresh();
        } catch (e: any) { setError(String(e)); }
        finally { setCreating(false); }
    };

    const handleSwitch = async (name: string) => {
        setSwitching(name);
        setError(null);
        try {
            await vcs.switchBranch(project.path, name);
            await refresh();
        } catch (e: any) { setError(String(e)); }
        finally { setSwitching(null); }
    };

    useEffect(() => {
        if (!iconPickerFor) return;
        const handleClick = (e: MouseEvent) => {
            if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
                setIconPickerFor(null);
                setEmojiPickerPos(null);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [iconPickerFor]);

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete branch "${name}"? This cannot be undone.`)) return;
        setDeleting(name);
        setError(null);
        try {
            await vcs.deleteBranch(project.path, name);
            await refresh();
        } catch (e: any) {
            setError(String(e));
        } finally {
            setDeleting(null);
        }
    };

    const handleRename = async (oldName: string, newName: string) => {
        if (!newName.trim() || newName === oldName) { setRenamingBranch(null); return; }
        try {
            // Stub – backend command not yet available
            setError(`Rename via CLI: git branch -m ${oldName} ${newName}`);
        } finally {
            setRenamingBranch(null);
        }
    };

    const handleMergeIntoCurrent = async (name: string) => {
        setError(`Merge stub — run: git merge ${name}`);
    };

    if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;

    return (
        <div className="flex flex-col flex-1 overflow-y-auto p-6 gap-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-zinc-100">Branches</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">{branches.length} branch{branches.length !== 1 ? "es" : ""}</p>
                </div>
                <button
                    onClick={() => setShowNew((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white font-medium transition-colors"
                >
                    <Plus className="h-3.5 w-3.5" /> New Branch
                </button>
            </div>

            {/* Create form */}
            {showNew && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
                    <p className="text-xs font-semibold text-zinc-400">Create new branch from HEAD</p>
                    <div className="flex gap-2">
                        <input
                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 px-3 py-2 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
                            placeholder="branch-name"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                            autoFocus
                        />
                        <button
                            onClick={handleCreate}
                            disabled={creating || !newName.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors disabled:opacity-40"
                        >
                            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Create
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div className="rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2.5 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
                    <p className="text-xs text-red-300">{error}</p>
                </div>
            )}

            {/* Branch list */}
            <div className="flex flex-col gap-3">
                {branches.map((b) => {
                    const isCurrent = b.name === (status?.branch ?? "");
                    const color = branchColors[b.name] ?? "#a78bfa";
                    const icon = branchIcons[b.name] ?? (isCurrent ? "🌿" : "🌿");
                    const isRenaming = renamingBranch === b.name;

                    return (
                        <div key={b.name}
                            className={cn(
                                "rounded-xl border p-4 flex flex-col gap-3 transition-colors",
                                isCurrent ? "border-violet-600/50 bg-violet-950/20" : "border-zinc-800 bg-zinc-900/50"
                            )}
                        >
                            {/* Header row */}
                            <div className="flex items-center gap-3">
                                {/* Emoji icon button */}
                                <div className="relative">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (iconPickerFor === b.name) {
                                                setIconPickerFor(null);
                                                setEmojiPickerPos(null);
                                            } else {
                                                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                                setEmojiPickerPos({ top: rect.bottom + 6, left: rect.left });
                                                setIconPickerFor(b.name);
                                            }
                                        }}
                                        className="text-xl leading-none hover:scale-110 transition-transform"
                                        title="Change icon"
                                    >
                                        {icon}
                                    </button>
                                </div>

                                {/* Name / rename */}
                                {isRenaming ? (
                                    <div className="flex items-center gap-2 flex-1">
                                        <input
                                            autoFocus
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleRename(b.name, renameValue);
                                                if (e.key === "Escape") setRenamingBranch(null);
                                            }}
                                            className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg text-xs text-zinc-200 px-2 py-1 focus:outline-none focus:border-zinc-400"
                                        />
                                        <button onClick={() => handleRename(b.name, renameValue)} className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                                        <button onClick={() => setRenamingBranch(null)} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex items-center gap-2 min-w-0">
                                        <span className="text-sm font-semibold text-zinc-100 truncate">{b.name}</span>
                                        {isCurrent && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-600/30 border border-violet-500/30 text-violet-300 font-bold uppercase tracking-wide shrink-0">
                                                current
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Color dot */}
                                <div className="w-3 h-3 rounded-full border border-white/20 shrink-0" style={{ background: color }} />
                            </div>

                            {/* Info row */}
                            <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                                {isCurrent && lastCommit ? (
                                    <>
                                        <span>Last commit: <span className="text-zinc-400 font-mono">{lastCommit.id.slice(0, 7)}</span></span>
                                        <span>·</span>
                                        <span>{fmtShort(lastCommit.timestamp)}</span>
                                        <span>·</span>
                                        <span className="truncate max-w-32">{lastCommit.author}</span>
                                    </>
                                ) : (
                                    <span className="text-zinc-600 italic">Switch to see last commit</span>
                                )}
                            </div>

                            {/* Actions row */}
                            <div className="flex items-center gap-2 flex-wrap">
                                {!isCurrent && (
                                    <button
                                        onClick={() => handleSwitch(b.name)}
                                        disabled={switching === b.name}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white font-medium transition-colors disabled:opacity-50"
                                    >
                                        {switching === b.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
                                        Switch
                                    </button>
                                )}

                                <button
                                    onClick={() => { setRenamingBranch(b.name); setRenameValue(b.name); }}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 border border-zinc-700 transition-colors"
                                >
                                    <Pencil className="h-3 w-3" /> Rename
                                </button>

                                {!isCurrent && (
                                    <button
                                        onClick={() => handleMergeIntoCurrent(b.name)}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 border border-zinc-700 transition-colors"
                                    >
                                        <GitMerge className="h-3 w-3" /> Merge here
                                    </button>
                                )}

                                {/* Color picker */}
                                <div className="flex items-center gap-1 ml-auto">
                                    {["#a78bfa", "#34d399", "#60a5fa", "#f97316", "#f472b6", "#facc15", "#22d3ee", "#71717a"].map((c) => (
                                        <button key={c}
                                            onClick={() => setBranchColor(b.name, c)}
                                            style={{ background: c }}
                                            className={cn("w-4 h-4 rounded-full border-2 transition-transform hover:scale-110",
                                                branchColors[b.name] === c ? "border-white" : "border-transparent"
                                            )}
                                        />
                                    ))}
                                </div>

                                {!isCurrent && (
                                    <button
                                        onClick={() => handleDelete(b.name)}
                                        disabled={deleting === b.name}
                                        className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-950/30 transition-colors ml-1 disabled:opacity-40"
                                        title="Delete branch"
                                    >
                                        {deleting === b.name
                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                            : <Trash2 className="h-3 w-3" />}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            {iconPickerFor !== null && emojiPickerPos !== null && createPortal(
                <div
                    ref={emojiPickerRef}
                    style={{ position: "fixed", top: emojiPickerPos.top, left: emojiPickerPos.left, zIndex: 9999 }}
                    className="bg-zinc-900 border border-zinc-700 rounded-xl p-2 grid grid-cols-5 gap-1 shadow-xl"
                >
                    {BRANCH_EMOJI_OPTIONS.map((em) => (
                        <button
                            key={em}
                            onClick={() => {
                                setBranchIcons((p) => ({ ...p, [iconPickerFor]: em }));
                                setIconPickerFor(null);
                                setEmojiPickerPos(null);
                            }}
                            className="text-lg p-1 hover:bg-zinc-700 rounded-lg transition-colors"
                        >
                            {em}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

interface CreateRepoModalProps {
    onClose: () => void;
    onCreated: (repo: GithubRepo) => void;
    githubCreateRepo: (name: string, isPrivate: boolean, description: string) => Promise<GithubRepo>;
}

function CreateRepoModal({ onClose, onCreated, githubCreateRepo }: CreateRepoModalProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [isPrivate, setIsPrivate] = useState(false);
    const [autoInit, setAutoInit] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isValid = name.trim().length > 0 && /^[a-zA-Z0-9._-]+$/.test(name.trim());

    const handleCreate = async () => {
        if (!isValid) return;
        setCreating(true);
        setError(null);
        try {
            const repo = await githubCreateRepo(name.trim(), isPrivate, description.trim());
            onCreated(repo);
        } catch (e) {
            setError(String(e));
        } finally {
            setCreating(false);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-[520px] bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
                    <div className="w-8 h-8 rounded-lg bg-violet-900/40 border border-violet-700/30 flex items-center justify-center">
                        <Plus className="h-4 w-4 text-violet-400" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-zinc-100">Create a new repository</h2>
                        <p className="text-[10px] text-zinc-500 mt-0.5">A repository contains all project files, including the revision history.</p>
                    </div>
                    <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex flex-col gap-5 px-6 py-5">
                    {/* Repository name */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-zinc-300">
                            Repository name <span className="text-red-400">*</span>
                        </label>
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && isValid && handleCreate()}
                            placeholder="my-awesome-repo"
                            className="bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-zinc-600 transition-colors"
                        />
                        {name.length > 0 && !isValid && (
                            <p className="text-[10px] text-amber-400">
                                Only letters, numbers, dots, hyphens, and underscores allowed.
                            </p>
                        )}
                        {name.length > 0 && isValid && (
                            <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                                <Check className="h-3 w-3" />
                                github.com/&lt;you&gt;/{name.trim()}
                            </p>
                        )}
                    </div>

                    {/* Description */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-zinc-300">
                            Description <span className="text-zinc-600 font-normal">(optional)</span>
                        </label>
                        <input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Short description of your repository"
                            className="bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-zinc-600 transition-colors"
                        />
                    </div>

                    {/* Visibility */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-zinc-300">Visibility</label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { value: false, label: "Public", desc: "Anyone can see this repository", icon: Eye },
                                { value: true, label: "Private", desc: "Only you can see this repository", icon: Hash },
                            ].map(({ value, label, desc, icon: Icon }) => (
                                <button
                                    key={String(value)}
                                    onClick={() => setIsPrivate(value)}
                                    className={cn(
                                        "flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                                        isPrivate === value
                                            ? "border-violet-500 bg-violet-950/30"
                                            : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                                    )}
                                >
                                    <div className={cn(
                                        "w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center",
                                        isPrivate === value ? "border-violet-500" : "border-zinc-600"
                                    )}>
                                        {isPrivate === value && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <Icon className="h-3.5 w-3.5 text-zinc-400" />
                                            <span className="text-xs font-semibold text-zinc-200">{label}</span>
                                        </div>
                                        <p className="text-[10px] text-zinc-500 mt-0.5">{desc}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Auto-init */}
                    <label className="flex items-start gap-3 cursor-pointer select-none">
                        <div className="relative mt-0.5">
                            <input
                                type="checkbox"
                                checked={autoInit}
                                onChange={(e) => setAutoInit(e.target.checked)}
                                className="sr-only"
                            />
                            <div className={cn(
                                "w-4 h-4 rounded border-2 transition-colors flex items-center justify-center",
                                autoInit ? "border-violet-500 bg-violet-500" : "border-zinc-600 bg-transparent"
                            )}>
                                {autoInit && <Check className="h-3 w-3 text-white" />}
                            </div>
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-zinc-300">Initialize this repository with a README</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">This will let you immediately clone the repository.</p>
                        </div>
                    </label>

                    {/* Note sobre vrcstudio topic */}
                    <div className="rounded-lg bg-violet-950/30 border border-violet-800/40 px-3 py-2 flex items-start gap-2">
                        <Zap className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-violet-300">
                            The <span className="font-bold">vrcstudio</span> topic will be added automatically so this repo appears in your VRC Studio list.
                        </p>
                    </div>

                    {error && (
                        <div className="rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2.5 flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
                            <p className="text-xs text-red-300">{error}</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-950/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm text-zinc-300 font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={creating || !isValid}
                        className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm text-white font-medium disabled:opacity-40 transition-colors"
                    >
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {creating ? "Creating…" : "Create repository"}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

interface RepoDetailModalProps {
    repo: GithubRepo;
    onClose: () => void;
    onSetRemote: (cloneUrl: string) => void;
    token: string;
}

function RepoDetailModal({ repo, onClose, onSetRemote, token }: RepoDetailModalProps) {
    const [readme, setReadme] = useState<string | null>(null);
    const [loadingReadme, setLoadingReadme] = useState(true);
    const [files, setFiles] = useState<Array<{ name: string; type: "file" | "dir"; sha: string; path: string }>>([]);
    const [loadingFiles, setLoadingFiles] = useState(true);
    const [repoDetail, setRepoDetail] = useState<{
        default_branch: string;
        stargazers_count: number;
        forks_count: number;
        open_issues_count: number;
        language: string | null;
        size: number;
    } | null>(null);
    const [activeTab, setActiveTab] = useState<"code" | "readme">("code");

    const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" };

    useEffect(() => {
        // Fetch repo detail
        fetch(`https://api.github.com/repos/${repo.full_name}`, { headers })
            .then((r) => r.json())
            .then((d) => setRepoDetail({
                default_branch: d.default_branch,
                stargazers_count: d.stargazers_count,
                forks_count: d.forks_count,
                open_issues_count: d.open_issues_count,
                language: d.language,
                size: d.size,
            }))
            .catch(() => { });

        // Fetch root file tree
        fetch(`https://api.github.com/repos/${repo.full_name}/contents`, { headers })
            .then((r) => r.json())
            .then((data) => {
                if (Array.isArray(data)) {
                    setFiles(data.map((f: any): { name: string; type: "dir" | "file"; sha: string; path: string } => ({
                        name: f.name, type: f.type === "dir" ? "dir" : "file",
                        sha: f.sha, path: f.path,
                    })).sort((a, b) => {
                        // Dirs primero, luego alphabetical
                        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    }));
                }
            })
            .catch(() => { })
            .finally(() => setLoadingFiles(false));

        // Fetch README
        fetch(`https://api.github.com/repos/${repo.full_name}/readme`, { headers })
            .then((r) => r.json())
            .then((d) => {
                if (d.content) {
                    const decoded = atob(d.content.replace(/\n/g, ""));
                    setReadme(decoded);
                }
            })
            .catch(() => setReadme(null))
            .finally(() => setLoadingReadme(false));
    }, [repo.full_name]);

    const langColors: Record<string, string> = {
        TypeScript: "#3178c6", JavaScript: "#f1e05a", Rust: "#dea584",
        Python: "#3572A5", "C#": "#178600", "C++": "#f34b7d", HTML: "#e34c26",
        CSS: "#563d7c", Go: "#00ADD8", Dart: "#00B4AB",
    };
    const langColor = repoDetail?.language ? (langColors[repoDetail.language] ?? "#6b7280") : "#6b7280";

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-[780px] max-h-[85vh] bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col">

                {/* Header — estilo página GitHub */}
                <div className="flex items-start gap-4 px-6 py-4 border-b border-zinc-800 bg-zinc-950">
                    {/* Icono del repo */}
                    <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                        repo.private ? "bg-amber-950/40 border border-amber-800/40" : "bg-zinc-800 border border-zinc-700"
                    )}>
                        {repo.private ? <span className="text-lg">🔒</span> : <GitBranch className="h-5 w-5 text-zinc-400" />}
                    </div>

                    <div className="flex-1 min-w-0">
                        {/* Breadcrumb */}
                        <div className="flex items-center gap-1 text-xs text-zinc-500 mb-1">
                            <User className="h-3 w-3" />
                            <span>{repo.full_name.split("/")[0]}</span>
                            <span>/</span>
                            <span className="text-zinc-200 font-semibold">{repo.name}</span>
                            <span className={cn("ml-1 text-[9px] px-1.5 py-0.5 rounded-full border font-bold",
                                repo.private ? "bg-amber-900/30 border-amber-700/30 text-amber-400" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                            )}>
                                {repo.private ? "Private" : "Public"}
                            </span>
                        </div>

                        {/* Description */}
                        {repo.description && (
                            <p className="text-xs text-zinc-400">{repo.description}</p>
                        )}

                        {/* Stats row */}
                        {repoDetail && (
                            <div className="flex items-center gap-4 mt-2 text-[10px] text-zinc-500">
                                {repoDetail.language && (
                                    <span className="flex items-center gap-1">
                                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: langColor }} />
                                        {repoDetail.language}
                                    </span>
                                )}
                                <span className="flex items-center gap-1">
                                    <Star className="h-3 w-3" /> {repoDetail.stargazers_count}
                                </span>
                                <span className="flex items-center gap-1">
                                    <GitFork className="h-3 w-3" /> {repoDetail.forks_count}
                                </span>
                                {repoDetail.open_issues_count > 0 && (
                                    <span className="flex items-center gap-1">
                                        <Circle className="h-3 w-3" /> {repoDetail.open_issues_count} issues
                                    </span>
                                )}
                                <span className="flex items-center gap-1">
                                    <GitBranch className="h-3 w-3" /> {repoDetail.default_branch}
                                </span>
                                <span>{(repoDetail.size / 1024).toFixed(1)} MB</span>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                        <a
                            href={repo.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 transition-colors"
                        >
                            <ExternalLink className="h-3 w-3" /> View on GitHub
                        </a>
                        <button
                            onClick={() => onSetRemote(repo.clone_url)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white font-medium transition-colors"
                        >
                            <Upload className="h-3 w-3" /> Set as remote
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Tab bar */}
                <div className="flex items-center gap-0 px-6 border-b border-zinc-800 bg-zinc-950 shrink-0">
                    {[
                        { id: "code" as const, label: "Code", icon: Layers },
                        { id: "readme" as const, label: "README", icon: Eye },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-all border-b-2 -mb-px",
                                activeTab === tab.id
                                    ? "border-violet-500 text-violet-300"
                                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                            )}
                        >
                            <tab.icon className="h-3.5 w-3.5" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {activeTab === "code" && (
                        <div>
                            {/* File tree */}
                            <div className="border-b border-zinc-800">
                                {/* Table header */}
                                <div className="flex items-center gap-3 px-4 py-2 bg-zinc-800/30 text-[9px] font-bold text-zinc-600 uppercase tracking-wider">
                                    <div className="w-4" />
                                    <div className="flex-1">Name</div>
                                    <div className="w-20 text-right">Type</div>
                                </div>

                                {loadingFiles && (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                                    </div>
                                )}

                                {!loadingFiles && files.map((file) => (
                                    <div
                                        key={file.sha + file.path}
                                        className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                                    >
                                        {file.type === "dir"
                                            ? <FolderOpen className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                            : <FileTypeIcon path={file.name} className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                                        }
                                        <span className={cn("flex-1 text-xs", file.type === "dir" ? "text-blue-300" : "text-zinc-300")}>
                                            {file.name}
                                        </span>
                                        <span className="text-[9px] text-zinc-700 w-20 text-right">
                                            {file.type === "dir" ? "directory" : "file"}
                                        </span>
                                    </div>
                                ))}

                                {!loadingFiles && files.length === 0 && (
                                    <p className="text-xs text-zinc-600 text-center py-6">Repository is empty</p>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === "readme" && (
                        <div className="p-6">
                            {loadingReadme && (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                                </div>
                            )}
                            {!loadingReadme && readme === null && (
                                <div className="flex flex-col items-center gap-2 py-8 text-zinc-700">
                                    <Eye className="h-8 w-8 opacity-30" />
                                    <p className="text-sm">No README found</p>
                                </div>
                            )}
                            {!loadingReadme && readme !== null && (
                                <div className="prose prose-invert prose-sm max-w-none">
                                    {/* README como pre-formateado simple — sin dependencia de markdown parser */}
                                    <pre className="whitespace-pre-wrap font-sans text-xs text-zinc-300 leading-6">
                                        {readme}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── GitHub page ───────────────────────────────────────────────────────────────

function GitHubPage({ project }: { project: Project }) {
    const [showAllRepos, setShowAllRepos] = useState(false);
    const [user, setUser] = useState<GithubUserInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [authStep, setAuthStep] = useState<"idle" | "waiting" | "done">("idle");
    const [devicePrompt, setDevicePrompt] = useState<{ user_code: string; verification_uri: string } | null>(null);
    const [remoteUrl, setRemoteUrl] = useState("");
    const [detailRepo, setDetailRepo] = useState<GithubRepo | null>(null);
    const [githubToken, setGithubToken] = useState<string>("");
    const [settingRemote, setSettingRemote] = useState(false);
    const [pushing, setPushing] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [opMsg, setOpMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [status, setStatus] = useState<GitStatus | null>(null);
    const setActiveSection = useAppStore((s) => s.setActiveSection);
    const [repos, setRepos] = useState<GithubRepo[]>([]);
    const [loadingRepos, setLoadingRepos] = useState(false);
    const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newRepoName, setNewRepoName] = useState("");
    const [newRepoPrivate, setNewRepoPrivate] = useState(false);
    const [newRepoDesc, setNewRepoDesc] = useState("");
    const [creatingRepo, setCreatingRepo] = useState(false);

    const githubListRepos = async (): Promise<GithubRepo[]> => {
        const token = await github.getToken();
        const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
            headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
        });
        if (!res.ok) throw new Error("Failed to list repos");
        const data = await res.json();
        return data.map((repo: any) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            html_url: repo.html_url,
            private: repo.private,
            updated_at: repo.updated_at,
            clone_url: repo.clone_url,
            description: repo.description ?? "",
        }));
    };

    const visibleRepos = showAllRepos
        ? repos
        : repos.filter((r) => (r.topics ?? []).includes("vrcstudio"));

    const githubCreateRepo = async (name: string, isPrivate: boolean, description: string): Promise<GithubRepo> => {
        const token = await github.getToken();
        const res = await fetch("https://api.github.com/user/repos", {
            method: "POST",
            headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name, private: isPrivate, description }),
        });
        if (!res.ok) throw new Error("Failed to create repo");
        const repo = await res.json();
        return {
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            private: repo.private,
            clone_url: repo.clone_url,
            html_url: repo.html_url,
            stargazers_count: repo.stargazers_count ?? 0,
            description: repo.description ?? "",
            updated_at: repo.updated_at ?? "",
            topics: repo.topics ?? [],
        };
    };

    // Cargar repos cuando user autenticado:
    useEffect(() => {
        if (!user) return;
        setLoadingRepos(true);
        githubListRepos()
            .then(setRepos)
            .catch(() => { })
            .finally(() => setLoadingRepos(false));
    }, [user]);

    // Handler crear repo:
    const handleCreateRepo = async () => {
        if (!newRepoName.trim()) return;
        setCreatingRepo(true);
        try {
            const repo = await githubCreateRepo(newRepoName.trim(), newRepoPrivate, newRepoDesc.trim());
            setRepos((r) => [repo, ...r]);
            setSelectedRepo(repo);
            setShowCreateModal(false);
            setNewRepoName(""); setNewRepoDesc("");
        } catch (e) { setOpMsg({ ok: false, text: String(e) }); }
        finally { setCreatingRepo(false); }
    };

    useEffect(() => {
        Promise.all([
            vcs.getStatus(project.path).catch(() => null),
        ]).then(([s]) => setStatus(s)).finally(() => { });

        github.getUser()
            .then((u) => {
                setUser(u);
                if (u) {
                    github.getToken().then(setGithubToken).catch(() => { });
                }
            })
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, [project.path]);

    const startAuth = async () => {
        setAuthStep("waiting");
        try {
            const prompt = await github.startDeviceAuth();
            setDevicePrompt(prompt);
            // Poll
            const info = await github.pollToken();
            setUser(info);
            setAuthStep("done");
            setDevicePrompt(null);
        } catch (e) {
            setAuthStep("idle");
            setOpMsg({ ok: false, text: String(e) });
        }
    };

    const logout = async () => {
        await github.logout().catch(() => { });
        setUser(null);
        setDevicePrompt(null);
        setAuthStep("idle");
    };

    const push = async () => {
        setPushing(true); setOpMsg(null);
        try {
            const token = await github.getToken();
            await vcs.push(project.path, token);
            setOpMsg({ ok: true, text: "Pushed successfully to origin" });
        } catch (e) { setOpMsg({ ok: false, text: String(e) }); }
        finally { setPushing(false); }
    };

    const pull = async () => {
        setPulling(true); setOpMsg(null);
        try {
            const token = await github.getToken();
            await vcs.pull(project.path, token);
            setOpMsg({ ok: true, text: "Pulled successfully from origin" });
        } catch (e) { setOpMsg({ ok: false, text: String(e) }); }
        finally { setPulling(false); }
    };

    const setRemote = async () => {
        if (!remoteUrl.trim()) return;
        setSettingRemote(true); setOpMsg(null);
        try {
            await vcs.addRemote(project.path, remoteUrl.trim());
            setOpMsg({ ok: true, text: "Remote 'origin' set" });
        } catch (e) { setOpMsg({ ok: false, text: String(e) }); }
        finally { setSettingRemote(false); }
    };

    if (loading) return (
        <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
    );

    if (!user) return (
        <div className="flex flex-col flex-1 items-center justify-center gap-8 px-8">
            {/* Large GitHub mark SVG */}
            <svg viewBox="0 0 98 96" className="w-24 h-24 text-zinc-700" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd"
                    d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
                />
            </svg>

            <div className="flex flex-col items-center gap-2 text-center">
                <h2 className="text-lg font-semibold text-zinc-100">GitHub not connected</h2>
                <p className="text-sm text-zinc-500 max-w-xs">
                    Connect your GitHub account in Settings to push, pull, and view repository information.
                </p>
            </div>

            <button
                onClick={() => {
                    setActiveSection("settings");
                    // Opcional: guardar que queremos ir a Connections para que Settings lo lea
                    localStorage.setItem("settings_desired_tab", "connections");
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm font-medium text-zinc-200 transition-colors"
            >
                <Cpu className="h-4 w-4" />
                Go to Settings → Connections
            </button>
        </div>
    );

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left panel — profile */}
            <div className="w-72 shrink-0 flex flex-col items-center gap-5 p-6 border-r border-zinc-800 overflow-y-auto">
                {/* Large avatar */}
                <div className="relative mt-2">
                    <img
                        src={user.avatar_url ?? undefined}
                        alt={user.login}
                        className="w-32 h-32 rounded-full ring-4 ring-zinc-700 object-cover"
                    />
                    <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-zinc-900" title="Connected" />
                </div>

                <div className="flex flex-col items-center gap-1 text-center">
                    <span className="text-base font-bold text-zinc-100">{user.name ?? user.login}</span>
                    <span className="text-xs text-zinc-500">@{user.login}</span>
                </div>

                {/* Logout */}
                <button
                    onClick={logout}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-red-400 hover:border-red-900/50 transition-colors"
                >
                    <LogOut className="h-3.5 w-3.5" />
                    Disconnect
                </button>

                <div className="w-full h-px bg-zinc-800" />

                {/* Profile stats */}
                <div className="w-full flex flex-col gap-3 text-xs">
                    <div className="flex justify-between text-zinc-500">
                        <span>GitHub</span>
                        <a href={`https://github.com/${user.login}`} target="_blank" rel="noreferrer"
                            className="text-violet-400 hover:text-violet-300 flex items-center gap-1">
                            github.com/{user.login} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                    </div>
                </div>
            </div>

            {/* Right panel — sync dashboard */}
            <div className="flex-1 flex flex-col overflow-y-auto p-6 gap-5">
                {/* Repository browser */}
                <div className="flex flex-col gap-3">
                    {/* Header con filtro */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                                Repositories
                            </span>
                            {/* Badge con el filtro activo */}
                            <button
                                onClick={() => setShowAllRepos((v) => !v)}
                                className={cn(
                                    "flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border transition-colors",
                                    showAllRepos
                                        ? "bg-zinc-800 border-zinc-700 text-zinc-400"
                                        : "bg-violet-900/30 border-violet-600/40 text-violet-400"
                                )}
                            >
                                {showAllRepos ? "All" : "vrcstudio"}
                            </button>
                            {loadingRepos && <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => { setLoadingRepos(true); githubListRepos().then(setRepos).catch(() => { }).finally(() => setLoadingRepos(false)); }}
                                className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                title="Refresh repos"
                            >
                                <RefreshCw className="h-3 w-3" />
                            </button>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white font-medium transition-colors"
                            >
                                <Plus className="h-3 w-3" /> New
                            </button>
                        </div>
                    </div>

                    {/* Create form */}
                    {showCreateModal && (
                        <CreateRepoModal
                            onClose={() => setShowCreateModal(false)}
                            onCreated={(repo) => {
                                setRepos((r) => [repo, ...r]);
                                setSelectedRepo(repo);
                                setShowCreateModal(false);
                            }}
                            githubCreateRepo={githubCreateRepo}
                        />
                    )}

                    {/* Empty state para filtro vrcstudio */}
                    {!loadingRepos && visibleRepos.length === 0 && !showAllRepos && (
                        <div className="flex flex-col items-center gap-3 py-8 text-center">
                            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                                <GitBranch className="h-5 w-5 text-zinc-600" />
                            </div>
                            <div>
                                <p className="text-xs font-medium text-zinc-400">No VRC Studio repos yet</p>
                                <p className="text-[10px] text-zinc-600 mt-1">Repos created here appear automatically,<br />or <button onClick={() => setShowAllRepos(true)} className="text-violet-400 hover:text-violet-300 underline">show all your repos</button></p>
                            </div>
                        </div>
                    )}

                    {/* Repo cards */}
                    <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
                        {visibleRepos.map((repo) => {
                            const isSelected = selectedRepo?.id === repo.id;
                            const isVrcStudio = repo.topics.includes("vrcstudio");
                            return (
                                <button
                                    key={repo.id}
                                    onClick={() => setDetailRepo(repo)}
                                    className={cn(
                                        "w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-all border",
                                        isSelected
                                            ? "bg-violet-950/30 border-violet-600/50 shadow-[0_0_0_1px_rgba(124,58,237,0.2)]"
                                            : "bg-zinc-900/60 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700"
                                    )}
                                >
                                    {/* Icono */}
                                    <div className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                                        repo.private ? "bg-amber-950/40 border border-amber-900/30" : "bg-zinc-800 border border-zinc-700"
                                    )}>
                                        {repo.private
                                            ? <span className="text-amber-400 text-xs">🔒</span>
                                            : <GitBranch className="h-3.5 w-3.5 text-zinc-500" />}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-xs font-semibold text-zinc-100 truncate">{repo.name}</span>
                                            {isVrcStudio && (
                                                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-violet-900/40 border border-violet-700/30 text-violet-400 font-bold shrink-0">
                                                    vrcstudio
                                                </span>
                                            )}
                                        </div>
                                        {repo.description && (
                                            <p className="text-[10px] text-zinc-500 truncate mt-0.5">{repo.description}</p>
                                        )}
                                        <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-600">
                                            {repo.stargazers_count != null && repo.stargazers_count > 0 && (
                                                <span>★ {repo.stargazers_count}</span>
                                            )}
                                            {repo.updated_at && (
                                                <span>Updated {new Date(repo.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Selected check */}
                                    {isSelected && <Check className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-1" />}
                                </button>
                            );
                        })}
                    </div>

                    {/* Set remote bar — aparece cuando hay un repo seleccionado */}
                    {selectedRepo && (
                        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3 flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-zinc-500">Selected remote</p>
                                    <p className="text-xs font-mono text-zinc-300 truncate">{selectedRepo.full_name}</p>
                                </div>
                                <a
                                    href={selectedRepo.html_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                    title="Open on GitHub"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                            </div>
                            <button
                                onClick={async () => {
                                    setSettingRemote(true); setOpMsg(null);
                                    try {
                                        await vcs.addRemote(project.path, selectedRepo.clone_url);
                                        setOpMsg({ ok: true, text: `Remote set → ${selectedRepo.full_name}` });
                                    } catch (e) {
                                        setOpMsg({ ok: false, text: String(e) });
                                    } finally {
                                        setSettingRemote(false);
                                    }
                                }}
                                disabled={settingRemote}
                                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white font-medium disabled:opacity-50 transition-colors"
                            >
                                {settingRemote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                Set as remote & use for Push/Pull
                            </button>
                        </div>
                    )}
                </div>

                {/* Push / Pull */}
                <div className="flex gap-3">
                    <button
                        onClick={push}
                        disabled={pushing}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm text-white font-medium transition-colors disabled:opacity-50"
                    >
                        {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                        Push
                    </button>
                    <button
                        onClick={pull}
                        disabled={pulling}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm text-zinc-200 font-medium transition-colors disabled:opacity-50"
                    >
                        {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDown className="h-4 w-4" />}
                        Pull
                    </button>
                </div>

                {opMsg && (
                    <div className={cn("text-xs px-3 py-2 rounded-lg flex items-center gap-2",
                        opMsg.ok ? "text-emerald-300 bg-emerald-950/40 border border-emerald-900/40" : "text-red-300 bg-red-950/40 border border-red-900/40")}>
                        {opMsg.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                        {opMsg.text}
                    </div>
                )}

                {/* Current branch status */}
                {status && (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-2">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Branch Status</span>
                        <div className="flex items-center gap-2 text-sm">
                            <GitBranch className="h-3.5 w-3.5 text-violet-400" />
                            <span className="text-zinc-200 font-medium">{status.branch}</span>
                        </div>
                        <div className="flex gap-4 text-[11px] text-zinc-500 mt-1">
                            <span>{status.staged?.length ?? 0} staged</span>
                            <span>{status.unstaged?.length ?? 0} modified</span>
                            <span>{status.untracked?.length ?? 0} untracked</span>
                        </div>
                    </div>
                )}
                {detailRepo && githubToken && (
                    <RepoDetailModal
                        repo={detailRepo}
                        onClose={() => setDetailRepo(null)}
                        token={githubToken}
                        onSetRemote={async (cloneUrl) => {
                            setSettingRemote(true);
                            setOpMsg(null);
                            try {
                                await vcs.addRemote(project.path, cloneUrl);
                                setOpMsg({ ok: true, text: `Remote set → ${detailRepo.full_name}` });
                                setSelectedRepo(detailRepo);
                                setDetailRepo(null);
                            } catch (e) {
                                setOpMsg({ ok: false, text: String(e) });
                            } finally {
                                setSettingRemote(false);
                            }
                        }}
                    />
                )}
            </div>
        </div>
    );
}

// ── Help / Documentation page ─────────────────────────────────────────────────

// ── Animated Git diagram ──────────────────────────────────────────────────────

type DiagramFrame = {
    nodes: { id: string; x: number; y: number; label: string; color: string; isNew?: boolean }[];
    edges: { from: string; to: string; color?: string; dashed?: boolean }[];
    labels?: { x: number; y: number; text: string; color?: string }[];
};

function GitDiagramAnimation({
    title,
    frames,
    frameLabels,
}: {
    title: string;
    frames: [DiagramFrame, DiagramFrame]; // [before, after]
    frameLabels: [string, string];
}) {
    const [phase, setPhase] = useState<"before" | "animating" | "after">("before");
    const current = phase === "after" ? frames[1] : frames[0];
    const W = 340;
    const H = 160;
    const R = 18;

    const nodeMap = (frame: DiagramFrame) =>
        Object.fromEntries(frame.nodes.map((n) => [n.id, n]));

    const bMap = nodeMap(current);

    const animate = () => {
        if (phase === "after") { setPhase("before"); return; }
        setPhase("animating");
        setTimeout(() => setPhase("after"), 500);
    };

    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-zinc-400">{title}</p>
                <button
                    onClick={animate}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-900/40 border border-violet-700/40 text-violet-300 text-[10px] font-semibold transition-all hover:bg-violet-800/50"
                >
                    {phase === "after" ? "↺ Reset" : "▶ Animar"}
                </button>
            </div>

            <div className="flex items-center gap-3 text-[10px]">
                <span className={cn("px-2 py-0.5 rounded font-semibold border", phase !== "after" ? "bg-violet-900/40 border-violet-700/40 text-violet-300" : "border-zinc-800 text-zinc-600")}>
                    {frameLabels[0]}
                </span>
                <div className="flex-1 h-px bg-zinc-800" />
                <span className={cn("px-2 py-0.5 rounded font-semibold border", phase === "after" ? "bg-emerald-900/40 border-emerald-700/40 text-emerald-300" : "border-zinc-800 text-zinc-600")}>
                    {frameLabels[1]}
                </span>
            </div>

            <svg
                width={W} height={H}
                viewBox={`0 0 ${W} ${H}`}
                style={{ transition: "all 0.4s ease" }}
            >
                {/* Edges */}
                {current.edges.map((e, i) => {
                    const fn_ = bMap[e.from];
                    const tn_ = bMap[e.to];
                    if (!fn_ || !tn_) return null;
                    return (
                        <line
                            key={i}
                            x1={fn_.x} y1={fn_.y}
                            x2={tn_.x} y2={tn_.y}
                            stroke={e.color ?? "#52525b"}
                            strokeWidth={1.5}
                            strokeDasharray={e.dashed ? "5 3" : undefined}
                            opacity={0.7}
                        />
                    );
                })}

                {/* Nodes */}
                {current.nodes.map((n) => (
                    <g key={n.id} style={{ transition: "all 0.4s ease" }}>
                        <circle
                            cx={n.x} cy={n.y} r={R}
                            fill={n.isNew && phase === "after" ? n.color + "40" : "#18181b"}
                            stroke={n.color}
                            strokeWidth={n.isNew && phase === "after" ? 2.5 : 1.5}
                            style={{
                                transition: "all 0.4s ease",
                                filter: n.isNew && phase === "after" ? `drop-shadow(0 0 6px ${n.color})` : "none",
                            }}
                        />
                        <text
                            x={n.x} y={n.y + 1}
                            textAnchor="middle" dominantBaseline="middle"
                            fill={n.color}
                            fontSize={8}
                            fontFamily="monospace"
                            fontWeight={700}
                        >
                            {n.label}
                        </text>
                    </g>
                ))}

                {/* Labels */}
                {current.labels?.map((l, i) => (
                    <text
                        key={i}
                        x={l.x} y={l.y}
                        fill={l.color ?? "#71717a"}
                        fontSize={9}
                        fontFamily="monospace"
                        textAnchor="middle"
                    >
                        {l.text}
                    </text>
                ))}
            </svg>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Git() {
    const [project, setProject] = useState<Project | null>(null);
    const [activePage, setActivePage] = useState<GitPage>("overview");
    const [pickerOpen, setPickerOpen] = useState(false);

    return (
        <div className="flex h-full overflow-hidden flex-col bg-zinc-950">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4 shrink-0">
                <GitBranch className="h-5 w-5 text-zinc-500" />
                <h1 className="text-lg font-semibold text-zinc-100">Git</h1>
                {project && (
                    <>
                        <span className="text-zinc-700">/</span>
                        <span className="text-sm text-zinc-400">{project.name}</span>
                        <button
                            onClick={() => setPickerOpen(true)}
                            className="ml-auto text-xs text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1"
                        >
                            <FolderOpen className="h-3 w-3" /> Change project
                        </button>
                    </>
                )}
            </div>

            {!project ? (
                <NoProjectSelected onOpen={() => setPickerOpen(true)} />
            ) : (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Content area */}
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                        {activePage === "overview" && <OverviewPage project={project} />}
                        {activePage === "changes" && <ChangesPage project={project} />}
                        {activePage === "tree" && <GitTreePage project={project} />}
                        {activePage === "conflicts" && <ConflictsPage project={project} />}
                        {activePage === "branches" && <BranchesPage project={project} />}
                        {activePage === "github" && <GitHubPage project={project} />}
                    </div>

                    {/* Bottom tab bar */}
                    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 flex items-center px-4 gap-1">
                        {GIT_TABS.map((tab) => {
                            const active = activePage === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActivePage(tab.id)}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-3 text-xs font-medium transition-all border-t-2 -mt-px",
                                        active
                                            ? "border-violet-500 text-violet-300"
                                            : "border-transparent text-zinc-500 hover:text-zinc-300"
                                    )}
                                >
                                    <tab.icon className="h-3.5 w-3.5" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Global project picker modal */}
            {pickerOpen && (
                <GlobalProjectPickerModal
                    title="Select Git Project"
                    subtitle="Choose a project with Git enabled"
                    onClose={() => setPickerOpen(false)}
                    onSelect={(p) => {
                        setProject(p);
                        setActivePage("overview");
                        setPickerOpen(false);
                    }}
                />
            )}
        </div>
    );
}

function shortSha(id: string) {
    return id.slice(0, 7);
}