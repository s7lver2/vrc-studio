use sqlx::SqlitePool;
use uuid::Uuid;
use crate::error::AppError;
use crate::models::CustomPackage;

// ── helpers ───────────────────────────────────────────────────────────────────

/// Obtiene los IDs de inventory_items asociados a un paquete.
async fn get_asset_ids(package_id: &str, pool: &SqlitePool) -> Result<Vec<String>, AppError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT inventory_item_id FROM custom_package_assets WHERE package_id = ?"
    )
    .bind(package_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.get::<String, _>(0)).collect())
}

fn row_to_pkg(row: &sqlx::sqlite::SqliteRow, asset_ids: Vec<String>) -> CustomPackage {
    use sqlx::Row;
    CustomPackage {
        id: row.get("id"),
        name: row.get("name"),
        display_name: row.get("display_name"),
        version: row.get("version"),
        description: row.get("description"),
        json_path: row.get("json_path"),
        zip_path: row.get("zip_path"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        asset_ids,
    }
}

// ── public API ────────────────────────────────────────────────────────────────

/// Inserta un nuevo paquete y devuelve su UUID.
pub async fn insert_package(
    pool: &SqlitePool,
    name: &str,
    display_name: &str,
    version: &str,
    description: &str,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO custom_packages (id, name, display_name, version, description, json_path, zip_path)
         VALUES (?, ?, ?, ?, ?, '', NULL)"
    )
    .bind(&id)
    .bind(name)
    .bind(display_name)
    .bind(version)
    .bind(description)
    .execute(pool)
    .await?;
    Ok(id)
}

/// Obtiene un paquete por ID (con asset_ids). Devuelve None si no existe.
pub async fn get_package(pool: &SqlitePool, id: &str) -> Result<Option<CustomPackage>, AppError> {
    use sqlx::Row;
    let maybe_row = sqlx::query(
        "SELECT id, name, display_name, version, description, json_path, zip_path, created_at, updated_at
         FROM custom_packages WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    match maybe_row {
        None => Ok(None),
        Some(row) => {
            let pkg_id: String = row.get("id");
            let asset_ids = get_asset_ids(&pkg_id, pool).await?;
            Ok(Some(row_to_pkg(&row, asset_ids)))
        }
    }
}

/// Lista todos los paquetes con sus asset_ids.
pub async fn list_packages(pool: &SqlitePool) -> Result<Vec<CustomPackage>, AppError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, name, display_name, version, description, json_path, zip_path, created_at, updated_at
         FROM custom_packages ORDER BY created_at DESC"
    )
    .fetch_all(pool)
    .await?;

    let mut packages = Vec::new();
    for row in rows {
        let pkg_id: String = row.get("id");
        let asset_ids = get_asset_ids(&pkg_id, pool).await?;
        packages.push(row_to_pkg(&row, asset_ids));
    }
    Ok(packages)
}

/// Actualiza los campos editables y updated_at de un paquete.
pub async fn update_package(
    pool: &SqlitePool,
    id: &str,
    display_name: &str,
    version: &str,
    description: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE custom_packages
         SET display_name = ?, version = ?, description = ?, updated_at = datetime('now')
         WHERE id = ?"
    )
    .bind(display_name)
    .bind(version)
    .bind(description)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Actualiza json_path y zip_path tras el build del ZIP.
pub async fn update_package_paths(
    pool: &SqlitePool,
    id: &str,
    json_path: &str,
    zip_path: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE custom_packages
         SET json_path = ?, zip_path = ?, updated_at = datetime('now')
         WHERE id = ?"
    )
    .bind(json_path)
    .bind(zip_path)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Elimina un paquete (CASCADE elimina sus custom_package_assets).
pub async fn delete_package(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM custom_packages WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Reemplaza todos los assets de un paquete (borra + inserta en una transacción).
pub async fn set_package_assets(
    pool: &SqlitePool,
    package_id: &str,
    asset_ids: &[String],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM custom_package_assets WHERE package_id = ?")
        .bind(package_id)
        .execute(&mut *tx)
        .await?;

    for asset_id in asset_ids {
        sqlx::query(
            "INSERT INTO custom_package_assets (package_id, inventory_item_id) VALUES (?, ?)"
        )
        .bind(package_id)
        .bind(asset_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}