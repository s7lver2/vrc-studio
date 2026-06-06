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
    pub description: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
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
    pub sort_order: i64,
}

#[tauri::command]
pub fn collections_list(pool: State<'_, DbPool>) -> Result<Vec<Collection>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.cover_url, c.description, c.parent_id, c.sort_order,
                c.created_at, c.updated_at, COUNT(ci.id) as item_count
         FROM shop_collections c
         LEFT JOIN shop_collection_items ci ON ci.collection_id = c.id
         GROUP BY c.id
         ORDER BY c.sort_order ASC, c.updated_at DESC",
    )?;
    let cols = stmt
        .query_map([], |row| {
            Ok(Collection {
                id:          row.get(0)?,
                name:        row.get(1)?,
                cover_url:   row.get(2)?,
                description: row.get(3)?,
                parent_id:   row.get(4)?,
                sort_order:  row.get(5)?,
                created_at:  row.get(6)?,
                updated_at:  row.get(7)?,
                item_count:  row.get(8)?,
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
        parent_id: None,
        sort_order: 0,
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
        "SELECT id, collection_id, source, source_id, name, author, thumbnail_url,
                price_display, url, added_at, sort_order
         FROM shop_collection_items
         WHERE collection_id = ?1
         ORDER BY sort_order ASC, added_at DESC",
    )?;
    let items = stmt
        .query_map(params![collection_id], |row| {
            Ok(CollectionItem {
                id:            row.get(0)?,
                collection_id: row.get(1)?,
                source:        row.get(2)?,
                source_id:     row.get(3)?,
                name:          row.get(4)?,
                author:        row.get(5)?,
                thumbnail_url: row.get(6)?,
                price_display: row.get(7)?,
                url:           row.get(8)?,
                added_at:      row.get(9)?,
                sort_order:    row.get(10)?,
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

#[tauri::command]
pub fn collection_move_to_parent(
    pool: State<'_, DbPool>,
    collection_id: String,
    parent_id: Option<String>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shop_collections SET parent_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![parent_id, now, collection_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn collections_reorder(
    pool: State<'_, DbPool>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE shop_collections SET sort_order = ?1 WHERE id = ?2",
            params![i as i64, id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn collection_items_reorder(
    pool: State<'_, DbPool>,
    collection_id: String,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE shop_collection_items SET sort_order = ?1 WHERE id = ?2 AND collection_id = ?3",
            params![i as i64, id, collection_id],
        )?;
    }
    Ok(())
}

/// Mueve un item de una colección a otra.
/// Si el item ya existe en la colección destino, simplemente lo elimina del origen.
#[tauri::command]
pub fn collection_item_move(
    pool: State<'_, DbPool>,
    item_id: String,
    from_collection_id: String,
    to_collection_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    // Obtener source y source_id para detectar duplicados en destino
    let (source, source_id): (String, String) = conn.query_row(
        "SELECT source, source_id FROM shop_collection_items WHERE id = ?1 AND collection_id = ?2",
        params![item_id, from_collection_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    // ¿Ya existe el item en la colección destino?
    let exists_in_target: i64 = conn.query_row(
        "SELECT COUNT(*) FROM shop_collection_items
         WHERE collection_id = ?1 AND source = ?2 AND source_id = ?3",
        params![to_collection_id, &source, &source_id],
        |row| row.get(0),
    ).unwrap_or(0);

    if exists_in_target > 0 {
        // Ya está en destino: solo borrar del origen
        conn.execute(
            "DELETE FROM shop_collection_items WHERE id = ?1",
            params![item_id],
        )?;
    } else {
        // No está en destino: actualizar collection_id
        conn.execute(
            "UPDATE shop_collection_items SET collection_id = ?1 WHERE id = ?2",
            params![to_collection_id, item_id],
        )?;
    }
    Ok(())
}