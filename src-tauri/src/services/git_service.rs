use git2::{Repository, Signature, IndexAddOption, Sort, BranchType, RemoteCallbacks, PushOptions, FetchOptions};
use serde::Serialize;
use std::path::Path;

pub const UNITY_GITIGNORE: &str = "\
# Unity generated\n\
[Ll]ibrary/\n\
[Tt]emp/\n\
[Oo]bj/\n\
[Bb]uild/\n\
[Bb]uilds/\n\
[Ll]ogs/\n\
[Uu]ser[Ss]ettings/\n\
MemoryCaptures/\n\
\n\
# OS files\n\
.DS_Store\n\
Thumbs.db\n\
\n\
# Rider / VS\n\
.idea/\n\
.vs/\n\
*.csproj\n\
*.sln\n";

/// Inicializa un repositorio Git con .gitignore y commit inicial.
/// Idempotente: no falla si ya existe el repo.
pub fn init_repository(project_path: &Path) -> Result<(), String> {
    let repo = Repository::init(project_path)
        .map_err(|e| format!("git init failed: {e}"))?;

    let gitignore_path = project_path.join(".gitignore");
    std::fs::write(&gitignore_path, UNITY_GITIGNORE)
        .map_err(|e| format!("failed to write .gitignore: {e}"))?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(Path::new(".gitignore")).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = Signature::now("VRC Studio", "vrcstudio@local")
        .map_err(|e| e.to_string())?;

    // Only commit if there are no commits yet (HEAD unborn)
    if repo.head().is_err() {
        repo.commit(Some("HEAD"), &sig, &sig, "chore: initial commit", &tree, &[])
            .map_err(|e| format!("initial commit failed: {e}"))?;
    }

    Ok(())
}

// ── Status ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub has_upstream: bool,
    pub ahead: usize,
    pub behind: usize,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

pub fn get_status(project_path: &Path) -> Result<GitStatus, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("HEAD").to_string();

    let (has_upstream, ahead, behind) = match repo.revparse_ext("@{upstream}") {
        Ok(_) => {
            let local_oid = head.target().unwrap_or(git2::Oid::zero());
            let upstream = repo.revparse_single("@{upstream}").unwrap();
            let (a, b) = repo.graph_ahead_behind(local_oid, upstream.id()).unwrap_or((0, 0));
            (true, a, b)
        }
        Err(_) => (false, 0, 0),
    };

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).renames_from_rewrites(true).exclude_submodules(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("?").to_string();
        let s = entry.status();
        if s.is_index_new() || s.is_index_modified() || s.is_index_deleted() {
            staged.push(path.clone());
        }
        if s.is_wt_modified() || s.is_wt_deleted() {
            unstaged.push(path.clone());
        }
        if s.is_wt_new() {
            untracked.push(path);
        }
    }

    Ok(GitStatus { branch, has_upstream, ahead, behind, staged, unstaged, untracked })
}

// ── Commit ───────────────────────────────────────────────────────────────────

pub fn stage_all_and_commit(
    project_path: &Path,
    message: &str,
    author_name: &str,
    author_email: &str,
) -> Result<String, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_all(["."].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("git add failed: {e}"))?;
    index.write().map_err(|e| e.to_string())?;

    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = Signature::now(author_name, author_email).map_err(|e| e.to_string())?;

    let parent_commit = repo.head().and_then(|h| h.peel_to_commit()).ok();
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    let commit_id = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("commit failed: {e}"))?;

    Ok(commit_id.to_string())
}

// ── Log ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct CommitEntry {
    pub id: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

pub fn get_log(project_path: &Path, limit: usize) -> Result<Vec<CommitEntry>, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(Sort::TIME).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let short_id = oid.to_string();
        entries.push(CommitEntry {
            id: short_id[..7.min(short_id.len())].to_string(),
            message: commit.message().unwrap_or("").trim().to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            timestamp: commit.time().seconds(),
        });
    }
    Ok(entries)
}

// ── Branches ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

pub fn list_branches(project_path: &Path) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    let head_name = repo.head().ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_default();

    let mut branches = Vec::new();
    for branch in repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())? {
        let (b, _) = branch.map_err(|e| e.to_string())?;
        let name = b.name().map_err(|e| e.to_string())?.unwrap_or("?").to_string();
        branches.push(BranchInfo { is_current: name == head_name, name });
    }
    Ok(branches)
}

pub fn create_branch(project_path: &Path, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
    repo.branch(branch_name, &commit, false)
        .map_err(|e| format!("create branch failed: {e}"))?;
    Ok(())
}

pub fn switch_branch(project_path: &Path, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    let refname = format!("refs/heads/{branch_name}");
    let obj = repo.revparse_single(&refname)
        .map_err(|_| format!("branch '{branch_name}' not found"))?;
    repo.checkout_tree(&obj, None)
        .map_err(|e| format!("checkout failed: {e}"))?;
    repo.set_head(&refname)
        .map_err(|e| format!("set_head failed: {e}"))?;
    Ok(())
}

// ── Remote + Push/Pull ───────────────────────────────────────────────────────

pub fn add_remote(project_path: &Path, name: &str, url: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    repo.remote(name, url)
        .map_err(|e| format!("add remote failed: {e}"))?;
    Ok(())
}

pub fn push_to_remote(project_path: &Path, remote_name: &str, token: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut remote = repo.find_remote(remote_name)
        .map_err(|e| format!("remote '{remote_name}' not found: {e}"))?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("main");
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");

    let mut callbacks = RemoteCallbacks::new();
    let token_owned = token.to_string();
    callbacks.credentials(move |_url, _user, _allowed| {
        git2::Cred::userpass_plaintext("oauth2", &token_owned)
    });

    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    remote.push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| format!("push failed: {e}"))?;
    Ok(())
}

pub fn pull_from_remote(project_path: &Path, remote_name: &str, token: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut callbacks = RemoteCallbacks::new();
    let token_owned = token.to_string();
    callbacks.credentials(move |_url, _user, _allowed| {
        git2::Cred::userpass_plaintext("oauth2", &token_owned)
    });

    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    let mut remote = repo.find_remote(remote_name)
        .map_err(|e| format!("remote not found: {e}"))?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("main");

    remote.fetch(&[branch], Some(&mut fetch_opts), None)
        .map_err(|e| format!("fetch failed: {e}"))?;

    let fetch_head = repo.find_reference("FETCH_HEAD")
        .map_err(|e| format!("FETCH_HEAD not found: {e}"))?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;

    let (analysis, _) = repo.merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;

    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{branch}");
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference.set_target(fetch_commit.id(), "pull: fast-forward")
            .map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
    } else if analysis.is_up_to_date() {
        // nothing to do
    } else {
        return Err("Pull requires merge — please resolve manually".into());
    }

    Ok(())
}