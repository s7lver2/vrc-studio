// src-tauri/src/commands/shop.rs
// Migrado a rusqlite + DbPool. Las únicas modificaciones respecto al original son:
// - Reemplazo de DbPool por DbPool
// - Uso de conn.execute() en lugar de sqlx::query()
// - Añadido use rusqlite::{params, OptionalExtension}
// - Las funciones que no tocan DB (WebView, scraping) quedan idénticas.

use crate::db::DbPool;
use crate::error::AppError;
use crate::services::{auth_store, booth, downloader, riperstore};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;
use uuid::Uuid;

// ── Shared result type ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShopProduct {
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String,
    pub url: String,
    pub source: String, // "booth" | "riperstore"
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async fn booth_resolve_download_url_via_webview(
    app: &AppHandle,
    downloadables_url: &str,
) -> Result<String, String> {
    let label = format!(
        "booth-dl-{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")
    );
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_nav = tx.clone();

    let parsed_url =
        Url::parse(downloadables_url).map_err(|e| format!("Invalid downloadables URL: {}", e))?;

    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed_url))
        .title("")
        .inner_size(1.0, 1.0)
        .visible(false) // invisible
        .decorations(false) // sin bordes
        .skip_taskbar(true) // no aparece en la barra de tareas
        .always_on_top(false)
        .transparent(true) // fondo transparente
        .build()
        .map_err(|e| e.to_string())?;

    let _ = win.hide();

    let result = match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(url)) => Ok(url),
        Ok(Err(_)) => Err("Channel closed".to_string()),
        Err(_) => Err("Timeout resolving download URL".to_string()),
    };
    let _ = win.close();
    result
}

pub fn merge_results(
    booth_res: Vec<booth::BoothProduct>,
    riper_res: Vec<riperstore::RiperstoreProduct>,
) -> Vec<ShopProduct> {
    booth_res
        .into_iter()
        .map(|p| ShopProduct {
            source_id: p.source_id,
            name: p.name,
            author: p.author,
            thumbnail_url: p.thumbnail_url,
            price_display: p.price_display,
            url: p.url,
            source: p.source,
        })
        .chain(riper_res.into_iter().map(|p| ShopProduct {
            source_id: p.source_id,
            name: p.name,
            author: p.author,
            thumbnail_url: p.thumbnail_url,
            price_display: p.price_display,
            url: p.url,
            source: p.source,
        }))
        .collect()
}

fn build_client(session_token: Option<String>) -> Result<reqwest::Client, String> {
    let builder = reqwest::Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    // Si hay token de sesión, se puede inyectar como header o cookie según la plataforma
    builder.build().map_err(|e| e.to_string())
}

// ── Commands ───────────────────────────────────────────────────────────────────

/// Called after booth_open_auth completes. Extracts the _plaza_session_nktz7u cookie
/// (Booth's auth cookie) from the WebView and stores it in the keyring for use in
/// authenticated API calls.
#[tauri::command]
pub async fn booth_capture_session_cookie(app: AppHandle) -> Result<bool, String> {
    use std::time::Duration;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let label = format!(
        "booth-cookie-{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")
    );
    let parsed_url =
        tauri::Url::parse("https://booth.pm/en").map_err(|e| format!("URL parse: {}", e))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title("")
        .inner_size(1.0, 1.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.hide();

    let tx_clone = tx.clone();
    let label_for_spawn = label.clone();
    let listen_handle = app.listen(format!("booth-cookie:{}", &label), move |ev| {
        if let Some(tx) = tx_clone.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(ev.payload().to_string());
        }
    });

    tokio::time::sleep(Duration::from_secs(3)).await;
    let emit_js = format!(
        r#"(function() {{
            window.__TAURI__.event.emit('booth-cookie:{}', document.cookie);
        }})();"#,
        label
    );
    let _ = win.eval(&emit_js);

    let cookie_result = tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();

    let _ = win.close();
    app.unlisten(listen_handle);

    let cookies = cookie_result.trim().trim_matches('"').to_string();
    if !cookies.is_empty() && cookies.contains("_plaza_session") {
        crate::services::auth_store::store_token("booth_session_cookie", &cookies)
            .map_err(|e| e)?;
        return Ok(true);
    }
    Ok(false)
}

/// Búsqueda en Booth. Riperstore se busca por separado via `ripper_search_via_webview`.
#[tauri::command]
pub async fn search_shop(query: String, page: u32) -> Result<Vec<ShopProduct>, String> {
    let booth_cookie =
        crate::services::auth_store::get_token("booth_session_cookie").unwrap_or(None);

    let client = if let Some(cookie) = &booth_cookie {
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .default_headers({
                let mut h = reqwest::header::HeaderMap::new();
                h.insert(
                    reqwest::header::COOKIE,
                    reqwest::header::HeaderValue::from_str(cookie)
                        .unwrap_or_else(|_| reqwest::header::HeaderValue::from_static("")),
                );
                h
            })
            .build()
            .map_err(|e| e.to_string())?
    } else {
        build_client(None).map_err(|e| e)?
    };

    let booth_results = booth::search(&client, &query, page)
        .await
        .map_err(|e| e.to_string())?;

    Ok(merge_results(booth_results, vec![]))
}

/// Obtiene la URL final de descarga de un item de Booth.
async fn booth_get_download_url_via_webview(
    app: &AppHandle,
    booth_state: &State<'_, BoothState>,
    source_id: &str,
) -> Result<String, String> {
    let log = |msg: &str| {
        eprintln!("[booth_dl] {}", msg);
        let _ = app.emit("booth:download-debug", serde_json::json!({ "msg": msg }));
    };

    log(&format!(
        "Obteniendo URL de descarga para item {}",
        source_id
    ));

    let label = {
        let guard = booth_state
            .webview_label
            .lock()
            .map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = label.ok_or_else(|| "No Booth WebView label".to_string())?;

    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "Booth WebView window not found".to_string())?;

    let js = booth_webview::build_ephemeral_download_js(source_id);

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_event = tx.clone();
    let listener_id = app.listen("booth:ephemeral-dl", move |event| {
        if let Some(sender) = tx_event.lock().unwrap().take() {
            let _ = sender.send(Ok(event.payload().to_string()));
        }
    });

    win.eval(&js).map_err(|e| {
        app.unlisten(listener_id);
        format!("eval error: {}", e)
    })?;

    let raw = match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(e))) => {
            app.unlisten(listener_id);
            return Err(format!("JS error: {}", e));
        }
        Ok(Err(_)) => {
            app.unlisten(listener_id);
            return Err("Channel closed".to_string());
        }
        Err(_) => {
            app.unlisten(listener_id);
            return Err("Timeout getting download URL".to_string());
        }
    };
    app.unlisten(listener_id);

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;
    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown");
        return Err(format!("Booth error: {}", err));
    }
    parsed["url"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Empty URL".to_string())
}

/// Inicia la descarga de un producto y lo registra en el Inventory.
/// Emite eventos `download://progress` durante el proceso.
/// Retorna el ID del nuevo InventoryItem creado.
#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    pool: State<'_, DbPool>,
    booth_state: State<'_, BoothState>,
    source: String,
    source_id: String,
    name: String,
    author: String,
    thumbnail_url: String,
) -> Result<String, AppError> {
    let client =
        build_client(auth_store::get_token(&source).unwrap_or(None)).map_err(AppError::External)?;

    let download_url = match source.as_str() {
        "booth" => {
            ensure_booth_authenticated(&app, &booth_state)
                .await
                .map_err(AppError::External)?;
            booth_get_download_url_via_webview(&app, &booth_state, &source_id)
                .await
                .map_err(AppError::External)?
        }
        "riperstore" => riperstore::get_download_url(&client, &source_id)
            .await
            .map_err(AppError::External)?,
        other => return Err(AppError::External(format!("Unknown source: {}", other))),
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::External(e.to_string()))?
        .join("downloads")
        .join(&source)
        .join(&source_id);

    let downloaded_path =
        downloader::download_file(&app, &client, &source_id, &download_url, &cache_dir)
            .await
            .map_err(AppError::External)?;

    let final_path = downloader::maybe_extract_zip(&app, &source_id, &downloaded_path, &cache_dir)
        .await
        .map_err(AppError::External)?;

    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let local_path = final_path.to_string_lossy().to_string();
    let size_bytes: i64 = std::fs::metadata(&final_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]')",
        params![item_id, name, author, source, source_id, local_path, thumbnail_url, now, size_bytes],
    )?;

    let _ = app.emit(
        "download://progress",
        serde_json::json!({
            "item_id": source_id,
            "percentage": 100.0,
            "downloaded_bytes": size_bytes,
            "total_bytes": size_bytes,
            "status": "done"
        }),
    );

    Ok(item_id)
}

/// Devuelve el detalle completo de un producto de Booth: imágenes en alta resolución,
/// descripción y productos similares. Usado por el modal de detalle del Shop.
#[tauri::command]
pub async fn get_booth_product_detail(
    source_id: String,
) -> Result<booth::BoothProductDetail, String> {
    let client = build_client(auth_store::get_token("booth").unwrap_or(None))?;
    booth::fetch_product_detail(&client, &source_id).await
}

/// Vincula una cuenta de proveedor almacenando el token en el keychain del SO.
#[tauri::command]
pub fn link_account(provider: String, token: String) -> Result<(), String> {
    auth_store::store_token(&provider, &token)
}

/// Elimina el token de un proveedor del keychain.
#[tauri::command]
pub fn unlink_account(provider: String) -> Result<(), String> {
    auth_store::delete_token(&provider)
}

/// Devuelve los proveedores que tienen token almacenado.
#[tauri::command]
pub fn get_linked_providers() -> Vec<String> {
    ["booth", "riperstore", "github"]
        .iter()
        .filter(|p| auth_store::get_token(p).unwrap_or(None).is_some())
        .map(|p| p.to_string())
        .collect()
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unified_results_merge() {
        let booth = vec![booth::BoothProduct {
            source_id: "111".to_string(),
            name: "Avatar A".to_string(),
            author: "Au".to_string(),
            thumbnail_url: "".to_string(),
            price_display: "¥500".to_string(),
            url: "https://booth.pm/items/111".to_string(),
            source: "booth".to_string(),
        }];
        let riper = vec![riperstore::RiperstoreProduct {
            source_id: "222".to_string(),
            name: "Avatar B".to_string(),
            author: "Rr".to_string(),
            thumbnail_url: "".to_string(),
            price_display: "Free".to_string(),
            url: "https://riperstore.com/threads/222/".to_string(),
            source: "riperstore".to_string(),
            booth_ids: vec![],
            avatar_booth_id: None,
            downloads: vec![],
            supported_avatars: vec![],
        }];

        let merged = merge_results(booth, riper);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].source, "booth");
        assert_eq!(merged[1].source, "riperstore");
    }

    #[test]
    fn test_merge_empty_results() {
        let merged = merge_results(vec![], vec![]);
        assert_eq!(merged.len(), 0);
    }
}

/// Descarga un item GRATUITO de Booth directamente desde la página del producto.
/// No requiere WebView auth — los items gratuitos tienen URL de descarga pública.
/// Si el item requiere autenticación a pesar de tener precio 0, devuelve un error
/// descriptivo indicando al usuario que conecte su cuenta de Booth.
#[tauri::command]
pub async fn booth_download_free_item(
    app: AppHandle,
    pool: State<'_, DbPool>,
    booth_state: State<'_, BoothState>,
    source_id: String,
    name: String,
    author: String,
    thumbnail_url: String,
) -> Result<String, AppError> {
    // Paso 1 — intentar URL de descarga sin auth;
    // si Booth requiere sesión (incluso en items gratuitos), usar WebView autenticado.
    let cdn_url = match booth::fetch_free_download_url(&source_id).await {
        Ok(url) => url,
        Err(e)
            if e.contains("requires Booth authentication")
                || e.contains("requires authentication") =>
        {
            // Item gratuito que igualmente exige login. Fallback al WebView autenticado.
            ensure_booth_authenticated(&app, &booth_state)
                .await
                .map_err(AppError::External)?;
            booth_get_download_url_via_webview(&app, &booth_state, &source_id)
                .await
                .map_err(AppError::External)?
        }
        Err(e) => return Err(AppError::External(e)),
    };

    // Paso 2 — cliente HTTP simple para la descarga (CDN no requiere cookies)
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|e| AppError::External(e.to_string()))?;

    // Paso 3 — directorio de caché
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::External(e.to_string()))?
        .join("downloads")
        .join("booth")
        .join(&source_id);

    // Paso 4 — emitir progreso inicial
    let _ = app.emit(
        "download://progress",
        serde_json::json!({
            "item_id": source_id,
            "percentage": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "status": "downloading"
        }),
    );

    // Paso 5 — descargar
    let downloaded_path =
        downloader::download_file(&app, &client, &source_id, &cdn_url, &cache_dir)
            .await
            .map_err(AppError::External)?;

    // Paso 6 — extraer si es zip/unitypackage
    let final_path =
        downloader::maybe_extract_zip(&app, &source_id, &downloaded_path, &cache_dir)
            .await
            .map_err(AppError::External)?;

    // Paso 7 — insertar en inventory DB
    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let local_path = final_path.to_string_lossy().to_string();
    let size_bytes: i64 = std::fs::metadata(&final_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]')",
        params![
            item_id,
            name,
            author,
            "booth",
            source_id,
            local_path,
            thumbnail_url,
            now,
            size_bytes
        ],
    )?;

    // Paso 8 — emitir progreso final
    let _ = app.emit(
        "download://progress",
        serde_json::json!({
            "item_id": source_id,
            "percentage": 100.0,
            "downloaded_bytes": size_bytes,
            "total_bytes": size_bytes,
            "status": "done"
        }),
    );

    Ok(item_id)
}

// ── Ripper.store WebView commands ─────────────────────────────────────────────

use crate::services::booth_webview;
use crate::services::ripper_webview;
use crate::{BoothState, RipperState};
use tauri::Listener;

/// Abre una ventana WebView en forum.ripper.store para que el usuario resuelva
/// el CF challenge y haga login.
#[tauri::command]
pub async fn open_ripper_auth(app: AppHandle, state: State<'_, RipperState>) -> Result<(), String> {
    // 1. Deregistrar listener previo
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }

    // 2. Registrar listener persistente
    let app_auth = app.clone();
    let listener_id = app.listen("ripper:current-url", move |event| {
        let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap_or_default();
        let logged_in = payload["loggedIn"].as_bool().unwrap_or(false);
        let url = payload["url"].as_str().unwrap_or("");

        if logged_in && ripper_webview::is_logged_in_url(url) {
            if let Some(win) = app_auth.get_webview_window(ripper_webview::WEBVIEW_LABEL) {
                let _ = win.hide();
            }
            let _ = app_auth.emit("ripper:auth_success", ());
        }
    });

    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        *guard = Some(listener_id);
    }

    // 3. Si la ventana ya existe (reconnect)
    {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        if let Some(ref label) = *guard {
            if let Some(win) = app.get_webview_window(label) {
                win.show().map_err(|e| e.to_string())?;
                win.set_focus().map_err(|e| e.to_string())?;
                let app_check = app.clone();
                let label_check = label.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    if let Some(w) = app_check.get_webview_window(&label_check) {
                        let _ = w.eval(&ripper_webview::build_session_check_js());
                    }
                });
                return Ok(());
            }
        }
    }

    // 4. Crear ventana nueva
    let label = ripper_webview::WEBVIEW_LABEL.to_string();
    let app_nav = app.clone();
    let label_nav = label.clone();
    let is_first_nav = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let is_first_nav_clone = is_first_nav.clone();

    let win = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(ripper_webview::RIPPER_ORIGIN.parse().unwrap()),
    )
    .title("Connect Ripper.store")
    .inner_size(1024.0, 768.0)
    .resizable(true)
    .on_navigation(move |url: &tauri::Url| {
        if is_first_nav_clone.swap(false, std::sync::atomic::Ordering::Relaxed) {
            return true;
        }
        if ripper_webview::is_logged_in_url(url.as_str()) {
            let app_spawn = app_nav.clone();
            let label_spawn = label_nav.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1500)).await;
                if let Some(w) = app_spawn.get_webview_window(&label_spawn) {
                    let _ = w.eval(&ripper_webview::build_session_check_js());
                }
            });
        }
        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    let win_hide = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win_hide.hide();
        }
    });

    {
        let app_poll = app.clone();
        let label_poll = label.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            for _ in 0..100 {
                match app_poll.get_webview_window(&label_poll) {
                    None => break,
                    Some(w) => {
                        let _ = w.eval(&ripper_webview::build_session_check_js());
                    }
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        });
    }

    let mut guard = state.webview_label.lock().map_err(|e| e.to_string())?;
    *guard = Some(label);
    Ok(())
}

/// Cierra sesión: destruye la WebviewWindow, limpia el estado y deregistra el listener.
#[tauri::command]
pub fn ripper_logout(app: AppHandle, state: State<'_, RipperState>) -> Result<(), String> {
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }
    let mut guard = state.webview_label.lock().map_err(|e| e.to_string())?;
    if let Some(ref label) = *guard {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.destroy();
        }
    }
    *guard = None;
    let _ = app.emit("ripper:logged_out", ());
    Ok(())
}

/// Devuelve true si hay una WebviewWindow de Ripper activa (= autenticado).
#[tauri::command]
pub fn ripper_is_authenticated(app: AppHandle, state: State<'_, RipperState>) -> bool {
    let mut guard = state
        .webview_label
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        None => false,
        Some(label) => {
            if app.get_webview_window(label).is_some() {
                true
            } else {
                *guard = None;
                false
            }
        }
    }
}

/// Obtiene la descripción e imágenes de un topic de Riperstore inyectando
/// fetch() en el WebView activo.
#[tauri::command]
pub async fn ripper_get_topic_detail(
    app: AppHandle,
    state: State<'_, RipperState>,
    source_id: String,
) -> Result<(String, Vec<String>, Vec<String>), String> {
    let label = {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = match label {
        Some(l) => l,
        None => return Err("Not authenticated with Ripper.store".to_string()),
    };
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "Ripper WebView window not found".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let listener_id = app.listen("ripper:topic-detail", move |event| {
        if let Some(sender) = tx_clone.lock().unwrap().take() {
            let _ = sender.send(Ok(event.payload().to_string()));
        }
    });

    let js = ripper_webview::build_topic_detail_js(&source_id);
    win.eval(&js).map_err(|e| {
        app.unlisten(listener_id);
        e.to_string()
    })?;

    let raw = match tokio::time::timeout(Duration::from_secs(8), rx).await {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(e))) => {
            app.unlisten(listener_id);
            return Err(format!("JS error: {}", e));
        }
        Ok(Err(_)) => {
            app.unlisten(listener_id);
            return Err("Channel closed".to_string());
        }
        Err(_) => {
            app.unlisten(listener_id);
            return Err("Topic detail fetch timed out".to_string());
        }
    };
    app.unlisten(listener_id);

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;

    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown");
        return Err(format!("Ripper fetch error: {}", err));
    }

    let description = parsed["description"].as_str().unwrap_or("").to_string();
    let images = parsed["images"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let links = parsed["links"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    Ok((description, images, links))
}

/// Scrape profundo de un topic de Riperstore.
#[tauri::command]
pub async fn ripper_scrape_deep(
    app: AppHandle,
    state: State<'_, RipperState>,
    source_id: String,
    max_pages: u32,
) -> Result<Vec<ripper_webview::DownloadLinkContext>, String> {
    let label = {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = match label {
        Some(l) => l,
        None => return Err("Not authenticated with Ripper.store".to_string()),
    };
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "Ripper WebView window not found".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let listener_id = app.listen("ripper:scrape-deep-result", move |event| {
        if let Some(sender) = tx_clone.lock().unwrap().take() {
            let _ = sender.send(Ok(event.payload().to_string()));
        }
    });

    let pages = max_pages.max(1).min(30);
    let js = ripper_webview::build_topic_scrape_deep_js(&source_id, pages);
    win.eval(&js).map_err(|e| {
        app.unlisten(listener_id);
        e.to_string()
    })?;

    let raw = match tokio::time::timeout(Duration::from_secs(45), rx).await {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(e))) => {
            app.unlisten(listener_id);
            return Err(format!("JS error: {}", e));
        }
        Ok(Err(_)) => {
            app.unlisten(listener_id);
            return Err("Channel closed".to_string());
        }
        Err(_) => {
            app.unlisten(listener_id);
            return Err("Deep scrape timed out (45s)".to_string());
        }
    };
    app.unlisten(listener_id);

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;

    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown");
        return Err(format!("Scrape error: {}", err));
    }

    let links = parsed["links"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let url = v["url"].as_str()?.to_string();
                    let avatars = v["avatars"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|av| av.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(ripper_webview::DownloadLinkContext { url, avatars })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(links)
}

/// Descarga directamente desde una URL arbitraria ya resuelta.
#[tauri::command]
pub async fn download_direct_url(
    app: AppHandle,
    pool: State<'_, DbPool>,
    url: String,
    name: String,
    author: String,
    thumbnail_url: String,
    source_id: String,
) -> Result<String, AppError> {
    let client = build_client(None).map_err(AppError::External)?;

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::External(e.to_string()))?
        .join("downloads")
        .join("riperstore")
        .join(&source_id);

    let _ = app.emit(
        "download://progress",
        serde_json::json!({
            "item_id": source_id,
            "percentage": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "status": "downloading"
        }),
    );

    let downloaded_path = downloader::download_file(&app, &client, &source_id, &url, &cache_dir)
        .await
        .map_err(AppError::External)?;

    let final_path = downloader::maybe_extract_zip(&app, &source_id, &downloaded_path, &cache_dir)
        .await
        .map_err(AppError::External)?;

    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let local_path = final_path.to_string_lossy().to_string();
    let size_bytes: i64 = std::fs::metadata(&final_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]')",
        params![item_id, name, author, "riperstore", source_id, local_path, thumbnail_url, now, size_bytes],
    )?;

    let _ = app.emit(
        "download://progress",
        serde_json::json!({
            "item_id": source_id,
            "percentage": 100.0,
            "downloaded_bytes": size_bytes,
            "total_bytes": size_bytes,
            "status": "done"
        }),
    );

    Ok(item_id)
}

/// Busca en forum.ripper.store inyectando JS en el WebView autenticado.
#[tauri::command]
pub async fn ripper_search_via_webview(
    app: AppHandle,
    state: State<'_, RipperState>,
    query: String,
    page: u32,
) -> Result<riperstore::RiperstoreSearchResult, String> {
    let label = {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = match label {
        Some(l) => l,
        None => return Err("Not authenticated with Ripper.store".to_string()),
    };
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "Ripper WebView window not found".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let listener_id = app.listen("ripper:search-result", move |event| {
        if let Some(sender) = tx_clone.lock().unwrap().take() {
            let _ = sender.send(Ok(event.payload().to_string()));
        }
    });

    let js = ripper_webview::build_search_js(&query, page);
    win.eval(&js).map_err(|e| {
        app.unlisten(listener_id);
        format!("eval error: {}", e)
    })?;

    let raw = match tokio::time::timeout(Duration::from_secs(15), rx).await {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(e))) => {
            app.unlisten(listener_id);
            return Err(format!("JS error: {}", e));
        }
        Ok(Err(_)) => {
            app.unlisten(listener_id);
            return Err("Channel closed".to_string());
        }
        Err(_) => {
            app.unlisten(listener_id);
            let _ = app.emit("ripper:session_expired", ());
            return Err(
                "Ripper.store search timed out — check your connection or re-authenticate"
                    .to_string(),
            );
        }
    };
    app.unlisten(listener_id);

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Event parse error: {}", e))?;

    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown error");
        let is_auth_error = err.contains("401")
            || err.contains("403")
            || err.contains("login")
            || err.contains("non-json");
        if is_auth_error {
            let _ = app.emit("ripper:session_expired", ());
        }
        return Err(format!("Ripper search error: {}", err));
    }

    let data_str = parsed["data"].as_str().unwrap_or("{}");
    ripper_webview::parse_search_response(data_str)
}

/// Navega una categoría de RipperStore inyectando JS en el WebView autenticado.
#[tauri::command]
pub async fn ripper_browse_category(
    app: AppHandle,
    state: State<'_, RipperState>,
    cid: u32,
    page: u32,
) -> Result<(), String> {
    use crate::services::ripper_webview::build_category_browse_js;

    let label = {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = match label {
        Some(l) => l,
        None => return Err("Not authenticated with Ripper.store".to_string()),
    };
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "Ripper WebView window not found".to_string())?;

    let js = build_category_browse_js(cid, page);
    win.eval(&js).map_err(|e| e.to_string())
}

/// Resuelve un link de `/hidelinks/r/<token>` de Riperstore a través de una
/// ventana WebView oculta que ya tiene las cookies de sesión del foro.
#[tauri::command]
pub async fn ripper_resolve_hidelink(app: AppHandle, url: String) -> Result<String, String> {
    if !url.contains("/hidelinks/") {
        return Err("Not a hidelinks URL".to_string());
    }

    let parsed_url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
    let label = format!("hl-{}", uuid::Uuid::new_v4().to_string().replace('-', ""));

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_nav = tx.clone();

    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title("Resolving download link…")
        .inner_size(400.0, 300.0)
        .visible(false)
        .resizable(false)
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            let is_ripper = url_str.contains("ripper.store");
            let is_cf = url_str.contains("cloudflare.com") || url_str.contains("challenges.");
            let is_blank = url_str == "about:blank";
            if !is_ripper && !is_cf && !is_blank {
                if let Some(sender) = tx_nav.lock().unwrap().take() {
                    let _ = sender.send(url_str);
                }
                false
            } else {
                true
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    let win_close = win.clone();
    let result = match tokio::time::timeout(Duration::from_secs(15), rx).await {
        Ok(Ok(resolved)) => Ok(resolved),
        _ => Err("Timeout: could not resolve hidelink in 15s".to_string()),
    };
    let _ = win_close.close();
    result
}

/// Abre (o muestra) la ventana WebView de Booth para que el usuario haga login.
#[tauri::command]
pub async fn booth_open_auth(app: AppHandle, state: State<'_, BoothState>) -> Result<(), String> {
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }

    let auth_flag = state.authenticated.clone();

    {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        if let Some(ref label) = *guard {
            if let Some(win) = app.get_webview_window(label) {
                win.show().map_err(|e| e.to_string())?;
                win.set_focus().map_err(|e| e.to_string())?;

                let app_listener = app.clone();
                let label_listener = label.clone();
                let auth_flag_rc = auth_flag.clone();
                let listener_id = app.listen("booth:session-check", move |event| {
                    let payload: serde_json::Value =
                        serde_json::from_str(event.payload()).unwrap_or_default();
                    let logged_in = payload["loggedIn"].as_bool().unwrap_or(false);
                    if logged_in {
                        auth_flag_rc.store(true, std::sync::atomic::Ordering::SeqCst);
                        if let Some(w) = app_listener.get_webview_window(&label_listener) {
                            let _ = w.hide();
                        }
                        let _ = app_listener.emit("booth:auth_success", ());
                    }
                });
                if let Ok(mut sl) = state.session_listener.lock() {
                    *sl = Some(listener_id);
                }

                let app_check = app.clone();
                let label_check = label.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    if let Some(w) = app_check.get_webview_window(&label_check) {
                        let _ = w.eval(booth_webview::build_session_check_js());
                    }
                });

                return Ok(());
            }
        }
    }

    let label = booth_webview::WEBVIEW_LABEL.to_string();
    let label_for_nav = label.clone();
    let app_clone = app.clone();
    let state_label = label.clone();

    let has_seen_auth_page = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let has_seen_auth_page_clone = has_seen_auth_page.clone();
    let auth_flag_nav = auth_flag.clone();

    let win = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(booth_webview::BOOTH_ORIGIN.parse().unwrap()),
    )
    .title("Connect Booth.pm")
    .inner_size(800.0, 600.0)
    .resizable(true)
    .visible(true)
    .on_navigation(move |url: &tauri::Url| {
        let url_str = url.as_str();
        let on_auth_page = url_str.contains("accounts.booth.pm/sign_in")
            || url_str.contains("accounts.booth.pm/sign_up")
            || url_str.contains("accounts.booth.pm/users/sign_in")
            || url_str.contains("accounts.booth.pm/users/sign_up");
        if on_auth_page {
            has_seen_auth_page_clone.store(true, std::sync::atomic::Ordering::Relaxed);
        } else if has_seen_auth_page_clone.load(std::sync::atomic::Ordering::Relaxed)
            && booth_webview::is_logged_in_url(url_str)
        {
            auth_flag_nav.store(true, std::sync::atomic::Ordering::SeqCst);
            if let Some(w) = app_clone.get_webview_window(&state_label) {
                let _ = w.hide();
            }
            let _ = app_clone.emit("booth:auth_success", ());
        }
        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    let win_hide = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win_hide.hide();
        }
    });

    {
        let app_listener = app.clone();
        let label_listener = label.clone();
        let auth_flag_sc = auth_flag.clone();
        let listener_id = app.listen("booth:session-check", move |event| {
            let payload: serde_json::Value =
                serde_json::from_str(event.payload()).unwrap_or_default();
            let logged_in = payload["loggedIn"].as_bool().unwrap_or(false);
            if logged_in {
                auth_flag_sc.store(true, std::sync::atomic::Ordering::SeqCst);
                if let Some(w) = app_listener.get_webview_window(&label_listener) {
                    let _ = w.hide();
                }
                let _ = app_listener.emit("booth:auth_success", ());
            }
        });
        if let Ok(mut guard) = state.session_listener.lock() {
            *guard = Some(listener_id);
        }
    }

    {
        let app_poll = app.clone();
        let label_poll = label.clone();
        let auth_flag_poll = auth_flag.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            for _ in 0..100 {
                if auth_flag_poll.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                match app_poll.get_webview_window(&label_poll) {
                    None => break,
                    Some(w) => {
                        let _ = w.eval(booth_webview::build_session_check_js());
                    }
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        });
    }

    let mut guard = state.webview_label.lock().map_err(|e| e.to_string())?;
    *guard = Some(label);
    Ok(())
}

/// Cierra sesión de Booth: destruye la WebviewWindow, limpia el estado y deregistra el listener.
#[tauri::command]
pub fn booth_logout(app: AppHandle, state: State<'_, BoothState>) -> Result<(), String> {
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }
    let mut guard = state.webview_label.lock().map_err(|e| e.to_string())?;
    if let Some(ref label) = *guard {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.destroy();
        }
    }
    *guard = None;
    state
        .authenticated
        .store(false, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut ids) = state.purchased_ids.lock() {
        ids.clear();
    }
    let _ = app.emit("booth:logged_out", ());
    Ok(())
}

/// Devuelve true si hay una WebviewWindow de Booth activa.
#[tauri::command]
pub fn booth_is_authenticated(app: AppHandle, state: State<'_, BoothState>) -> bool {
    let authenticated = state
        .authenticated
        .load(std::sync::atomic::Ordering::SeqCst);
    if authenticated {
        let mut guard = state
            .webview_label
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(ref label) = *guard {
            if app.get_webview_window(label).is_none() {
                *guard = None;
                state
                    .authenticated
                    .store(false, std::sync::atomic::Ordering::SeqCst);
                return false;
            }
        }
    }
    authenticated
}

/// Devuelve los IDs de items ya cargados como comprados (sin hacer fetch).
#[tauri::command]
pub fn booth_get_owned_ids(state: State<'_, BoothState>) -> Vec<String> {
    state
        .purchased_ids
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .cloned()
        .collect()
}

/// Fetch paginado de accounts.booth.pm/orders + accounts.booth.pm/library navegando el WebView.
#[tauri::command]
pub async fn booth_fetch_purchases(
    app: AppHandle,
    state: State<'_, BoothState>,
) -> Result<Vec<String>, String> {
    ensure_booth_authenticated(&app, &state).await?;

    let label = {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = label.ok_or_else(|| "No Booth WebView label".to_string())?;

    let sections = [
        ("orders", "https://accounts.booth.pm/orders"),
        ("library", "https://accounts.booth.pm/library"),
        ("gifts", "https://accounts.booth.pm/library?type=free"),
    ];

    let mut all_ids = std::collections::HashSet::new();
    let mut session_retried = false; // solo un retry de sesión por llamada

    'sections: for (section_name, base_url) in &sections {
        eprintln!("[booth_fetch] Iniciando scrape de /{}", section_name);
        for page in 1u32..=30 {
            let win = app
                .get_webview_window(&label)
                .ok_or_else(|| format!("WebView '{}' not found", label))?;
            let page_url = tauri::Url::parse(&format!("{}?page={}", base_url, page))
                .map_err(|e| format!("{}", e))?;
            // Para library?type=free ya tiene '?' — usar '&' para page
            let page_url = if base_url.contains('?') {
                tauri::Url::parse(&format!("{}&page={}", base_url, page))
                    .map_err(|e| format!("{}", e))?
            } else {
                tauri::Url::parse(&format!("{}?page={}", base_url, page))
                    .map_err(|e| format!("{}", e))?
            };
            win.navigate(page_url).map_err(|e| format!("{}", e))?;
            tokio::time::sleep(Duration::from_secs(2)).await;

            let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
            let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
            let tx_clone = tx.clone();

            let listener_id = app.listen("booth:purchases-page", move |event| {
                if let Some(sender) = tx_clone.lock().unwrap().take() {
                    let _ = sender.send(Ok(event.payload().to_string()));
                }
            });

            let js = booth_webview::build_fetch_purchases_js(page);
            win.eval(&js).map_err(|e| {
                app.unlisten(listener_id);
                e.to_string()
            })?;

            let raw = match tokio::time::timeout(Duration::from_secs(12), rx).await {
                Ok(Ok(Ok(p))) => p,
                Ok(Ok(Err(e))) => {
                    eprintln!("[booth_fetch] /{} p{} — error de canal: {}", section_name, page, e);
                    app.unlisten(listener_id);
                    break;
                }
                _ => {
                    eprintln!("[booth_fetch] /{} p{} — timeout esperando evento", section_name, page);
                    app.unlisten(listener_id);
                    break;
                }
            };
            app.unlisten(listener_id);

            let parsed: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;

            if parsed["ok"].as_bool() != Some(true) {
                let err = parsed["error"].as_str().unwrap_or("unknown");
                eprintln!("[booth_fetch] /{} p{} — error JS: {}", section_name, page, err);
                if err == "redirected_to_login" && !session_retried {
                    eprintln!("[booth_fetch] Session lost, re-authenticating...");
                    ensure_booth_authenticated(&app, &state).await?;
                    session_retried = true;
                    all_ids.clear();
                    eprintln!("[booth_fetch] Re-authenticated, restarting scrape...");
                    break 'sections; // Salir del loop de secciones — se reintentará en el bloque de abajo
                }
                break;
            }

            let ids: Vec<String> = parsed["ids"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let has_more = parsed["has_more"].as_bool().unwrap_or(false);
            eprintln!("[booth_fetch] /{} p{} — {} IDs nuevos, has_more={}", section_name, page, ids.len(), has_more);
            all_ids.extend(ids);
            if !has_more { break; }
        }
    }

    // Si hubo retry de sesión, volver a scrapear una vez más
    if session_retried {
        eprintln!("[booth_fetch] Retrying full scrape after re-authentication...");
        for (section_name, base_url) in &sections {
            eprintln!("[booth_fetch] Retry scrape de /{}", section_name);
            for page in 1u32..=30 {
                let win = app
                    .get_webview_window(&label)
                    .ok_or_else(|| format!("WebView '{}' not found", label))?;
                let page_url = if base_url.contains('?') {
                    tauri::Url::parse(&format!("{}&page={}", base_url, page))
                        .map_err(|e| format!("{}", e))?
                } else {
                    tauri::Url::parse(&format!("{}?page={}", base_url, page))
                        .map_err(|e| format!("{}", e))?
                };
                win.navigate(page_url).map_err(|e| format!("{}", e))?;
                tokio::time::sleep(Duration::from_secs(2)).await;

                let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
                let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
                let tx_clone = tx.clone();
                let listener_id = app.listen("booth:purchases-page", move |event| {
                    if let Some(sender) = tx_clone.lock().unwrap().take() {
                        let _ = sender.send(Ok(event.payload().to_string()));
                    }
                });

                let js = booth_webview::build_fetch_purchases_js(page);
                win.eval(&js).map_err(|e| { app.unlisten(listener_id); e.to_string() })?;

                let raw = match tokio::time::timeout(Duration::from_secs(12), rx).await {
                    Ok(Ok(Ok(p))) => p,
                    _ => { app.unlisten(listener_id); break; }
                };
                app.unlisten(listener_id);

                let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
                if parsed["ok"].as_bool() != Some(true) { break; }

                let ids: Vec<String> = parsed["ids"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                let has_more = parsed["has_more"].as_bool().unwrap_or(false);
                all_ids.extend(ids);
                if !has_more { break; }
            }
        }
    }

    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.navigate("https://booth.pm/en".parse().unwrap());
    }

    let all_ids_vec: Vec<String> = all_ids.into_iter().collect();
    eprintln!("[booth_fetch] Total IDs únicos: {}", all_ids_vec.len());

    if let Ok(mut ids_set) = state.purchased_ids.lock() {
        ids_set.clear();
        ids_set.extend(all_ids_vec.iter().cloned());
    }

    let _ = app.emit("booth:purchases_loaded", serde_json::json!({ "count": all_ids_vec.len() }));
    Ok(all_ids_vec)
}

#[tauri::command]
pub fn booth_check_session(app: AppHandle, state: State<'_, BoothState>) -> Result<bool, String> {
    let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
    let label = guard
        .as_ref()
        .ok_or_else(|| "No Booth WebView label".to_string())?;
    let win = app
        .get_webview_window(label)
        .ok_or_else(|| "WebView not found".to_string())?;

    let (tx, rx) = std::sync::mpsc::channel();
    let listener_id = app.listen("booth:session-check-result", move |event| {
        let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap_or_default();
        let logged_in = payload["loggedIn"].as_bool().unwrap_or(false);
        let _ = tx.send(logged_in);
    });

    win.eval(booth_webview::build_session_check_js())
        .map_err(|e| format!("eval error: {}", e))?;

    let logged_in = match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(v) => v,
        Err(_) => return Err("Timeout checking session".to_string()),
    };

    app.unlisten(listener_id);
    Ok(logged_in)
}

async fn ensure_booth_authenticated(
    app: &AppHandle,
    booth_state: &State<'_, BoothState>,
) -> Result<(), String> {
    if booth_is_authenticated(app.clone(), booth_state.clone()) {
        return Ok(());
    }
    eprintln!("[booth] Not authenticated, opening auth window...");
    booth_open_auth(app.clone(), booth_state.clone()).await?;

    let (tx, rx) = oneshot::channel();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let listener_id = app.listen("booth:auth_success", move |_event| {
        if let Some(sender) = tx_clone.lock().unwrap().take() {
            let _ = sender.send(());
        }
    });

    let result = match tokio::time::timeout(Duration::from_secs(120), rx).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_e)) => Err("Authentication channel closed".to_string()),
        Err(_) => Err("Authentication timeout".to_string()),
    };

    app.unlisten(listener_id);
    result
}

pub fn build_search_results_extractor_js() -> String {
    r#"
(function() {
  const cards = document.querySelectorAll('li[data-product-id]');
  const items = [];
  cards.forEach(li => {
    const source_id = li.getAttribute('data-product-id');
    const name = (li.getAttribute('data-product-name') || '').trim();
    if (!source_id || !name) return;
    const author = li.getAttribute('data-product-brand') || '';
    const price = li.getAttribute('data-product-price') || '0';
    const price_display = price === '0' ? 'Free' : '¥' + price;
    const thumbEl = li.querySelector('a.js-thumbnail-image[data-original]');
    const thumbnail_url = thumbEl ? thumbEl.getAttribute('data-original') : '';
    items.push({
      source_id,
      name,
      author,
      thumbnail_url: thumbnail_url || '',
      price_display,
      url: 'https://booth.pm/en/items/' + source_id,
      source: 'booth'
    });
  });
  window.__booth_result__ = JSON.stringify({ items });
})();
"#
    .to_string()
}

/// Searches Booth via the authenticated WebView window.
#[tauri::command]
pub async fn booth_search_authenticated(
    app: AppHandle,
    query: String,
    page: u32,
) -> Result<Vec<ShopProduct>, String> {
    use crate::services::booth;
    use std::time::Duration;
    use tauri::WebviewWindowBuilder;
    use tokio::time::timeout;

    let encoded = urlencoding::encode(&query);
    let search_url = format!(
        "https://booth.pm/en/search/{}?page={}&sort=new_arrival",
        encoded, page
    );

    let label = format!(
        "booth-search-{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")
    );
    let parsed_url = tauri::Url::parse(&search_url).map_err(|e| format!("Invalid URL: {}", e))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title("")
        .inner_size(1.0, 1.0)
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .always_on_top(false)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.hide();

    let win_clone = win.clone();
    let tx_clone = tx.clone();
    let label_for_spawn = label.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let extractor = build_search_results_extractor_js();
        let _ = win_clone.eval(&extractor);
        tokio::time::sleep(Duration::from_millis(800)).await;
        let emit_js = format!(
            r#"(function() {{
            const r = window.__booth_result__;
            if (r) {{
                window.__TAURI__.event.emit('booth-search:{}', r);
            }} else {{
                window.__TAURI__.event.emit('booth-search:{}', 'null');
            }}
        }})();"#,
            label_for_spawn, label_for_spawn
        );
        let _ = win_clone.eval(&emit_js);
    });

    let listen_handle = app.listen(format!("booth-search:{}", &label), move |ev| {
        if let Some(tx) = tx.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(ev.payload().to_string());
        }
    });

    tokio::time::sleep(Duration::from_secs(4)).await;
    let result = match timeout(Duration::from_secs(8), rx).await {
        Ok(Ok(payload)) => payload,
        _ => "null".to_string(),
    };

    let _ = win.close();
    app.unlisten(listen_handle);

    if result == "null" || result.is_empty() {
        let client = build_client(None).map_err(|e| e)?;
        let booth_results = booth::search(&client, &query, page)
            .await
            .unwrap_or_default();
        return Ok(booth_results
            .into_iter()
            .map(|p| ShopProduct {
                source_id: p.source_id,
                name: p.name,
                author: p.author,
                thumbnail_url: p.thumbnail_url,
                price_display: p.price_display,
                url: p.url,
                source: p.source,
            })
            .collect());
    }

    let cleaned = result
        .trim()
        .trim_matches('"')
        .replace("\\\"", "\"")
        .replace("\\\\", "\\");
    #[derive(serde::Deserialize)]
    struct SearchPayload {
        items: Vec<ShopProduct>,
    }
    let parsed: SearchPayload = serde_json::from_str(&cleaned)
        .or_else(|_| serde_json::from_str(&result))
        .unwrap_or(SearchPayload { items: vec![] });
    Ok(parsed.items)
}