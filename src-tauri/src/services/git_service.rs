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
    pub parent_ids: Vec<String>,
}

pub fn get_log(project_path: &Path, limit: usize) -> Result<Vec<CommitEntry>, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_glob("refs/heads/*").map_err(|e| e.to_string())?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let parent_ids = commit.parents()
            .map(|p| p.id().to_string())
            .collect::<Vec<_>>();
        entries.push(CommitEntry {
            id: oid.to_string(),    // SHA completo
            message: commit.message().unwrap_or("").trim().to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            timestamp: commit.time().seconds(),
            parent_ids,
        });
    }
    Ok(entries)
}

// ── Branches ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub tip_sha: String,
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
        // Obtener el SHA del tip commit de la branch
        let tip_sha = b.get()
            .peel_to_commit()
            .map(|c| c.id().to_string())
            .unwrap_or_default();
        branches.push(BranchInfo { is_current: name == head_name, name, tip_sha });
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

// ── Commit diff ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct CommitDiffFile {
    pub path: String,
    pub status: String, // "added" | "deleted" | "modified" | "renamed"
    pub old_path: Option<String>,
    pub insertions: usize,
    pub deletions: usize,
}

/// Devuelve la lista de archivos cambiados en un commit (por SHA corto o largo).
pub fn get_commit_diff_files(project_path: &Path, commit_sha: &str) -> Result<Vec<CommitDiffFile>, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let obj = repo.revparse_single(commit_sha)
        .map_err(|_| format!("commit '{commit_sha}' not found"))?;
    let commit = obj.peel_to_commit()
        .map_err(|e| format!("not a commit: {e}"))?;

    let commit_tree = commit.tree().map_err(|e| e.to_string())?;

    let parent_tree = if commit.parent_count() > 0 {
        let parent = commit.parent(0).map_err(|e| e.to_string())?;
        Some(parent.tree().map_err(|e| e.to_string())?)
    } else {
        None
    };

    let diff = repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(&commit_tree),
        None,
    ).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    for delta in diff.deltas() {
        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Renamed => "renamed",
            _ => "modified",
        };
        let path = delta.new_file().path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let old_path = if delta.status() == git2::Delta::Renamed {
            delta.old_file().path().map(|p| p.to_string_lossy().to_string())
        } else {
            None
        };
        files.push(CommitDiffFile {
            path,
            status: status.to_string(),
            old_path,
            insertions: 0,
            deletions: 0,
        });
    }

    // Segunda pasada para stats de líneas
    let mut stats_map: std::collections::HashMap<String, (usize, usize)> = std::collections::HashMap::new();
    diff.foreach(
        &mut |_delta, _| true,
        None,
        None,
        Some(&mut |delta, _hunk, line| {
            let path = delta.new_file().path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let e = stats_map.entry(path).or_default();
            match line.origin() {
                '+' => e.0 += 1,
                '-' => e.1 += 1,
                _ => {}
            }
            true
        }),
    ).map_err(|e| e.to_string())?;

    for f in &mut files {
        if let Some((ins, del)) = stats_map.get(&f.path) {
            f.insertions = *ins;
            f.deletions = *del;
        }
    }

    Ok(files)
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub origin: String, // "+", "-", " ", "\\"
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub status: String,
    pub hunks: Vec<DiffHunk>,
}

/// Devuelve el diff línea a línea de un archivo en un commit.
pub fn get_file_diff(project_path: &Path, commit_sha: &str, file_path: &str) -> Result<FileDiff, String> {
    use std::cell::RefCell;

    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let obj = repo.revparse_single(commit_sha)
        .map_err(|_| format!("commit '{commit_sha}' not found"))?;
    let commit = obj.peel_to_commit()
        .map_err(|e| format!("not a commit: {e}"))?;
    let commit_tree = commit.tree().map_err(|e| e.to_string())?;

    let parent_tree = if commit.parent_count() > 0 {
        let parent = commit.parent(0).map_err(|e| e.to_string())?;
        Some(parent.tree().map_err(|e| e.to_string())?)
    } else {
        None
    };

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(file_path);

    let diff = repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(&commit_tree),
        Some(&mut opts),
    ).map_err(|e| e.to_string())?;

    let hunks: RefCell<Vec<DiffHunk>> = RefCell::new(Vec::new());
    let file_status: RefCell<String> = RefCell::new("modified".to_string());

    diff.foreach(
        &mut |delta, _| {
            *file_status.borrow_mut() = match delta.status() {
                git2::Delta::Added   => "added".to_string(),
                git2::Delta::Deleted => "deleted".to_string(),
                git2::Delta::Renamed => "renamed".to_string(),
                _                    => "modified".to_string(),
            };
            true
        },
        None,
        Some(&mut |_delta, hunk| {
            let header = std::str::from_utf8(hunk.header())
                .unwrap_or("")
                .trim()
                .to_string();
            hunks.borrow_mut().push(DiffHunk { header, lines: Vec::new() });
            true
        }),
        Some(&mut |_delta, _hunk, line| {
            let origin = match line.origin() {
                '+' => "+",
                '-' => "-",
                ' ' => " ",
                _   => "\\",
            };
            let content = std::str::from_utf8(line.content())
                .unwrap_or("")
                .to_string();
            if let Some(h) = hunks.borrow_mut().last_mut() {
                h.lines.push(DiffLine {
                    origin: origin.to_string(),
                    content,
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                });
            }
            true
        }),
    ).map_err(|e| e.to_string())?;

    Ok(FileDiff {
        path: file_path.to_string(),
        status: file_status.into_inner(),
        hunks: hunks.into_inner(),
    })
}

/// Crea un branch a partir de un commit SHA específico (no desde HEAD).
/// Acepta tanto SHA completo (40 chars) como SHA corto (7+ chars).
pub fn create_branch_from_commit(
    project_path: &Path,
    branch_name: &str,
    commit_sha: &str,
) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    // revparse_single soporta SHAs parciales, nombres de referencia, etc.
    let obj = repo.revparse_single(commit_sha)
        .map_err(|e| format!("commit not found: {e}"))?;
    
    let commit = obj.peel_to_commit()
        .map_err(|e| format!("not a commit: {e}"))?;

    repo.branch(branch_name, &commit, false)
        .map_err(|e| format!("create branch failed: {e}"))?;

    Ok(())
}

/// Hace merge de `branch_name` en el branch actual (HEAD).
/// Retorna: "fast-forward" | "merge-commit:<sha>" | "up-to-date"
pub fn merge_branch(
    project_path: &Path,
    branch_name: &str,
    author_name: &str,
    author_email: &str,
) -> Result<String, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    // Resolver la referencia del branch a mergear
    let refname = format!("refs/heads/{branch_name}");
    let their_commit_obj = repo.revparse_single(&refname)
        .map_err(|_| format!("branch '{branch_name}' not found"))?;
    let their_commit = their_commit_obj.peel_to_commit()
        .map_err(|e| format!("not a commit: {e}"))?;

    let annotated = repo.find_annotated_commit(their_commit.id())
        .map_err(|e| e.to_string())?;

    let (analysis, _) = repo.merge_analysis(&[&annotated])
        .map_err(|e| e.to_string())?;

    if analysis.is_up_to_date() {
        return Ok("up-to-date".to_string());
    }

    if analysis.is_fast_forward() {
        // Fast-forward: mover HEAD directamente
        let head_ref_name = repo.head()
            .and_then(|h| h.resolve())
            .map(|r| r.name().unwrap_or("HEAD").to_string())
            .map_err(|e| e.to_string())?;

        let mut reference = repo.find_reference(&head_ref_name)
            .map_err(|e| e.to_string())?;
        reference.set_target(their_commit.id(), "merge: fast-forward")
            .map_err(|e| e.to_string())?;
        repo.set_head(&head_ref_name)
            .map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;

        return Ok(format!("fast-forward"));
    }

    if analysis.is_normal() {
        // Merge commit: indexar + resolver + crear commit
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.allow_conflicts(true).conflict_style_merge(true);

        repo.merge(&[&annotated], None, Some(&mut checkout_opts))
            .map_err(|e| format!("merge failed: {e}"))?;

        let mut index = repo.index().map_err(|e| e.to_string())?;
        if index.has_conflicts() {
            // Limpiar estado de merge antes de devolver error
            repo.cleanup_state().ok();
            return Err("merge has conflicts — resolve them in the Conflicts tab".to_string());
        }

        let tree_id = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
        let sig = Signature::now(author_name, author_email)
            .map_err(|e| e.to_string())?;

        let head_commit = repo.head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|e| e.to_string())?;

        let message = format!("Merge branch '{branch_name}'");
        let merge_commit_id = repo.commit(
            Some("HEAD"),
            &sig, &sig,
            &message,
            &tree,
            &[&head_commit, &their_commit],
        ).map_err(|e| format!("merge commit failed: {e}"))?;

        repo.cleanup_state().map_err(|e| e.to_string())?;

        return Ok(format!("merge-commit:{}", merge_commit_id));
    }

    Err("merge not possible (unborn HEAD or no common ancestor)".to_string())
}

/// Borra un branch local. Falla si es el branch actual (checkout a otro primero).
pub fn delete_branch(project_path: &Path, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    // Comprobar que no es el branch actual
    let head_name = repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_default();
    if head_name == branch_name {
        return Err(format!("Cannot delete the currently active branch '{branch_name}'. Switch to another branch first."));
    }

    let mut branch = repo
        .find_branch(branch_name, BranchType::Local)
        .map_err(|_| format!("branch '{branch_name}' not found"))?;

    branch.delete().map_err(|e| format!("delete failed: {e}"))
}

/// Crea un branch desde un commit dado, hace checkout a él, crea un commit vacío
/// de inicialización, y vuelve al branch original.
/// Retorna el SHA del commit vacío creado.
pub fn create_branch_with_init_commit(
    project_path: &Path,
    branch_name: &str,
    from_commit_sha: &str,
    author_name: &str,
    author_email: &str,
) -> Result<String, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    // 1. Guardar el branch actual para volver al final
    let original_branch = repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "master".to_string());

    // 2. Encontrar el commit de origen por SHA (corto o largo)
    let from_obj = repo.revparse_single(from_commit_sha)
        .map_err(|e| format!("commit not found: {e}"))?;
    let from_commit = from_obj.peel_to_commit()
        .map_err(|e| format!("not a commit: {e}"))?;

    // 3. Crear el branch desde ese commit
    repo.branch(branch_name, &from_commit, false)
        .map_err(|e| format!("create branch failed: {e}"))?;

    // 4. Hacer checkout al nuevo branch
    let new_refname = format!("refs/heads/{branch_name}");
    let new_obj = repo.revparse_single(&new_refname)
        .map_err(|e| format!("branch ref not found: {e}"))?;
    repo.checkout_tree(&new_obj, None)
        .map_err(|e| format!("checkout failed: {e}"))?;
    repo.set_head(&new_refname)
        .map_err(|e| format!("set_head failed: {e}"))?;

    // 5. Crear commit vacío (sin cambios en el árbol — mismo tree que el padre)
    let parent_commit = repo.head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| format!("cannot get HEAD commit: {e}"))?;
    let tree = parent_commit.tree().map_err(|e| e.to_string())?;
    let sig = Signature::now(author_name, author_email)
        .map_err(|e| e.to_string())?;
    let init_message = format!("chore: initialize branch '{branch_name}'");
    let init_commit_id = repo.commit(
        Some("HEAD"),
        &sig, &sig,
        &init_message,
        &tree,
        &[&parent_commit],
    ).map_err(|e| format!("init commit failed: {e}"))?;

    // 6. Volver al branch original
    let orig_refname = format!("refs/heads/{original_branch}");
    let orig_obj = repo.revparse_single(&orig_refname)
        .map_err(|e| format!("cannot find original branch: {e}"))?;
    repo.checkout_tree(&orig_obj, None)
        .map_err(|e| format!("checkout back failed: {e}"))?;
    repo.set_head(&orig_refname)
        .map_err(|e| e.to_string())?;

    Ok(init_commit_id.to_string())
}

pub fn rename_branch(project_path: &Path, old_name: &str, new_name: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut branch = repo
        .find_branch(old_name, BranchType::Local)
        .map_err(|_| format!("branch '{old_name}' not found"))?;

    branch.rename(new_name, false)
        .map_err(|e| format!("rename failed: {e}"))?;

    Ok(())
}

/// Lee el contenido del .gitignore del repositorio.
/// Devuelve string vacío si el archivo no existe.
pub fn read_gitignore(project_path: &Path) -> Result<String, String> {
    let path = project_path.join(".gitignore");
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read .gitignore: {e}"))
}

/// Sobreescribe el .gitignore con el contenido dado.
pub fn write_gitignore(project_path: &Path, content: &str) -> Result<(), String> {
    let path = project_path.join(".gitignore");
    std::fs::write(&path, content)
        .map_err(|e| format!("failed to write .gitignore: {e}"))
}

/// Hace merge de un commit concreto (por SHA) en el branch actual.
/// Útil cuando no sabemos el nombre de la rama — solo el SHA del commit.
pub fn merge_by_sha(
    project_path: &Path,
    commit_sha: &str,
    author_name: &str,
    author_email: &str,
) -> Result<String, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let oid = git2::Oid::from_str(commit_sha)
        .map_err(|e| format!("invalid sha '{commit_sha}': {e}"))?;

    let their_commit = repo.find_commit(oid)
        .map_err(|e| format!("commit not found: {e}"))?;

    let annotated = repo.find_annotated_commit(their_commit.id())
        .map_err(|e| e.to_string())?;

    let (analysis, _) = repo.merge_analysis(&[&annotated])
        .map_err(|e| e.to_string())?;

    if analysis.is_up_to_date() {
        return Ok("up-to-date".to_string());
    }

    if analysis.is_fast_forward() {
        let head_ref_name = repo.head()
            .and_then(|h| h.resolve())
            .map(|r| r.name().unwrap_or("HEAD").to_string())
            .map_err(|e| e.to_string())?;
        let mut reference = repo.find_reference(&head_ref_name)
            .map_err(|e| e.to_string())?;
        reference.set_target(their_commit.id(), "merge: fast-forward")
            .map_err(|e| e.to_string())?;
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.force();
        repo.checkout_head(Some(&mut checkout_opts))
            .map_err(|e| format!("checkout failed: {e}"))?;
        return Ok(format!("fast-forward:{}", their_commit.id()));
    }

    if analysis.is_normal() {
        let head_commit = repo.head()
            .map_err(|e| e.to_string())?
            .peel_to_commit()
            .map_err(|e| e.to_string())?;

        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.allow_conflicts(true).conflict_style_merge(true);

        repo.merge(&[&annotated], None, Some(&mut checkout_opts))
            .map_err(|e| format!("merge failed: {e}"))?;

        let index = repo.index().map_err(|e| e.to_string())?;
        if index.has_conflicts() {
            repo.cleanup_state().ok();
            return Err("merge has conflicts — resolve them in the Conflicts tab".to_string());
        }

        let mut index = repo.index().map_err(|e| e.to_string())?;
        let tree_id = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

        let sig = git2::Signature::now(author_name, author_email)
            .map_err(|e| e.to_string())?;

        let msg = format!("Merge commit {} into HEAD", &commit_sha[..7]);

        let merge_commit_id = repo.commit(
            Some("HEAD"),
            &sig, &sig,
            &msg,
            &tree,
            &[&head_commit, &their_commit],
        ).map_err(|e| format!("merge commit failed: {e}"))?;

        repo.cleanup_state().ok();
        return Ok(format!("merge-commit:{}", merge_commit_id));
    }

    Err("merge not possible (unborn HEAD or no common ancestor)".to_string())
}