use crate::error::AppError;
use crate::services::{auth_store, booth, downloader, riperstore};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State, Emitter};
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
    if let Some(_token) = session_token {
        // Booth usa cookies — se pueden añadir via cookie_provider en implementaciones avanzadas
        // Por ahora el cookie_store manejará las sesiones persistentes
    }

    builder.build().map_err(|e| e.to_string())
}

// ── Commands ───────────────────────────────────────────────────────────────────

/// Búsqueda en Booth. Riperstore se busca por separado via `ripper_search_via_webview`.
#[tauri::command]
pub async fn search_shop(query: String, page: u32) -> Result<Vec<ShopProduct>, String> {
    let booth_token = auth_store::get_token("booth").unwrap_or(None);
    let client = build_client(booth_token)?;

    let booth_results = booth::search(&client, &query, page)
        .await
        .map_err(|e| e.to_string())?;

    Ok(merge_results(booth_results, vec![]))
}

/// Obtiene la URL real de descarga de un item de Booth inyectando JS en el WebView
/// autenticado.
///
/// v3: en lugar de navegar el WebView al item (lo que provoca `DOM load timeout`
/// porque booth.pm nunca alcanza `readyState === 'complete'` en contexto headless),
/// inyectamos JS que hace `fetch()` al item page desde dentro del WebView.
/// Al estar el WebView ya en booth.pm, las cookies de sesión se envían automáticamente
/// con `credentials: 'include'`. Parseamos el HTML de respuesta para extraer
/// el link `/downloadables/ID`. No se produce ninguna navegación visible.
async fn booth_get_download_url_via_webview(
    app: &AppHandle,
    booth_state: &BoothState,
    source_id: &str,
) -> Result<String, String> {
    let log = |msg: &str| {
        eprintln!("[booth_dl] {}", msg);
        let _ = app.emit("booth:download-debug", serde_json::json!({ "msg": msg }));
    };

    log(&format!("Iniciando descarga para item {}", source_id));

    let label = {
        let guard = booth_state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = label.ok_or_else(|| {
        let e = "Not authenticated with Booth.pm".to_string();
        log(&format!("ERROR: {}", e));
        e
    })?;

    log(&format!("Usando webview label: {}", label));

    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| {
            let e = "Booth WebView window not found — please reconnect your account".to_string();
            log(&format!("ERROR: {}", e));
            e
        })?;

    let source_id_owned = source_id.to_string();

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_event = tx.clone();
    let listener_id = app.listen("booth:download-url", move |event: tauri::Event| {
        if let Some(sender) = tx_event.lock().unwrap().take() {
            let _ = sender.send(Ok(event.payload().to_string()));
        }
    });

    // Inyectar JS que hace fetch() al item page usando las cookies del WebView.
    // El WebView puede estar en cualquier página de booth.pm — no importa.
    let js = booth_webview::build_get_download_url_js(&source_id_owned);
    win.eval(&js).map_err(|e| {
        app.unlisten(listener_id);
        format!("WebView eval error: {}", e)
    })?;
    log("JS de fetch inyectado, esperando evento booth:download-url...");

    // Timeout generoso para el fetch HTTP + resolución CDN
    let raw = match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(e))) => { app.unlisten(listener_id); return Err(format!("Channel error: {}", e)); }
        Ok(Err(_)) => { app.unlisten(listener_id); return Err("Channel closed unexpectedly".to_string()); }
        Err(_) => { app.unlisten(listener_id); return Err("Booth download URL fetch timed out (30s)".to_string()); }
    };
    app.unlisten(listener_id);
    log(&format!("Respuesta del JS: {}", &raw[..raw.len().min(200)]));

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;

    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown error");
        return Err(err.to_string());
    }

    parsed["url"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Empty download URL in response".to_string())
}

/// Inicia la descarga de un producto y lo registra en el Inventory.
/// Emite eventos `download://progress` durante el proceso.
/// Retorna el ID del nuevo InventoryItem creado.
#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    booth_state: State<'_, BoothState>,
    source: String,
    source_id: String,
    name: String,
    author: String,
    thumbnail_url: String,
) -> Result<String, AppError> {
    let client = build_client(auth_store::get_token(&source).unwrap_or(None))
        .map_err(AppError::External)?;

    // Obtener URL real de descarga.
    // Para Booth usamos el WebView autenticado (que tiene las cookies de sesión)
    // en lugar de reqwest. Sin cookies, Booth no devuelve los enlaces /downloadables/
    // aunque el item esté comprado → error "Download URL not found".
    let download_url = match source.as_str() {
        "booth" => booth_get_download_url_via_webview(&app, &booth_state, &source_id)
            .await
            .map_err(AppError::External)?,
        "riperstore" => riperstore::get_download_url(&client, &source_id)
            .await
            .map_err(AppError::External)?,
        other => return Err(AppError::External(format!("Unknown source: {}", other))),
    };

    // Directorio de caché por item
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::External(e.to_string()))?
        .join("downloads")
        .join(&source)
        .join(&source_id);

    // Descargar
    let downloaded_path =
        downloader::download_file(&app, &client, &source_id, &download_url, &cache_dir)
            .await
            .map_err(AppError::External)?;

    // Extraer si es ZIP
    let final_path =
        downloader::maybe_extract_zip(&app, &source_id, &downloaded_path, &cache_dir)
            .await
            .map_err(AppError::External)?;

    // Registrar en inventory_items
    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let local_path = final_path.to_string_lossy().to_string();
    let size_bytes: i64 = std::fs::metadata(&final_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    sqlx::query(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')",
    )
    .bind(&item_id)
    .bind(&name)
    .bind(&author)
    .bind(&source)
    .bind(&source_id)
    .bind(&local_path)
    .bind(&thumbnail_url)
    .bind(&now)
    .bind(size_bytes)
    .execute(&*pool)
    .await?;

    // Emitir evento "done"
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
// ── Ripper.store WebView commands ─────────────────────────────────────────────

use crate::services::ripper_webview;
use crate::services::booth_webview;
use crate::{BoothState, RipperState};
use std::time::Duration;
use tauri::{Listener, WebviewUrl, WebviewWindowBuilder};

/// Abre una ventana WebView en forum.ripper.store para que el usuario resuelva
/// el CF challenge y haga login.
///
/// Flujo de detección de auth:
/// 1. Se registra un listener PERSISTENTE para `ripper:current-url`.
/// 2. `on_navigation` — cuando detecta una URL válida (no /login, no CF), lanza
///    un task que espera 1.5s (a que la página cargue) y evalúa
///    `build_session_check_js()` en el WebView.
/// 3. El JS verifica `window.config.uid > 0` (login real en NodeBB, no solo CF)
///    y emite `ripper:current-url` con `{ url, loggedIn }`.
/// 4. El listener recibe el evento: si `loggedIn=true` → oculta ventana y emite
///    `ripper:auth_success`.
///
/// Para el path de "ventana ya existe" (reconnect): se reutiliza la ventana
/// y se lanza el mismo session check JS de forma inmediata.
#[tauri::command]
pub async fn open_ripper_auth(
    app: AppHandle,
    state: State<'_, RipperState>,
) -> Result<(), String> {
    // 1. Deregistrar listener previo (evita duplicados entre reconnects)
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }

    // 2. Registrar listener PERSISTENTE para ripper:current-url.
    //    Usa WEBVIEW_LABEL constante (siempre "ripper-auth") para no necesitar
    //    capturar el label por closure antes de crear la ventana.
    let app_auth = app.clone();
    let listener_id = app.listen("ripper:current-url", move |event| {
        let payload: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or_default();
        let logged_in = payload["loggedIn"].as_bool().unwrap_or(false);
        let url = payload["url"].as_str().unwrap_or("");

        if logged_in && ripper_webview::is_logged_in_url(url) {
            // Ocultar la ventana (puede estar visible si el usuario fue redirigido)
            if let Some(win) = app_auth.get_webview_window(ripper_webview::WEBVIEW_LABEL) {
                let _ = win.hide();
            }
            let _ = app_auth.emit("ripper:auth_success", ());
        }
        // Si loggedIn=false, no hacemos nada — el usuario todavía está en la pantalla
        // de login o CF challenge; el próximo check lo detectará.
    });

    // Guardar el ID del listener
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        *guard = Some(listener_id);
    }

    // 3. Si la ventana ya existe (reconnect): mostrarla y lanzar session check
    {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        if let Some(ref label) = *guard {
            if let Some(win) = app.get_webview_window(label) {
                win.show().map_err(|e| e.to_string())?;
                win.set_focus().map_err(|e| e.to_string())?;

                // Session check inmediato (1s para que la página esté ready si
                // acaba de cargarse)
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

    // Saltar la primera navegación (es la URL de apertura — todavía cargando)
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
        // Ignorar la primera navegación (URL de apertura)
        if is_first_nav_clone.swap(false, std::sync::atomic::Ordering::Relaxed) {
            return true;
        }
        // Cuando la URL parece válida (no /login, no CF), programar session check.
        // No emitir auth_success aquí directamente: esperamos a que la página cargue
        // y window.config.uid esté disponible.
        if ripper_webview::is_logged_in_url(url.as_str()) {
            let app_spawn = app_nav.clone();
            let label_spawn = label_nav.clone();
            tokio::spawn(async move {
                // Esperar a que la página termine de cargar
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

    // Interceptar X: ocultar en lugar de destruir (conserva cookies de sesión)
    let win_hide = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win_hide.hide();
        }
    });

    // Polling de sesión: NodeBB usa login vía AJAX, así que on_navigation nunca
    // dispara tras el submit del formulario. Comprobamos cada 3s hasta que el
    // usuario se autentique (ripper:auth_success) o cierre la ventana.
    // La primera iteración espera 2s para que la página cargue.
    {
        let app_poll = app.clone();
        let label_poll = label.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            // Máximo ~5 minutos (100 ciclos x 3s) para no correr indefinidamente
            for _ in 0..100 {
                match app_poll.get_webview_window(&label_poll) {
                    None => break, // ventana destruida (logout) -> parar
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
pub fn ripper_logout(
    app: AppHandle,
    state: State<'_, RipperState>,
) -> Result<(), String> {
    // Deregistrar listener de sesión
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }
    let mut guard = state.webview_label.lock().map_err(|e| e.to_string())?;
    if let Some(ref label) = *guard {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.destroy(); // destroy() bypasses on_close_requested (which only hides)
        }
    }
    *guard = None;
    let _ = app.emit("ripper:logged_out", ());
    Ok(())
}

/// Devuelve true si hay una WebviewWindow de Ripper activa (= autenticado).
/// Comprueba que la ventana realmente existe — si fue cerrada externamente
/// sin logout, limpia el label para evitar que la próxima búsqueda haga timeout.
#[tauri::command]
pub fn ripper_is_authenticated(app: AppHandle, state: State<'_, RipperState>) -> bool {
    let mut guard = state.webview_label.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        None => false,
        Some(label) => {
            if app.get_webview_window(label).is_some() {
                true
            } else {
                *guard = None; // ventana cerrada externamente — limpiar estado
                false
            }
        }
    }
}

/// Obtiene la descripción e imágenes de un topic de Riperstore inyectando
/// fetch() en el WebView activo. Timeout de 8s.
/// Devuelve `(description, images)` — description puede ser "" si el topic
/// no tiene contenido parseable.
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

    let listener_id = app.listen("ripper:topic-detail", move |event: tauri::Event| {
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
        Ok(Ok(Err(e))) => { app.unlisten(listener_id); return Err(format!("JS error: {}", e)); }
        Ok(Err(_)) => { app.unlisten(listener_id); return Err("Channel closed".to_string()); }
        Err(_) => { app.unlisten(listener_id); return Err("Topic detail fetch timed out".to_string()); }
    };
    app.unlisten(listener_id);

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;

    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown");
        return Err(format!("Ripper fetch error: {}", err));
    }

    let description = parsed["description"].as_str().unwrap_or("").to_string();
    let images: Vec<String> = parsed["images"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let links: Vec<String> = parsed["links"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    Ok((description, images, links))
}

/// Scrape profundo de un topic de Riperstore: recorre hasta `max_pages` páginas
/// del hilo y devuelve TODOS los links externos encontrados en cualquier post,
/// cada uno enriquecido con los avatares detectados en el post que lo contenía.
///
/// A diferencia de `ripper_get_topic_detail` (que solo lee el OP),
/// este comando lee todas las replies donde suelen estar los links de descarga.
/// Timeout: 45s (el JS hace fetch() en paralelo por página).
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

    let listener_id = app.listen("ripper:scrape-deep-result", move |event: tauri::Event| {
        if let Some(sender) = tx_clone.lock().unwrap().take() {
            let _ = sender.send(Ok(event.payload().to_string()));
        }
    });

    let pages = max_pages.max(1).min(30); // clamp: 1..30
    let js = ripper_webview::build_topic_scrape_deep_js(&source_id, pages);
    win.eval(&js).map_err(|e| {
        app.unlisten(listener_id);
        e.to_string()
    })?;

    let raw = match tokio::time::timeout(Duration::from_secs(45), rx).await {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(e))) => { app.unlisten(listener_id); return Err(format!("JS error: {}", e)); }
        Ok(Err(_))       => { app.unlisten(listener_id); return Err("Channel closed".to_string()); }
        Err(_)           => { app.unlisten(listener_id); return Err("Deep scrape timed out (45s)".to_string()); }
    };
    app.unlisten(listener_id);

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;

    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown");
        return Err(format!("Scrape error: {}", err));
    }

    // El JS emite objetos {url: string, avatars: string[]} — deserializar correctamente.
    // (Bug anterior: se intentaba extraer v.as_str() de un objeto → siempre vacío)
    let links: Vec<ripper_webview::DownloadLinkContext> = parsed["links"]
        .as_array()
        .map(|arr| {
            arr.iter().filter_map(|v| {
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
            }).collect()
        })
        .unwrap_or_default();

    Ok(links)
}

/// Descarga directamente desde una URL arbitraria ya resuelta (para links de Riperstore
/// extraídos del scrape y/o tras resolver hidelinks via WebView).
///
/// Solo funciona con hosts de descarga directa (workupload, pixeldrain, gofile, catbox…).
/// Registra el archivo en el inventario y emite download://progress events.
/// Retorna el ID del nuevo InventoryItem creado.
#[tauri::command]
pub async fn download_direct_url(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
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

    // Emitir evento de inicio de descarga
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

    let downloaded_path =
        downloader::download_file(&app, &client, &source_id, &url, &cache_dir)
            .await
            .map_err(AppError::External)?;

    let final_path =
        downloader::maybe_extract_zip(&app, &source_id, &downloaded_path, &cache_dir)
            .await
            .map_err(AppError::External)?;

    // Registrar en inventory_items (INSERT OR IGNORE para no duplicar si se re-descarga)
    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let local_path = final_path.to_string_lossy().to_string();
    let size_bytes: i64 = std::fs::metadata(&final_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    sqlx::query(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')",
    )
    .bind(&item_id)
    .bind(&name)
    .bind(&author)
    .bind("riperstore")
    .bind(&source_id)
    .bind(&local_path)
    .bind(&thumbnail_url)
    .bind(&now)
    .bind(size_bytes)
    .execute(&*pool)
    .await?;

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
/// Timeout de 15s. Solo emite `ripper:session_expired` si el error indica
/// sesión inválida (HTTP 401/403 o redirect a /login).
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

    // Canal oneshot para recibir el resultado del evento JS
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let listener_id = app.listen("ripper:search-result", move |event: tauri::Event| {
        if let Some(sender) = tx_clone.lock().unwrap().take() {
            let _ = sender.send(Ok(event.payload().to_string()));
        }
    });

    let js = crate::services::ripper_webview::build_search_js(&query, page);
    win.eval(&js).map_err(|e| {
        app.unlisten(listener_id);
        format!("eval error: {}", e)
    })?;

    let raw = match tokio::time::timeout(Duration::from_secs(15), rx).await {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(e))) => { app.unlisten(listener_id); return Err(format!("JS error: {}", e)); }
        Ok(Err(_)) => { app.unlisten(listener_id); return Err("Channel closed unexpectedly".to_string()); }
        Err(_) => {
            app.unlisten(listener_id);
            let _ = app.emit("ripper:session_expired", ());
            return Err("Ripper.store search timed out — check your connection or re-authenticate".to_string());
        }
    };
    app.unlisten(listener_id);

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Event parse error: {}", e))?;

    if parsed["ok"].as_bool() != Some(true) {
        let err = parsed["error"].as_str().unwrap_or("unknown error");
        // Emitir session_expired solo para errores de autenticación reales
        let is_auth_error = err.contains("401")
            || err.contains("403")
            || err.contains("login")
            || err.contains("non-json"); // redirect a /login devuelve HTML
        if is_auth_error {
            let _ = app.emit("ripper:session_expired", ());
        }
        return Err(format!("Ripper search error: {}", err));
    }

    let data_str = parsed["data"].as_str().unwrap_or("{}");
    crate::services::ripper_webview::parse_search_response(data_str)
}

/// Navega una categoría de RipperStore inyectando JS en el WebView autenticado.
/// Emite el evento `ripper:category-result` con los topics de la página.
/// Útil para browsing directo sin pasar por el buscador de NodeBB.
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
///
/// El reto de Cloudflare (que aparece al abrir hidelinks con el navegador del
/// sistema) se evita porque el WebView comparte el mismo perfil del navegador
/// que la ventana de autenticación de Riperstore.
///
/// Retorna la URL final (p.ej. workupload.com/file/xyz) después de seguir
/// los redirects, o un error si el timeout de 15s se agota.
#[tauri::command]
pub async fn ripper_resolve_hidelink(
    app: AppHandle,
    url: String,
) -> Result<String, String> {
    // Sanity check: debe ser una URL de hidelinks
    if !url.contains("/hidelinks/") {
        return Err("Not a hidelinks URL".to_string());
    }

    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;

    // Label único para no chocar con otras ventanas
    let label = format!("hl-{}", uuid::Uuid::new_v4().to_string().replace('-', ""));

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_nav = tx.clone();

    // Creamos una ventana oculta apuntando al hidelink.
    // Como comparte el perfil del navegador (WebView2 en Windows / WKWebView en macOS),
    // las cookies de Cloudflare y del foro están presentes → sin challenge.
    // on_navigation captura el primer redirect a un host externo (workupload, mega…).
    let win = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(parsed_url),
    )
    .title("Resolving download link…")
    .inner_size(400.0, 300.0)
    .visible(false)
    .resizable(false)
    .on_navigation(move |nav_url| {
        let url_str = nav_url.to_string();
        let is_ripper  = url_str.contains("ripper.store");
        let is_cf      = url_str.contains("cloudflare.com") || url_str.contains("challenges.");
        let is_blank   = url_str == "about:blank";

        if !is_ripper && !is_cf && !is_blank {
            // Primera URL fuera de ripper.store → destino real de descarga
            if let Some(sender) = tx_nav.lock().unwrap().take() {
                let _ = sender.send(url_str);
            }
            false // cancelar navegación — ya obtuvimos lo que necesitamos
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
/// Detecta el login via cambio de URL y oculta la ventana, emitiendo `booth:auth_success`.
#[tauri::command]
pub async fn booth_open_auth(
    app: AppHandle,
    state: State<'_, BoothState>,
) -> Result<(), String> {
    // 1. Deregistrar listener previo (evita duplicados entre reconnects)
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }

    // Clonar el Arc<AtomicBool> de autenticación para usarlo en los closures
    let auth_flag = state.authenticated.clone();

    // Si ya existe la ventana: mostrarla, re-registrar el listener y lanzar session check.
    // IMPORTANTE: no hacer return aquí sin reponer el listener — fue limpiado justo arriba,
    // y sin él booth:session-check no tiene quien lo escuche → auth_success nunca se emite.
    {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        if let Some(ref label) = *guard {
            if let Some(win) = app.get_webview_window(label) {
                win.show().map_err(|e| e.to_string())?;
                win.set_focus().map_err(|e| e.to_string())?;

                // Re-registrar listener de booth:session-check
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

                // Lanzar session check con un pequeño delay para asegurar que la página
                // está lista antes de hacer el fetch. Sin delay, el check puede llegar
                // mientras booth.pm todavía está cargando y devolver un falso positivo.
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
    let app_clone = app.clone();
    let state_label = label.clone();

    // Rastreamos si el usuario pasó por la página de login de Booth.
    // Solo se considera "autenticado" si llegamos a un URL de booth.pm
    // DESPUÉS de haber visto accounts.booth.pm — evita falsos positivos
    // por las redirecciones de servidor que hace booth.pm al cargar
    // (p.ej. booth.pm → booth.pm/en), que antes ocultaban la ventana
    // inmediatamente sin que el usuario hubiera hecho login.
    let has_seen_auth_page = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let has_seen_auth_page_clone = has_seen_auth_page.clone();
    let auth_flag_nav = auth_flag.clone();

    let win = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(booth_webview::BOOTH_ORIGIN.parse().unwrap()),
    )
    .title("Connect Booth.pm")
    .inner_size(1024.0, 768.0)
    .resizable(true)
    .on_navigation(move |url: &tauri::Url| {
        let url_str = url.as_str();
        let on_auth_page = url_str.contains("accounts.booth.pm/sign_in")
            || url_str.contains("accounts.booth.pm/sign_up")
            || url_str.contains("accounts.booth.pm/users/sign_in")
            || url_str.contains("accounts.booth.pm/users/sign_up");

        if on_auth_page {
            // El usuario llegó a la página de login — marcamos que pasó por aquí.
            has_seen_auth_page_clone.store(true, std::sync::atomic::Ordering::Relaxed);
        } else if has_seen_auth_page_clone.load(std::sync::atomic::Ordering::Relaxed)
            && booth_webview::is_logged_in_url(url_str)
        {
            // Venimos del flujo de login y ya no estamos en una página de auth
            // → el usuario completó el login correctamente.
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

    // Interceptar X: ocultar en lugar de destruir (conserva la sesión)
    let win_hide = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win_hide.hide();
        }
    });

    // ── Listener persistente para booth:session-check ─────────────────────────
    // El JS de build_session_check_js() hace fetch de /account/purchases y emite
    // este evento con { loggedIn: bool }. El listener lo recibe y, si loggedIn=true,
    // oculta la ventana y emite booth:auth_success.
    // Guardamos el ID para poder deregistrarlo en booth_logout.
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

    // ── Polling de sesión ─────────────────────────────────────────────────────
    // Booth usa Pixiv OAuth, que puede completar el login en un popup o via AJAX
    // sin disparar on_navigation en el WebView principal. Por eso no podemos
    // confiar solo en on_navigation: necesitamos sondear periódicamente.
    //
    // Comprobamos cada 3s (hasta ~5 min = 100 ciclos). La primera iteración
    // espera 2s para que la página inicial cargue antes del primer check.
    {
        let app_poll = app.clone();
        let label_poll = label.clone();
        let auth_flag_poll = auth_flag.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            for _ in 0..100 {
                // Parar si el usuario ya se autenticó
                if auth_flag_poll.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                match app_poll.get_webview_window(&label_poll) {
                    None => break, // ventana destruida (logout) → parar
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
pub fn booth_logout(
    app: AppHandle,
    state: State<'_, BoothState>,
) -> Result<(), String> {
    // Deregistrar listener de sesión
    {
        let mut guard = state.session_listener.lock().map_err(|e| e.to_string())?;
        if let Some(id) = guard.take() {
            app.unlisten(id);
        }
    }
    let mut guard = state.webview_label.lock().map_err(|e| e.to_string())?;
    if let Some(ref label) = *guard {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.destroy(); // destroy() bypasa on_window_event
        }
    }
    *guard = None;
    // Resetear flag de autenticación
    state.authenticated.store(false, std::sync::atomic::Ordering::SeqCst);
    // Limpiar IDs comprados
    if let Ok(mut ids) = state.purchased_ids.lock() {
        ids.clear();
    }
    let _ = app.emit("booth:logged_out", ());
    Ok(())
}

/// Devuelve true si hay una WebviewWindow de Booth activa.
/// Si la ventana fue cerrada externamente (no por logout), limpia el estado.
#[tauri::command]
pub fn booth_is_authenticated(app: AppHandle, state: State<'_, BoothState>) -> bool {
    // Usamos el flag explícito en lugar de comprobar si el WebviewWindow existe.
    // El webview puede existir sin que la sesión haya sido verificada (falso positivo).
    let authenticated = state.authenticated.load(std::sync::atomic::Ordering::SeqCst);
    if authenticated {
        // Verificación de coherencia: si el webview fue destruido externamente, resetear.
        let mut guard = state.webview_label.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref label) = *guard {
            if app.get_webview_window(label).is_none() {
                *guard = None;
                state.authenticated.store(false, std::sync::atomic::Ordering::SeqCst);
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
///
/// Scrapea AMBAS secciones porque:
/// - /orders  → items de pago (compras)
/// - /library → TODOS los items: gratuitos + de pago + regalados
///
/// Usa el mismo JS (build_fetch_purchases_js) en ambas, que espera a que el DOM
/// esté listo antes de leer. Los IDs se deduplan con un HashSet.
#[tauri::command]
pub async fn booth_fetch_purchases(
    app: AppHandle,
    state: State<'_, BoothState>,
) -> Result<Vec<String>, String> {
    let label = {
        let guard = state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let label = match label {
        Some(l) => l,
        None => return Err("Not authenticated with Booth.pm".to_string()),
    };

    let mut all_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Scrapear /orders y /library
    let sections = [("orders", "https://accounts.booth.pm/orders"), ("library", "https://accounts.booth.pm/library")];

    for (section_name, base_url) in &sections {
        eprintln!("[booth_fetch] Iniciando scrape de /{}", section_name);

        for page in 1u32..=30 {
            // Verificar que la ventana sigue viva antes de cada navegación
            let win = match app.get_webview_window(&label) {
                Some(w) => w,
                None => {
                    eprintln!("[booth_fetch] WebView cerrado — abortando");
                    break;
                }
            };

            let page_url: tauri::Url = format!("{}?page={}", base_url, page)
                .parse()
                .map_err(|e: <tauri::Url as std::str::FromStr>::Err| e.to_string())?;

            eprintln!("[booth_fetch] Navegando a: {}", page_url);
            win.navigate(page_url).map_err(|e| e.to_string())?;

            // Esperar a que la página cargue (el JS interno espera readyState=complete,
            // pero damos un margen inicial para que empiece la navegación)
            tokio::time::sleep(Duration::from_secs(2)).await;

            // Re-obtener ventana (puede haber cambiado de estado)
            let win = match app.get_webview_window(&label) {
                Some(w) => w,
                None => break,
            };

            let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
            let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
            let tx_clone = tx.clone();

            let listener_id = app.listen("booth:purchases-page", move |event: tauri::Event| {
                if let Some(sender) = tx_clone.lock().unwrap().take() {
                    let _ = sender.send(Ok(event.payload().to_string()));
                }
            });

            let js = booth_webview::build_fetch_purchases_js(page);
            win.eval(&js).map_err(|e| {
                app.unlisten(listener_id);
                e.to_string()
            })?;

            // Timeout generoso (el JS espera hasta 8s por readyState)
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
                // Si fue redirect a login, no tiene sentido continuar con esta sección
                if err == "redirected_to_login" {
                    eprintln!("[booth_fetch] /{} — sesión no disponible en esta sección, saltando", section_name);
                }
                break;
            }

            let ids: Vec<String> = parsed["ids"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            let new_count = ids.len();
            let has_more = parsed["has_more"].as_bool().unwrap_or(false);

            eprintln!("[booth_fetch] /{} p{} — {} IDs nuevos, has_more={}", section_name, page, new_count, has_more);
            all_ids.extend(ids);

            if !has_more {
                break;
            }
        }
    }

    // Volver a booth.pm/en para dejar el WebView en su estado original
    if let Some(w) = app.get_webview_window(&label) {
        let home: tauri::Url = "https://booth.pm/en".parse().unwrap();
        let _ = w.navigate(home);
    }

    let all_ids_vec: Vec<String> = all_ids.into_iter().collect();
    eprintln!("[booth_fetch] Total IDs únicos: {}", all_ids_vec.len());

    // Guardar en estado
    if let Ok(mut ids_set) = state.purchased_ids.lock() {
        ids_set.clear();
        ids_set.extend(all_ids_vec.iter().cloned());
    }

    let _ = app.emit("booth:purchases_loaded", serde_json::json!({ "count": all_ids_vec.len() }));
    Ok(all_ids_vec)
}