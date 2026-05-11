//! Servicio de polling para el tracker de items y autores.
//! Se lanza como tarea Tokio en el arranque de la app y comprueba
//! periódicamente los items activos según su check_interval_minutes.

use crate::services::booth;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, Emitter};
use chrono::Utc;
use uuid::Uuid;
use serde_json::json;

/// Evento emitido al frontend cuando se detecta un cambio.
const EVENT_TRACKER_UPDATE: &str = "tracker:update";

/// Lanza el loop de polling en background. Llamar una vez al inicio de la app.
pub fn start_polling(app: AppHandle, db: SqlitePool) {
    tauri::async_runtime::spawn(async move {
        loop {
            // Intervalo mínimo de comprobación: 1 minuto
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            if let Err(e) = run_checks(&app, &db).await {
                eprintln!("[tracker] check error: {e}");
            }
        }
    });
}

async fn run_checks(app: &AppHandle, db: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    use sqlx::Row;
    let now = Utc::now();
    let now_str = now.to_rfc3339();

    // Cargar items activos cuyo next check ya pasó
    let rows = sqlx::query(
        "SELECT * FROM tracker_items WHERE is_active=1"
    )
    .fetch_all(db)
    .await?;

    // Cliente HTTP reutilizable para todas las llamadas a Booth
    let client = reqwest::Client::builder()
        .user_agent("VRC-Studio/1.0")
        .build()?;

    for row in &rows {
        let id: String = row.get("id");
        let kind: String = row.get("kind");
        let interval_min: i64 = row.get("check_interval_minutes");
        let last_checked: Option<String> = row.get("last_checked_at");

        // Comprobar si ya toca
        let should_check = match &last_checked {
            None => true,
            Some(ts) => {
                let last = chrono::DateTime::parse_from_rfc3339(ts)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or(Utc::now() - chrono::Duration::days(1));
                now.signed_duration_since(last).num_minutes() >= interval_min
            }
        };

        if !should_check { continue; }

        let events_created = match kind.as_str() {
            "item" => check_item(&client, &row, db).await.unwrap_or_default(),
            "author" => check_author(&client, &row, db).await.unwrap_or_default(),
            _ => 0,
        };

        // Actualizar last_checked_at
        sqlx::query("UPDATE tracker_items SET last_checked_at=? WHERE id=?")
            .bind(&now_str)
            .bind(&id)
            .execute(db)
            .await?;

        if events_created > 0 {
            // Notificar al frontend
            let _ = app.emit(EVENT_TRACKER_UPDATE, json!({ "tracker_item_id": id }));

            // Notificación de Windows via tauri-plugin-notification
            send_os_notification(app, &row);
        }
    }
    Ok(())
}

/// Comprueba precio y disponibilidad de un item de Booth.
/// Devuelve el número de eventos creados.
async fn check_item(
    client: &reqwest::Client,
    row: &sqlx::sqlite::SqliteRow,
    db: &SqlitePool,
) -> Result<u32, Box<dyn std::error::Error>> {
    use sqlx::Row;
    let tracker_id: String = row.get("id");
    let booth_id: Option<String> = row.get("booth_id");
    let track_price: i64 = row.get("track_price_drops");
    let last_price: Option<String> = row.get("last_known_price");

    let bid = match booth_id {
        Some(b) => b,
        None => return Ok(0),
    };

    let detail = booth::fetch_product_detail(client, &bid).await?;
    let mut created = 0u32;
    let now = Utc::now().to_rfc3339();

    // Comprobar cambio de precio
    if track_price != 0 {
        if let Some(ref prev_price) = last_price {
            if *prev_price != detail.price_display {
                let payload = json!({
                    "old_price": prev_price,
                    "new_price": detail.price_display,
                });
                insert_event(db, &tracker_id, "price_change", &payload.to_string(), &now).await?;
                created += 1;
            }
        }
        // Actualizar precio conocido
        sqlx::query("UPDATE tracker_items SET last_known_price=? WHERE id=?")
            .bind(&detail.price_display)
            .bind(&tracker_id)
            .execute(db)
            .await?;
    }

    Ok(created)
}

/// Comprueba si un autor tiene nuevos items en su shop de Booth.
async fn check_author(
    client: &reqwest::Client,
    row: &sqlx::sqlite::SqliteRow,
    db: &SqlitePool,
) -> Result<u32, Box<dyn std::error::Error>> {
    use sqlx::Row;
    let tracker_id: String = row.get("id");
    let shop_id: Option<String> = row.get("author_booth_shop_id");
    let author_name: Option<String> = row.get("author_name");

    let search_query = match shop_id.as_deref().or(author_name.as_deref()) {
        Some(q) => q.to_string(),
        None => return Ok(0),
    };

    let products = booth::search(client, &search_query, 1).await?;
    let now = Utc::now().to_rfc3339();
    let mut created = 0u32;

    // Comprobar si hay items nuevos (comparar booth_ids con los conocidos)
    let known_ids: Vec<String> = sqlx::query_scalar(
        "SELECT json_extract(payload,'$.booth_id') FROM tracker_events
         WHERE tracker_item_id=? AND event_type='new_item'"
    )
    .bind(&tracker_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    for product in &products {
        if !known_ids.contains(&product.source_id) {
            let payload = json!({
                "booth_id": product.source_id,
                "name": product.name,
                "price": product.price_display,
                "url": product.url,
                "thumbnail": product.thumbnail_url,
            });
            insert_event(db, &tracker_id, "new_item", &payload.to_string(), &now).await?;
            created += 1;
        }
    }
    Ok(created)
}

async fn insert_event(
    db: &SqlitePool,
    tracker_item_id: &str,
    event_type: &str,
    payload: &str,
    now: &str,
) -> Result<(), sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO tracker_events (id, tracker_item_id, event_type, payload, detected_at, is_read)
         VALUES (?,?,?,?,?,0)"
    )
    .bind(&id)
    .bind(tracker_item_id)
    .bind(event_type)
    .bind(payload)
    .bind(now)
    .execute(db)
    .await?;
    Ok(())
}

fn send_os_notification(app: &AppHandle, row: &sqlx::sqlite::SqliteRow) {
    use sqlx::Row;
    let name: Option<String> = row.get("item_name");
    let author: Option<String> = row.get("author_name");
    let label = name.or(author).unwrap_or_else(|| "Tracker item".to_string());

    // tauri-plugin-notification (Tauri 2)
    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification()
            .builder()
            .title("VRC Studio Tracker")
            .body(format!("Cambio detectado en: {}", label))
            .show();
    }
}