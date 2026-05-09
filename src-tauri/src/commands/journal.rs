use sqlx::SqlitePool;
use tauri::State;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct JournalEntry {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn journal_list(
    project_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<JournalEntry>, String> {
    sqlx::query_as::<_, JournalEntry>(
        "SELECT id, project_id, content, created_at, updated_at
         FROM project_journal_entries
         WHERE project_id = ?
         ORDER BY created_at DESC",
    )
    .bind(&project_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn journal_create(
    project_id: String,
    content: String,
    pool: State<'_, SqlitePool>,
) -> Result<JournalEntry, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO project_journal_entries (id, project_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&project_id)
    .bind(&content)
    .bind(&now)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(JournalEntry { id, project_id, content, created_at: now.clone(), updated_at: now })
}

#[tauri::command]
pub async fn journal_update(
    id: String,
    content: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE project_journal_entries SET content = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&content)
    .bind(&now)
    .bind(&id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn journal_delete(
    id: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM project_journal_entries WHERE id = ?")
        .bind(&id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}