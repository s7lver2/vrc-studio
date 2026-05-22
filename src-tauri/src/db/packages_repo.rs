use rusqlite::{params, OptionalExtension};
use uuid::Uuid;
use crate::db::DbPool;
use crate::error::AppError;
use crate::models::CustomPackage;

// ── helpers ───────────────────────────────────────────────────────────────────

fn get_asset_ids(conn: &rusqlite::Connection, package_id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT inventory_item_id FROM custom_package_assets WHERE package_id = ?1"
    )?;
    let ids = stmt
        .query_map(params![package_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ids)
}

fn row_to_pkg(
    row: &rusqlite::Row<'_>,
    asset_ids: Vec<String>,
) -> Result<CustomPackage, rusqlite::Error> {
    Ok(CustomPackage {
        id:           row.get("id")?,
        name:         row.get("name")?,
        display_name: row.get("display_name")?,
        version:      row.get("version")?,
        description:  row.get("description")?,
        json_path:    row.get("json_path")?,
        zip_path:     row.get("zip_path")?,
        created_at:   row.get("created_at")?,
        updated_at:   row.get("updated_at")?,
        asset_ids,
    })
}

// ── public API ────────────────────────────────────────────────────────────────

/// Inserta un nuevo paquete y devuelve su UUID.
pub fn insert_package(
    pool: &DbPool,
    name: &str,
    display_name: &str,
    version: &str,
    description: &str,
) -> Result<String, AppError> {
    let conn = pool.get()?;
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO custom_packages (id, name, display_name, version, description, json_path, zip_path)
         VALUES (?1, ?2, ?3, ?4, ?5, '', NULL)",
        params![id, name, display_name, version, description],
    )?;
    Ok(id)
}

pub fn list_packages(pool: &DbPool) -> Result<Vec<CustomPackage>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM custom_packages ORDER BY created_at DESC")?;
    let rows: Vec<_> = stmt.query_map([], |row| {
        // asset_ids se rellenan después
        row_to_pkg(row, vec![])
    })?.collect::<Result<Vec<_>, _>>()?;

    // Cargar asset_ids para cada paquete
    rows.into_iter()
        .map(|mut pkg| {
            pkg.asset_ids = get_asset_ids(&conn, &pkg.id)?;
            Ok(pkg)
        })
        .collect()
}

pub fn get_package(pool: &DbPool, id: &str) -> Result<CustomPackage, AppError> {
    let conn = pool.get()?;
    let pkg = conn.query_row(
        "SELECT * FROM custom_packages WHERE id = ?1",
        params![id],
        |row| row_to_pkg(row, vec![]),
    ).optional()?.ok_or_else(|| AppError::NotFound(format!("package {}", id)))?;

    let asset_ids = get_asset_ids(&conn, &pkg.id)?;
    Ok(CustomPackage { asset_ids, ..pkg })
}

/// Actualiza los campos editables y updated_at de un paquete.
pub async fn update_package(
    pool: &DbPool,
    id: &str,
    display_name: &str,
    version: &str,
    description: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("UPDATE custom_packages
         SET display_name = ?, version = ?, description = ?, updated_at = datetime('now')
         WHERE id = ?", params![display_name, version, description, id])?;
    Ok(())
}

/// Actualiza json_path y zip_path tras el build del ZIP.
pub fn update_package_paths(
    pool: &DbPool,
    id: &str,
    json_path: &str,
    zip_path: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE custom_packages SET json_path = ?1, zip_path = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![json_path, zip_path, id],
    )?;
    Ok(())
}

/// Elimina un paquete (CASCADE elimina sus custom_package_assets).
pub fn delete_package(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM custom_packages WHERE id = ?1", params![id])?;
    Ok(())
}

/// Reemplaza todos los assets de un paquete (borra + inserta en una transacción).
pub fn set_package_assets(pool: &DbPool, package_id: &str, asset_ids: &[String]) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM custom_package_assets WHERE package_id = ?1", params![package_id])?;
    for asset_id in asset_ids {
        conn.execute(
            "INSERT OR IGNORE INTO custom_package_assets (package_id, inventory_item_id) VALUES (?1, ?2)",
            params![package_id, asset_id],
        )?;
    }
    Ok(())
}