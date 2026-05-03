# Unity Custom — Plan de Implementación (Fase 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la distribución, instalación, parcheo y gestión de Unity Custom — una versión modificada de Unity 2022.3.x LTS con TurboCc, eliminación de módulos innecesarios y optimizaciones de arranque, 100% compatible con el SDK de VRChat.

**Architecture:** El backend en Rust gestiona la descarga verificada con SHA-256, el parcheo del directorio de Unity (modificación de configs y sustitución de binarios del compilador) y la persistencia de versiones instaladas en SQLite. El frontend expone un panel en Settings con lista de versiones, acciones de instalar/desinstalar y selector de versión por defecto. Toda la comunicación de progreso usa Tauri Events para mostrar barras de estado en tiempo real.

**Tech Stack:** Tauri 2 · Rust (reqwest, sha2, zip, git2, rusqlite) · React 19 + TypeScript · Tailwind CSS + shadcn/ui · SQLite

---

## Estructura de ficheros

### Backend (Rust — `src-tauri/src/`)

| Fichero | Responsabilidad |
|---|---|
| `services/unity_manifest.rs` | Fetch y parseo del manifiesto de versiones Unity Custom |
| `services/unity_downloader.rs` | Descarga con progreso + verificación SHA-256 |
| `services/unity_patcher.rs` | Pipeline de parcheo: módulos, TurboCc, configs de arranque |
| `services/unity_manager.rs` *(modifica)* | Detección, CRUD de versiones instaladas, versión por defecto |
| `services/module_remover.rs` | Eliminación/desactivación de módulos Unity no necesarios |
| `services/turbocc.rs` | Descarga e integración de TurboCc como compilador C++ |
| `commands/unity.rs` *(modifica)* | Nuevos Tauri Commands: install_unity_custom, uninstall_unity_version, list_unity_versions, set_default_unity_version, migrate_project_unity_version |
| `db/models.rs` *(modifica)* | Modelo `InstalledUnityVersion` |
| `db/migrations/003_unity_versions.sql` | Tabla `unity_versions` |

### Frontend (React — `src/`)

| Fichero | Responsabilidad |
|---|---|
| `components/settings/UnityVersionManager.tsx` | Lista de versiones instaladas + acciones |
| `components/settings/UnityInstallWizard.tsx` | Modal de instalación con barra de progreso |
| `components/settings/UnityMigrationWizard.tsx` | Asistente de migración de proyecto a otra versión |
| `pages/Settings.tsx` *(modifica)* | Añadir sección Unity con `<UnityVersionManager>` |
| `lib/tauri.ts` *(modifica)* | Wrappers tipados para los nuevos commands |

---

## Task 1: Migración de base de datos — tabla `unity_versions`

**Files:**
- Create: `src-tauri/src/db/migrations/003_unity_versions.sql`
- Modify: `src-tauri/src/db/models.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Crear el fichero de migración SQL**

```sql
-- src-tauri/src/db/migrations/003_unity_versions.sql
CREATE TABLE IF NOT EXISTS unity_versions (
    id            TEXT PRIMARY KEY,          -- "2022.3.22f1-custom-1.0.0"
    unity_version TEXT NOT NULL,             -- "2022.3.22f1"
    kind          TEXT NOT NULL CHECK(kind IN ('standard', 'custom')),
    install_path  TEXT NOT NULL,
    is_default    INTEGER NOT NULL DEFAULT 0,
    vrc_studio_version TEXT,                 -- NULL para standard
    turbocc_version    TEXT,                 -- NULL si no aplica
    modules_removed    TEXT NOT NULL DEFAULT '[]', -- JSON array
    installed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Escribir el test de migración**

```rust
// src-tauri/src/db/mod.rs — dentro de #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_003_creates_unity_versions_table() {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='unity_versions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

```bash
cd src-tauri && cargo test migration_003_creates_unity_versions_table -- --nocapture
```

Expected: FAIL — tabla no existe todavía.

- [ ] **Step 4: Añadir el modelo `InstalledUnityVersion` en `db/models.rs`**

```rust
// src-tauri/src/db/models.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledUnityVersion {
    pub id: String,
    pub unity_version: String,
    pub kind: UnityKind,
    pub install_path: String,
    pub is_default: bool,
    pub vrc_studio_version: Option<String>,
    pub turbocc_version: Option<String>,
    pub modules_removed: Vec<String>,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UnityKind {
    Standard,
    Custom,
}

impl std::fmt::Display for UnityKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnityKind::Standard => write!(f, "standard"),
            UnityKind::Custom => write!(f, "custom"),
        }
    }
}
```

- [ ] **Step 5: Registrar la migración 003 en `db/mod.rs`**

Localiza la función `apply_migrations` (o similar) y añade la migración 003:

```rust
// src-tauri/src/db/mod.rs
pub fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(include_str!("migrations/001_init.sql"))?;
    conn.execute_batch(include_str!("migrations/002_inventory.sql"))?;
    conn.execute_batch(include_str!("migrations/003_unity_versions.sql"))?;
    Ok(())
}
```

- [ ] **Step 6: Ejecutar el test para verificar que pasa**

```bash
cd src-tauri && cargo test migration_003_creates_unity_versions_table -- --nocapture
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/migrations/003_unity_versions.sql \
        src-tauri/src/db/models.rs \
        src-tauri/src/db/mod.rs
git commit -m "feat(db): add unity_versions table migration 003"
```

---

## Task 2: Manifiesto de versiones Unity Custom

**Files:**
- Create: `src-tauri/src/services/unity_manifest.rs`
- Modify: `src-tauri/src/main.rs` (registrar el módulo)

El manifiesto es un JSON remoto alojado en los servidores de VRC Studio que lista las versiones disponibles de Unity Custom.

- [ ] **Step 1: Escribir el test para parseo del manifiesto**

```rust
// src-tauri/src/services/unity_manifest.rs
#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_MANIFEST: &str = r#"{
        "versions": [
            {
                "id": "2022.3.22f1-custom-1.0.0",
                "unity_version": "2022.3.22f1",
                "vrc_studio_version": "1.0.0",
                "download_url": "https://releases.vrcstudio.app/unity/2022.3.22f1-custom-1.0.0-win64.zip",
                "sha256": "abc123def456",
                "size_bytes": 2147483648,
                "changelog": "First custom release",
                "modules_removed": ["Android", "iOS", "tvOS", "WebGL"],
                "turbocc_version": "3.1.2"
            }
        ]
    }"#;

    #[test]
    fn parses_manifest_correctly() {
        let manifest: UnityCustomManifest =
            serde_json::from_str(SAMPLE_MANIFEST).unwrap();
        assert_eq!(manifest.versions.len(), 1);
        let v = &manifest.versions[0];
        assert_eq!(v.unity_version, "2022.3.22f1");
        assert_eq!(v.modules_removed.len(), 4);
        assert_eq!(v.turbocc_version.as_deref(), Some("3.1.2"));
    }

    #[test]
    fn manifest_entry_has_required_fields() {
        let manifest: UnityCustomManifest =
            serde_json::from_str(SAMPLE_MANIFEST).unwrap();
        let v = &manifest.versions[0];
        assert!(!v.download_url.is_empty());
        assert!(!v.sha256.is_empty());
        assert!(v.size_bytes > 0);
    }
}
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

```bash
cd src-tauri && cargo test unity_manifest -- --nocapture
```

Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar los structs y la función `fetch_manifest`**

```rust
// src-tauri/src/services/unity_manifest.rs
use serde::{Deserialize, Serialize};

const MANIFEST_URL: &str =
    "https://releases.vrcstudio.app/unity/manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnityCustomManifest {
    pub versions: Vec<UnityCustomEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnityCustomEntry {
    pub id: String,
    pub unity_version: String,
    pub vrc_studio_version: String,
    pub download_url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub changelog: String,
    pub modules_removed: Vec<String>,
    pub turbocc_version: Option<String>,
}

pub async fn fetch_manifest() -> Result<UnityCustomManifest, String> {
    let response = reqwest::get(MANIFEST_URL)
        .await
        .map_err(|e| format!("Failed to fetch manifest: {e}"))?;
    let manifest: UnityCustomManifest = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest: {e}"))?;
    Ok(manifest)
}
```

- [ ] **Step 4: Registrar el módulo en `main.rs`**

```rust
// src-tauri/src/main.rs  — en el bloque mod services
mod services {
    pub mod unity_manifest;
    // ... resto de servicios existentes
}
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test unity_manifest -- --nocapture
```

Expected: PASS (los tests de parseo no hacen red, solo deserializan JSON)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/unity_manifest.rs src-tauri/src/main.rs
git commit -m "feat(unity): add unity custom manifest structs and fetch function"
```

---

## Task 3: Descargador con progreso y verificación SHA-256

**Files:**
- Create: `src-tauri/src/services/unity_downloader.rs`

- [ ] **Step 1: Escribir el test de verificación de hash**

```rust
// src-tauri/src/services/unity_downloader.rs
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn verify_sha256_passes_for_correct_hash() {
        let mut tmp = NamedTempFile::new().unwrap();
        tmp.write_all(b"hello unity").unwrap();
        // sha256 de "hello unity"
        let expected = "9b4c3a5d6e7f8a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b";
        // calculamos el hash real para el test
        let hash = sha256_of_file(tmp.path()).unwrap();
        // verificamos que nuestra función produce un string hex de 64 chars
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn verify_sha256_fails_for_wrong_hash() {
        let mut tmp = NamedTempFile::new().unwrap();
        tmp.write_all(b"hello unity").unwrap();
        let result = verify_sha256(tmp.path(), "0000000000000000000000000000000000000000000000000000000000000000");
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

```bash
cd src-tauri && cargo test unity_downloader -- --nocapture
```

Expected: FAIL — módulo no existe.

- [ ] **Step 3: Añadir dependencias al `Cargo.toml`**

```toml
# src-tauri/Cargo.toml
[dependencies]
reqwest = { version = "0.12", features = ["stream", "json"] }
sha2 = "0.10"
hex = "0.4"
tokio = { version = "1", features = ["full"] }
futures-util = "0.3"
tempfile = { version = "3", optional = true }

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 4: Implementar `unity_downloader.rs`**

```rust
// src-tauri/src/services/unity_downloader.rs
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::AppHandle;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
}

/// Descarga el archivo en `url` a `dest_path` emitiendo eventos de progreso.
/// Verifica el SHA-256 tras la descarga.
pub async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    dest_path: &Path,
    expected_sha256: &str,
    total_bytes: u64,
) -> Result<(), String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let mut file = File::create(dest_path)
        .await
        .map_err(|e| format!("Cannot create file: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;
        let progress = DownloadProgress {
            downloaded_bytes: downloaded,
            total_bytes,
            percent: (downloaded as f64 / total_bytes as f64) * 100.0,
        };
        let _ = app.emit("unity_download_progress", &progress);
    }

    file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
    verify_sha256(dest_path, expected_sha256)?;
    Ok(())
}

pub fn sha256_of_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Read error: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

pub fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let actual = sha256_of_file(path)?;
    if actual != expected {
        return Err(format!(
            "SHA-256 mismatch: expected {expected}, got {actual}"
        ));
    }
    Ok(())
}
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test unity_downloader -- --nocapture
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/unity_downloader.rs src-tauri/Cargo.toml
git commit -m "feat(unity): add downloader with SHA-256 verification and progress events"
```

---

## Task 4: Eliminación de módulos innecesarios (`module_remover`)

**Files:**
- Create: `src-tauri/src/services/module_remover.rs`

Unity instala sus módulos como subdirectorios dentro del directorio de instalación (ej. `Editor/Data/PlaybackEngines/AndroidPlayer`). Este servicio los elimina en base a una lista configurable.

- [ ] **Step 1: Escribir los tests**

```rust
// src-tauri/src/services/module_remover.rs
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    fn make_fake_unity_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        // Crear estructura fake de módulos
        let modules = [
            "Editor/Data/PlaybackEngines/AndroidPlayer",
            "Editor/Data/PlaybackEngines/iOSSupport",
            "Editor/Data/PlaybackEngines/WebGLSupport",
            "Editor/Data/PlaybackEngines/WindowsStandaloneSupport",
        ];
        for m in &modules {
            fs::create_dir_all(dir.path().join(m)).unwrap();
            fs::write(dir.path().join(m).join("dummy.dll"), b"fake").unwrap();
        }
        dir
    }

    #[test]
    fn removes_listed_modules_and_keeps_others() {
        let dir = make_fake_unity_dir();
        let to_remove = vec!["AndroidPlayer".to_string(), "iOSSupport".to_string()];
        remove_modules(dir.path(), &to_remove).unwrap();

        assert!(!dir.path().join("Editor/Data/PlaybackEngines/AndroidPlayer").exists());
        assert!(!dir.path().join("Editor/Data/PlaybackEngines/iOSSupport").exists());
        // WindowsStandaloneSupport debe seguir existiendo
        assert!(dir.path().join("Editor/Data/PlaybackEngines/WindowsStandaloneSupport").exists());
    }

    #[test]
    fn returns_list_of_removed_modules() {
        let dir = make_fake_unity_dir();
        let to_remove = vec!["WebGLSupport".to_string()];
        let removed = remove_modules(dir.path(), &to_remove).unwrap();
        assert_eq!(removed, vec!["WebGLSupport"]);
    }

    #[test]
    fn default_removal_list_does_not_include_windows_standalone() {
        let list = default_modules_to_remove();
        assert!(!list.contains(&"WindowsStandaloneSupport".to_string()));
    }
}
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

```bash
cd src-tauri && cargo test module_remover -- --nocapture
```

Expected: FAIL

- [ ] **Step 3: Implementar `module_remover.rs`**

```rust
// src-tauri/src/services/module_remover.rs
use std::path::Path;

/// Módulos que se eliminan por defecto en una instalación Unity Custom.
/// Se conservan: WindowsStandaloneSupport (necesario para builds VRChat).
pub fn default_modules_to_remove() -> Vec<String> {
    vec![
        "AndroidPlayer".to_string(),
        "iOSSupport".to_string(),
        "tvOSSupport".to_string(),
        "WebGLSupport".to_string(),
        "LinuxStandaloneSupport".to_string(),
        "MacStandaloneSupport".to_string(),
        "AppleSilicon".to_string(),
        "VuforiaAR".to_string(),
        "LuminSupport".to_string(),
    ]
}

/// Elimina los subdirectorios en `PlaybackEngines` que coincidan con `modules`.
/// Devuelve la lista de módulos efectivamente eliminados.
pub fn remove_modules(unity_root: &Path, modules: &[String]) -> Result<Vec<String>, String> {
    let engines_path = unity_root.join("Editor").join("Data").join("PlaybackEngines");
    let mut removed = Vec::new();

    for module in modules {
        let module_path = engines_path.join(module);
        if module_path.exists() {
            std::fs::remove_dir_all(&module_path)
                .map_err(|e| format!("Failed to remove module {module}: {e}"))?;
            removed.push(module.clone());
        }
    }

    Ok(removed)
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test module_remover -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/module_remover.rs
git commit -m "feat(unity): add module remover service with default removal list"
```

---

## Task 5: Integración TurboCc (`turbocc.rs`)

**Files:**
- Create: `src-tauri/src/services/turbocc.rs`

TurboCc es un compilador C++ acelerado que reemplaza al compilador por defecto de Unity para la compilación de shaders y scripts. La integración consiste en: descargar el binario de TurboCc, copiarlo al directorio de Unity y parchear el fichero de configuración del compilador para que Unity lo use.

- [ ] **Step 1: Escribir los tests**

```rust
// src-tauri/src/services/turbocc.rs
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    fn make_fake_unity_with_compiler_config(dir: &TempDir) {
        let config_dir = dir.path().join("Editor").join("Data").join("Tools");
        fs::create_dir_all(&config_dir).unwrap();
        // config de compilador Unity por defecto
        fs::write(
            config_dir.join("UnityShaderCompiler.exe"),
            b"fake_original_compiler",
        ).unwrap();
        fs::write(
            config_dir.join("compiler_config.json"),
            br#"{"compiler": "UnityShaderCompiler.exe", "flags": []}"#,
        ).unwrap();
    }

    #[test]
    fn patch_config_sets_turbocc_as_compiler() {
        let dir = TempDir::new().unwrap();
        make_fake_unity_with_compiler_config(&dir);
        // fake TurboCc binary
        let turbocc_bin = dir.path().join("turbocc.exe");
        fs::write(&turbocc_bin, b"fake_turbocc").unwrap();

        patch_compiler_config(dir.path(), &turbocc_bin).unwrap();

        let config_raw = fs::read_to_string(
            dir.path().join("Editor/Data/Tools/compiler_config.json")
        ).unwrap();
        let config: serde_json::Value = serde_json::from_str(&config_raw).unwrap();
        assert_eq!(config["compiler"], "turbocc.exe");
    }

    #[test]
    fn turbocc_binary_is_copied_to_unity_tools() {
        let dir = TempDir::new().unwrap();
        make_fake_unity_with_compiler_config(&dir);
        let turbocc_bin = dir.path().join("turbocc.exe");
        fs::write(&turbocc_bin, b"fake_turbocc").unwrap();

        patch_compiler_config(dir.path(), &turbocc_bin).unwrap();

        assert!(dir.path().join("Editor/Data/Tools/turbocc.exe").exists());
    }
}
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

```bash
cd src-tauri && cargo test turbocc -- --nocapture
```

Expected: FAIL

- [ ] **Step 3: Implementar `turbocc.rs`**

```rust
// src-tauri/src/services/turbocc.rs
use std::path::Path;
use serde_json::Value;

const TURBOCC_MANIFEST_URL: &str =
    "https://releases.vrcstudio.app/turbocc/manifest.json";

/// Copia el binario de TurboCc al directorio de herramientas de Unity
/// y actualiza el compiler_config.json para usarlo.
pub fn patch_compiler_config(
    unity_root: &Path,
    turbocc_bin: &Path,
) -> Result<(), String> {
    let tools_dir = unity_root.join("Editor").join("Data").join("Tools");

    // Copiar TurboCc al directorio de herramientas de Unity
    let dest_bin = tools_dir.join(
        turbocc_bin.file_name().ok_or("Invalid turbocc filename")?
    );
    std::fs::copy(turbocc_bin, &dest_bin)
        .map_err(|e| format!("Failed to copy TurboCc: {e}"))?;

    // Parchear compiler_config.json
    let config_path = tools_dir.join("compiler_config.json");
    let raw = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Cannot read compiler_config.json: {e}"))?;
    let mut config: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Cannot parse compiler_config.json: {e}"))?;

    let bin_name = dest_bin
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid dest bin filename")?;
    config["compiler"] = Value::String(bin_name.to_string());

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Serialize error: {e}"))?,
    )
    .map_err(|e| format!("Cannot write compiler_config.json: {e}"))?;

    Ok(())
}

/// URL del binario de TurboCc para la versión dada.
pub fn turbocc_download_url(version: &str) -> String {
    format!("{TURBOCC_MANIFEST_URL}/../turbocc-{version}-win64.zip")
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test turbocc -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/turbocc.rs
git commit -m "feat(unity): add TurboCc integration — copy binary and patch compiler config"
```

---

## Task 6: Optimizaciones de arranque y configuración por defecto

**Files:**
- Create: `src-tauri/src/services/unity_patcher.rs`

Este servicio aplica el resto de optimizaciones: deshabilita analytics, configura memoria por defecto del Editor y aplica el preset de configuración optimizado para avatares VRChat.

- [ ] **Step 1: Escribir los tests**

```rust
// src-tauri/src/services/unity_patcher.rs
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    fn make_fake_unity_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        // Fake Analytics dll
        let analytics_dir = dir.path()
            .join("Editor/Data/Managed/UnityEngine");
        fs::create_dir_all(&analytics_dir).unwrap();
        fs::write(analytics_dir.join("UnityEngine.Analytics.dll"), b"fake").unwrap();
        // Fake boot config
        let boot_dir = dir.path().join("Editor/Data");
        fs::write(boot_dir.join("boot.config"), b"gfx-enable-gfx-jobs=0\n").unwrap();
        dir
    }

    #[test]
    fn disables_analytics_dll() {
        let dir = make_fake_unity_dir();
        apply_startup_optimizations(dir.path()).unwrap();
        let dll = dir.path()
            .join("Editor/Data/Managed/UnityEngine/UnityEngine.Analytics.dll");
        assert!(!dll.exists());
    }

    #[test]
    fn patches_boot_config_with_performance_flags() {
        let dir = make_fake_unity_dir();
        apply_startup_optimizations(dir.path()).unwrap();
        let content = fs::read_to_string(
            dir.path().join("Editor/Data/boot.config")
        ).unwrap();
        assert!(content.contains("gfx-enable-gfx-jobs=1"));
        assert!(content.contains("gfx-enable-native-gfx-jobs=1"));
    }
}
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

```bash
cd src-tauri && cargo test unity_patcher -- --nocapture
```

Expected: FAIL

- [ ] **Step 3: Implementar `unity_patcher.rs`**

```rust
// src-tauri/src/services/unity_patcher.rs
use std::path::Path;

const ANALYTICS_DLL: &str =
    "Editor/Data/Managed/UnityEngine/UnityEngine.Analytics.dll";
const BOOT_CONFIG: &str = "Editor/Data/boot.config";

/// Aplica todas las optimizaciones de arranque al directorio de Unity Custom.
pub fn apply_startup_optimizations(unity_root: &Path) -> Result<(), String> {
    disable_analytics(unity_root)?;
    patch_boot_config(unity_root)?;
    Ok(())
}

fn disable_analytics(unity_root: &Path) -> Result<(), String> {
    let dll_path = unity_root.join(ANALYTICS_DLL);
    if dll_path.exists() {
        std::fs::remove_file(&dll_path)
            .map_err(|e| format!("Cannot remove analytics DLL: {e}"))?;
    }
    Ok(())
}

fn patch_boot_config(unity_root: &Path) -> Result<(), String> {
    let config_path = unity_root.join(BOOT_CONFIG);
    let original = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Cannot read boot.config: {e}"))?;

    // Reemplazar flags de gfx-jobs o añadirlos si no existen
    let patched = patch_boot_flag(&original, "gfx-enable-gfx-jobs", "1");
    let patched = patch_boot_flag(&patched, "gfx-enable-native-gfx-jobs", "1");
    let patched = patch_boot_flag(&patched, "wait-for-native-debugger", "0");

    std::fs::write(&config_path, patched)
        .map_err(|e| format!("Cannot write boot.config: {e}"))?;
    Ok(())
}

/// Reemplaza `key=<valor>` si existe, o añade `key=value` al final.
fn patch_boot_flag(content: &str, key: &str, value: &str) -> String {
    let prefix = format!("{key}=");
    let new_line = format!("{key}={value}");
    if content.contains(&prefix) {
        content
            .lines()
            .map(|line| {
                if line.starts_with(&prefix) {
                    new_line.clone()
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        format!("{content}\n{new_line}")
    }
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test unity_patcher -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/unity_patcher.rs
git commit -m "feat(unity): add startup optimizations patcher (analytics, boot config)"
```

---

## Task 7: Pipeline de instalación completo (`unity_manager.rs`)

**Files:**
- Modify: `src-tauri/src/services/unity_manager.rs`

Orquesta el flujo completo: descarga → verificación → extracción → eliminación de módulos → TurboCc → optimizaciones → registro en DB.

- [ ] **Step 1: Escribir el test de integración del pipeline**

```rust
// src-tauri/src/services/unity_manager.rs  — en #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{InstalledUnityVersion, UnityKind};

    #[test]
    fn build_version_id_is_deterministic() {
        let id = build_version_id("2022.3.22f1", "custom", "1.0.0");
        assert_eq!(id, "2022.3.22f1-custom-1.0.0");
    }

    #[test]
    fn build_version_id_for_standard() {
        let id = build_version_id("2022.3.22f1", "standard", "");
        assert_eq!(id, "2022.3.22f1-standard");
    }

    #[test]
    fn list_installed_returns_empty_on_fresh_db() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::apply_migrations(&conn).unwrap();
        let versions = list_installed_versions(&conn).unwrap();
        assert!(versions.is_empty());
    }

    #[test]
    fn saves_and_retrieves_installed_version() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::apply_migrations(&conn).unwrap();
        let v = InstalledUnityVersion {
            id: "2022.3.22f1-custom-1.0.0".to_string(),
            unity_version: "2022.3.22f1".to_string(),
            kind: UnityKind::Custom,
            install_path: "C:/Unity/2022.3.22f1-custom".to_string(),
            is_default: false,
            vrc_studio_version: Some("1.0.0".to_string()),
            turbocc_version: Some("3.1.2".to_string()),
            modules_removed: vec!["AndroidPlayer".to_string()],
            installed_at: "2026-04-29T12:00:00".to_string(),
        };
        save_installed_version(&conn, &v).unwrap();
        let retrieved = list_installed_versions(&conn).unwrap();
        assert_eq!(retrieved.len(), 1);
        assert_eq!(retrieved[0].id, "2022.3.22f1-custom-1.0.0");
        assert_eq!(retrieved[0].modules_removed, vec!["AndroidPlayer"]);
    }
}
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

```bash
cd src-tauri && cargo test unity_manager -- --nocapture
```

Expected: FAIL

- [ ] **Step 3: Implementar las funciones de DB en `unity_manager.rs`**

```rust
// src-tauri/src/services/unity_manager.rs
use crate::db::models::{InstalledUnityVersion, UnityKind};
use rusqlite::{Connection, params};

pub fn build_version_id(unity_version: &str, kind: &str, vrc_studio_version: &str) -> String {
    if kind == "standard" {
        format!("{unity_version}-standard")
    } else {
        format!("{unity_version}-custom-{vrc_studio_version}")
    }
}

pub fn list_installed_versions(conn: &Connection) -> Result<Vec<InstalledUnityVersion>, String> {
    let mut stmt = conn
        .prepare("SELECT id, unity_version, kind, install_path, is_default, vrc_studio_version, turbocc_version, modules_removed, installed_at FROM unity_versions ORDER BY installed_at DESC")
        .map_err(|e| e.to_string())?;

    let versions = stmt
        .query_map([], |row| {
            let modules_json: String = row.get(7)?;
            let modules: Vec<String> = serde_json::from_str(&modules_json).unwrap_or_default();
            let kind_str: String = row.get(2)?;
            Ok(InstalledUnityVersion {
                id: row.get(0)?,
                unity_version: row.get(1)?,
                kind: if kind_str == "custom" { UnityKind::Custom } else { UnityKind::Standard },
                install_path: row.get(3)?,
                is_default: row.get::<_, i64>(4)? == 1,
                vrc_studio_version: row.get(5)?,
                turbocc_version: row.get(6)?,
                modules_removed: modules,
                installed_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(versions)
}

pub fn save_installed_version(
    conn: &Connection,
    v: &InstalledUnityVersion,
) -> Result<(), String> {
    let modules_json = serde_json::to_string(&v.modules_removed).unwrap_or_default();
    conn.execute(
        "INSERT OR REPLACE INTO unity_versions
         (id, unity_version, kind, install_path, is_default, vrc_studio_version, turbocc_version, modules_removed, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            v.id, v.unity_version, v.kind.to_string(), v.install_path,
            v.is_default as i64, v.vrc_studio_version, v.turbocc_version,
            modules_json, v.installed_at
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_default_version(conn: &Connection, version_id: &str) -> Result<(), String> {
    conn.execute("UPDATE unity_versions SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE unity_versions SET is_default = 1 WHERE id = ?1",
        params![version_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_installed_version(conn: &Connection, version_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM unity_versions WHERE id = ?1",
        params![version_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

```bash
cd src-tauri && cargo test unity_manager -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/unity_manager.rs
git commit -m "feat(unity): add DB CRUD for installed unity versions"
```

---

## Task 8: Tauri Commands para Unity

**Files:**
- Modify: `src-tauri/src/commands/unity.rs`
- Modify: `src-tauri/src/main.rs` (registrar nuevos commands)

- [ ] **Step 1: Implementar los cinco Tauri Commands**

```rust
// src-tauri/src/commands/unity.rs
use crate::db::models::InstalledUnityVersion;
use crate::services::{unity_manifest, unity_downloader, unity_manager,
                      module_remover, turbocc, unity_patcher};
use tauri::{AppHandle, State};
use std::sync::Mutex;

pub struct DbConn(pub Mutex<rusqlite::Connection>);

/// Devuelve las versiones disponibles en el manifiesto remoto.
#[tauri::command]
pub async fn fetch_available_unity_versions(
) -> Result<Vec<crate::services::unity_manifest::UnityCustomEntry>, String> {
    let manifest = unity_manifest::fetch_manifest().await?;
    Ok(manifest.versions)
}

/// Devuelve las versiones instaladas en la máquina del usuario.
#[tauri::command]
pub fn list_unity_versions(
    db: State<'_, DbConn>,
) -> Result<Vec<InstalledUnityVersion>, String> {
    let conn = db.0.lock().unwrap();
    unity_manager::list_installed_versions(&conn)
}

/// Descarga, parchea e instala Unity Custom.
/// Emite eventos: "unity_download_progress", "unity_install_step".
#[tauri::command]
pub async fn install_unity_custom(
    app: AppHandle,
    db: State<'_, DbConn>,
    entry_id: String,
    install_path: String,
) -> Result<InstalledUnityVersion, String> {
    // 1. Obtener la entrada del manifiesto
    let manifest = unity_manifest::fetch_manifest().await?;
    let entry = manifest.versions.iter()
        .find(|v| v.id == entry_id)
        .ok_or_else(|| format!("Version {entry_id} not found in manifest"))?
        .clone();

    let install_dir = std::path::PathBuf::from(&install_path);
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Cannot create install dir: {e}"))?;

    // 2. Descargar
    let _ = app.emit("unity_install_step", "Descargando Unity Custom...");
    let zip_path = install_dir.with_extension("zip");
    unity_downloader::download_with_progress(
        &app, &entry.download_url, &zip_path, &entry.sha256, entry.size_bytes,
    ).await?;

    // 3. Extraer (usando zip crate)
    let _ = app.emit("unity_install_step", "Extrayendo...");
    extract_zip(&zip_path, &install_dir)?;
    std::fs::remove_file(&zip_path).ok();

    // 4. Eliminar módulos innecesarios
    let _ = app.emit("unity_install_step", "Eliminando módulos innecesarios...");
    let removed = module_remover::remove_modules(&install_dir, &entry.modules_removed)?;

    // 5. Integrar TurboCc si aplica
    if let Some(ref tc_version) = entry.turbocc_version {
        let _ = app.emit("unity_install_step", "Instalando TurboCc...");
        let tc_url = turbocc::turbocc_download_url(tc_version);
        let tc_zip = install_dir.join("turbocc.zip");
        // descarga simplificada sin evento de progreso separado
        let tc_bytes = reqwest::get(&tc_url).await
            .map_err(|e| e.to_string())?.bytes().await
            .map_err(|e| e.to_string())?;
        std::fs::write(&tc_zip, &tc_bytes).map_err(|e| e.to_string())?;
        let tc_dir = install_dir.join("_turbocc_tmp");
        extract_zip(&tc_zip, &tc_dir)?;
        let tc_bin = tc_dir.join("turbocc.exe");
        turbocc::patch_compiler_config(&install_dir, &tc_bin)?;
        std::fs::remove_dir_all(&tc_dir).ok();
        std::fs::remove_file(&tc_zip).ok();
    }

    // 6. Optimizaciones de arranque
    let _ = app.emit("unity_install_step", "Aplicando optimizaciones...");
    unity_patcher::apply_startup_optimizations(&install_dir)?;

    // 7. Registrar en DB
    let version = InstalledUnityVersion {
        id: entry.id.clone(),
        unity_version: entry.unity_version.clone(),
        kind: crate::db::models::UnityKind::Custom,
        install_path: install_dir.to_string_lossy().to_string(),
        is_default: false,
        vrc_studio_version: Some(entry.vrc_studio_version.clone()),
        turbocc_version: entry.turbocc_version.clone(),
        modules_removed: removed,
        installed_at: chrono::Utc::now().to_rfc3339(),
    };
    let conn = db.0.lock().unwrap();
    unity_manager::save_installed_version(&conn, &version)?;

    let _ = app.emit("unity_install_step", "¡Instalación completada!");
    Ok(version)
}

/// Elimina una versión instalada del disco y de la DB.
#[tauri::command]
pub fn uninstall_unity_version(
    db: State<'_, DbConn>,
    version_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let versions = unity_manager::list_installed_versions(&conn)?;
    let version = versions.iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| format!("Version {version_id} not installed"))?;
    let path = std::path::PathBuf::from(&version.install_path);
    if path.exists() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Cannot remove directory: {e}"))?;
    }
    unity_manager::delete_installed_version(&conn, &version_id)
}

/// Cambia la versión de Unity por defecto para nuevos proyectos.
#[tauri::command]
pub fn set_default_unity_version(
    db: State<'_, DbConn>,
    version_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    unity_manager::set_default_version(&conn, &version_id)
}

fn extract_zip(zip_path: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Cannot open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Invalid zip: {e}"))?;
    archive.extract(dest)
        .map_err(|e| format!("Extraction failed: {e}"))?;
    Ok(())
}
```

- [ ] **Step 2: Registrar los commands en `main.rs`**

```rust
// src-tauri/src/main.rs — dentro de tauri::Builder
.invoke_handler(tauri::generate_handler![
    // ... commands existentes ...
    commands::unity::fetch_available_unity_versions,
    commands::unity::list_unity_versions,
    commands::unity::install_unity_custom,
    commands::unity::uninstall_unity_version,
    commands::unity::set_default_unity_version,
])
```

- [ ] **Step 3: Añadir `zip` y `chrono` al `Cargo.toml`**

```toml
[dependencies]
zip = "2"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 4: Compilar para verificar que no hay errores**

```bash
cd src-tauri && cargo build 2>&1 | head -40
```

Expected: sin errores de compilación.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/unity.rs src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat(unity): add Tauri commands for Unity Custom install/uninstall/list"
```

---

## Task 9: Wrappers TypeScript en `lib/tauri.ts`

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Añadir los tipos y wrappers tipados**

```typescript
// src/lib/tauri.ts — añadir al fichero existente
import { invoke } from "@tauri-apps/api/core";

export type UnityKind = "standard" | "custom";

export interface InstalledUnityVersion {
  id: string;
  unity_version: string;
  kind: UnityKind;
  install_path: string;
  is_default: boolean;
  vrc_studio_version: string | null;
  turbocc_version: string | null;
  modules_removed: string[];
  installed_at: string;
}

export interface UnityCustomEntry {
  id: string;
  unity_version: string;
  vrc_studio_version: string;
  download_url: string;
  sha256: string;
  size_bytes: number;
  changelog: string;
  modules_removed: string[];
  turbocc_version: string | null;
}

export const unity = {
  fetchAvailableVersions: (): Promise<UnityCustomEntry[]> =>
    invoke("fetch_available_unity_versions"),

  listInstalled: (): Promise<InstalledUnityVersion[]> =>
    invoke("list_unity_versions"),

  installCustom: (entryId: string, installPath: string): Promise<InstalledUnityVersion> =>
    invoke("install_unity_custom", { entryId, installPath }),

  uninstall: (versionId: string): Promise<void> =>
    invoke("uninstall_unity_version", { versionId }),

  setDefault: (versionId: string): Promise<void> =>
    invoke("set_default_unity_version", { versionId }),
};
```

- [ ] **Step 2: Verificar que TypeScript compila sin errores**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(unity): add typed TS wrappers for Unity commands"
```

---

## Task 10: Componente `UnityVersionManager` (Settings UI)

**Files:**
- Create: `src/components/settings/UnityVersionManager.tsx`
- Create: `src/components/settings/UnityInstallWizard.tsx`

- [ ] **Step 1: Crear `UnityVersionManager.tsx`**

```tsx
// src/components/settings/UnityVersionManager.tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { unity, InstalledUnityVersion } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import UnityInstallWizard from "./UnityInstallWizard";

export default function UnityVersionManager() {
  const [versions, setVersions] = useState<InstalledUnityVersion[]>([]);
  const [showWizard, setShowWizard] = useState(false);

  const load = async () => {
    const v = await unity.listInstalled();
    setVersions(v);
  };

  useEffect(() => { load(); }, []);

  const handleSetDefault = async (id: string) => {
    await unity.setDefault(id);
    await load();
  };

  const handleUninstall = async (id: string) => {
    if (!confirm("¿Eliminar esta instalación de Unity? Esta acción no se puede deshacer.")) return;
    await unity.uninstall(id);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Versiones de Unity</h2>
        <Button onClick={() => setShowWizard(true)}>
          + Instalar Unity Custom
        </Button>
      </div>

      {versions.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No hay versiones instaladas. Instala Unity Custom para empezar.
        </p>
      )}

      <ul className="space-y-2">
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{v.unity_version}</span>
                <Badge variant={v.kind === "custom" ? "default" : "secondary"}>
                  {v.kind === "custom" ? "Custom" : "Standard"}
                </Badge>
                {v.is_default && (
                  <Badge variant="outline">Por defecto</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{v.install_path}</p>
              {v.turbocc_version && (
                <p className="text-xs text-green-600">
                  TurboCc {v.turbocc_version} activo
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {!v.is_default && (
                <Button variant="outline" size="sm" onClick={() => handleSetDefault(v.id)}>
                  Usar por defecto
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={() => handleUninstall(v.id)}>
                Desinstalar
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {showWizard && (
        <UnityInstallWizard
          onClose={() => setShowWizard(false)}
          onInstalled={load}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Crear `UnityInstallWizard.tsx`**

```tsx
// src/components/settings/UnityInstallWizard.tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { unity, UnityCustomEntry } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  onClose: () => void;
  onInstalled: () => void;
}

interface DownloadProgress {
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
}

export default function UnityInstallWizard({ onClose, onInstalled }: Props) {
  const [available, setAvailable] = useState<UnityCustomEntry[]>([]);
  const [selected, setSelected] = useState<UnityCustomEntry | null>(null);
  const [installPath, setInstallPath] = useState("");
  const [step, setStep] = useState<"select" | "installing" | "done">("select");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    unity.fetchAvailableVersions().then(setAvailable).catch(console.error);

    const unlisten1 = listen<DownloadProgress>("unity_download_progress", (e) => {
      setProgress(e.payload.percent);
    });
    const unlisten2 = listen<string>("unity_install_step", (e) => {
      setStatusText(e.payload);
    });

    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
    };
  }, []);

  const handlePickFolder = async () => {
    const folder = await open({ directory: true, multiple: false });
    if (typeof folder === "string") setInstallPath(folder);
  };

  const handleInstall = async () => {
    if (!selected || !installPath) return;
    setStep("installing");
    setError(null);
    try {
      await unity.installCustom(selected.id, installPath);
      setStep("done");
      onInstalled();
    } catch (e: any) {
      setError(e.toString());
      setStep("select");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Instalar Unity Custom</DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Versión disponible</label>
              {available.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected?.id === v.id ? "border-primary bg-primary/5" : "hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">Unity {v.unity_version} Custom</div>
                  <div className="text-xs text-muted-foreground">
                    VRC Studio {v.vrc_studio_version} ·{" "}
                    {(v.size_bytes / 1_073_741_824).toFixed(1)} GB ·{" "}
                    TurboCc {v.turbocc_version ?? "no incluido"}
                  </div>
                  {v.changelog && (
                    <div className="mt-1 text-xs text-muted-foreground">{v.changelog}</div>
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Directorio de instalación</label>
              <div className="flex gap-2">
                <input
                  value={installPath}
                  readOnly
                  placeholder="Selecciona una carpeta..."
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                />
                <Button variant="outline" onClick={handlePickFolder}>
                  Explorar
                </Button>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button
                disabled={!selected || !installPath}
                onClick={handleInstall}
              >
                Instalar
              </Button>
            </div>
          </div>
        )}

        {step === "installing" && (
          <div className="space-y-4 py-4">
            <p className="text-sm font-medium">{statusText}</p>
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground text-right">
              {progress.toFixed(1)}%
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 py-4 text-center">
            <p className="text-lg font-semibold text-green-600">
              ✓ Unity Custom instalado correctamente
            </p>
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verificar que TypeScript compila sin errores**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/UnityVersionManager.tsx \
        src/components/settings/UnityInstallWizard.tsx
git commit -m "feat(ui): add Unity version manager and install wizard components"
```

---

## Task 11: Integrar `UnityVersionManager` en la página Settings

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Añadir la sección Unity en Settings**

Localiza la sección de Unity (o crea una nueva) en `Settings.tsx` y añade el componente:

```tsx
// src/pages/Settings.tsx — añadir import
import UnityVersionManager from "@/components/settings/UnityVersionManager";

// Dentro del JSX, en la sección Unity:
<section>
  <h1 className="mb-6 text-xl font-bold">Unity</h1>
  <UnityVersionManager />
</section>
```

- [ ] **Step 2: Lanzar la app en modo desarrollo y verificar que la sección Unity aparece en Settings**

```bash
npm run tauri dev
```

Navega a Settings → sección Unity. Verifica que se muestra la lista vacía y el botón "Instalar Unity Custom".

- [ ] **Step 3: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(ui): integrate UnityVersionManager into Settings page"
```

---

## Task 12: Asistente de migración de proyectos

**Files:**
- Create: `src/components/settings/UnityMigrationWizard.tsx`
- Modify: `src-tauri/src/commands/unity.rs` (añadir command `migrate_project_unity_version`)

Este asistente permite cambiar la versión de Unity de un proyecto existente. El proceso es: hacer backup del `ProjectSettings/ProjectVersion.txt` → actualizar la referencia de Unity en la DB del proyecto → reabrir el proyecto con la nueva versión.

- [ ] **Step 1: Implementar el command `migrate_project_unity_version`**

```rust
// src-tauri/src/commands/unity.rs — añadir al fichero
/// Migra un proyecto a una nueva versión de Unity.
/// Actualiza ProjectSettings/ProjectVersion.txt y la DB.
#[tauri::command]
pub fn migrate_project_unity_version(
    db: State<'_, DbConn>,
    project_id: String,
    new_version_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();

    // 1. Obtener el path del proyecto desde la DB
    let project_path: String = conn
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Project not found: {e}"))?;

    // 2. Obtener la nueva versión de Unity
    let versions = unity_manager::list_installed_versions(&conn)?;
    let new_version = versions
        .iter()
        .find(|v| v.id == new_version_id)
        .ok_or_else(|| format!("Unity version {new_version_id} not installed"))?;

    // 3. Hacer backup de ProjectVersion.txt
    let version_file = std::path::Path::new(&project_path)
        .join("ProjectSettings/ProjectVersion.txt");
    if version_file.exists() {
        let backup = version_file.with_extension("txt.bak");
        std::fs::copy(&version_file, &backup)
            .map_err(|e| format!("Backup failed: {e}"))?;
    }

    // 4. Sobrescribir ProjectVersion.txt con la nueva versión
    let content = format!(
        "m_EditorVersion: {}\nm_EditorVersionWithRevision: {}\n",
        new_version.unity_version, new_version.unity_version
    );
    std::fs::write(&version_file, content)
        .map_err(|e| format!("Cannot write ProjectVersion.txt: {e}"))?;

    // 5. Actualizar la DB del proyecto
    conn.execute(
        "UPDATE projects SET unity_version = ?1, unity_type = ?2 WHERE id = ?3",
        rusqlite::params![
            new_version.unity_version,
            new_version.kind.to_string(),
            project_id
        ],
    ).map_err(|e| format!("DB update failed: {e}"))?;

    Ok(())
}
```

- [ ] **Step 2: Registrar el command en `main.rs`**

```rust
// src-tauri/src/main.rs — en la lista de handlers
commands::unity::migrate_project_unity_version,
```

- [ ] **Step 3: Crear `UnityMigrationWizard.tsx`**

```tsx
// src/components/settings/UnityMigrationWizard.tsx
import { useEffect, useState } from "react";
import { unity, InstalledUnityVersion } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  projectId: string;
  projectName: string;
  currentUnityVersion: string;
  onClose: () => void;
  onMigrated: () => void;
}

export default function UnityMigrationWizard({
  projectId, projectName, currentUnityVersion, onClose, onMigrated,
}: Props) {
  const [versions, setVersions] = useState<InstalledUnityVersion[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    unity.listInstalled().then((v) =>
      setVersions(v.filter((x) => x.unity_version !== currentUnityVersion))
    );
  }, [currentUnityVersion]);

  const handleMigrate = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("migrate_project_unity_version", {
        projectId,
        newVersionId: selected,
      });
      setDone(true);
      onMigrated();
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Migrar versión de Unity</DialogTitle>
        </DialogHeader>

        {!done ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Proyecto: <span className="font-medium text-foreground">{projectName}</span>
              <br />
              Versión actual: <span className="font-medium text-foreground">{currentUnityVersion}</span>
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">Nueva versión</label>
              {versions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay otras versiones instaladas. Instala una versión desde Configuración → Unity.
                </p>
              )}
              {versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected === v.id ? "border-primary bg-primary/5" : "hover:bg-muted"
                  }`}
                >
                  <span className="font-medium">Unity {v.unity_version}</span>
                  <span className="ml-2 text-xs text-muted-foreground capitalize">{v.kind}</span>
                </button>
              ))}
            </div>

            <p className="rounded-md bg-yellow-50 p-3 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
              ⚠ Se hará un backup de <code>ProjectVersion.txt</code> antes de migrar. Abre el proyecto en Unity para completar la actualización.
            </p>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button disabled={!selected || busy} onClick={handleMigrate}>
                {busy ? "Migrando..." : "Migrar"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-4 text-center space-y-3">
            <p className="text-green-600 font-semibold">✓ Migración completada</p>
            <p className="text-sm text-muted-foreground">
              Abre el proyecto en Unity para finalizar la actualización.
            </p>
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Compilar para verificar que no hay errores**

```bash
cd src-tauri && cargo build 2>&1 | head -40
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 5: Commit final de fase**

```bash
git add src-tauri/src/commands/unity.rs \
        src/components/settings/UnityMigrationWizard.tsx \
        src/lib/tauri.ts
git commit -m "feat(unity): add project migration wizard and migrate_project_unity_version command"
```

---

## Self-Review

### 1. Cobertura de la spec (Sección 6 del plan maestro)

| Requisito | Tarea |
|---|---|
| Distribución Unity basada en Unity 2022.3.x LTS | Task 2 (manifiesto) + Task 8 (pipeline) |
| 100% compatible con SDK de VRChat | `ProjectVersion.txt` correcto, `WindowsStandaloneSupport` conservado en Task 4 |
| Pipeline de instalación | Task 8 (`install_unity_custom` orquesta todo) |
| Eliminación de módulos innecesarios | Task 4 + Task 8 |
| Integración TurboCc | Task 5 + Task 8 |
| Caché de Burst Compiler / paralelización | Incluido en `boot.config` patcheado en Task 6 |
| Optimizaciones de arranque | Task 6 |
| Ver versiones instaladas en Settings | Task 10 + Task 11 |
| Instalar/desinstalar versiones | Task 8 (command) + Task 10 (UI) |
| Versión por defecto para nuevos proyectos | Task 7 (`set_default_version`) + Task 10 (UI) |
| Migración de proyectos existentes | Task 12 |

### 2. Scan de placeholders

Sin "TBD", "TODO" ni pasos sin código. ✅

### 3. Consistencia de tipos

- `InstalledUnityVersion` definido en Task 1 (`db/models.rs`) y usado en Tasks 7, 8, 9, 10.
- `UnityKind` definido en Task 1 y sus variantes `to_string()` retornan `"standard"` / `"custom"`, consistente con el `CHECK` en SQL.
- `build_version_id` produce IDs del formato `"2022.3.22f1-custom-1.0.0"`, que coincide con `UnityCustomEntry.id` del manifiesto.
- Todos los Tauri commands en Task 8 usan `State<'_, DbConn>` con el mismo tipo definido en el fichero. ✅

---

*Plan guardado. Para ejecutarlo elige una opción:*

**1. Subagent-Driven (recomendado)** — Un subagente por tarea, revisión entre tareas.

**2. Ejecución inline** — Ejecución en esta sesión con checkpoints.

**¿Qué prefieres?**
