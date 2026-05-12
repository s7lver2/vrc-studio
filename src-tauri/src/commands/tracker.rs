use crate::error::AppError;
use crate::models::{TrackerItem, TrackerEvent, CreateTrackerItemPayload, UpdateTrackerItemPayload, TrackerKind};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

fn kind_str(k: &TrackerKind) -> &'static str {
    match k {
        TrackerKind::Item => "item",
        TrackerKind::Author => "author",
    }
}

fn row_to_tracker_item(row: &sqlx::sqlite::SqliteRow) -> TrackerItem {
    use sqlx::Row;
    let kind_s: String = row.get("kind");
    TrackerItem {
        id: row.get("id"),
        kind: if kind_s == "author" { TrackerKind::Author } else { TrackerKind::Item },
        booth_id: row.get("booth_id"),
        item_name: row.get("item_name"),
        item_author: row.get("item_author"),
        item_thumbnail_url: row.get("item_thumbnail_url"),
        item_url: row.get("item_url"),
        last_known_price: row.get("last_known_price"),
        track_price_drops: row.get::<i64, _>("track_price_drops") != 0,
        track_availability: row.get::<i64, _>("track_availability") != 0,
        author_name: row.get("author_name"),
        author_booth_shop_id: row.get("author_booth_shop_id"),
        track_new_items: row.get::<i64, _>("track_new_items") != 0,
        check_interval_minutes: row.get("check_interval_minutes"),
        last_checked_at: row.get("last_checked_at"),
        is_active: row.get::<i64, _>("is_active") != 0,
        created_at: row.get("created_at"),
    }
}

#[tauri::command]
pub async fn tracker_list(db: State<'_, SqlitePool>) -> Result<Vec<TrackerItem>, AppError> {
    let rows = sqlx::query(
        "SELECT * FROM tracker_items ORDER BY created_at DESC"
    )
    .fetch_all(db.inner())
    .await?;
    Ok(rows.iter().map(row_to_tracker_item).collect())
}

#[tauri::command]
pub async fn tracker_create(
    payload: CreateTrackerItemPayload,
    db: State<'_, SqlitePool>,
) -> Result<TrackerItem, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let kind = kind_str(&payload.kind);

    sqlx::query(
        "INSERT INTO tracker_items (
            id, kind,
            booth_id, item_name, item_author, item_thumbnail_url, item_url,
            track_price_drops, track_availability,
            author_name, author_booth_shop_id, track_new_items,
            check_interval_minutes, is_active, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)"
    )
    .bind(&id)
    .bind(kind)
    .bind(&payload.booth_id)
    .bind(&payload.item_name)
    .bind(&payload.item_author)
    .bind(&payload.item_thumbnail_url)
    .bind(&payload.item_url)
    .bind(payload.track_price_drops.unwrap_or(true) as i64)
    .bind(payload.track_availability.unwrap_or(true) as i64)
    .bind(&payload.author_name)
    .bind(&payload.author_booth_shop_id)
    .bind(payload.track_new_items.unwrap_or(true) as i64)
    .bind(payload.check_interval_minutes.unwrap_or(60))
    .bind(&now)
    .execute(db.inner())
    .await?;

    let row = sqlx::query("SELECT * FROM tracker_items WHERE id = ?")
        .bind(&id)
        .fetch_one(db.inner())
        .await?;
    Ok(row_to_tracker_item(&row))
}

#[tauri::command]
pub async fn tracker_update(
    id: String,
    payload: UpdateTrackerItemPayload,
    db: State<'_, SqlitePool>,
) -> Result<TrackerItem, AppError> {
    if let Some(v) = payload.track_price_drops {
        sqlx::query("UPDATE tracker_items SET track_price_drops=? WHERE id=?")
            .bind(v as i64).bind(&id).execute(db.inner()).await?;
    }
    if let Some(v) = payload.track_availability {
        sqlx::query("UPDATE tracker_items SET track_availability=? WHERE id=?")
            .bind(v as i64).bind(&id).execute(db.inner()).await?;
    }
    if let Some(v) = payload.track_new_items {
        sqlx::query("UPDATE tracker_items SET track_new_items=? WHERE id=?")
            .bind(v as i64).bind(&id).execute(db.inner()).await?;
    }
    if let Some(v) = payload.check_interval_minutes {
        sqlx::query("UPDATE tracker_items SET check_interval_minutes=? WHERE id=?")
            .bind(v).bind(&id).execute(db.inner()).await?;
    }
    if let Some(v) = payload.is_active {
        sqlx::query("UPDATE tracker_items SET is_active=? WHERE id=?")
            .bind(v as i64).bind(&id).execute(db.inner()).await?;
    }
    let row = sqlx::query("SELECT * FROM tracker_items WHERE id = ?")
        .bind(&id).fetch_one(db.inner()).await?;
    Ok(row_to_tracker_item(&row))
}

#[tauri::command]
pub async fn tracker_delete(
    id: String,
    db: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM tracker_items WHERE id=?")
        .bind(&id).execute(db.inner()).await?;
    Ok(())
}

#[tauri::command]
pub async fn tracker_list_events(
    tracker_item_id: Option<String>,
    unread_only: bool,
    db: State<'_, SqlitePool>,
) -> Result<Vec<TrackerEvent>, AppError> {
    use sqlx::Row;
    let rows = if let Some(ref tid) = tracker_item_id {
        sqlx::query(
            "SELECT * FROM tracker_events WHERE tracker_item_id=? ORDER BY detected_at DESC LIMIT 100"
        ).bind(tid).fetch_all(db.inner()).await?
    } else if unread_only {
        sqlx::query(
            "SELECT * FROM tracker_events WHERE is_read=0 ORDER BY detected_at DESC LIMIT 100"
        ).fetch_all(db.inner()).await?
    } else {
        sqlx::query(
            "SELECT * FROM tracker_events ORDER BY detected_at DESC LIMIT 100"
        ).fetch_all(db.inner()).await?
    };
    Ok(rows.iter().map(|r| TrackerEvent {
        id: r.get("id"),
        tracker_item_id: r.get("tracker_item_id"),
        event_type: r.get("event_type"),
        payload: r.get("payload"),
        detected_at: r.get("detected_at"),
        is_read: r.get::<i64, _>("is_read") != 0,
    }).collect())
}

#[tauri::command]
pub async fn tracker_mark_events_read(
    ids: Vec<String>,
    db: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    for id in ids {
        sqlx::query("UPDATE tracker_events SET is_read=1 WHERE id=?")
            .bind(&id).execute(db.inner()).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tracker_unread_count(
    db: State<'_, SqlitePool>,
) -> Result<i64, AppError> {
    use sqlx::Row;
    let row = sqlx::query("SELECT COUNT(*) as cnt FROM tracker_events WHERE is_read=0")
        .fetch_one(db.inner()).await?;
    Ok(row.get("cnt"))
}

#[tauri::command]
pub async fn tracker_run_now(
    id: Option<String>,
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    crate::services::tracker_service::run_checks_now(&app, db.inner(), id)
        .await
        .map_err(|e| AppError::Generic(e.to_string()))
}