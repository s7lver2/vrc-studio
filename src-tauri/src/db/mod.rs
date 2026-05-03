use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
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
    sqlx::migrate!("src/db/migrations")
        .run(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))
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