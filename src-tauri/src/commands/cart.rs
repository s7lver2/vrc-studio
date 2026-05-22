// src-tauri/src/commands/cart.rs
use crate::db::DbPool;
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartItem {
    pub id: String,
    pub source: String,
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String,
    pub url: String,
    pub added_at: String,
}

#[tauri::command]
pub fn cart_get_items(pool: State<'_, DbPool>) -> Result<Vec<CartItem>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, source, source_id, name, author, thumbnail_url, price_display, url, added_at
         FROM shop_cart ORDER BY added_at DESC",
    )?;
    let items = stmt
        .query_map([], |row| {
            Ok(CartItem {
                id: row.get(0)?,
                source: row.get(1)?,
                source_id: row.get(2)?,
                name: row.get(3)?,
                author: row.get(4)?,
                thumbnail_url: row.get(5)?,
                price_display: row.get(6)?,
                url: row.get(7)?,
                added_at: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

#[tauri::command]
pub fn cart_add_item(
    pool: State<'_, DbPool>,
    source: String,
    source_id: String,
    name: String,
    author: String,
    thumbnail_url: String,
    price_display: String,
    url: String,
) -> Result<CartItem, AppError> {
    let id = Uuid::new_v4().to_string();
    let added_at = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO shop_cart
         (id, source, source_id, name, author, thumbnail_url, price_display, url, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, source, source_id, name, author, thumbnail_url, price_display, url, added_at],
    )?;
    // Si ya existía (IGNORE), devolver el existente
    let item = conn.query_row(
        "SELECT id, source, source_id, name, author, thumbnail_url, price_display, url, added_at
         FROM shop_cart WHERE source = ?1 AND source_id = ?2",
        params![source, source_id],
        |row| Ok(CartItem {
            id: row.get(0)?,
            source: row.get(1)?,
            source_id: row.get(2)?,
            name: row.get(3)?,
            author: row.get(4)?,
            thumbnail_url: row.get(5)?,
            price_display: row.get(6)?,
            url: row.get(7)?,
            added_at: row.get(8)?,
        }),
    )?;
    Ok(item)
}

#[tauri::command]
pub fn cart_remove_item(
    pool: State<'_, DbPool>,
    source: String,
    source_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM shop_cart WHERE source = ?1 AND source_id = ?2",
        params![source, source_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn cart_clear(pool: State<'_, DbPool>) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM shop_cart", [])?;
    Ok(())
}

#[tauri::command]
pub fn cart_is_in_cart(
    pool: State<'_, DbPool>,
    source: String,
    source_id: String,
) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM shop_cart WHERE source = ?1 AND source_id = ?2",
        params![source, source_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}