use std::path::PathBuf;
use std::fs;
use serde::Serialize;
use git2::Repository;

#[derive(Debug, Clone, Serialize)]
pub struct ConflictFile {
    pub path: String,
    pub ours_snippet: String,   // primeras 8 líneas de <<<<<<< ours
    pub theirs_snippet: String, // primeras 8 líneas de >>>>>>> theirs
}

/// Devuelve la lista de archivos con conflictos de merge en el repo.
#[tauri::command]
pub async fn vcs_get_conflicts(project_path: String) -> Result<Vec<ConflictFile>, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&path)
            .map_err(|e| format!("cannot open repo: {e}"))?;

        let index = repo.index().map_err(|e| e.to_string())?;
        let mut files: Vec<ConflictFile> = Vec::new();

        for conflict in index.conflicts().map_err(|e| e.to_string())? {
            let conflict = conflict.map_err(|e| e.to_string())?;
            let entry = conflict.our.or(conflict.their).or(conflict.ancestor);
            if let Some(entry) = entry {
                let rel_path = String::from_utf8_lossy(&entry.path).to_string();
                let full_path = path.join(&rel_path);

                let (ours_snippet, theirs_snippet) = if let Ok(contents) = fs::read_to_string(&full_path) {
                    parse_conflict_snippets(&contents)
                } else {
                    (String::new(), String::new())
                };

                files.push(ConflictFile { path: rel_path, ours_snippet, theirs_snippet });
            }
        }

        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_conflict_snippets(content: &str) -> (String, String) {
    let mut ours = Vec::new();
    let mut theirs = Vec::new();
    let mut in_ours = false;
    let mut in_theirs = false;

    for line in content.lines() {
        if line.starts_with("<<<<<<<") {
            in_ours = true;
            continue;
        }
        if line.starts_with("=======") {
            in_ours = false;
            in_theirs = true;
            continue;
        }
        if line.starts_with(">>>>>>>") {
            in_theirs = false;
            continue;
        }
        if in_ours && ours.len() < 8 { ours.push(line); }
        if in_theirs && theirs.len() < 8 { theirs.push(line); }
    }

    (ours.join("\n"), theirs.join("\n"))
}

/// Resuelve un conflicto eligiendo "ours" o "theirs", o marcándolo como manual.
/// strategy: "ours" | "theirs" | "manual"
#[tauri::command]
pub async fn vcs_resolve_conflict(
    project_path: String,
    file_path: String,
    strategy: String,
) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        if strategy == "manual" {
            // El usuario ya editó el archivo — solo hay que hacer `git add`
            git_add_file(&path, &file_path)?;
            return Ok(());
        }

        let full_path = path.join(&file_path);
        let content = fs::read_to_string(&full_path)
            .map_err(|e| format!("cannot read file: {e}"))?;

        let resolved = if strategy == "ours" {
            resolve_keep_ours(&content)
        } else {
            resolve_keep_theirs(&content)
        };

        fs::write(&full_path, resolved)
            .map_err(|e| format!("cannot write file: {e}"))?;

        git_add_file(&path, &file_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn resolve_keep_ours(content: &str) -> String {
    let mut out = Vec::new();
    let mut skip = false;
    for line in content.lines() {
        if line.starts_with("<<<<<<<") { skip = false; continue; }
        if line.starts_with("=======") { skip = true; continue; }
        if line.starts_with(">>>>>>>") { skip = false; continue; }
        if !skip { out.push(line); }
    }
    out.join("\n")
}

fn resolve_keep_theirs(content: &str) -> String {
    let mut out = Vec::new();
    let mut skip = true;
    for line in content.lines() {
        if line.starts_with("<<<<<<<") { skip = true; continue; }
        if line.starts_with("=======") { skip = false; continue; }
        if line.starts_with(">>>>>>>") { skip = true; continue; }
        if !skip { out.push(line); }
    }
    out.join("\n")
}

fn git_add_file(repo_path: &std::path::Path, file_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("cannot open repo: {e}"))?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(std::path::Path::new(file_path))
        .map_err(|e| format!("git add failed: {e}"))?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}