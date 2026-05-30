// src-tauri/src/commands/shop.rs
// Migrado a rusqlite + DbPool. Las únicas modificaciones respecto al original son:
// - Reemplazo de DbPool por DbPool
// - Uso de conn.execute() en lugar de sqlx::query()
// - Añadido use rusqlite::{params, OptionalExtension}
// - Las funciones que no tocan DB (WebView, scraping) quedan idénticas.

use crate::db::DbPool;
use crate::error::AppError;
use crate::services::{auth_store, booth, downloader};
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
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoothDownloadable {
    pub id: String,
    pub name: String,
    pub size_label: String,
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

    // Capture navigation events to detect when Booth redirects to the CDN file URL.
    // booth.pm/downloadables/XXXX does an HTTP redirect to the actual file on S3/CDN.
    // We can't follow that redirect from JS (CORS), so we do it here via on_navigation.
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed_url.clone()))
        .title("")
        .inner_size(1.0, 1.0)
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .always_on_top(false)
        .transparent(true)
        .on_navigation(move |url: &tauri::Url| {
            let url_str = url.as_str().to_string();
            // Capture the redirect to CDN (S3, Cloudfront, or any non-booth.pm URL)
            let is_cdn = !url_str.contains("booth.pm") && !url_str.contains("accounts.booth.pm");
            if is_cdn {
                if let Some(sender) = tx_nav.lock().ok().and_then(|mut g| g.take()) {
                    let _ = sender.send(url_str);
                }
                return false; // stop navigation — we have the URL
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    let _ = win.hide();

    let result = match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(url)) => Ok(url),
        Ok(Err(_)) => Err("Channel closed".to_string()),
        Err(_) => Err("Timeout resolving download URL via WebView navigation".to_string()),
    };
    let _ = win.close();
    result
}

pub fn booth_products_to_shop(booth_res: Vec<booth::BoothProduct>) -> Vec<ShopProduct> {
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
        .collect()
}

fn build_client(session_token: Option<String>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert("Accept-Language", "en-US,en;q=0.9".parse().unwrap());
            // If a session token is provided, inject it as the Booth authentication cookie.
            if let Some(ref token) = session_token {
                let cookie_header = format!("_plaza_session_nktz7u={}", token);
                if let Ok(val) = cookie_header.parse() {
                    headers.insert(reqwest::header::COOKIE, val);
                }
            }
            headers
        });
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

/// Búsqueda en Booth.
#[tauri::command]
pub async fn search_shop(query: String, page: u32) -> Result<Vec<ShopProduct>, String> {
    // Retrieve the Booth session cookie from the keyring (if any)
    let booth_token = crate::services::auth_store::get_token("booth").unwrap_or(None);

    // Build an HTTP client that includes the Booth session cookie
    let client = build_client(booth_token.clone()).map_err(|e| e)?;

    let authenticated = booth_token.is_some();
    let booth_results = booth::search(&client, &query, page, authenticated)
        .await
        .map_err(|e| e.to_string())?;

    Ok(booth_products_to_shop(booth_results))
}

/// Obtiene la URL final de descarga de un item de Booth mediante navegación WebView.
///
/// Estrategia sin CORS:
///   1. Abre un WebView oculto directamente en la página del item (booth.pm/en/items/ID).
///      El WebView hereda las cookies de sesión del perfil de la app.
///   2. Espera a que cargue la página.
///   3. Inyecta JS para encontrar el enlace /downloadables/XXXX y navegar a él.
///   4. on_navigation captura la URL final CDN (S3/Cloudfront) cuando Booth redirige.
///
/// Esta aproximación evita todos los problemas de CORS ya que no usa fetch()
/// cross-origin — solo navegación nativa del WebView.
async fn booth_get_download_url_via_webview(
    app: &AppHandle,
    _booth_state: &State<'_, BoothState>,
    source_id: &str,
) -> Result<String, String> {
    let log = |msg: &str| {
        eprintln!("[booth_dl] {}", msg);
        let _ = app.emit("booth:download-debug", serde_json::json!({ "msg": msg }));
    };

    log(&format!("Iniciando descarga WebView para item {}", source_id));

    let label = format!(
        "booth-item-{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")
    );

    // Abre directamente en la página del item (con age_confirmation por si acaso)
    let item_url_str = format!(
        "https://booth.pm/en/items/{}?age_confirmation=1",
        source_id
    );
    let item_url = Url::parse(&item_url_str).map_err(|e| format!("URL parse: {}", e))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_nav = tx.clone();

    // on_navigation captura la redirección final al CDN (URL que no sea booth.pm)
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(item_url))
        .title("")
        .inner_size(1.0, 1.0)
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .always_on_top(false)
        .transparent(true)
        .on_navigation(move |url: &tauri::Url| {
            let url_str = url.as_str().to_string();
            // La URL CDN de Booth no es booth.pm ni accounts.booth.pm
            let is_cdn = !url_str.contains("booth.pm");
            if is_cdn {
                log::info!("[booth_dl] CDN redirect detected: {}", &url_str[..url_str.len().min(80)]);
                if let Some(sender) = tx_nav.lock().ok().and_then(|mut g| g.take()) {
                    let _ = sender.send(url_str);
                }
                return false; // detener navegación — ya tenemos la URL
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    let _ = win.hide();

    // Esperar a que la página del item cargue completamente
    tokio::time::sleep(Duration::from_secs(4)).await;

    // También escuchar si el JS reporta que no encontró link de descarga
    let (err_tx, err_rx) = tokio::sync::oneshot::channel::<String>();
    let err_tx = std::sync::Arc::new(std::sync::Mutex::new(Some(err_tx)));
    let err_tx_clone = err_tx.clone();
    let not_found_listener = app.listen("booth:dl-not-found", move |event| {
        let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap_or_default();
        let msg = payload["error"].as_str().unwrap_or("No download link found").to_string();
        if let Some(sender) = err_tx_clone.lock().ok().and_then(|mut g| g.take()) {
            let _ = sender.send(msg);
        }
    });

    // Inyectar JS para encontrar el link /downloadables/ y navegar a él
    let find_and_navigate_js = booth_webview::build_navigate_to_downloadables_js(source_id);
    if let Err(e) = win.eval(&find_and_navigate_js) {
        app.unlisten(not_found_listener);
        let _ = win.close();
        return Err(format!("JS eval error: {}", e));
    }

    // Esperar la navegación al CDN (capturada por on_navigation) con timeout
    // O un error del JS si no se encontró link
    let result = tokio::select! {
        cdn = tokio::time::timeout(Duration::from_secs(30), rx) => {
            match cdn {
                Ok(Ok(cdn_url)) => {
                    log(&format!("URL CDN obtenida: {}", &cdn_url[..cdn_url.len().min(80)]));
                    Ok(cdn_url)
                }
                Ok(Err(_)) => Err("Channel closed before CDN redirect".to_string()),
                Err(_) => Err(
                    "Timeout: el item puede no estar comprado o Booth cambió su layout.".to_string()
                ),
            }
        }
        err = tokio::time::timeout(Duration::from_secs(15), err_rx) => {
            match err {
                Ok(Ok(msg)) if !msg.is_empty() => Err(msg),
                Ok(Ok(_)) => Err("Download link not found (empty error)".to_string()),
                Ok(Err(_)) => {
                    // Channel closed cleanly (sender dropped without sending) — not an error.
                    Err("Timeout waiting for download link".to_string())
                }
                Err(_) => Err("Timeout waiting for download link".to_string()),
            }
        }
    };

    app.unlisten(not_found_listener);
    let _ = win.close();
    result
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
    ["booth", "github"]
        .iter()
        .filter(|p| auth_store::get_token(p).unwrap_or(None).is_some())
        .map(|p| p.to_string())
        .collect()
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

use crate::services::booth_webview;
use crate::{BoothState};
use tauri::Listener;

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
        .join("direct")
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
        params![item_id, name, author, "direct", source_id, local_path, thumbnail_url, now, size_bytes],
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
// Add this import at the top of the file if not already present:
// use crate::services::auth_store;

pub fn booth_is_authenticated(app: AppHandle, state: State<'_, BoothState>) -> bool {
    let authenticated = state
        .authenticated
        .load(std::sync::atomic::Ordering::SeqCst);

    if authenticated {
        // Verify that the WebView is still alive
        let mut guard = state.webview_label.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref label) = *guard {
            if app.get_webview_window(label).is_none() {
                *guard = None;
                state.authenticated.store(false, std::sync::atomic::Ordering::SeqCst);
                // Even if the WebView died, a keyring cookie may still exist
            }
        }
        // Re‑read the flag in case it was cleared above
        let still_authenticated = state.authenticated.load(std::sync::atomic::Ordering::SeqCst);
        if still_authenticated {
            return true;
        }
    }

    // Fallback: if a session cookie exists in the keyring, the session survives restarts
    let has_persisted_session = auth_store::get_token("booth")
        .unwrap_or(None)
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);

    if has_persisted_session {
        // Restore the memory flag for subsequent requests in this session
        state.authenticated.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    has_persisted_session
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
    // ── GUARD: si no hay sesión activa (ni WebView ni cookie en keyring), fallar temprano
    if !booth_is_authenticated(app.clone(), state.clone()) {
        return Err("Booth session not active. Please reconnect your account.".to_string());
    }

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
                    break 'sections;
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

/// Lists all downloadable files for a Booth item.
/// Uses the authenticated Booth WebView to fetch the item page and extract all /downloadables/ links.
#[tauri::command]
pub async fn booth_list_downloadables(
    app: AppHandle,
    booth_state: State<'_, BoothState>,
    source_id: String,
) -> Result<Vec<BoothDownloadable>, String> {
    use crate::services::booth_webview;
    use std::time::Duration;

    ensure_booth_authenticated(&app, &booth_state).await?;

    // Get the label of the existing Booth auth WebView
    let label = {
        let guard = booth_state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let win = label
        .as_deref()
        .and_then(|lbl| app.get_webview_window(lbl))
        .ok_or_else(|| "Booth WebView not available — please re-authenticate".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<BoothDownloadable>, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let listener = app.listen("booth:downloadables-list", move |event| {
        let payload: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or_default();
        if let Some(sender) = tx_clone.lock().ok().and_then(|mut g| g.take()) {
            if payload["ok"].as_bool().unwrap_or(false) {
                let items: Vec<BoothDownloadable> = payload["items"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect();
                let _ = sender.send(Ok(items));
            } else {
                let err = payload["error"].as_str().unwrap_or("Unknown error").to_string();
                let _ = sender.send(Err(err));
            }
        }
    });

    let js = booth_webview::build_list_downloadables_js(&source_id);
    if let Err(e) = win.eval(&js) {
        app.unlisten(listener);
        return Err(format!("JS eval error: {e}"));
    }

    let result = match tokio::time::timeout(Duration::from_secs(20), rx).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("Channel closed".to_string()),
        Err(_) => Err("Timeout listing downloadables".to_string()),
    };

    app.unlisten(listener);
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
        let booth_results = booth::search(&client, &query, page, false)
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