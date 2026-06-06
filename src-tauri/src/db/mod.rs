// src-tauri/src/db/mod.rs
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use crate::error::AppError;

pub mod packages_repo;

/// Newtype sobre r2d2::Pool para poder implementar traits de Tauri.
#[derive(Clone)]
pub struct DbPool(pub Pool<SqliteConnectionManager>);

impl DbPool {
    /// Obtiene una conexión del pool. Bloquea brevemente si todas están en uso.
    pub fn get(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, AppError> {
        self.0.get().map_err(|e| AppError::Database(e.to_string()))
    }
}

// Tauri necesita que el estado sea Send + Sync; Pool ya lo es.
unsafe impl Send for DbPool {}
unsafe impl Sync for DbPool {}

/// Inicializa el pool y ejecuta las migraciones pendientes.
pub fn init_pool(app_data_dir: &str) -> Result<DbPool, AppError> {
    let db_path = format!("{}/vrc-studio.db", app_data_dir);
    let manager = SqliteConnectionManager::file(&db_path)
        .with_flags(rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE)
        .with_init(|conn| {
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
            Ok(())
        });
    let pool = Pool::builder()
        .max_size(5)
        .build(manager)
        .map_err(|e| AppError::Database(e.to_string()))?;

    run_migrations(&pool)?;
    Ok(DbPool(pool))
}

// ── Migrador ─────────────────────────────────────────────────────────────────

/// Lista de migraciones (version, sql_content).
/// El SQL se incluye en el binario en tiempo de compilación.
const MIGRATIONS: &[(i64, &str)] = &[
    (1,  include_str!("migrations/001_initial.sql")),
    (2,  include_str!("migrations/002_custom_package_assets.sql")),
    (3,  include_str!("migrations/003_shop_inventory.sql")),
    (4,  include_str!("migrations/004_inventory_images.sql")),
    (5,  include_str!("migrations/005_compression.sql")),
    (6,  include_str!("migrations/006_vcs.sql")),
    (7,  include_str!("migrations/007_project_screenshots.sql")),
    (8,  include_str!("migrations/008_journal.sql")),
    (9,  include_str!("migrations/009_tracker.sql")),
    (10, include_str!("migrations/010_inventory_v2.sql")),
    (11, include_str!("migrations/011_item_custom_images.sql")),
    (12, include_str!("migrations/012_folder_v2.sql")),
    (13, include_str!("migrations/013_schema_repair.sql")),
    (14, include_str!("migrations/014_folder_sort_order.sql")),
    (15, include_str!("migrations/015_folder_emoji.sql")),
    (16, include_str!("migrations/016_folder_image_fill.sql")),
    (17, include_str!("migrations/017_shop_cart.sql")),
    (18, include_str!("migrations/018_shop_collections.sql")),
    (19, include_str!("migrations/019_collection_description.sql")),
    (20, include_str!("migrations/020_tracker_v2.sql")),
    (21, include_str!("migrations/021_multi_avatar.sql")),
    (22, include_str!("migrations/022_variant_custom_image.sql")),
    (23, include_str!("migrations/023_folder_fill_rename.sql")),
    (24, include_str!("migrations/024_early_imports.sql")),
    (25, include_str!("migrations/025_early_import_sub_zip.sql")),
    (26, include_str!("migrations/026_project_cover_image.sql")),
    (27, include_str!("migrations/027_project_folders.sql")),
    (28, include_str!("migrations/028_project_sort_order.sql")),
    (29, include_str!("migrations/029_project_folder_image.sql")),
    (30, include_str!("migrations/030_collections_folders.sql")),
];

fn run_migrations(pool: &Pool<SqliteConnectionManager>) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Database(e.to_string()))?;

    // Crear tabla de control de migraciones si no existe.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );"
    ).map_err(|e| AppError::Database(e.to_string()))?;

    for (version, sql) in MIGRATIONS {
        // Comprobar si ya está aplicada.
        let already_applied: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE version = ?1",
                params![version],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| AppError::Database(e.to_string()))?;

        if already_applied {
            continue;
        }

        // Ejecutar el SQL de la migración (puede tener múltiples statements).
        conn.execute_batch(sql)
            .map_err(|e| AppError::Database(format!("migration {}: {}", version, e)))?;

        // Registrar como aplicada.
        conn.execute(
            "INSERT INTO _migrations (version) VALUES (?1)",
            params![version],
        ).map_err(|e| AppError::Database(e.to_string()))?;
    }

    Ok(())
}

// ── Pool en memoria para tests ────────────────────────────────────────────────

#[cfg(test)]
pub fn create_test_pool() -> Result<DbPool, AppError> {
    let manager = SqliteConnectionManager::memory()
        .with_init(|conn| {
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
            Ok(())
        });
    let pool = Pool::builder()
        .max_size(1)
        .build(manager)
        .map_err(|e| AppError::Database(e.to_string()))?;
    run_migrations(&pool)?;
    Ok(DbPool(pool))
}