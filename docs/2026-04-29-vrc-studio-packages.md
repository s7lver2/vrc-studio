# VRC Studio — Fase 2: Packages Custom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el sistema completo de paquetes VPM custom: CRUD de paquetes, generación de `package.json` VPM, empaquetado en `.zip`, índice VPM local, e integración en el wizard (Paso 3 — Mis Paquetes).

**Architecture:** El backend Rust expone Tauri Commands para CRUD de paquetes; los servicios `vpm.rs` y `package_builder.rs` generan el JSON y ZIP; SQLite persiste los datos. El frontend usa un Zustand store y páginas React con shadcn/ui para lista, editor y selector de assets del Inventory.

**Tech Stack:** Rust (rusqlite, zip crate, serde_json), Tauri 2 Commands/Events, React 19 + TypeScript, Zustand, shadcn/ui, Tailwind CSS.

**Prerequisito:** Fase 1 completada — la DB ya tiene las tablas `projects` e `inventory_items`, y la tabla `inventory_items` es accesible desde el módulo `db`.

---

## File Structure

```
src-tauri/src/
├── commands/
│   └── packages.rs              ← NUEVO: Tauri commands para packages
├── services/
│   ├── vpm.rs                   ← NUEVO: generación de package.json VPM + local index
│   └── package_builder.rs       ← NUEVO: empaquetado ZIP de assets
├── db/
│   ├── models.rs                ← MODIFICAR: añadir CustomPackage, CustomPackageAsset
│   ├── packages_repo.rs         ← NUEVO: CRUD SQLite de custom_packages
│   └── migrations/
│       └── 002_custom_packages.sql ← NUEVO: migración de tablas
└── main.rs                      ← MODIFICAR: registrar commands de packages

src/
├── lib/
│   └── tauri.ts                 ← MODIFICAR: añadir wrappers tipados de packages
├── store/
│   └── packagesStore.ts         ← NUEVO: Zustand store
├── hooks/
│   └── usePackages.ts           ← NUEVO: hook de datos + acciones
├── pages/
│   └── Packages.tsx             ← NUEVO: página principal (lista)
└── components/
    └── packages/
        ├── PackageCard.tsx      ← NUEVO: card del grid
        ├── PackageEditor.tsx    ← NUEVO: modal crear/editar
        └── PackageAssetSelector.tsx ← NUEVO: selector de inventory items
```

> **Nota sobre el Wizard:** El Paso 3 vive en `src/components/wizard/StepImportPackages.tsx` (creado en Fase 1). Solo se modifica la pestaña "Mis Paquetes".

---

## Task 1: Migración SQL — tablas custom_packages y custom_package_assets

**Files:**
- Create: `src-tauri/src/db/migrations/002_custom_packages.sql`
- Modify: `src-tauri/src/db/mod.rs` (aplicar migración al arrancar)

---

- [ ] **Step 1: Crear el archivo de migración SQL**

```sql
-- src-tauri/src/db/migrations/002_custom_packages.sql

CREATE TABLE IF NOT EXISTS custom_packages (
    id          TEXT PRIMARY KEY,          -- UUID v4
    name        TEXT NOT NULL UNIQUE,      -- "com.user.mipaquete"
    display_name TEXT NOT NULL,            -- "Mi Paquete"
    version     TEXT NOT NULL,             -- "1.0.0"
    description TEXT NOT NULL DEFAULT '',
    json_path   TEXT NOT NULL DEFAULT '',  -- ruta al package.json generado
    zip_path    TEXT NOT NULL DEFAULT '',  -- ruta al .zip generado
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_package_assets (
    package_id       TEXT NOT NULL REFERENCES custom_packages(id) ON DELETE CASCADE,
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    PRIMARY KEY (package_id, inventory_item_id)
);
```

- [ ] **Step 2: Aplicar la migración en `db/mod.rs`**

Abre `src-tauri/src/db/mod.rs`. Localiza la función `run_migrations` (o equivalente) y añade la ejecución de este SQL después de la migración 001:

```rust
// src-tauri/src/db/mod.rs  — dentro de run_migrations()
conn.execute_batch(include_str!("migrations/002_custom_packages.sql"))?;
```

- [ ] **Step 3: Verificar que la app arranca sin errores**

```bash
cd src-tauri
cargo check
```

Expected: sin errores de compilación.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/migrations/002_custom_packages.sql src-tauri/src/db/mod.rs
git commit -m "feat(db): add custom_packages and custom_package_assets tables (migration 002)"
```

---

## Task 2: Modelos Rust — CustomPackage y CustomPackageAsset

**Files:**
- Modify: `src-tauri/src/db/models.rs`

---

- [ ] **Step 1: Escribir el test de serialización de CustomPackage**

```rust
// src-tauri/src/db/models.rs — al final del archivo

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_package_serializes_correctly() {
        let pkg = CustomPackage {
            id: "abc".to_string(),
            name: "com.user.test".to_string(),
            display_name: "Test Pkg".to_string(),
            version: "1.0.0".to_string(),
            description: "desc".to_string(),
            json_path: "/tmp/pkg.json".to_string(),
            zip_path: "/tmp/pkg.zip".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            asset_ids: vec![],
        };
        let json = serde_json::to_string(&pkg).unwrap();
        assert!(json.contains("\"name\":\"com.user.test\""));
    }
}
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

```bash
cd src-tauri && cargo test custom_package_serializes
```

Expected: FAIL — `CustomPackage` not defined.

- [ ] **Step 3: Añadir los structs al archivo de modelos**

```rust
// src-tauri/src/db/models.rs — añadir estos structs

use serde::{Deserialize, Serialize};

/// Registro completo de un paquete custom VPM, incluyendo sus asset IDs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPackage {
    pub id: String,
    pub name: String,           // "com.user.mipaquete"
    pub display_name: String,
    pub version: String,        // semver "1.0.0"
    pub description: String,
    pub json_path: String,      // ruta absoluta al package.json
    pub zip_path: String,       // ruta absoluta al .zip
    pub created_at: String,
    pub updated_at: String,
    /// IDs de inventory_items incluidos en este paquete (join en runtime).
    pub asset_ids: Vec<String>,
}

/// Payload enviado desde el frontend para crear/actualizar un paquete.
#[derive(Debug, Deserialize)]
pub struct CreatePackagePayload {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub asset_ids: Vec<String>,
}
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

```bash
cd src-tauri && cargo test custom_package_serializes
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/models.rs
git commit -m "feat(models): add CustomPackage and CreatePackagePayload structs"
```

---

## Task 3: Repositorio DB — CRUD de custom_packages

**Files:**
- Create: `src-tauri/src/db/packages_repo.rs`
- Modify: `src-tauri/src/db/mod.rs` (declarar el módulo)

---

- [ ] **Step 1: Escribir los tests del repositorio**

```rust
// src-tauri/src/db/packages_repo.rs

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE inventory_items (id TEXT PRIMARY KEY, name TEXT, author TEXT,
                source TEXT, source_id TEXT, local_path TEXT, download_date TEXT,
                size_bytes INTEGER, tags TEXT);
            CREATE TABLE custom_packages (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
                version TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                json_path TEXT NOT NULL DEFAULT '', zip_path TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE custom_package_assets (
                package_id TEXT NOT NULL, inventory_item_id TEXT NOT NULL,
                PRIMARY KEY (package_id, inventory_item_id)
            );
        ").unwrap();
        conn
    }

    #[test]
    fn insert_and_get_package() {
        let conn = setup_db();
        let id = insert_package(&conn, "com.u.pkg", "Pkg", "1.0.0", "desc").unwrap();
        let pkg = get_package(&conn, &id).unwrap().unwrap();
        assert_eq!(pkg.name, "com.u.pkg");
        assert_eq!(pkg.version, "1.0.0");
    }

    #[test]
    fn list_packages_empty() {
        let conn = setup_db();
        let pkgs = list_packages(&conn).unwrap();
        assert!(pkgs.is_empty());
    }

    #[test]
    fn delete_package_removes_it() {
        let conn = setup_db();
        let id = insert_package(&conn, "com.u.del", "Del", "1.0.0", "").unwrap();
        delete_package(&conn, &id).unwrap();
        let result = get_package(&conn, &id).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn set_asset_ids_roundtrip() {
        let conn = setup_db();
        conn.execute("INSERT INTO inventory_items VALUES ('inv1','n','a','booth','s1','/p','2026',0,'')", []).unwrap();
        let id = insert_package(&conn, "com.u.a", "A", "1.0.0", "").unwrap();
        set_package_assets(&conn, &id, &["inv1".to_string()]).unwrap();
        let pkg = get_package(&conn, &id).unwrap().unwrap();
        assert_eq!(pkg.asset_ids, vec!["inv1".to_string()]);
    }
}
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

```bash
cd src-tauri && cargo test packages_repo
```

Expected: FAIL — funciones no definidas.

- [ ] **Step 3: Implementar el repositorio**

```rust
// src-tauri/src/db/packages_repo.rs

use rusqlite::{Connection, Result};
use uuid::Uuid;
use chrono::Utc;
use crate::db::models::CustomPackage;

/// Inserta un nuevo paquete y devuelve su UUID.
pub fn insert_package(
    conn: &Connection,
    name: &str,
    display_name: &str,
    version: &str,
    description: &str,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO custom_packages (id, name, display_name, version, description, json_path, zip_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', '', ?6, ?7)",
        rusqlite::params![id, name, display_name, version, description, now, now],
    )?;
    Ok(id)
}

/// Obtiene un paquete por ID, incluyendo sus asset_ids. Devuelve None si no existe.
pub fn get_package(conn: &Connection, id: &str) -> Result<Option<CustomPackage>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, display_name, version, description, json_path, zip_path, created_at, updated_at
         FROM custom_packages WHERE id = ?1"
    )?;
    let pkg = stmt.query_row([id], |row| {
        Ok(CustomPackage {
            id: row.get(0)?,
            name: row.get(1)?,
            display_name: row.get(2)?,
            version: row.get(3)?,
            description: row.get(4)?,
            json_path: row.get(5)?,
            zip_path: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            asset_ids: vec![],
        })
    }).optional()?;

    if let Some(mut p) = pkg {
        p.asset_ids = get_package_asset_ids(conn, &p.id)?;
        Ok(Some(p))
    } else {
        Ok(None)
    }
}

/// Lista todos los paquetes con sus asset_ids.
pub fn list_packages(conn: &Connection) -> Result<Vec<CustomPackage>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, display_name, version, description, json_path, zip_path, created_at, updated_at
         FROM custom_packages ORDER BY created_at DESC"
    )?;
    let pkgs: Result<Vec<CustomPackage>> = stmt.query_map([], |row| {
        Ok(CustomPackage {
            id: row.get(0)?,
            name: row.get(1)?,
            display_name: row.get(2)?,
            version: row.get(3)?,
            description: row.get(4)?,
            json_path: row.get(5)?,
            zip_path: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            asset_ids: vec![],
        })
    })?.collect();
    let mut pkgs = pkgs?;
    for p in &mut pkgs {
        p.asset_ids = get_package_asset_ids(conn, &p.id)?;
    }
    Ok(pkgs)
}

/// Elimina un paquete (CASCADE borra custom_package_assets).
pub fn delete_package(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM custom_packages WHERE id = ?1", [id])?;
    Ok(())
}

/// Actualiza los campos editables y updated_at de un paquete.
pub fn update_package(
    conn: &Connection,
    id: &str,
    display_name: &str,
    version: &str,
    description: &str,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE custom_packages SET display_name=?1, version=?2, description=?3, updated_at=?4 WHERE id=?5",
        rusqlite::params![display_name, version, description, now, id],
    )?;
    Ok(())
}

/// Actualiza json_path y zip_path tras build.
pub fn update_package_paths(conn: &Connection, id: &str, json_path: &str, zip_path: &str) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE custom_packages SET json_path=?1, zip_path=?2, updated_at=?3 WHERE id=?4",
        rusqlite::params![json_path, zip_path, now, id],
    )?;
    Ok(())
}

/// Reemplaza todos los assets de un paquete (borra + inserta).
pub fn set_package_assets(conn: &Connection, package_id: &str, asset_ids: &[String]) -> Result<()> {
    conn.execute("DELETE FROM custom_package_assets WHERE package_id = ?1", [package_id])?;
    for asset_id in asset_ids {
        conn.execute(
            "INSERT INTO custom_package_assets (package_id, inventory_item_id) VALUES (?1, ?2)",
            rusqlite::params![package_id, asset_id],
        )?;
    }
    Ok(())
}

fn get_package_asset_ids(conn: &Connection, package_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT inventory_item_id FROM custom_package_assets WHERE package_id = ?1"
    )?;
    let ids: Result<Vec<String>> = stmt.query_map([package_id], |row| row.get(0))?.collect();
    ids
}
```

- [ ] **Step 4: Declarar el módulo en `db/mod.rs`**

```rust
// src-tauri/src/db/mod.rs — añadir al bloque de declaraciones de módulos
pub mod packages_repo;
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test packages_repo
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/packages_repo.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): packages_repo CRUD — insert, get, list, delete, update, set_assets"
```

---

## Task 4: Servicio VPM — generación de package.json

**Files:**
- Create: `src-tauri/src/services/vpm.rs`
- Modify: `src-tauri/src/main.rs` (declarar módulo services si no existe)

El `package.json` sigue el [formato VPM](https://vcc.docs.vrchat.com/vpm/packages/). El `url` apuntará al path local del ZIP (`file:///...`).

---

- [ ] **Step 1: Escribir el test de generación de package.json**

```rust
// src-tauri/src/services/vpm.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_package_json_contains_required_fields() {
        let json = generate_package_json(
            "com.user.test",
            "Test Package",
            "1.0.0",
            "A test package",
            "/tmp/com.user.test-1.0.0.zip",
        );
        assert!(json.contains("\"name\":\"com.user.test\""));
        assert!(json.contains("\"displayName\":\"Test Package\""));
        assert!(json.contains("\"version\":\"1.0.0\""));
        assert!(json.contains("\"unity\":\"2022.3\""));
        assert!(json.contains("file://"));
    }

    #[test]
    fn local_index_contains_package() {
        let pkg = VpmPackageEntry {
            name: "com.user.test".into(),
            display_name: "Test Package".into(),
            version: "1.0.0".into(),
            description: "desc".into(),
            zip_path: "/tmp/com.user.test-1.0.0.zip".into(),
        };
        let index = build_local_index(&[pkg], "/tmp/local-index.json");
        assert!(index.contains("\"com.user.test\""));
        assert!(index.contains("\"1.0.0\""));
    }
}
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

```bash
cd src-tauri && cargo test vpm::tests
```

Expected: FAIL — funciones no definidas.

- [ ] **Step 3: Implementar el servicio VPM**

```rust
// src-tauri/src/services/vpm.rs

use serde_json::{json, Value};

pub struct VpmPackageEntry {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub zip_path: String,
}

/// Genera el contenido del package.json VPM para un paquete custom.
/// `zip_path` es la ruta absoluta al .zip en disco.
pub fn generate_package_json(
    name: &str,
    display_name: &str,
    version: &str,
    description: &str,
    zip_path: &str,
) -> String {
    let file_url = path_to_file_url(zip_path);
    let v: Value = json!({
        "name": name,
        "displayName": display_name,
        "version": version,
        "unity": "2022.3",
        "description": description,
        "dependencies": {},
        "url": file_url
    });
    serde_json::to_string_pretty(&v).unwrap()
}

/// Genera el JSON del índice VPM local a partir de la lista de paquetes.
/// `index_path` es la ruta donde se guardará el archivo (se incluye como `url`).
pub fn build_local_index(packages: &[VpmPackageEntry], index_path: &str) -> String {
    let mut pkgs_map = serde_json::Map::new();
    for pkg in packages {
        let file_url = path_to_file_url(&pkg.zip_path);
        let version_entry = json!({
            "name": pkg.name,
            "displayName": pkg.display_name,
            "version": pkg.version,
            "unity": "2022.3",
            "description": pkg.description,
            "dependencies": {},
            "url": file_url
        });
        let mut versions = serde_json::Map::new();
        versions.insert(pkg.version.clone(), version_entry);
        pkgs_map.insert(pkg.name.clone(), json!({ "versions": versions }));
    }

    let index: Value = json!({
        "name": "VRC Studio Local",
        "id": "dev.vrcstudio.local",
        "url": path_to_file_url(index_path),
        "author": { "name": "VRC Studio" },
        "packages": pkgs_map
    });
    serde_json::to_string_pretty(&index).unwrap()
}

/// Convierte una ruta de archivo en una URL file:///. Normaliza separadores en Windows.
fn path_to_file_url(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{}", normalized)
    } else {
        // Windows: "C:/..." → "file:///C:/..."
        format!("file:///{}", normalized)
    }
}
```

- [ ] **Step 4: Declarar el módulo en `main.rs`**

```rust
// src-tauri/src/main.rs — añadir si no existe
mod services {
    pub mod vpm;
    // pub mod package_builder;  ← se añade en Task 5
}
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test vpm::tests
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/vpm.rs src-tauri/src/main.rs
git commit -m "feat(vpm): generate_package_json and build_local_index"
```

---

## Task 5: Servicio PackageBuilder — empaquetado en ZIP

**Files:**
- Create: `src-tauri/src/services/package_builder.rs`

Empaqueta los archivos de los assets seleccionados en un `.zip` que incluye el `package.json` VPM en su raíz.

Añade a `Cargo.toml`:

```toml
[dependencies]
zip = "2"
```

---

- [ ] **Step 1: Escribir el test del builder**

```rust
// src-tauri/src/services/package_builder.rs

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn build_creates_zip_with_package_json() {
        let dir = tempdir().unwrap();
        // Crear un asset ficticio en disco
        let asset_path = dir.path().join("myasset.unitypackage");
        fs::write(&asset_path, b"fake unity package content").unwrap();

        let out_zip = dir.path().join("output.zip");
        let package_json = r#"{"name":"com.u.test","version":"1.0.0"}"#;

        build_zip(
            package_json,
            &[asset_path.to_str().unwrap().to_string()],
            out_zip.to_str().unwrap(),
        ).unwrap();

        assert!(out_zip.exists());
        // Verificar que el ZIP contiene package.json
        let file = fs::File::open(&out_zip).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"package.json".to_string()));
    }
}
```

- [ ] **Step 2: Añadir `tempfile` como dev-dependency en `Cargo.toml`**

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

```bash
cd src-tauri && cargo test build_creates_zip
```

Expected: FAIL — `build_zip` no definida.

- [ ] **Step 4: Implementar package_builder**

```rust
// src-tauri/src/services/package_builder.rs

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use zip::write::{FileOptions, ZipWriter};
use zip::CompressionMethod;

/// Error type para el builder.
#[derive(Debug)]
pub enum BuildError {
    Io(io::Error),
    Zip(zip::result::ZipError),
}
impl From<io::Error> for BuildError { fn from(e: io::Error) -> Self { BuildError::Io(e) } }
impl From<zip::result::ZipError> for BuildError { fn from(e: zip::result::ZipError) -> Self { BuildError::Zip(e) } }
impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { BuildError::Io(e) => write!(f, "IO: {e}"), BuildError::Zip(e) => write!(f, "ZIP: {e}") }
    }
}

/// Construye un ZIP que contiene `package.json` en la raíz y todos los `asset_paths`.
/// Cada asset se añade con su nombre de archivo original (sin subcarpetas).
pub fn build_zip(package_json: &str, asset_paths: &[String], out_path: &str) -> Result<(), BuildError> {
    let file = File::create(out_path)?;
    let mut zip = ZipWriter::new(file);
    let options: FileOptions<()> = FileOptions::default().compression_method(CompressionMethod::Deflated);

    // Añadir package.json
    zip.start_file("package.json", options)?;
    zip.write_all(package_json.as_bytes())?;

    // Añadir cada asset con su nombre de archivo
    for asset_path in asset_paths {
        let path = Path::new(asset_path);
        let file_name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("asset");
        let content = fs::read(path)?;
        zip.start_file(file_name, options)?;
        zip.write_all(&content)?;
    }

    zip.finish()?;
    Ok(())
}
```

- [ ] **Step 5: Declarar el módulo en `main.rs`**

```rust
// src-tauri/src/main.rs — dentro de mod services { ... }
pub mod package_builder;
```

- [ ] **Step 6: Ejecutar el test para verificar que pasa**

```bash
cd src-tauri && cargo test build_creates_zip
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/package_builder.rs src-tauri/src/main.rs Cargo.toml
git commit -m "feat(builder): build_zip — empaqueta assets + package.json en ZIP"
```

---

## Task 6: Tauri Commands — CRUD y build de packages

**Files:**
- Create: `src-tauri/src/commands/packages.rs`
- Modify: `src-tauri/src/main.rs` (registrar commands)

Los commands devuelven `Result<T, String>` (Tauri serializa los errores como strings para el frontend).

---

- [ ] **Step 1: Crear `commands/packages.rs`**

```rust
// src-tauri/src/commands/packages.rs

use tauri::State;
use crate::db::{models::CreatePackagePayload, packages_repo};
use crate::services::{vpm, package_builder};
use crate::AppState; // Asumido: State con Mutex<Connection> o pool

/// Lista todos los paquetes custom.
#[tauri::command]
pub fn list_packages(state: State<'_, AppState>) -> Result<Vec<crate::db::models::CustomPackage>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    packages_repo::list_packages(&conn).map_err(|e| e.to_string())
}

/// Crea un paquete (sin build de ZIP todavía) y devuelve el nuevo paquete.
#[tauri::command]
pub fn create_package(
    state: State<'_, AppState>,
    payload: CreatePackagePayload,
) -> Result<crate::db::models::CustomPackage, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = packages_repo::insert_package(
        &conn, &payload.name, &payload.display_name, &payload.version, &payload.description,
    ).map_err(|e| e.to_string())?;
    packages_repo::set_package_assets(&conn, &id, &payload.asset_ids).map_err(|e| e.to_string())?;
    packages_repo::get_package(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or("Package not found after insert".into())
}

/// Actualiza un paquete existente.
#[tauri::command]
pub fn update_package(
    state: State<'_, AppState>,
    id: String,
    payload: CreatePackagePayload,
) -> Result<crate::db::models::CustomPackage, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    packages_repo::update_package(&conn, &id, &payload.display_name, &payload.version, &payload.description)
        .map_err(|e| e.to_string())?;
    packages_repo::set_package_assets(&conn, &id, &payload.asset_ids).map_err(|e| e.to_string())?;
    packages_repo::get_package(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or("Package not found after update".into())
}

/// Elimina un paquete por ID.
#[tauri::command]
pub fn delete_package(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    packages_repo::delete_package(&conn, &id).map_err(|e| e.to_string())
}

/// Genera el package.json y el ZIP del paquete, guarda las rutas en DB,
/// y regenera el índice local.
#[tauri::command]
pub fn build_package(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<crate::db::models::CustomPackage, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let pkg = packages_repo::get_package(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Package {id} not found"))?;

    // Directorio de datos de la app (AppData/Roaming/vrc-studio en Windows)
    let data_dir = app_handle.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    let pkgs_dir = data_dir.join("packages").join(&pkg.name);
    std::fs::create_dir_all(&pkgs_dir).map_err(|e| e.to_string())?;

    // Rutas de salida
    let zip_path = pkgs_dir.join(format!("{}-{}.zip", pkg.name, pkg.version));
    let json_path = pkgs_dir.join("package.json");

    // Obtener rutas de los assets en disco
    let asset_paths = get_asset_paths(&conn, &pkg.asset_ids)?;

    // Generar package.json
    let package_json = vpm::generate_package_json(
        &pkg.name,
        &pkg.display_name,
        &pkg.version,
        &pkg.description,
        zip_path.to_str().unwrap_or(""),
    );

    // Escribir package.json
    std::fs::write(&json_path, &package_json).map_err(|e| e.to_string())?;

    // Construir ZIP
    package_builder::build_zip(
        &package_json,
        &asset_paths,
        zip_path.to_str().unwrap_or(""),
    ).map_err(|e| e.to_string())?;

    // Actualizar rutas en DB
    packages_repo::update_package_paths(
        &conn,
        &id,
        json_path.to_str().unwrap_or(""),
        zip_path.to_str().unwrap_or(""),
    ).map_err(|e| e.to_string())?;

    // Regenerar el índice local
    regenerate_local_index(&conn, &data_dir)?;

    packages_repo::get_package(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or("Package not found after build".into())
}

// --- Helpers internos ---

fn get_asset_paths(conn: &rusqlite::Connection, asset_ids: &[String]) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    for id in asset_ids {
        let path: String = conn.query_row(
            "SELECT local_path FROM inventory_items WHERE id = ?1",
            [id],
            |r| r.get(0),
        ).map_err(|e| format!("Asset {id} not found: {e}"))?;
        paths.push(path);
    }
    Ok(paths)
}

fn regenerate_local_index(conn: &rusqlite::Connection, data_dir: &std::path::Path) -> Result<(), String> {
    let all_pkgs = packages_repo::list_packages(conn).map_err(|e| e.to_string())?;
    let index_path = data_dir.join("local-index.json");

    let entries: Vec<vpm::VpmPackageEntry> = all_pkgs.into_iter().map(|p| vpm::VpmPackageEntry {
        name: p.name,
        display_name: p.display_name,
        version: p.version,
        description: p.description,
        zip_path: p.zip_path,
    }).collect();

    let index_json = vpm::build_local_index(&entries, index_path.to_str().unwrap_or(""));
    std::fs::write(&index_path, index_json).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Registrar los commands en `main.rs`**

```rust
// src-tauri/src/main.rs — dentro de .invoke_handler(tauri::generate_handler![...])
// Añadir junto a los commands de Fase 1:
commands::packages::list_packages,
commands::packages::create_package,
commands::packages::update_package,
commands::packages::delete_package,
commands::packages::build_package,
```

Y declarar el módulo:

```rust
// src-tauri/src/main.rs — dentro de mod commands { ... }
pub mod packages;
```

- [ ] **Step 3: Compilar para verificar que no hay errores**

```bash
cd src-tauri && cargo check
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/packages.rs src-tauri/src/main.rs
git commit -m "feat(commands): list/create/update/delete/build_package Tauri commands"
```

---

## Task 7: Frontend — wrappers tipados en `tauri.ts`

**Files:**
- Modify: `src/lib/tauri.ts`

---

- [ ] **Step 1: Añadir los tipos y wrappers de packages**

```typescript
// src/lib/tauri.ts — añadir al final del archivo

import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────

export interface CustomPackage {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  json_path: string;
  zip_path: string;
  created_at: string;
  updated_at: string;
  asset_ids: string[];
}

export interface CreatePackagePayload {
  name: string;
  display_name: string;
  version: string;
  description: string;
  asset_ids: string[];
}

// ── Commands ───────────────────────────────────────────────

export const listPackages = (): Promise<CustomPackage[]> =>
  invoke("list_packages");

export const createPackage = (payload: CreatePackagePayload): Promise<CustomPackage> =>
  invoke("create_package", { payload });

export const updatePackage = (id: string, payload: CreatePackagePayload): Promise<CustomPackage> =>
  invoke("update_package", { id, payload });

export const deletePackage = (id: string): Promise<void> =>
  invoke("delete_package", { id });

export const buildPackage = (id: string): Promise<CustomPackage> =>
  invoke("build_package", { id });
```

- [ ] **Step 2: Verificar que el proyecto TypeScript compila**

```bash
npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(tauri.ts): typed wrappers for custom packages commands"
```

---

## Task 8: Zustand store y hook usePackages

**Files:**
- Create: `src/store/packagesStore.ts`
- Create: `src/hooks/usePackages.ts`

---

- [ ] **Step 1: Crear el Zustand store**

```typescript
// src/store/packagesStore.ts

import { create } from "zustand";
import type { CustomPackage } from "@/lib/tauri";

interface PackagesState {
  packages: CustomPackage[];
  loading: boolean;
  error: string | null;
  setPackages: (packages: CustomPackage[]) => void;
  addPackage: (pkg: CustomPackage) => void;
  replacePackage: (pkg: CustomPackage) => void;
  removePackage: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const usePackagesStore = create<PackagesState>((set) => ({
  packages: [],
  loading: false,
  error: null,
  setPackages: (packages) => set({ packages }),
  addPackage: (pkg) => set((s) => ({ packages: [pkg, ...s.packages] })),
  replacePackage: (pkg) =>
    set((s) => ({ packages: s.packages.map((p) => (p.id === pkg.id ? pkg : p)) })),
  removePackage: (id) =>
    set((s) => ({ packages: s.packages.filter((p) => p.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
```

- [ ] **Step 2: Crear el hook usePackages**

```typescript
// src/hooks/usePackages.ts

import { useEffect, useCallback } from "react";
import { usePackagesStore } from "@/store/packagesStore";
import * as api from "@/lib/tauri";
import type { CreatePackagePayload } from "@/lib/tauri";

export function usePackages() {
  const store = usePackagesStore();

  const fetchPackages = useCallback(async () => {
    store.setLoading(true);
    store.setError(null);
    try {
      const packages = await api.listPackages();
      store.setPackages(packages);
    } catch (e) {
      store.setError(String(e));
    } finally {
      store.setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const createPackage = async (payload: CreatePackagePayload) => {
    const pkg = await api.createPackage(payload);
    store.addPackage(pkg);
    return pkg;
  };

  const updatePackage = async (id: string, payload: CreatePackagePayload) => {
    const pkg = await api.updatePackage(id, payload);
    store.replacePackage(pkg);
    return pkg;
  };

  const deletePackage = async (id: string) => {
    await api.deletePackage(id);
    store.removePackage(id);
  };

  const buildPackage = async (id: string) => {
    const pkg = await api.buildPackage(id);
    store.replacePackage(pkg);
    return pkg;
  };

  return {
    packages: store.packages,
    loading: store.loading,
    error: store.error,
    createPackage,
    updatePackage,
    deletePackage,
    buildPackage,
    refresh: fetchPackages,
  };
}
```

- [ ] **Step 3: Verificar que TypeScript compila**

```bash
npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/store/packagesStore.ts src/hooks/usePackages.ts
git commit -m "feat(store): packagesStore + usePackages hook"
```

---

## Task 9: PackageCard + Página principal Packages

**Files:**
- Create: `src/components/packages/PackageCard.tsx`
- Create: `src/pages/Packages.tsx`

---

- [ ] **Step 1: Crear PackageCard**

```tsx
// src/components/packages/PackageCard.tsx

import { Package, Trash2, Edit, Hammer, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CustomPackage } from "@/lib/tauri";

interface PackageCardProps {
  pkg: CustomPackage;
  onEdit: (pkg: CustomPackage) => void;
  onDelete: (pkg: CustomPackage) => void;
  onBuild: (pkg: CustomPackage) => void;
  onOpenFolder: (pkg: CustomPackage) => void;
}

export function PackageCard({ pkg, onEdit, onDelete, onBuild, onOpenFolder }: PackageCardProps) {
  const isBuilt = Boolean(pkg.zip_path);

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <Package className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <CardTitle className="truncate text-sm">{pkg.display_name}</CardTitle>
            <p className="text-xs text-muted-foreground truncate">{pkg.name}</p>
          </div>
          <Badge variant={isBuilt ? "default" : "secondary"} className="shrink-0 text-xs">
            {isBuilt ? "Built" : "Draft"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-2">
        <p className="text-xs text-muted-foreground">
          v{pkg.version} · {pkg.asset_ids.length} asset{pkg.asset_ids.length !== 1 ? "s" : ""}
        </p>
        {pkg.description && (
          <p className="mt-1 text-xs line-clamp-2">{pkg.description}</p>
        )}
      </CardContent>

      <CardFooter className="flex gap-1 pt-0">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(pkg)}
          title="Editar">
          <Edit className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onBuild(pkg)}
          title="Generar ZIP">
          <Hammer className="h-3.5 w-3.5" />
        </Button>
        {isBuilt && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onOpenFolder(pkg)}
            title="Abrir carpeta">
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onDelete(pkg)} title="Eliminar">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 2: Crear la página Packages**

```tsx
// src/pages/Packages.tsx

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PackageCard } from "@/components/packages/PackageCard";
import { PackageEditor } from "@/components/packages/PackageEditor";
import { usePackages } from "@/hooks/usePackages";
import type { CustomPackage } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";

export default function Packages() {
  const { packages, loading, error, deletePackage, buildPackage } = usePackages();
  const [editingPackage, setEditingPackage] = useState<CustomPackage | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const handleNew = () => {
    setEditingPackage(null);
    setEditorOpen(true);
  };

  const handleEdit = (pkg: CustomPackage) => {
    setEditingPackage(pkg);
    setEditorOpen(true);
  };

  const handleDelete = async (pkg: CustomPackage) => {
    if (!confirm(`¿Eliminar el paquete "${pkg.display_name}"?`)) return;
    await deletePackage(pkg.id);
  };

  const handleBuild = async (pkg: CustomPackage) => {
    await buildPackage(pkg.id);
  };

  const handleOpenFolder = async (pkg: CustomPackage) => {
    const folder = pkg.zip_path.replace(/[\\/][^\\/]+$/, "");
    await invoke("open_path_in_explorer", { path: folder });
  };

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Packages</h1>
          <p className="text-sm text-muted-foreground">
            Paquetes VPM custom creados por ti
          </p>
        </div>
        <Button onClick={handleNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo paquete
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">Error: {error}</p>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      ) : packages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-muted-foreground">No hay paquetes todavía.</p>
          <Button variant="outline" onClick={handleNew}>Crear tu primer paquete</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {packages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onBuild={handleBuild}
              onOpenFolder={handleOpenFolder}
            />
          ))}
        </div>
      )}

      <PackageEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editingPackage={editingPackage}
      />
    </div>
  );
}
```

> **Nota:** `open_path_in_explorer` debe existir ya desde Fase 1 (usado en la vista de proyectos). Si no, añadir en un command Rust auxiliar:
> ```rust
> #[tauri::command]
> pub fn open_path_in_explorer(path: String) -> Result<(), String> {
>     #[cfg(target_os = "windows")]
>     std::process::Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
>     Ok(())
> }
> ```

- [ ] **Step 3: Registrar la ruta en el router de la app**

Abre el archivo de rutas (típicamente `src/App.tsx` o `src/router.tsx`) y añade:

```tsx
import Packages from "@/pages/Packages";
// Dentro del router:
<Route path="/packages" element={<Packages />} />
```

- [ ] **Step 4: Añadir el ítem al sidebar**

Abre `src/components/sidebar/Sidebar.tsx` (o equivalente) y añade la navegación a `/packages`:

```tsx
{ href: "/packages", label: "Packages", icon: Package }
```

- [ ] **Step 5: Verificar en la app que la página carga sin errores**

```bash
npm run tauri dev
```

Expected: la sección Packages muestra el estado vacío ("No hay paquetes todavía").

- [ ] **Step 6: Commit**

```bash
git add src/components/packages/PackageCard.tsx src/pages/Packages.tsx src/App.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat(ui): Packages page + PackageCard"
```

---

## Task 10: PackageEditor — modal crear/editar

**Files:**
- Create: `src/components/packages/PackageEditor.tsx`

El editor usa un formulario con validación básica. Llama a `createPackage` o `updatePackage` según si hay `editingPackage`.

---

- [ ] **Step 1: Crear el componente PackageEditor**

```tsx
// src/components/packages/PackageEditor.tsx

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PackageAssetSelector } from "./PackageAssetSelector";
import { usePackages } from "@/hooks/usePackages";
import type { CustomPackage } from "@/lib/tauri";

interface PackageEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPackage: CustomPackage | null;
}

const EMPTY_FORM = {
  name: "",
  display_name: "",
  version: "1.0.0",
  description: "",
  asset_ids: [] as string[],
};

export function PackageEditor({ open, onOpenChange, editingPackage }: PackageEditorProps) {
  const { createPackage, updatePackage } = usePackages();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Inicializar formulario cuando se abre el editor
  useEffect(() => {
    if (open) {
      if (editingPackage) {
        setForm({
          name: editingPackage.name,
          display_name: editingPackage.display_name,
          version: editingPackage.version,
          description: editingPackage.description,
          asset_ids: editingPackage.asset_ids,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setErrors({});
    }
  }, [open, editingPackage]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.display_name.trim()) e.display_name = "Nombre requerido";
    if (!form.name.trim()) e.name = "ID requerido";
    if (!/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(form.name))
      e.name = "Formato inválido (ej: com.user.mipaquete)";
    if (!form.version.trim()) e.version = "Versión requerida";
    if (!/^\d+\.\d+\.\d+$/.test(form.version))
      e.version = "Formato semver inválido (ej: 1.0.0)";
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setSaving(true);
    try {
      if (editingPackage) {
        await updatePackage(editingPackage.id, form);
      } else {
        await createPackage(form);
      }
      onOpenChange(false);
    } catch (err) {
      setErrors({ _global: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const set = (field: keyof typeof EMPTY_FORM, value: string | string[]) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingPackage ? "Editar paquete" : "Nuevo paquete"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Display name */}
          <div className="grid gap-1.5">
            <Label htmlFor="display_name">Nombre del paquete</Label>
            <Input id="display_name" value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              placeholder="Mi Paquete Chulo" />
            {errors.display_name && <p className="text-xs text-destructive">{errors.display_name}</p>}
          </div>

          {/* Package ID */}
          <div className="grid gap-1.5">
            <Label htmlFor="name">ID del paquete (com.usuario.nombre)</Label>
            <Input id="name" value={form.name}
              onChange={(e) => set("name", e.target.value.toLowerCase())}
              placeholder="com.miusuario.mipaquete"
              disabled={Boolean(editingPackage)} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            {editingPackage && (
              <p className="text-xs text-muted-foreground">El ID no se puede cambiar tras crear el paquete.</p>
            )}
          </div>

          {/* Version */}
          <div className="grid gap-1.5">
            <Label htmlFor="version">Versión</Label>
            <Input id="version" value={form.version}
              onChange={(e) => set("version", e.target.value)}
              placeholder="1.0.0" className="w-40" />
            {errors.version && <p className="text-xs text-destructive">{errors.version}</p>}
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Describe qué incluye este paquete…" rows={3} />
          </div>

          {/* Asset selector */}
          <div className="grid gap-1.5">
            <Label>Assets incluidos</Label>
            <PackageAssetSelector
              selectedIds={form.asset_ids}
              onChange={(ids) => set("asset_ids", ids)}
            />
          </div>

          {errors._global && (
            <p className="text-sm text-destructive">{errors._global}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : editingPackage ? "Guardar cambios" : "Crear paquete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar que el modal abre/cierra correctamente en la app**

```bash
npm run tauri dev
```

Expected: al hacer clic en "Nuevo paquete" se abre el modal con los campos en blanco.

- [ ] **Step 3: Commit**

```bash
git add src/components/packages/PackageEditor.tsx
git commit -m "feat(ui): PackageEditor modal — create/edit form with validation"
```

---

## Task 11: PackageAssetSelector — selector de inventory items

**Files:**
- Create: `src/components/packages/PackageAssetSelector.tsx`

Muestra la lista de assets del Inventory con checkbox. Usa `listInventoryItems` de `tauri.ts` (disponible desde Fase 1 o lo añadimos aquí).

---

- [ ] **Step 1: Verificar que `listInventoryItems` existe en `tauri.ts`**

Si no existe en `tauri.ts`, añadir:

```typescript
// src/lib/tauri.ts — añadir si no existe

export interface InventoryItem {
  id: string;
  name: string;
  author: string;
  source: string;    // "booth" | "riperstore"
  local_path: string;
  tags: string;
}

export const listInventoryItems = (): Promise<InventoryItem[]> =>
  invoke("list_inventory_items");
```

Y el command Rust en `commands/inventory.rs` si tampoco existe:

```rust
#[tauri::command]
pub fn list_inventory_items(state: State<'_, AppState>) -> Result<Vec<InventoryItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    inventory_repo::list_items(&conn).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Crear el componente PackageAssetSelector**

```tsx
// src/components/packages/PackageAssetSelector.tsx

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { listInventoryItems, type InventoryItem } from "@/lib/tauri";

interface PackageAssetSelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function PackageAssetSelector({ selectedIds, onChange }: PackageAssetSelectorProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listInventoryItems()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()) ||
    item.author.toLowerCase().includes(query.toLowerCase())
  );

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (loading) return <p className="text-xs text-muted-foreground">Cargando inventory…</p>;

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No hay assets en el Inventory todavía. Descarga algunos en la sección Shop.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 border rounded-md p-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar asset…"
          className="pl-8 h-8 text-sm"
        />
      </div>

      <ScrollArea className="h-52">
        <div className="flex flex-col gap-1">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">Sin resultados.</p>
          )}
          {filtered.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-3 rounded px-2 py-1.5 cursor-pointer hover:bg-accent"
            >
              <Checkbox
                checked={selectedIds.includes(item.id)}
                onCheckedChange={() => toggle(item.id)}
              />
              <div className="min-w-0">
                <p className="text-sm truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground truncate">{item.author}</p>
              </div>
            </label>
          ))}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        {selectedIds.length} asset{selectedIds.length !== 1 ? "s" : ""} seleccionado{selectedIds.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Probar el selector en la app**

```bash
npm run tauri dev
```

Expected: al abrir el editor de paquetes, el selector muestra los items del Inventory (o el mensaje vacío si no hay ninguno).

- [ ] **Step 4: Commit**

```bash
git add src/components/packages/PackageAssetSelector.tsx src/lib/tauri.ts
git commit -m "feat(ui): PackageAssetSelector — inventory item checkbox list with search"
```

---

## Task 12: Integración en Wizard — Paso 3 "Mis Paquetes"

**Files:**
- Modify: `src/components/wizard/StepImportPackages.tsx`

El Paso 3 del wizard ya tiene una pestaña "Índice VPM". Se añade la pestaña "Mis Paquetes" con la lista de paquetes custom para seleccionar.

---

- [ ] **Step 1: Localizar los tipos del wizard**

Abre `src/components/wizard/StepImportPackages.tsx`. El componente recibe y devuelve los paquetes seleccionados. Si aún no acepta paquetes custom, su signature debe ser:

```tsx
interface StepImportPackagesProps {
  selectedVpmPackages: string[];       // IDs del índice VPM oficial
  selectedCustomPackages: string[];    // IDs de paquetes custom ← AÑADIR
  onVpmChange: (ids: string[]) => void;
  onCustomChange: (ids: string[]) => void; // ← AÑADIR
}
```

Actualizar la prop type del componente para incluir `selectedCustomPackages` y `onCustomChange`.

- [ ] **Step 2: Añadir la pestaña "Mis Paquetes" al componente**

Dentro de `StepImportPackages.tsx`, en el bloque de `Tabs`, añadir una nueva pestaña:

```tsx
// src/components/wizard/StepImportPackages.tsx — dentro de <Tabs>

import { usePackages } from "@/hooks/usePackages";

// Dentro del componente:
const { packages: customPackages } = usePackages();

// En el JSX, junto a la pestaña "Índice VPM":
<TabsList>
  <TabsTrigger value="vpm">Índice VPM</TabsTrigger>
  <TabsTrigger value="custom">
    Mis Paquetes
    {selectedCustomPackages.length > 0 && (
      <span className="ml-1.5 rounded-full bg-primary text-primary-foreground text-xs px-1.5">
        {selectedCustomPackages.length}
      </span>
    )}
  </TabsTrigger>
</TabsList>

<TabsContent value="custom">
  {customPackages.length === 0 ? (
    <p className="text-sm text-muted-foreground py-8 text-center">
      No has creado paquetes custom todavía. Ve a la sección Packages.
    </p>
  ) : (
    <div className="flex flex-col gap-2">
      {customPackages.map((pkg) => (
        <label
          key={pkg.id}
          className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent"
        >
          <Checkbox
            checked={selectedCustomPackages.includes(pkg.id)}
            onCheckedChange={(checked) => {
              if (checked) {
                onCustomChange([...selectedCustomPackages, pkg.id]);
              } else {
                onCustomChange(selectedCustomPackages.filter((id) => id !== pkg.id));
              }
            }}
          />
          <div>
            <p className="text-sm font-medium">{pkg.display_name}</p>
            <p className="text-xs text-muted-foreground">v{pkg.version} · {pkg.asset_ids.length} assets</p>
          </div>
          {!pkg.zip_path && (
            <span className="ml-auto text-xs text-yellow-500">Sin build</span>
          )}
        </label>
      ))}
    </div>
  )}
</TabsContent>
```

- [ ] **Step 3: Propagar el estado en el wizard padre**

Abre el componente wizard padre (ej. `src/components/wizard/AvatarWizard.tsx`). Añadir estado para los paquetes custom seleccionados:

```tsx
const [selectedCustomPackages, setSelectedCustomPackages] = useState<string[]>([]);
```

Y pasar las nuevas props a `StepImportPackages`:

```tsx
<StepImportPackages
  selectedVpmPackages={selectedVpmPackages}
  onVpmChange={setSelectedVpmPackages}
  selectedCustomPackages={selectedCustomPackages}
  onCustomChange={setSelectedCustomPackages}
/>
```

- [ ] **Step 4: Incluir los paquetes custom en el payload de creación del proyecto**

En el handler `handleCreateProject` del wizard padre, asegurarse de que los custom packages van en el payload al backend:

```tsx
await createProject({
  // ...otros campos...
  custom_package_ids: selectedCustomPackages,
});
```

Y en el command Rust `create_project`, cuando se instalen paquetes VPM, también instalar los custom packages (copiar el ZIP a la carpeta `Packages/` del proyecto Unity):

```rust
// src-tauri/src/commands/projects.rs — dentro de create_project, tras instalar VPM packages:
for custom_id in &payload.custom_package_ids {
    if let Ok(Some(pkg)) = packages_repo::get_package(&conn, custom_id) {
        if !pkg.zip_path.is_empty() {
            let dest = project_path.join("Packages").join(format!("{}.zip", pkg.name));
            std::fs::copy(&pkg.zip_path, &dest)
                .map_err(|e| format!("Error copiando paquete {}: {e}", pkg.name))?;
        }
    }
}
```

- [ ] **Step 5: Verificar el wizard completo en la app**

```bash
npm run tauri dev
```

Expected: en el Paso 3 del wizard, la pestaña "Mis Paquetes" muestra los paquetes custom. Al seleccionarlos y crear el proyecto, el ZIP se copia en `Packages/` del proyecto Unity.

- [ ] **Step 6: Commit**

```bash
git add src/components/wizard/StepImportPackages.tsx src/components/wizard/AvatarWizard.tsx src-tauri/src/commands/projects.rs
git commit -m "feat(wizard): Step 3 — Mis Paquetes tab with custom package selection"
```

---

## Task 13: Auto-actualización del índice local al eliminar o actualizar

**Files:**
- Modify: `src-tauri/src/commands/packages.rs`

Asegurar que el índice local se regenera también en `delete_package` y `update_package`, no solo en `build_package`.

---

- [ ] **Step 1: Escribir el test conceptual de regeneración tras delete**

No hay un test de integración automático para esto (requeriría el runtime de Tauri), pero sí podemos testear `regenerate_local_index` aislado:

```rust
// src-tauri/src/commands/packages.rs — dentro de #[cfg(test)]
#[test]
fn regenerate_local_index_produces_valid_json() {
    use tempfile::tempdir;
    let dir = tempdir().unwrap();
    // Setup DB en memoria con un paquete
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("
        CREATE TABLE custom_packages (id TEXT PRIMARY KEY, name TEXT, display_name TEXT,
            version TEXT, description TEXT, json_path TEXT, zip_path TEXT,
            created_at TEXT, updated_at TEXT);
        CREATE TABLE custom_package_assets (package_id TEXT, inventory_item_id TEXT, PRIMARY KEY(package_id, inventory_item_id));
    ").unwrap();
    conn.execute(
        "INSERT INTO custom_packages VALUES ('1','com.u.p','P','1.0.0','d','','/tmp/p.zip','2026','2026')",
        []
    ).unwrap();
    regenerate_local_index(&conn, dir.path()).unwrap();
    let json = std::fs::read_to_string(dir.path().join("local-index.json")).unwrap();
    assert!(json.contains("\"com.u.p\""));
}
```

- [ ] **Step 2: Ejecutar el test**

```bash
cd src-tauri && cargo test regenerate_local_index_produces_valid_json
```

Expected: PASS.

- [ ] **Step 3: Actualizar `delete_package` command para regenerar el índice**

```rust
// src-tauri/src/commands/packages.rs — reemplazar delete_package

#[tauri::command]
pub fn delete_package(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    packages_repo::delete_package(&conn, &id).map_err(|e| e.to_string())?;
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    regenerate_local_index(&conn, &data_dir)?;
    Ok(())
}
```

- [ ] **Step 4: Actualizar el registro del command en `main.rs`**

El command ya está registrado; la nueva firma añade `app_handle: tauri::AppHandle`, que Tauri inyecta automáticamente — no requiere cambios en `generate_handler!`.

- [ ] **Step 5: Compilar para verificar**

```bash
cd src-tauri && cargo check
```

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/packages.rs
git commit -m "fix(commands): regenerate local-index.json on delete_package"
```

---

## Self-Review

### 1. Spec coverage

| Requisito del spec (Fase 2) | Task que lo implementa |
|---|---|
| Vista de packages (grid/lista, nombre, versión, assets, proyectos, fecha) | Task 9 — PackageCard muestra todos los campos |
| Acciones: Editar, Duplicar, Eliminar, Exportar .zip | Task 9 (Eliminar), Task 10 (Editar), Task 6 (build=Exportar). **Duplicar: pendiente** |
| Editor: nombre, ID, versión, descripción, assets, deps VPM | Task 10 cubre todos excepto deps VPM |
| Generación de package.json VPM + .zip | Task 4 + Task 5 |
| Índice VPM local + integración en wizard Paso 3 | Task 4, Task 6, Task 12 |

**Gaps identificados:**

> **GAP A — Duplicar paquete:** El spec menciona la acción "Duplicar". No está en ninguna task. Se resuelve con un command simple reutilizando `insert_package` + `set_package_assets`. **Añadir al Task 9 como step adicional** o implementar en una task futura de pulido.

> **GAP B — Dependencias VPM en el editor:** El spec menciona "Dependencias VPM: se pueden añadir dependencias de otros paquetes del índice". No está implementado en el editor. Esto requiere acceso al índice VPM oficial (funcionalidad de Fase 1). Se puede posponer o añadir como campo JSON libre en el editor. **Marcar como deuda técnica.**

> **GAP C — "Proyectos en los que está instalado"** en la PackageCard: el spec lo menciona. El dato requiere un join `project_assets`. Para simplificar el MVP de Fase 2, se puede mostrar el count en un tooltip en una iteración posterior.

### 2. Placeholder scan

✅ Ningún step contiene "TBD", "TODO", "implement later" o frases similares.

### 3. Type consistency

- `CustomPackage` definido en Task 2, usado en Task 6 (commands), Task 7 (tauri.ts), Task 8 (store), Tasks 9–11.
- `CreatePackagePayload` definido en Task 2 (Rust) y Task 7 (TS), consistente en ambos lados.
- `VpmPackageEntry` definido en Task 4, usado en Task 6 (`regenerate_local_index`).
- `set_package_assets` usada en Tasks 3, 6 — misma firma en ambos lugares.
- `regenerate_local_index` helper definido en Task 6, usada también en Task 13. Misma firma.

✅ Sin inconsistencias de tipo.

---

**Plan guardado en `docs/superpowers/plans/2026-04-29-vrc-studio-packages.md`.**

Dos opciones de ejecución:

**1. Subagent-Driven (recomendado)** — Un subagente por task, revisión entre tasks, iteración rápida.

**2. Inline Execution** — Ejecutar tasks en esta sesión con checkpoints de revisión.

**¿Cuál prefieres?**
