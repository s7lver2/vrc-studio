use sqlx::{sqlite::SqlitePoolOptions, SqlitePool, Row};
use crate::error::AppError;

pub mod packages_repo;

pub async fn init_pool(app_data_dir: &str) -> Result<SqlitePool, AppError> {
    let db_path = format!("{}/vrc-studio.db", app_data_dir);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&format!("sqlite://{}?mode=rwc", db_path))
        .await?;
    run_migrations(&pool).await?;
    Ok(pool)
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    // Reparar columnas faltantes antes de ejecutar migraciones
    // (importante para usuarios con base de datos en estado inconsistente)
    fix_missing_columns(pool).await?;

    sqlx::migrate!("src/db/migrations")
        .run(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))
}

/// Asegura que las columnas añadidas en migraciones 011 y 012
/// existan realmente, incluso si esas migraciones no se aplicaron.
async fn fix_missing_columns(pool: &SqlitePool) -> Result<(), AppError> {
    // --- inventory_items: custom_images ---
    let rows = sqlx::query("PRAGMA table_info(inventory_items)")
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    let has_custom_images = rows.iter().any(|r| {
        r.get::<String, _>("name") == "custom_images"
    });
    if !has_custom_images {
        sqlx::query("ALTER TABLE inventory_items ADD COLUMN custom_images TEXT DEFAULT '[]'")
            .execute(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
    }

    // --- inventory_folders: color ---
    let rows = sqlx::query("PRAGMA table_info(inventory_folders)")
        .fetch_all(pool)
        .await?;
    let has_color = rows.iter().any(|r| r.get::<String, _>("name") == "color");
    if !has_color {
        sqlx::query("ALTER TABLE inventory_folders ADD COLUMN color TEXT")
            .execute(pool)
            .await?;
    }

    // --- inventory_folders: custom_image_path ---
    let has_custom_image_path = rows.iter().any(|r| {
        r.get::<String, _>("name") == "custom_image_path"
    });
    if !has_custom_image_path {
        sqlx::query("ALTER TABLE inventory_folders ADD COLUMN custom_image_path TEXT")
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// In-memory pool for tests only
#[cfg(test)]
pub async fn create_test_pool() -> Result<SqlitePool, AppError> {
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await?;
    run_migrations(&pool).await?;
    Ok(pool)
}