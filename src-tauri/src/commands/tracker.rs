use crate::error::AppError;
use crate::models::{TrackerItem, TrackerEvent, CreateTrackerItemPayload, UpdateTrackerItemPayload, TrackerKind};
use rusqlite::params;
use crate::db::DbPool;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

fn kind_str(k: &TrackerKind) -> &'static str {
    match k {
        TrackerKind::Item => "item",
        TrackerKind::Author => "author",
    }
}

fn row_to_tracker_item(row: &rusqlite::Row<'_>) -> TrackerItem {
    let kind_s: String = row.get("kind").unwrap_or_default();
    TrackerItem {
        id: row.get("id").unwrap_or_default(),
        kind: if kind_s == "author" { TrackerKind::Author } else { TrackerKind::Item },
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
        check_interval_minutes: row.get("check_interval_minutes").unwrap_or(60),
        last_checked_at: row.get("last_checked_at").ok(),
        is_active: row.get::<_, i64>("is_active").unwrap_or(0) != 0,
        created_at: row.get("created_at").unwrap_or_default(),
    }
}

fn row_to_tracker_event(row: &rusqlite::Row<'_>) -> TrackerEvent {
    TrackerEvent {
        id: row.get("id").unwrap_or_default(),
        tracker_item_id: row.get("tracker_item_id").unwrap_or_default(),
        event_type: row.get("event_type").unwrap_or_default(),
        payload: row.get("payload").unwrap_or_default(),
        detected_at: row.get("detected_at").unwrap_or_default(),
        is_read: row.get::<_, i64>("is_read").unwrap_or(0) != 0,
    }
}

#[tauri::command]
pub async fn tracker_list(pool: State<'_, DbPool>) -> Result<Vec<TrackerItem>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM tracker_items ORDER BY created_at DESC")?;
    let items = stmt
        .query_map([], |row| Ok(row_to_tracker_item(row)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

#[tauri::command]
pub async fn tracker_create(
    payload: CreateTrackerItemPayload,
    pool: State<'_, DbPool>,
) -> Result<TrackerItem, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let kind = kind_str(&payload.kind);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO tracker_items (
            id, kind, booth_id, item_name, item_author, item_thumbnail_url, item_url,
            track_price_drops, track_availability,
            author_name, author_booth_shop_id, track_new_items,
            check_interval_minutes, is_active, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, ?14)",
        params![
            id, kind,
            payload.booth_id,
            payload.item_name,
            payload.item_author,
            payload.item_thumbnail_url,
            payload.item_url,
            payload.track_price_drops.unwrap_or(true) as i64,
            payload.track_availability.unwrap_or(true) as i64,
            payload.author_name,
            payload.author_booth_shop_id,
            payload.track_new_items.unwrap_or(true) as i64,
            payload.check_interval_minutes.unwrap_or(60),
            now,
        ],
    )?;

    let item = conn.query_row(
        "SELECT * FROM tracker_items WHERE id = ?1",
        params![id],
        |row| Ok(row_to_tracker_item(row)),
    )?;
    Ok(item)
}

#[tauri::command]
pub async fn tracker_update(
    id: String,
    payload: UpdateTrackerItemPayload,
    pool: State<'_, DbPool>,
) -> Result<TrackerItem, AppError> {
    let conn = pool.get()?;
    if let Some(v) = payload.track_price_drops {
        conn.execute(
            "UPDATE tracker_items SET track_price_drops = ?1 WHERE id = ?2",
            params![v as i64, id],
        )?;
    }
    if let Some(v) = payload.track_availability {
        conn.execute(
            "UPDATE tracker_items SET track_availability = ?1 WHERE id = ?2",
            params![v as i64, id],
        )?;
    }
    if let Some(v) = payload.track_new_items {
        conn.execute(
            "UPDATE tracker_items SET track_new_items = ?1 WHERE id = ?2",
            params![v as i64, id],
        )?;
    }
    if let Some(v) = payload.check_interval_minutes {
        conn.execute(
            "UPDATE tracker_items SET check_interval_minutes = ?1 WHERE id = ?2",
            params![v, id],
        )?;
    }
    if let Some(v) = payload.is_active {
        conn.execute(
            "UPDATE tracker_items SET is_active = ?1 WHERE id = ?2",
            params![v as i64, id],
        )?;
    }

    let item = conn.query_row(
        "SELECT * FROM tracker_items WHERE id = ?1",
        params![id],
        |row| Ok(row_to_tracker_item(row)),
    )?;
    Ok(item)
}

#[tauri::command]
pub async fn tracker_delete(id: String, pool: State<'_, DbPool>) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM tracker_items WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub async fn tracker_list_events(
    tracker_item_id: Option<String>,
    unread_only: bool,
    pool: State<'_, DbPool>,
) -> Result<Vec<TrackerEvent>, AppError> {
    let conn = pool.get()?;
    let rows = if let Some(tid) = tracker_item_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM tracker_events WHERE tracker_item_id = ?1 ORDER BY detected_at DESC LIMIT 100"
        )?;
        let iter = stmt.query_map(params![tid], |row| Ok(row_to_tracker_event(row)))?;
        iter.collect::<Result<Vec<_>, _>>()?
    } else if unread_only {
        let mut stmt = conn.prepare(
            "SELECT * FROM tracker_events WHERE is_read = 0 ORDER BY detected_at DESC LIMIT 100"
        )?;
        let iter = stmt.query_map([], |row| Ok(row_to_tracker_event(row)))?;
        iter.collect::<Result<Vec<_>, _>>()?
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM tracker_events ORDER BY detected_at DESC LIMIT 100"
        )?;
        let iter = stmt.query_map([], |row| Ok(row_to_tracker_event(row)))?;
        iter.collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

#[tauri::command]
pub async fn tracker_mark_events_read(
    ids: Vec<String>,
    pool: State<'_, DbPool>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    for id in ids {
        conn.execute(
            "UPDATE tracker_events SET is_read = 1 WHERE id = ?1",
            params![id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tracker_unread_count(pool: State<'_, DbPool>) -> Result<i64, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tracker_events WHERE is_read = 0",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

#[tauri::command]
pub async fn tracker_run_now(
    id: Option<String>,
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
) -> Result<(), AppError> {
    crate::services::tracker_service::run_checks_now(&app, &pool, id)
        .await
        .map_err(|e| AppError::Generic(e.to_string()))
}