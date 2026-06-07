// src-tauri/src/tools/sdk_server.rs
//
// Ephemeral HTTP server started per-sidecar session.
// The sidecar calls POST /sdk/{method} with a bearer token.
// Responses are synchronous JSON.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

/// Shared state available to all SDK route handlers.
pub struct SdkServerState {
    /// Auth token sent with each request from sidecar.
    pub token: String,
    /// Projects list (populated from the projects DB on server start).
    pub projects: Vec<SdkProject>,
    /// Notifications are forwarded via this Tauri app handle.
    pub app: tauri::AppHandle,
    /// Channel to send "progress" updates to the Tauri frontend.
    pub progress_tx: tokio::sync::mpsc::UnboundedSender<ProgressUpdate>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SdkProject {
    pub path: String,
    pub name: String,
    pub unity_version: String,
}

#[derive(Serialize, Deserialize)]
pub struct ProgressUpdate {
    pub tool_id: String,
    pub progress: f64,
    pub label: String,
}

#[derive(Serialize)]
pub struct SdkErrorResponse {
    pub error: String,
}

/// Start the SDK HTTP server on a random available port.
/// Returns (port, token, shutdown_tx).
pub async fn start(
    state: Arc<SdkServerState>,
) -> (u16, tokio::sync::oneshot::Sender<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind SDK server");
    let port = listener.local_addr().unwrap().port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let router = Router::new()
        .route("/sdk/projects", post(handle_get_projects))
        .route("/sdk/notify", post(handle_notify))
        .route("/sdk/progress", post(handle_progress))
        .route("/sdk/list-dir", post(handle_list_dir))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async { let _ = shutdown_rx.await; })
            .await
            .ok();
    });

    (port, shutdown_tx)
}

/// Middleware: validate Bearer token.
fn check_token(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start_matches("Bearer ") == expected)
        .unwrap_or(false)
}

async fn handle_get_projects(
    State(state): State<Arc<SdkServerState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !check_token(&headers, &state.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(serde_json::json!({ "projects": state.projects })))
}

#[derive(Deserialize)]
struct NotifyBody {
    message: String,
    #[serde(default = "default_notify_type")]
    r#type: String,
}

fn default_notify_type() -> String { "info".into() }

async fn handle_notify(
    State(state): State<Arc<SdkServerState>>,
    headers: HeaderMap,
    Json(body): Json<NotifyBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !check_token(&headers, &state.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    use tauri::Emitter;
    state.app.emit("sdk://notify", serde_json::json!({
        "message": body.message,
        "type": body.r#type,
    })).ok();
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ProgressBody {
    tool_id: String,
    progress: f64,
    #[serde(default)]
    label: String,
}

async fn handle_progress(
    State(state): State<Arc<SdkServerState>>,
    headers: HeaderMap,
    Json(body): Json<ProgressBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !check_token(&headers, &state.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    state.progress_tx.send(ProgressUpdate {
        tool_id: body.tool_id,
        progress: body.progress,
        label: body.label,
    }).ok();
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ListDirBody {
    root: String,
    #[serde(default)]
    sub_path: String,
}

async fn handle_list_dir(
    State(state): State<Arc<SdkServerState>>,
    headers: HeaderMap,
    Json(body): Json<ListDirBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !check_token(&headers, &state.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    // Validate root is within a registered project path
    let normalized_root = body.root.replace('\\', "/");
    let allowed = state.projects.iter().any(|p| {
        let proj_path = p.path.replace('\\', "/");
        normalized_root.starts_with(&proj_path)
    });
    if !allowed {
        return Ok(Json(serde_json::json!({
            "error": "root path is not within a registered project"
        })));
    }
    match crate::commands::tools::tools_list_dir(body.root, body.sub_path) {
        Ok(entries) => Ok(Json(serde_json::json!({ "entries": entries }))),
        Err(e) => Ok(Json(serde_json::json!({ "error": e.to_string() }))),
    }
}