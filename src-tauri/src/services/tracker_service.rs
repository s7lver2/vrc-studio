//! Servicio de polling para el tracker de items y autores.
//! Se lanza como tarea Tokio en el arranque de la app y comprueba
//! periódicamente los items activos según su check_interval_minutes.

use crate::db::DbPool;
use crate::models::{TrackerItem, TrackerKind};
use crate::services::booth;
use anyhow::{anyhow, Result};
use chrono::Utc;
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde_json::json;
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const EVENT_TRACKER_UPDATE: &str = "tracker:update";

fn row_to_tracker_item(row: &rusqlite::Row<'_>) -> TrackerItem {
    let kind_s: String = row.get("kind").unwrap_or_default();
    TrackerItem {
        id: row.get("id").unwrap_or_default(),
        kind: if kind_s == "author" {
            TrackerKind::Author
        } else if kind_s == "keyword" {
            TrackerKind::Keyword
        } else {
            TrackerKind::Item
        },
        booth_id: row.get("booth_id").unwrap_or_default(),
        item_name: row.get("item_name").unwrap_or_default(),
        item_author: row.get("item_author").unwrap_or_default(),
        item_thumbnail_url: row.get("item_thumbnail_url").ok(),
        item_url: row.get("item_url").unwrap_or_default(),
        last_known_price: row.get("last_known_price").ok(),
        track_price_drops: row.get::<_, i64>("track_price_drops").unwrap_or(0) != 0,
        track_availability: row.get::<_, i64>("track_availability").unwrap_or(0) != 0,
        author_name: row.get("author_name").ok(),
        author_booth_shop_id: row.get("author_booth_shop_id").ok(),
        track_new_items: row.get::<_, i64>("track_new_items").unwrap_or(0) != 0,
        search_keyword: row.get("search_keyword").ok(),
        search_category: row.get("search_category").ok(),
        check_interval_minutes: row.get("check_interval_minutes").unwrap_or(60),
        last_checked_at: row.get("last_checked_at").ok(),
        is_active: row.get::<_, i64>("is_active").unwrap_or(0) != 0,
        created_at: row.get("created_at").unwrap_or_default(),
    }
}

pub fn start_polling(app: AppHandle, db: DbPool) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            if let Err(e) = run_checks(&app, &db).await {
                eprintln!("[tracker] check error: {e}");
            }
        }
    });
}

async fn run_checks(app: &AppHandle, db: &DbPool) -> Result<()> {
    run_checks_now(app, db, None).await
}

pub async fn run_checks_now(app: &AppHandle, db: &DbPool, filter_id: Option<String>) -> Result<()> {
    // 1. Fetch active tracker items in a blocking task
    let items = tokio::task::spawn_blocking({
        let db = db.clone();
        move || -> Result<Vec<TrackerItem>> {
            let conn = db.get().map_err(|e| anyhow!("{}", e))?;
            let mut sql = String::from("SELECT * FROM tracker_items WHERE is_active = 1");
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];
            if let Some(ref id) = filter_id {
                sql.push_str(" AND id = ?");
                params.push(Box::new(id.clone()));
            }
            let mut stmt = conn.prepare(&sql)?;
            let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt.query_map(param_refs.as_slice(), |row| Ok(row_to_tracker_item(row)))?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| anyhow!(e))
        }
    })
    .await??;

    let client = reqwest::Client::builder()
        .user_agent("VRC-Studio/1.0")
        .build()?;

    for item in &items {
        let now_str = Utc::now().to_rfc3339();
        let events_created = match item.kind {
            TrackerKind::Item => {
                // Si no hay booth_id válido, devolvemos 0
                if let Some(booth_id) = item.booth_id.as_ref().filter(|id| !id.is_empty()) {
                    // ----- ASYNC: fetch product detail -----
                    let detail = booth::fetch_product_detail(&client, booth_id)
                        .await
                        .map_err(|e| anyhow!("Booth API error: {}", e))?;
                    let new_price = detail.price_display.clone();

                    // ----- SYNC: update DB -----
                    let item_id = item.id.clone();
                    let track_price = item.track_price_drops;
                    let last_price = item.last_known_price.clone();
                    let db = db.clone();
                    let now = now_str.clone();

                    tokio::task::spawn_blocking(move || -> Result<u32> {
                        let conn = db.get().map_err(|e| anyhow!("{}", e))?;
                        let mut created = 0u32;

                        if track_price {
                            match last_price {
                                None => {
                                    let payload = json!({ "new_price": new_price, "is_initial": true });
                                    insert_event_sync(&conn, &item_id, "price_change", &payload.to_string(), &now)?;
                                    created += 1;
                                }
                                Some(prev) if prev != new_price => {
                                    let payload = json!({ "old_price": prev, "new_price": new_price });
                                    insert_event_sync(&conn, &item_id, "price_change", &payload.to_string(), &now)?;
                                    created += 1;
                                }
                                _ => {}
                            }
                            conn.execute(
                                "UPDATE tracker_items SET last_known_price = ?1, last_checked_at = ?2 WHERE id = ?3",
                                params![new_price, now, item_id],
                            )?;
                        } else {
                            conn.execute(
                                "UPDATE tracker_items SET last_checked_at = ?1 WHERE id = ?2",
                                params![now, item_id],
                            )?;
                        }
                        Ok(created)
                    }).await??
                } else {
                    0u32
                }
            }
            TrackerKind::Author => {
                let search_query = match (&item.author_booth_shop_id, &item.author_name) {
                    (Some(shop), _) if !shop.is_empty() => shop.clone(),
                    (_, Some(name)) if !name.is_empty() => name.clone(),
                    _ => String::new(),
                };
                if search_query.is_empty() {
                    0u32
                } else {
                    // 👇 añadir el cuarto argumento `false`
                    let products = booth::search(&client, &search_query, 1, false)
                        .await
                        .map_err(|e| anyhow!("Booth search error: {}", e))?;

                    let item_id = item.id.clone();
                    let db = db.clone();
                    let now = now_str.clone();

                    tokio::task::spawn_blocking(move || -> Result<u32> {
                        let conn = db.get().map_err(|e| anyhow!("{}", e))?;
                        let mut created = 0u32;
                        let mut stmt = conn.prepare(
                            "SELECT json_extract(payload, '$.booth_id') FROM tracker_events
                             WHERE tracker_item_id = ?1 AND event_type = 'new_item'",
                        )?;
                        let known_ids: Vec<String> = stmt
                            .query_map(params![&item_id], |row| row.get::<_, String>(0))?
                            .collect::<Result<Vec<_>, _>>()?;
                        for product in &products {
                            if !known_ids.contains(&product.source_id) {
                                let payload = json!({
                                    "booth_id": product.source_id,
                                    "name": product.name,
                                    "price": product.price_display,
                                    "url": product.url,
                                    "thumbnail": product.thumbnail_url,
                                });
                                insert_event_sync(
                                    &conn,
                                    &item_id,
                                    "new_item",
                                    &payload.to_string(),
                                    &now,
                                )?;
                                created += 1;
                            }
                        }
                        conn.execute(
                            "UPDATE tracker_items SET last_checked_at = ?1 WHERE id = ?2",
                            params![now, item_id],
                        )?;
                        Ok(created)
                    })
                    .await??
                }
            }
            TrackerKind::Keyword => {
                if let Some(ref kw) = item.search_keyword {
                    // Call async function that handles everything (including DB updates)
                    check_keyword_results(db, item, kw, &now_str).await?
                } else {
                    0u32
                }
            }
        };

        if events_created > 0 {
            let _ = app.emit(EVENT_TRACKER_UPDATE, json!({ "tracker_item_id": item.id }));
            send_os_notification(app, item);
        }
    }

    Ok(())
}

/// Synchronous version of event insertion (to be used inside spawn_blocking).
fn insert_event_sync(
    conn: &rusqlite::Connection,
    tracker_item_id: &str,
    event_type: &str,
    payload: &str,
    now: &str,
) -> Result<()> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tracker_events (id, tracker_item_id, event_type, payload, detected_at, is_read)
         VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![id, tracker_item_id, event_type, payload, now],
    )?;
    Ok(())
}

fn send_os_notification(app: &AppHandle, item: &TrackerItem) {
    let label = item
        .item_name
        .as_ref()
        .or(item.author_name.as_ref())
        .cloned()
        .unwrap_or_else(|| "Tracker item".to_string());

    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("VRC Studio Tracker")
            .body(format!("Cambio detectado en: {}", label))
            .show();
    }
}

/// Check keyword results: fetch search page, detect new items, store events.
/// Returns number of new events created (u32).
async fn check_keyword_results(
    db: &DbPool,
    item: &TrackerItem,
    keyword: &str,
    now_str: &str,
) -> Result<u32> {
    let encoded = urlencoding::encode(keyword);
    let url = format!("https://booth.pm/en/browse?q={}&sort=new", encoded);

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (compatible; VRCStudio)")
        .send()
        .await
        .map_err(|e| anyhow!("HTTP error: {}", e))?;
    let html = resp
        .text()
        .await
        .map_err(|e| anyhow!("Body error: {}", e))?;

    // Extract booth IDs
    let re = Regex::new(r#"/items/(\d{5,8})"#).unwrap();
    let found_ids: HashSet<String> = re
        .captures_iter(&html)
        .filter_map(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .collect();

    if found_ids.is_empty() {
        return Ok(0);
    }

    let item_id = item.id.clone();
    let keyword_owned = keyword.to_string();
    let now = now_str.to_string();
    let db = db.clone();

    let created = tokio::task::spawn_blocking(move || -> Result<u32> {
        let conn = db.get().map_err(|e| anyhow!("{}", e))?;
        let mut created = 0u32;

        // Get previously seen IDs from last 'keyword_seen' event
        let seen_ids: HashSet<String> = {
            let mut stmt = conn.prepare(
                "SELECT payload FROM tracker_events
                 WHERE tracker_item_id = ?1 AND event_type = 'keyword_seen'
                 ORDER BY detected_at DESC LIMIT 1"
            )?;
            let snapshot: Option<String> = stmt
                .query_row(params![&item_id], |row| row.get(0))
                .optional()?;
            snapshot
                .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
                .unwrap_or_default()
                .into_iter()
                .collect()
        };

        let new_ids: Vec<&String> = found_ids.iter().filter(|id| !seen_ids.contains(*id)).collect();
        if !new_ids.is_empty() {
            for booth_id in new_ids.iter().take(10) {
                let payload = json!({
                    "booth_id": booth_id,
                    "keyword": keyword_owned,
                    "url": format!("https://booth.pm/items/{}", booth_id)
                });
                insert_event_sync(&conn, &item_id, "new_item", &payload.to_string(), &now)?;
                created += 1;
            }
        }

        // Save updated snapshot
        let all_ids: Vec<String> = seen_ids.union(&found_ids).cloned().collect();
        let snapshot_payload = serde_json::to_string(&all_ids).unwrap_or_default();
        let snapshot_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO tracker_events (id, tracker_item_id, event_type, payload, detected_at, is_read)
             VALUES (?1, ?2, 'keyword_seen', ?3, ?4, 1)",
            params![snapshot_id, item_id, snapshot_payload, now],
        )?;

        // Update last_checked_at
        conn.execute(
            "UPDATE tracker_items SET last_checked_at = ?1 WHERE id = ?2",
            params![now, item_id],
        )?;

        Ok(created)
    }).await??;

    Ok(created)
}
