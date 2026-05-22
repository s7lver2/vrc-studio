use rusqlite::params;
use crate::db::DbPool;
use tauri::State;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JournalEntry {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_journal_entry(row: &rusqlite::Row<'_>) -> JournalEntry {
    JournalEntry {
        id: row.get("id").unwrap_or_default(),
        project_id: row.get("project_id").unwrap_or_default(),
        content: row.get("content").unwrap_or_default(),
        created_at: row.get("created_at").unwrap_or_default(),
        updated_at: row.get("updated_at").unwrap_or_default(),
    }
}

#[tauri::command]
pub async fn journal_list(
    project_id: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<JournalEntry>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, content, created_at, updated_at
             FROM project_journal_entries
             WHERE project_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let entries = stmt
        .query_map(params![project_id], |row| Ok(row_to_journal_entry(row)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(entries)
}

#[tauri::command]
pub async fn journal_create(
    project_id: String,
    content: String,
    pool: State<'_, DbPool>,
) -> Result<JournalEntry, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO project_journal_entries (id, project_id, content, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, project_id, content, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(JournalEntry {
        id,
        project_id,
        content,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn journal_update(
    id: String,
    content: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE project_journal_entries SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn journal_delete(id: String, pool: State<'_, DbPool>) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM project_journal_entries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}