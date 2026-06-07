use std::path::PathBuf;
use std::sync::Mutex;
use crate::services::github_oauth::{self, DevicePrompt, GithubUserInfo};
use crate::services::auth_store;
use crate::services::git_service::{self, GitStatus, CommitEntry, BranchInfo, CommitDiffFile, FileDiff};

// ── Status ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_vcs_status(project_path: String) -> Result<GitStatus, String> {
    let path = PathBuf::from(&project_path);
    if !path.join(".git").exists() {
        return Err("No git repository found at this path".into());
    }
    tokio::task::spawn_blocking(move || git_service::get_status(&path))
        .await
        .map_err(|e| e.to_string())?
}

// ── Commit ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vcs_commit(project_path: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".into());
    }
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::stage_all_and_commit(&path, &message, "VRC Studio User", "user@vrcstudio")
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Log ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_vcs_log(project_path: String, limit: usize) -> Result<Vec<CommitEntry>, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::get_log(&path, limit.min(100)))
        .await
        .map_err(|e| e.to_string())?
}

// ── Branches ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_vcs_branches(project_path: String) -> Result<Vec<BranchInfo>, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::list_branches(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_vcs_branch(project_path: String, branch_name: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::create_branch(&path, &branch_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn switch_vcs_branch(project_path: String, branch_name: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::switch_branch(&path, &branch_name))
        .await
        .map_err(|e| e.to_string())?
}

// ── Remote / Push / Pull ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn vcs_add_remote(project_path: String, remote_url: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::add_remote(&path, "origin", &remote_url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_push(project_path: String, token: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::push_to_remote(&path, "origin", &token))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_pull(project_path: String, token: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::pull_from_remote(&path, "origin", &token))
        .await
        .map_err(|e| e.to_string())?
}
// ── GitHub OAuth Device Flow ───────────────────────────────────────────────

// device_code + interval almacenados entre las dos llamadas del flujo
static PENDING_DEVICE_CODE: Mutex<Option<(String, u64)>> = Mutex::new(None);

const GITHUB_PROVIDER: &str = "github";

/// Paso 1: inicia el Device Flow con GitHub.
/// Devuelve el user_code y la URL que el usuario debe visitar.
#[tauri::command]
pub async fn github_start_device_auth() -> Result<DevicePrompt, String> {
    let (device_code, prompt) = github_oauth::request_device_code().await?;
    let interval = prompt.interval;
    *PENDING_DEVICE_CODE.lock().unwrap() = Some((device_code, interval));
    Ok(prompt)
}

/// Paso 2: hace polling hasta que el usuario autorice.
/// Persiste el token en el keyring del SO y devuelve la info del usuario.
#[tauri::command]
pub async fn github_poll_token() -> Result<GithubUserInfo, String> {
    let (device_code, interval) = PENDING_DEVICE_CODE
        .lock()
        .unwrap()
        .clone()
        .ok_or("No GitHub auth in progress — call github_start_device_auth first")?;

    let token = github_oauth::poll_for_token(device_code, interval).await?;

    // Persistir en el keyring del SO (no en disco sin cifrar)
    auth_store::store_token(GITHUB_PROVIDER, &token)
        .map_err(|e| format!("failed to save token: {e}"))?;

    // Limpiar el device code pendiente
    *PENDING_DEVICE_CODE.lock().unwrap() = None;

    // Obtener y devolver info del usuario
    github_oauth::get_user_info(&token).await
}

/// Recupera el token de GitHub almacenado y devuelve la info del usuario.
/// Devuelve None si no hay token guardado.
#[tauri::command]
pub async fn github_get_user() -> Result<Option<GithubUserInfo>, String> {
    match auth_store::get_token(GITHUB_PROVIDER)? {
        None => Ok(None),
        Some(token) => {
            match github_oauth::get_user_info(&token).await {
                Ok(info) => Ok(Some(info)),
                // Si el token es inválido/expirado, limpiar y devolver None
                Err(_) => {
                    let _ = auth_store::delete_token(GITHUB_PROVIDER);
                    Ok(None)
                }
            }
        }
    }
}

/// Devuelve el token de GitHub almacenado (para usar en push/pull).
/// Devuelve error si no hay token.
#[tauri::command]
pub async fn github_get_token() -> Result<String, String> {
    auth_store::get_token(GITHUB_PROVIDER)?
        .ok_or_else(|| "No GitHub token found — please authenticate first".into())
}

/// Revoca la sesión de GitHub eliminando el token del keyring.
#[tauri::command]
pub async fn github_logout() -> Result<(), String> {
    auth_store::delete_token(GITHUB_PROVIDER)
}
// ── Commit Diff ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vcs_get_commit_diff(project_path: String, commit_sha: String) -> Result<Vec<CommitDiffFile>, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::get_commit_diff_files(&path, &commit_sha))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_get_file_diff(project_path: String, commit_sha: String, file_path: String) -> Result<FileDiff, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::get_file_diff(&path, &commit_sha, &file_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_vcs_branch_from_commit(
    project_path: String,
    branch_name: String,
    commit_sha: String,
) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::create_branch_from_commit(&path, &branch_name, &commit_sha)
    })
    .await
    .map_err(|e| e.to_string())?
}

// src-tauri/src/commands/vcs.rs

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct GithubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub clone_url: String,
    pub html_url: String,          // para abrir en browser
    pub private: bool,
    pub description: Option<String>,
    pub updated_at: Option<String>,
    pub stargazers_count: Option<u32>,
    #[serde(default)]
    pub topics: Vec<String>,       // tags/topics del repo
}

#[tauri::command]
pub async fn github_list_repos() -> Result<Vec<GithubRepo>, String> {
    let token = auth_store::get_token(GITHUB_PROVIDER)?
        .ok_or("No GitHub token")?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner")
        .bearer_auth(&token)
        .header("User-Agent", "vrc-studio")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json::<Vec<GithubRepo>>()
        .await
        .map_err(|e| format!("parse error: {e}"))
}

// src-tauri/src/commands/vcs.rs
#[tauri::command]
pub async fn vcs_merge_branch(
    project_path: String,
    branch_name: String,
) -> Result<String, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::merge_branch(&path, &branch_name, "VRC Studio User", "user@vrcstudio")
    })
    .await
    .map_err(|e| e.to_string())?
}

// src-tauri/src/commands/vcs.rs
#[tauri::command]
pub async fn github_create_repo(
    name: String,
    private: bool,
    description: String,
) -> Result<GithubRepo, String> {
    let token = auth_store::get_token(GITHUB_PROVIDER)?
        .ok_or("No GitHub token")?;

    let client = reqwest::Client::new();
    // Incluir topic "vrcstudio" desde la creación
    let body = serde_json::json!({
        "name": name,
        "private": private,
        "description": description,
        "has_issues": true,
        "auto_init": false,
    });

    let resp = client
        .post("https://api.github.com/user/repos")
        .bearer_auth(&token)
        .header("User-Agent", "vrc-studio")
        .header("Accept", "application/vnd.github+json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error: {err}"));
    }

    let repo: GithubRepo = resp.json().await.map_err(|e| format!("parse error: {e}"))?;

    // Añadir topic "vrcstudio" via endpoint separado (más compatible)
    let _topic_resp = client
        .put(&format!("https://api.github.com/repos/{}/topics", repo.full_name))
        .bearer_auth(&token)
        .header("User-Agent", "vrc-studio")
        .header("Accept", "application/vnd.github+json")
        .json(&serde_json::json!({ "names": ["vrcstudio"] }))
        .send()
        .await
        .ok(); // Si falla no es crítico

    Ok(repo)
}

#[tauri::command]
pub async fn vcs_delete_branch(project_path: String, branch_name: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::delete_branch(&path, &branch_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_create_branch_with_init(
    project_path: String,
    branch_name: String,
    from_commit_sha: String,
) -> Result<String, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::create_branch_with_init_commit(
            &path, &branch_name, &from_commit_sha,
            "VRC Studio User", "user@vrcstudio",
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_rename_branch(project_path: String, old_name: String, new_name: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::rename_branch(&path, &old_name, &new_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_read_gitignore(project_path: String) -> Result<String, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::read_gitignore(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_write_gitignore(project_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::write_gitignore(&path, &content))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_merge_by_sha(
    project_path: String,
    commit_sha: String,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::merge_by_sha(&path, &commit_sha, "VRC Studio User", "user@vrcstudio")
    })
    .await
    .map_err(|e| e.to_string())?
}