// src-tauri/src/commands/collections.rs
use crate::db::DbPool;
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub cover_url: String,
    pub created_at: String,
    pub description: String,
    pub updated_at: String,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionItem {
    pub id: String,
    pub collection_id: String,
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
pub fn collections_list(pool: State<'_, DbPool>) -> Result<Vec<Collection>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
    "SELECT c.id, c.name, c.cover_url, c.description, c.created_at, c.updated_at,
            COUNT(ci.id) as item_count
     FROM shop_collections c
     LEFT JOIN shop_collection_items ci ON ci.collection_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC",
)?;
let cols = stmt
    .query_map([], |row| {
        Ok(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
            cover_url: row.get(2)?,
            description: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            item_count: row.get(6)?,
        })
    })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(cols)
}

#[tauri::command]
pub fn collection_create(
    pool: State<'_, DbPool>,
    name: String,
) -> Result<Collection, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO shop_collections (id, name, cover_url, description, created_at, updated_at)
         VALUES (?1, ?2, '', '', ?3, ?3)",
        params![id, name, now],
    )?;
    Ok(Collection {
        id,
        name,
        cover_url: String::new(),
        description: String::new(),
        created_at: now.clone(),
        updated_at: now,
        item_count: 0,
    })
}

#[tauri::command]
pub fn collection_delete(
    pool: State<'_, DbPool>,
    collection_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM shop_collections WHERE id = ?1", params![collection_id])?;
    Ok(())
}

#[tauri::command]
pub fn collection_rename(
    pool: State<'_, DbPool>,
    collection_id: String,
    name: String,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shop_collections SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now, collection_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn collection_set_cover(
    pool: State<'_, DbPool>,
    collection_id: String,
    cover_url: String,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shop_collections SET cover_url = ?1, updated_at = ?2 WHERE id = ?3",
        params![cover_url, now, collection_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn collection_add_item(
    pool: State<'_, DbPool>,
    collection_id: String,
    source: String,
    source_id: String,
    name: String,
    author: String,
    thumbnail_url: String,
    price_display: String,
    url: String,
) -> Result<(), AppError> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO shop_collection_items
         (id, collection_id, source, source_id, name, author, thumbnail_url, price_display, url, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, collection_id, source, source_id, name, author, thumbnail_url, price_display, url, now],
    )?;
    // Actualizar updated_at de la colección
    conn.execute(
        "UPDATE shop_collections SET updated_at = ?1 WHERE id = ?2",
        params![now, collection_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn collection_remove_item(
    pool: State<'_, DbPool>,
    collection_id: String,
    source: String,
    source_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM shop_collection_items
         WHERE collection_id = ?1 AND source = ?2 AND source_id = ?3",
        params![collection_id, source, source_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn collection_get_items(
    pool: State<'_, DbPool>,
    collection_id: String,
) -> Result<Vec<CollectionItem>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, collection_id, source, source_id, name, author, thumbnail_url, price_display, url, added_at
         FROM shop_collection_items
         WHERE collection_id = ?1
         ORDER BY added_at DESC",
    )?;
    let items = stmt
        .query_map(params![collection_id], |row| {
            Ok(CollectionItem {
                id: row.get(0)?,
                collection_id: row.get(1)?,
                source: row.get(2)?,
                source_id: row.get(3)?,
                name: row.get(4)?,
                author: row.get(5)?,
                thumbnail_url: row.get(6)?,
                price_display: row.get(7)?,
                url: row.get(8)?,
                added_at: row.get(9)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

/// Devuelve los IDs de colecciones que contienen este item
#[tauri::command]
pub fn collection_get_item_collections(
    pool: State<'_, DbPool>,
    source: String,
    source_id: String,
) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT collection_id FROM shop_collection_items
         WHERE source = ?1 AND source_id = ?2",
    )?;
    let ids = stmt
        .query_map(params![source, source_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(ids)
}

#[tauri::command]
pub fn collection_update_description(
    pool: State<'_, DbPool>,
    collection_id: String,
    description: String,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shop_collections SET description = ?1, updated_at = ?2 WHERE id = ?3",
        params![description, now, collection_id],
    )?;
    Ok(())
}