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
    // Pre‑repair: si las columnas de 010‑012 ya existen, las marcamos como
    // aplicadas en _sqlx_migrations para que sqlx las omita.
    ensure_columns_exist(pool).await?;

    match sqlx::migrate!("src/db/migrations").run(pool).await {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("was previously applied but has been modified")
                || msg.contains("duplicate column name")
            {
                // Checksum mismatch o columna duplicada → forzamos el estado limpio
                sqlx::query("DELETE FROM _sqlx_migrations WHERE version IN (11, 12)")
                    .execute(pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))?;
                // Reintentamos
                return sqlx::migrate!("src/db/migrations")
                    .run(pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()));
            }
            Err(AppError::Database(msg))
        }
    }
}

// ── Pre‑reparación de columnas ──────────────────────────────────────────────

async fn ensure_columns_exist(pool: &SqlitePool) -> Result<(), AppError> {
    async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> Result<bool, AppError> {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?",
        )
        .bind(table)
        .bind(column)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(count > 0)
    }

    async fn mark_applied(pool: &SqlitePool, version: i64, description: &str, checksum: &[u8]) -> Result<(), AppError> {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM _sqlx_migrations WHERE version = ?",
        )
        .bind(version)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
        if exists == 0 {
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time) VALUES (?, ?, datetime('now'), 1, ?, 0)",
            )
            .bind(version)
            .bind(description)
            .bind(checksum)
            .execute(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        Ok(())
    }

    // Checksums pre‑calculados (SHA‑256 de los archivos de migración incrustados)
    // Los obtenemos con include_str! para que funcionen en release.
    let checksum_10 = checksum_of(include_str!("../db/migrations/010_inventory_v2.sql"));
    let checksum_11 = checksum_of(include_str!("../db/migrations/011_item_custom_images.sql"));
    let checksum_12 = checksum_of(include_str!("../db/migrations/012_folder_v2.sql"));

    if column_exists(pool, "inventory_items", "display_name").await? {
        mark_applied(pool, 10, "inventory v2", &checksum_10).await?;
    }
    if column_exists(pool, "inventory_items", "custom_images").await? {
        mark_applied(pool, 11, "item custom images", &checksum_11).await?;
    }
    if column_exists(pool, "inventory_folders", "color").await?
        && column_exists(pool, "inventory_folders", "custom_image_path").await?
    {
        mark_applied(pool, 12, "folder v2", &checksum_12).await?;
    }

    Ok(())
}

fn checksum_of(contents: &str) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(contents.as_bytes());
    hasher.finalize().to_vec()
}

async fn compute_migration_checksum(version: i64) -> Result<Vec<u8>, AppError> {
    // sqlx stores checksums as a SHA-256 of the migration file contents.
    // We compute the same checksum by reading the file.
    use sha2::{Digest, Sha256};
    let path = format!("src/db/migrations/{:03}_*.sql", version);
    // Since file names vary, we need to find the actual file
    let dir = std::fs::read_dir("src/db/migrations")
        .map_err(|e| AppError::External(e.to_string()))?;
    let mut file_path = None;
    for entry in dir {
        let entry = entry.map_err(|e| AppError::External(e.to_string()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&format!("{:03}_", version)) {
            file_path = Some(entry.path());
            break;
        }
    }
    let path = file_path.ok_or_else(|| AppError::External(format!("Migration file for version {} not found", version)))?;
    let contents = tokio::fs::read(&path)
        .await
        .map_err(|e| AppError::External(e.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(&contents);
    let result: Vec<u8> = hasher.finalize().to_vec();
    Ok(result)
}

/// In-memory pool for tests only.
#[cfg(test)]
pub async fn create_test_pool() -> Result<SqlitePool, AppError> {
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await?;
    run_migrations(&pool).await?;
    Ok(pool)
}