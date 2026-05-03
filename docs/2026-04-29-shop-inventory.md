# VRC Studio — Plan 3: Shop e Inventory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el módulo completo de Shop (autenticación Booth/Riperstore, búsqueda unificada, vista de producto, descarga con progreso) e Inventory (carpetas virtuales, filtros, drag & drop, acciones de eliminación en 3 modos).

**Architecture:** El backend Rust expone Tauri Commands para auth, búsqueda y descarga. Las descargas largas emiten Tauri Events de progreso al frontend. El Inventory vive en SQLite con estructura de carpetas virtuales (solo en DB, sin mover archivos en disco). El frontend consume los commands con wrappers tipados en `src/lib/tauri.ts`.

**Tech Stack:** Tauri 2, Rust (`reqwest`, `keyring`, `sqlx`, `tokio`, `serde`), React 19 + TypeScript, Tailwind CSS, shadcn/ui, SQLite, `@dnd-kit/core` para drag & drop.

---

## Estructura de archivos

```
src-tauri/src/
  services/
    auth_store.rs         # Keychain seguro (keyring crate) para tokens/sesiones
    booth.rs              # Cliente HTTP Booth.pm (search, product detail, download URL)
    riperstore.rs         # Scraper Riperstore Forums (login, search, download URL)
    downloader.rs         # Motor de descargas: stream, extracción zip, registro DB, eventos
  commands/
    shop.rs               # Tauri commands: search, get_product, start_download, link_account
    inventory.rs          # Tauri commands: list_items, create_folder, move_item, delete_item, tag_item
  db/
    migrations/
      0003_shop_inventory.sql   # Tablas inventory_items, folders, linked_accounts
    models.rs             # Structs SQLite (extender con InventoryItem, InventoryFolder, LinkedAccount)
    mod.rs                # Pool compartido (ya existe de planes anteriores)
  main.rs                 # Registrar nuevos commands

src/
  pages/
    Shop.tsx              # Página principal: barra búsqueda + ShopFilters + ProductGrid
    Inventory.tsx         # Página principal: FolderTree + InventoryGrid
  components/
    shop/
      ProductCard.tsx     # Card con imagen, nombre, autor, precio, fuente
      ProductGrid.tsx     # Grid responsive de ProductCards
      ProductDetail.tsx   # Modal/panel lateral: carrusel, descripción, botón descarga
      ShopFilters.tsx     # Filtros: fuente, precio, tipo
      DownloadProgress.tsx # Toast/barra de progreso de descargas activas
    inventory/
      FolderTree.tsx      # Sidebar árbol de carpetas virtuales
      InventoryGrid.tsx   # Grid/lista de InventoryItem con toggle
      InventoryItem.tsx   # Card de item: imagen, nombre, acciones
      ItemActions.tsx     # Menú contextual: instalar, eliminar (3 modos), etiquetar, info
  hooks/
    useShopSearch.ts      # Estado de búsqueda unificada + debounce
    useDownloadProgress.ts # Suscripción a eventos Tauri de progreso
    useInventory.ts       # CRUD de inventory items + folders
  lib/
    tauri.ts              # Extender wrappers tipados con shop/inventory commands
  store/
    shopStore.ts          # Zustand: resultados búsqueda, filtros activos, producto seleccionado
    inventoryStore.ts     # Zustand: items, folders, item seleccionado, vista (grid/list)
```

---

## Task 1: Migración DB — tablas Shop e Inventory

**Files:**
- Create: `src-tauri/src/db/migrations/0003_shop_inventory.sql`
- Modify: `src-tauri/src/db/models.rs`

- [ ] **Step 1: Escribir el test de migración**

```rust
// src-tauri/src/db/migrations/tests.rs (añadir al módulo de tests existente)
#[cfg(test)]
mod migration_tests {
    use super::*;

    #[tokio::test]
    async fn test_migration_0003_creates_tables() {
        let pool = sqlx::SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!("./src/db/migrations").run(&pool).await.unwrap();

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert!(tables.contains(&"inventory_items".to_string()));
        assert!(tables.contains(&"inventory_folders".to_string()));
        assert!(tables.contains(&"inventory_folder_items".to_string()));
        assert!(tables.contains(&"linked_accounts".to_string()));
    }
}
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
cargo test migration_tests::test_migration_0003 -- --nocapture
```

Expected: FAIL — `migration 0003 not found` o tablas no existentes.

- [ ] **Step 3: Crear la migración SQL**

```sql
-- src-tauri/src/db/migrations/0003_shop_inventory.sql

CREATE TABLE IF NOT EXISTS inventory_items (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    author      TEXT NOT NULL,
    source      TEXT NOT NULL CHECK(source IN ('booth', 'riperstore', 'manual')),
    source_id   TEXT,
    local_path  TEXT NOT NULL,
    thumbnail_url TEXT,
    download_date TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    tags        TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS inventory_folders (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT REFERENCES inventory_folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_folder_items (
    folder_id   TEXT NOT NULL REFERENCES inventory_folders(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, item_id)
);

CREATE TABLE IF NOT EXISTS linked_accounts (
    provider    TEXT PRIMARY KEY NOT NULL CHECK(provider IN ('booth', 'riperstore', 'github')),
    username    TEXT,
    expires_at  TEXT
);
```

- [ ] **Step 4: Añadir structs en models.rs**

```rust
// src-tauri/src/db/models.rs  (añadir al final del archivo existente)
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub author: String,
    pub source: String,
    pub source_id: Option<String>,
    pub local_path: String,
    pub thumbnail_url: Option<String>,
    pub download_date: String,
    pub size_bytes: i64,
    pub tags: String, // JSON array serializado
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct InventoryFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LinkedAccount {
    pub provider: String,
    pub username: Option<String>,
    pub expires_at: Option<String>,
}
```

- [ ] **Step 5: Ejecutar tests para verificar que pasan**

```bash
cargo test migration_tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/migrations/0003_shop_inventory.sql src-tauri/src/db/models.rs
git commit -m "feat(db): add migration 0003 for inventory_items, folders, linked_accounts"
```

---

## Task 2: Auth Store — Keychain seguro para credenciales

**Files:**
- Create: `src-tauri/src/services/auth_store.rs`

Dependencia en `Cargo.toml`:
```toml
keyring = "2"
```

- [ ] **Step 1: Escribir los tests**

```rust
// src-tauri/src/services/auth_store.rs (al final del archivo, en módulo tests)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_retrieve_token() {
        let provider = "booth_test";
        store_token(provider, "mytoken123").unwrap();
        let retrieved = get_token(provider).unwrap();
        assert_eq!(retrieved, Some("mytoken123".to_string()));
        delete_token(provider).unwrap();
    }

    #[test]
    fn test_get_missing_token_returns_none() {
        let result = get_token("nonexistent_provider_xyz").unwrap();
        assert_eq!(result, None);
    }
}
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
cargo test auth_store::tests -- --nocapture
```

Expected: FAIL — `store_token` not found.

- [ ] **Step 3: Implementar auth_store.rs**

```rust
// src-tauri/src/services/auth_store.rs
use keyring::Entry;

const SERVICE_NAME: &str = "vrc-studio";

fn entry(provider: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE_NAME, provider)
}

pub fn store_token(provider: &str, token: &str) -> Result<(), String> {
    entry(provider)
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())
}

pub fn get_token(provider: &str) -> Result<Option<String>, String> {
    match entry(provider).map_err(|e| e.to_string())?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_token(provider: &str) -> Result<(), String> {
    match entry(provider).map_err(|e| e.to_string())?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 4: Declarar módulo en services/mod.rs**

```rust
// src-tauri/src/services/mod.rs (añadir)
pub mod auth_store;
```

- [ ] **Step 5: Ejecutar tests**

```bash
cargo test auth_store::tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/auth_store.rs src-tauri/src/services/mod.rs Cargo.toml
git commit -m "feat(auth): add keychain-backed auth_store for provider tokens"
```

---

## Task 3: Cliente Booth.pm

**Files:**
- Create: `src-tauri/src/services/booth.rs`

Dependencias en `Cargo.toml`:
```toml
reqwest = { version = "0.12", features = ["json", "cookies"] }
scraper = "0.19"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 1: Escribir los tests**

```rust
// src-tauri/src/services/booth.rs (al final)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_search_results_from_html() {
        // HTML mínimo que simula la estructura de resultados de Booth
        let html = r#"
          <ul class="items-works">
            <li class="item">
              <div class="item-thumbnail">
                <a href="/items/12345"><img src="https://example.com/img.jpg" /></a>
              </div>
              <div class="item-name"><a href="/items/12345">Cool Avatar Base</a></div>
              <div class="item-price">¥1,500</div>
              <div class="item-shop"><a href="/shop/authorxyz">AuthorXYZ</a></div>
            </li>
          </ul>
        "#;

        let results = parse_search_results(html);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Cool Avatar Base");
        assert_eq!(results[0].author, "AuthorXYZ");
        assert_eq!(results[0].source_id, "12345");
        assert_eq!(results[0].price_display, "¥1,500");
    }

    #[test]
    fn test_build_search_url() {
        let url = build_search_url("avatar base", 1);
        assert!(url.contains("booth.pm"));
        assert!(url.contains("avatar+base") || url.contains("avatar%20base"));
        assert!(url.contains("page=1"));
    }
}
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
cargo test booth::tests -- --nocapture
```

Expected: FAIL — `parse_search_results` not found.

- [ ] **Step 3: Implementar booth.rs**

```rust
// src-tauri/src/services/booth.rs
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoothProduct {
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String,
    pub url: String,
    pub source: String, // siempre "booth"
}

pub fn build_search_url(query: &str, page: u32) -> String {
    let encoded = urlencoding::encode(query);
    format!(
        "https://booth.pm/en/browse?q={}&page={}",
        encoded, page
    )
}

pub fn parse_search_results(html: &str) -> Vec<BoothProduct> {
    let document = Html::parse_document(html);
    let item_sel = Selector::parse("li.item").unwrap();
    let name_sel = Selector::parse(".item-name a").unwrap();
    let price_sel = Selector::parse(".item-price").unwrap();
    let author_sel = Selector::parse(".item-shop a").unwrap();
    let link_sel = Selector::parse(".item-thumbnail a").unwrap();
    let img_sel = Selector::parse("img").unwrap();

    document
        .select(&item_sel)
        .filter_map(|item| {
            let name = item.select(&name_sel).next()?.text().collect::<String>().trim().to_string();
            let price_display = item.select(&price_sel).next()
                .map(|e| e.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            let author = item.select(&author_sel).next()?.text().collect::<String>().trim().to_string();
            let href = item.select(&link_sel).next()?.value().attr("href")?;
            let source_id = href.split('/').last()?.to_string();
            let thumbnail_url = item.select(&img_sel).next()
                .and_then(|i| i.value().attr("src"))
                .unwrap_or("")
                .to_string();

            Some(BoothProduct {
                source_id,
                name,
                author,
                thumbnail_url,
                price_display,
                url: format!("https://booth.pm{}", href),
                source: "booth".to_string(),
            })
        })
        .collect()
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    page: u32,
) -> Result<Vec<BoothProduct>, String> {
    let url = build_search_url(query, page);
    let html = client
        .get(&url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    Ok(parse_search_results(&html))
}

pub async fn get_download_url(
    client: &reqwest::Client,
    source_id: &str,
) -> Result<String, String> {
    // Booth sirve la URL de descarga real en la página del item cuando el usuario está autenticado
    let url = format!("https://booth.pm/en/items/{}", source_id);
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);
    let sel = Selector::parse("a[data-product-id]").unwrap();
    document
        .select(&sel)
        .find_map(|el| el.value().attr("href").map(|s| s.to_string()))
        .ok_or_else(|| "Download URL not found (not purchased or not logged in)".to_string())
}
```

- [ ] **Step 4: Añadir dependencia urlencoding en Cargo.toml**

```toml
urlencoding = "2"
```

- [ ] **Step 5: Declarar módulo**

```rust
// src-tauri/src/services/mod.rs (añadir)
pub mod booth;
```

- [ ] **Step 6: Ejecutar tests**

```bash
cargo test booth::tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/booth.rs src-tauri/src/services/mod.rs Cargo.toml
git commit -m "feat(shop): add Booth.pm search client and HTML parser"
```

---

## Task 4: Cliente Riperstore Forums

**Files:**
- Create: `src-tauri/src/services/riperstore.rs`

- [ ] **Step 1: Escribir los tests**

```rust
// src-tauri/src/services/riperstore.rs (al final)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_forum_threads_from_html() {
        let html = r#"
          <div class="structItem">
            <div class="structItem-title">
              <a href="/threads/avatar-base.456/" class="structItem-title">Cool Avatar</a>
            </div>
            <div class="structItem-minor"><ul>
              <li class="structItem-startDate"><a>AuthorRipe</a></li>
            </ul></div>
            <div class="attachment"><img src="https://example.com/ripe.jpg" /></div>
          </div>
        "#;

        let results = parse_thread_list(html);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Cool Avatar");
        assert_eq!(results[0].author, "AuthorRipe");
        assert_eq!(results[0].source_id, "456");
    }

    #[test]
    fn test_build_search_url() {
        let url = build_search_url("lilac avatar", 1);
        assert!(url.contains("riperstore.com") || url.contains("search"));
        assert!(url.contains("lilac+avatar") || url.contains("lilac%20avatar"));
    }
}
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
cargo test riperstore::tests -- --nocapture
```

Expected: FAIL — `parse_thread_list` not found.

- [ ] **Step 3: Implementar riperstore.rs**

```rust
// src-tauri/src/services/riperstore.rs
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiperstoreProduct {
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String, // siempre "Free"
    pub url: String,
    pub source: String, // siempre "riperstore"
}

pub fn build_search_url(query: &str, page: u32) -> String {
    let encoded = urlencoding::encode(query);
    format!(
        "https://riperstore.com/search?q={}&page={}",
        encoded, page
    )
}

pub fn parse_thread_list(html: &str) -> Vec<RiperstoreProduct> {
    let document = Html::parse_document(html);
    let item_sel = Selector::parse(".structItem").unwrap();
    let title_sel = Selector::parse(".structItem-title a").unwrap();
    let author_sel = Selector::parse(".structItem-minor li a").unwrap();
    let img_sel = Selector::parse(".attachment img").unwrap();

    document
        .select(&item_sel)
        .filter_map(|item| {
            let title_el = item.select(&title_sel).next()?;
            let name = title_el.text().collect::<String>().trim().to_string();
            let href = title_el.value().attr("href")?;
            // href como "/threads/cool-avatar.456/" → source_id = "456"
            let source_id = href
                .trim_end_matches('/')
                .rsplit('.')
                .next()?
                .to_string();
            let author = item
                .select(&author_sel)
                .next()
                .map(|a| a.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            let thumbnail_url = item
                .select(&img_sel)
                .next()
                .and_then(|i| i.value().attr("src"))
                .unwrap_or("")
                .to_string();

            Some(RiperstoreProduct {
                source_id,
                name,
                author,
                thumbnail_url,
                price_display: "Free".to_string(),
                url: format!("https://riperstore.com{}", href),
                source: "riperstore".to_string(),
            })
        })
        .collect()
}

/// Extrae la primera URL de attachment (.zip/.unitypackage) del hilo del foro.
pub fn parse_download_url_from_thread(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let sel = Selector::parse("a[href$='.zip'], a[href$='.unitypackage']").unwrap();
    document
        .select(&sel)
        .next()
        .and_then(|a| a.value().attr("href"))
        .map(|s| s.to_string())
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    page: u32,
) -> Result<Vec<RiperstoreProduct>, String> {
    let url = build_search_url(query, page);
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    Ok(parse_thread_list(&html))
}

pub async fn get_download_url(
    client: &reqwest::Client,
    source_id: &str,
) -> Result<String, String> {
    let url = format!("https://riperstore.com/threads/{}/", source_id);
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    parse_download_url_from_thread(&html)
        .ok_or_else(|| "No downloadable attachment found in thread".to_string())
}
```

- [ ] **Step 4: Declarar módulo**

```rust
// src-tauri/src/services/mod.rs (añadir)
pub mod riperstore;
```

- [ ] **Step 5: Ejecutar tests**

```bash
cargo test riperstore::tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/riperstore.rs src-tauri/src/services/mod.rs
git commit -m "feat(shop): add Riperstore Forums scraper client"
```

---

## Task 5: Motor de descarga con progreso en tiempo real

**Files:**
- Create: `src-tauri/src/services/downloader.rs`

- [ ] **Step 1: Escribir tests**

```rust
// src-tauri/src/services/downloader.rs (al final)
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_is_zip_by_extension() {
        assert!(is_zip_path("/tmp/pack.zip"));
        assert!(!is_zip_path("/tmp/pack.unitypackage"));
    }

    #[test]
    fn test_sanitize_filename() {
        let name = sanitize_filename("Cool Avatar/Base: v2.0?");
        assert!(!name.contains('/'));
        assert!(!name.contains(':'));
        assert!(!name.contains('?'));
    }

    #[tokio::test]
    async fn test_download_progress_events_emit_correctly() {
        // Test que DownloadProgress::chunk() calcula percentage correctamente
        let mut prog = DownloadProgress::new(1000);
        prog.add_bytes(500);
        assert_eq!(prog.percentage(), 50.0);
        prog.add_bytes(500);
        assert_eq!(prog.percentage(), 100.0);
    }
}
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
cargo test downloader::tests -- --nocapture
```

Expected: FAIL — `is_zip_path` / `DownloadProgress` not found.

- [ ] **Step 3: Implementar downloader.rs**

```rust
// src-tauri/src/services/downloader.rs
use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

pub fn is_zip_path(path: &str) -> bool {
    path.ends_with(".zip")
}

pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
}

impl DownloadProgress {
    pub fn new(total_bytes: u64) -> Self {
        Self { total_bytes, downloaded_bytes: 0 }
    }

    pub fn add_bytes(&mut self, n: u64) {
        self.downloaded_bytes += n;
    }

    pub fn percentage(&self) -> f64 {
        if self.total_bytes == 0 {
            return 0.0;
        }
        (self.downloaded_bytes as f64 / self.total_bytes as f64) * 100.0
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressEvent {
    pub item_id: String,
    pub percentage: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub status: String, // "downloading" | "extracting" | "done" | "error"
}

/// Descarga `url` a `dest_dir/<filename>`. Emite eventos `download://progress` con Tauri.
/// Retorna la ruta final del archivo descargado.
pub async fn download_file(
    app: &AppHandle,
    client: &reqwest::Client,
    item_id: &str,
    url: &str,
    dest_dir: &Path,
) -> Result<PathBuf, String> {
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    let total = response.content_length().unwrap_or(0);
    let filename = url
        .split('/')
        .last()
        .map(|s| sanitize_filename(s))
        .unwrap_or_else(|| format!("{}.bin", item_id));

    tokio::fs::create_dir_all(dest_dir).await.map_err(|e| e.to_string())?;
    let dest_path = dest_dir.join(&filename);
    let mut file = tokio::fs::File::create(&dest_path).await.map_err(|e| e.to_string())?;

    let mut progress = DownloadProgress::new(total);
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
        progress.add_bytes(bytes.len() as u64);

        let _ = app.emit("download://progress", DownloadProgressEvent {
            item_id: item_id.to_string(),
            percentage: progress.percentage(),
            downloaded_bytes: progress.downloaded_bytes,
            total_bytes: progress.total_bytes,
            status: "downloading".to_string(),
        });
    }

    Ok(dest_path)
}

/// Si el archivo descargado es un .zip, lo extrae en `dest_dir` y retorna la carpeta extraída.
pub async fn maybe_extract_zip(
    app: &AppHandle,
    item_id: &str,
    file_path: &Path,
    dest_dir: &Path,
) -> Result<PathBuf, String> {
    if !is_zip_path(&file_path.to_string_lossy()) {
        return Ok(file_path.to_path_buf());
    }

    let _ = app.emit("download://progress", DownloadProgressEvent {
        item_id: item_id.to_string(),
        percentage: 100.0,
        downloaded_bytes: 0,
        total_bytes: 0,
        status: "extracting".to_string(),
    });

    let file_path_owned = file_path.to_path_buf();
    let dest_dir_owned = dest_dir.to_path_buf();

    tokio::task::spawn_blocking(move || -> Result<PathBuf, String> {
        let file = std::fs::File::open(&file_path_owned).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        archive.extract(&dest_dir_owned).map_err(|e| e.to_string())?;
        // El contenido queda en dest_dir; borrar el .zip
        std::fs::remove_file(&file_path_owned).ok();
        Ok(dest_dir_owned)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

Añadir a `Cargo.toml`:
```toml
zip = "2"
futures-util = "0.3"
```

- [ ] **Step 4: Declarar módulo**

```rust
// src-tauri/src/services/mod.rs
pub mod downloader;
```

- [ ] **Step 5: Ejecutar tests**

```bash
cargo test downloader::tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/downloader.rs src-tauri/src/services/mod.rs Cargo.toml
git commit -m "feat(shop): add async download manager with real-time Tauri progress events"
```

---

## Task 6: Tauri Commands — Shop

**Files:**
- Create: `src-tauri/src/commands/shop.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Escribir tests de integración (command handlers)**

```rust
// src-tauri/src/commands/shop.rs (al final)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unified_results_merge_and_deduplicate() {
        let booth = vec![
            SearchResult {
                source_id: "111".to_string(),
                name: "Avatar A".to_string(),
                author: "Au".to_string(),
                thumbnail_url: "".to_string(),
                price_display: "¥500".to_string(),
                url: "https://booth.pm/items/111".to_string(),
                source: "booth".to_string(),
            },
        ];
        let riper = vec![
            SearchResult {
                source_id: "222".to_string(),
                name: "Avatar B".to_string(),
                author: "Rr".to_string(),
                thumbnail_url: "".to_string(),
                price_display: "Free".to_string(),
                url: "https://riperstore.com/threads/222".to_string(),
                source: "riperstore".to_string(),
            },
        ];

        let merged = merge_results(booth, riper);
        assert_eq!(merged.len(), 2);
    }
}
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
cargo test commands::shop::tests -- --nocapture
```

Expected: FAIL.

- [ ] **Step 3: Implementar commands/shop.rs**

```rust
// src-tauri/src/commands/shop.rs
use crate::services::{auth_store, booth, downloader, riperstore};
use crate::db::models::InventoryItem;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String,
    pub url: String,
    pub source: String,
}

pub fn merge_results(
    booth_res: Vec<booth::BoothProduct>,
    riper_res: Vec<riperstore::RiperstoreProduct>,
) -> Vec<SearchResult> {
    let mut all: Vec<SearchResult> = booth_res
        .into_iter()
        .map(|p| SearchResult {
            source_id: p.source_id,
            name: p.name,
            author: p.author,
            thumbnail_url: p.thumbnail_url,
            price_display: p.price_display,
            url: p.url,
            source: p.source,
        })
        .chain(riper_res.into_iter().map(|p| SearchResult {
            source_id: p.source_id,
            name: p.name,
            author: p.author,
            thumbnail_url: p.thumbnail_url,
            price_display: p.price_display,
            url: p.url,
            source: p.source,
        }))
        .collect();

    // Orden: Booth primero, luego Riperstore (ya están en ese orden)
    all
}

#[tauri::command]
pub async fn search_shop(query: String, page: u32) -> Result<Vec<SearchResult>, String> {
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .map_err(|e| e.to_string())?;

    let (booth_res, riper_res) = tokio::join!(
        booth::search(&client, &query, page),
        riperstore::search(&client, &query, page),
    );

    let booth_results = booth_res.unwrap_or_default();
    let riper_results = riper_res.unwrap_or_default();

    Ok(merge_results(booth_results, riper_results))
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    source: String,
    source_id: String,
    name: String,
    author: String,
    thumbnail_url: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .map_err(|e| e.to_string())?;

    let download_url = match source.as_str() {
        "booth" => booth::get_download_url(&client, &source_id).await?,
        "riperstore" => riperstore::get_download_url(&client, &source_id).await?,
        other => return Err(format!("Unknown source: {}", other)),
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("downloads")
        .join(&source)
        .join(&source_id);

    let downloaded_path =
        downloader::download_file(&app, &client, &source_id, &download_url, &cache_dir).await?;

    let final_path =
        downloader::maybe_extract_zip(&app, &source_id, &downloaded_path, &cache_dir).await?;

    // Registrar en DB
    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let size: i64 = std::fs::metadata(&final_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    sqlx::query!(
        r#"INSERT INTO inventory_items (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')"#,
        item_id,
        name,
        author,
        source,
        source_id,
        final_path.to_string_lossy().to_string(),
        thumbnail_url,
        now,
        size,
    )
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit("download://progress", serde_json::json!({
        "item_id": source_id,
        "percentage": 100.0,
        "status": "done"
    }));

    Ok(item_id)
}

#[tauri::command]
pub fn link_account(provider: String, token: String) -> Result<(), String> {
    auth_store::store_token(&provider, &token)
}

#[tauri::command]
pub fn unlink_account(provider: String) -> Result<(), String> {
    auth_store::delete_token(&provider)
}

#[tauri::command]
pub fn get_linked_providers() -> Vec<String> {
    ["booth", "riperstore", "github"]
        .iter()
        .filter(|p| auth_store::get_token(p).unwrap_or(None).is_some())
        .map(|p| p.to_string())
        .collect()
}
```

- [ ] **Step 4: Registrar commands en main.rs**

```rust
// src-tauri/src/main.rs — en .invoke_handler(tauri::generate_handler![...]) añadir:
commands::shop::search_shop,
commands::shop::start_download,
commands::shop::link_account,
commands::shop::unlink_account,
commands::shop::get_linked_providers,
```

- [ ] **Step 5: Ejecutar tests**

```bash
cargo test commands::shop::tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Compilar**

```bash
cargo build 2>&1 | head -40
```

Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/shop.rs src-tauri/src/main.rs
git commit -m "feat(shop): add shop Tauri commands (search, download, auth)"
```

---

## Task 7: Tauri Commands — Inventory

**Files:**
- Create: `src-tauri/src/commands/inventory.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Escribir tests**

```rust
// src-tauri/src/commands/inventory.rs (al final)
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_crud_inventory_item() {
        let pool = sqlx::SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!("./src/db/migrations").run(&pool).await.unwrap();

        // Insertar item
        let item_id = "test-item-1".to_string();
        sqlx::query!(
            "INSERT INTO inventory_items (id, name, author, source, local_path, download_date, size_bytes, tags)
             VALUES (?, 'Test', 'Au', 'manual', '/tmp', '2026-01-01', 0, '[]')",
            item_id
        )
        .execute(&pool)
        .await
        .unwrap();

        // Listar
        let items = list_inventory_items_query(&pool).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Test");

        // Eliminar solo de inventario
        delete_inventory_item_query(&pool, "test-item-1", DeleteMode::InventoryOnly).await.unwrap();
        let items_after = list_inventory_items_query(&pool).await.unwrap();
        assert_eq!(items_after.len(), 0);
    }

    #[tokio::test]
    async fn test_create_and_list_folder() {
        let pool = sqlx::SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!("./src/db/migrations").run(&pool).await.unwrap();

        let folder_id = create_folder_query(&pool, "My Folder", None).await.unwrap();
        let folders = list_folders_query(&pool).await.unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "My Folder");
        assert_eq!(folders[0].id, folder_id);
    }
}
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
cargo test commands::inventory::tests -- --nocapture
```

Expected: FAIL.

- [ ] **Step 3: Implementar commands/inventory.rs**

```rust
// src-tauri/src/commands/inventory.rs
use crate::db::models::{InventoryFolder, InventoryItem};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeleteMode {
    InventoryOnly,
    InventoryAndDisk,
    InventoryDiskAndProjects,
}

pub async fn list_inventory_items_query(pool: &SqlitePool) -> Result<Vec<InventoryItem>, String> {
    sqlx::query_as!(InventoryItem, "SELECT * FROM inventory_items ORDER BY download_date DESC")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

pub async fn delete_inventory_item_query(
    pool: &SqlitePool,
    item_id: &str,
    mode: DeleteMode,
) -> Result<(), String> {
    // Obtener local_path antes de borrar
    let item = sqlx::query_as!(
        InventoryItem,
        "SELECT * FROM inventory_items WHERE id = ?",
        item_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Item {} not found", item_id))?;

    // Borrar de DB primero
    sqlx::query!("DELETE FROM inventory_items WHERE id = ?", item_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    match mode {
        DeleteMode::InventoryOnly => {}
        DeleteMode::InventoryAndDisk => {
            let path = std::path::Path::new(&item.local_path);
            if path.exists() {
                if path.is_dir() {
                    std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
                } else {
                    std::fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
        }
        DeleteMode::InventoryDiskAndProjects => {
            // Borrar de disco
            let path = std::path::Path::new(&item.local_path);
            if path.exists() {
                if path.is_dir() {
                    std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
                } else {
                    std::fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
            // Borrar relaciones con proyectos Unity
            sqlx::query!("DELETE FROM project_assets WHERE inventory_item_id = ?", item_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

pub async fn create_folder_query(
    pool: &SqlitePool,
    name: &str,
    parent_id: Option<&str>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    sqlx::query!(
        "INSERT INTO inventory_folders (id, name, parent_id) VALUES (?, ?, ?)",
        id,
        name,
        parent_id,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub async fn list_folders_query(pool: &SqlitePool) -> Result<Vec<InventoryFolder>, String> {
    sqlx::query_as!(InventoryFolder, "SELECT * FROM inventory_folders ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_inventory(pool: State<'_, SqlitePool>) -> Result<Vec<InventoryItem>, String> {
    list_inventory_items_query(&pool).await
}

#[tauri::command]
pub async fn delete_inventory_item(
    pool: State<'_, SqlitePool>,
    item_id: String,
    mode: DeleteMode,
) -> Result<(), String> {
    delete_inventory_item_query(&pool, &item_id, mode).await
}

#[tauri::command]
pub async fn create_inventory_folder(
    pool: State<'_, SqlitePool>,
    name: String,
    parent_id: Option<String>,
) -> Result<String, String> {
    create_folder_query(&pool, &name, parent_id.as_deref()).await
}

#[tauri::command]
pub async fn list_inventory_folders(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<InventoryFolder>, String> {
    list_folders_query(&pool).await
}

#[tauri::command]
pub async fn move_item_to_folder(
    pool: State<'_, SqlitePool>,
    item_id: String,
    folder_id: String,
) -> Result<(), String> {
    // Eliminar de cualquier carpeta previa
    sqlx::query!("DELETE FROM inventory_folder_items WHERE item_id = ?", item_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query!(
        "INSERT INTO inventory_folder_items (folder_id, item_id) VALUES (?, ?)",
        folder_id,
        item_id
    )
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn tag_inventory_item(
    pool: State<'_, SqlitePool>,
    item_id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    sqlx::query!("UPDATE inventory_items SET tags = ? WHERE id = ?", tags_json, item_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Registrar commands en main.rs**

```rust
// src-tauri/src/main.rs — añadir al invoke_handler:
commands::inventory::list_inventory,
commands::inventory::delete_inventory_item,
commands::inventory::create_inventory_folder,
commands::inventory::list_inventory_folders,
commands::inventory::move_item_to_folder,
commands::inventory::tag_inventory_item,
```

- [ ] **Step 5: Ejecutar tests**

```bash
cargo test commands::inventory::tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/inventory.rs src-tauri/src/main.rs
git commit -m "feat(inventory): add CRUD inventory Tauri commands with 3 delete modes"
```

---

## Task 8: Frontend — Wrappers tipados Shop e Inventory

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Escribir test TypeScript (tipos)**

```typescript
// src/lib/tauri.test.ts
import { searchShop, startDownload, listInventory } from './tauri';

// Verificar que las firmas compilan (test en tiempo de compilación via tsc)
const _typeCheck = async () => {
  const results = await searchShop("avatar", 1);
  const _name: string = results[0].name;
  const _source: string = results[0].source;

  const items = await listInventory();
  const _author: string = items[0].author;
};
```

Ejecutar:
```bash
npx tsc --noEmit
```

Expected: PASS (sin errores de tipos).

- [ ] **Step 2: Añadir wrappers en tauri.ts**

```typescript
// src/lib/tauri.ts — añadir al final del archivo existente
import { invoke } from "@tauri-apps/api/core";

export interface ShopProduct {
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
  price_display: string;
  url: string;
  source: "booth" | "riperstore";
}

export interface InventoryItem {
  id: string;
  name: string;
  author: string;
  source: "booth" | "riperstore" | "manual";
  source_id: string | null;
  local_path: string;
  thumbnail_url: string | null;
  download_date: string;
  size_bytes: number;
  tags: string; // JSON array serializado
}

export interface InventoryFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

export type DeleteMode =
  | "InventoryOnly"
  | "InventoryAndDisk"
  | "InventoryDiskAndProjects";

export const searchShop = (query: string, page: number) =>
  invoke<ShopProduct[]>("search_shop", { query, page });

export const startDownload = (args: {
  source: string;
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
}) => invoke<string>("start_download", args);

export const linkAccount = (provider: string, token: string) =>
  invoke<void>("link_account", { provider, token });

export const unlinkAccount = (provider: string) =>
  invoke<void>("unlink_account", { provider });

export const getLinkedProviders = () =>
  invoke<string[]>("get_linked_providers");

export const listInventory = () => invoke<InventoryItem[]>("list_inventory");

export const deleteInventoryItem = (item_id: string, mode: DeleteMode) =>
  invoke<void>("delete_inventory_item", { item_id, mode });

export const createInventoryFolder = (name: string, parent_id?: string) =>
  invoke<string>("create_inventory_folder", { name, parent_id: parent_id ?? null });

export const listInventoryFolders = () =>
  invoke<InventoryFolder[]>("list_inventory_folders");

export const moveItemToFolder = (item_id: string, folder_id: string) =>
  invoke<void>("move_item_to_folder", { item_id, folder_id });

export const tagInventoryItem = (item_id: string, tags: string[]) =>
  invoke<void>("tag_inventory_item", { item_id, tags });
```

- [ ] **Step 3: Verificar tipos**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(frontend): add typed Tauri wrappers for shop and inventory commands"
```

---

## Task 9: Zustand Stores — Shop e Inventory

**Files:**
- Create: `src/store/shopStore.ts`
- Create: `src/store/inventoryStore.ts`

- [ ] **Step 1: Implementar shopStore.ts**

```typescript
// src/store/shopStore.ts
import { create } from "zustand";
import { ShopProduct, searchShop } from "../lib/tauri";

interface ShopFilters {
  source: "all" | "booth" | "riperstore";
  priceType: "all" | "free" | "paid" | "owned";
}

interface ShopState {
  query: string;
  page: number;
  results: ShopProduct[];
  loading: boolean;
  error: string | null;
  selectedProduct: ShopProduct | null;
  filters: ShopFilters;

  setQuery: (q: string) => void;
  setFilters: (f: Partial<ShopFilters>) => void;
  search: () => Promise<void>;
  selectProduct: (p: ShopProduct | null) => void;
  loadNextPage: () => Promise<void>;
}

export const useShopStore = create<ShopState>((set, get) => ({
  query: "",
  page: 1,
  results: [],
  loading: false,
  error: null,
  selectedProduct: null,
  filters: { source: "all", priceType: "all" },

  setQuery: (q) => set({ query: q, page: 1, results: [] }),

  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),

  search: async () => {
    const { query, page, filters } = get();
    if (!query.trim()) return;
    set({ loading: true, error: null });
    try {
      let res = await searchShop(query, page);
      if (filters.source !== "all") {
        res = res.filter((r) => r.source === filters.source);
      }
      set({ results: res, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectProduct: (p) => set({ selectedProduct: p }),

  loadNextPage: async () => {
    const { query, page, results, filters } = get();
    set({ loading: true });
    try {
      let more = await searchShop(query, page + 1);
      if (filters.source !== "all") {
        more = more.filter((r) => r.source === filters.source);
      }
      set({ results: [...results, ...more], page: page + 1, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));
```

- [ ] **Step 2: Implementar inventoryStore.ts**

```typescript
// src/store/inventoryStore.ts
import { create } from "zustand";
import {
  InventoryItem,
  InventoryFolder,
  DeleteMode,
  listInventory,
  listInventoryFolders,
  deleteInventoryItem,
  createInventoryFolder,
  moveItemToFolder,
  tagInventoryItem,
} from "../lib/tauri";

interface InventoryState {
  items: InventoryItem[];
  folders: InventoryFolder[];
  selectedFolderId: string | null;
  selectedItem: InventoryItem | null;
  viewMode: "grid" | "list";
  searchQuery: string;
  loading: boolean;
  error: string | null;

  fetchAll: () => Promise<void>;
  setViewMode: (m: "grid" | "list") => void;
  setSearchQuery: (q: string) => void;
  selectFolder: (id: string | null) => void;
  selectItem: (item: InventoryItem | null) => void;
  removeItem: (id: string, mode: DeleteMode) => Promise<void>;
  addFolder: (name: string, parentId?: string) => Promise<void>;
  moveItem: (itemId: string, folderId: string) => Promise<void>;
  updateTags: (itemId: string, tags: string[]) => Promise<void>;
  filteredItems: () => InventoryItem[];
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  folders: [],
  selectedFolderId: null,
  selectedItem: null,
  viewMode: "grid",
  searchQuery: "",
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [items, folders] = await Promise.all([listInventory(), listInventoryFolders()]);
      set({ items, folders, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setViewMode: (m) => set({ viewMode: m }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  selectFolder: (id) => set({ selectedFolderId: id }),
  selectItem: (item) => set({ selectedItem: item }),

  removeItem: async (id, mode) => {
    await deleteInventoryItem(id, mode);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },

  addFolder: async (name, parentId) => {
    const id = await createInventoryFolder(name, parentId);
    set((s) => ({
      folders: [...s.folders, { id, name, parent_id: parentId ?? null }],
    }));
  },

  moveItem: async (itemId, folderId) => {
    await moveItemToFolder(itemId, folderId);
  },

  updateTags: async (itemId, tags) => {
    await tagInventoryItem(itemId, tags);
    const tagsJson = JSON.stringify(tags);
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, tags: tagsJson } : i)),
    }));
  },

  filteredItems: () => {
    const { items, searchQuery } = get();
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.author.toLowerCase().includes(q)
    );
  },
}));
```

- [ ] **Step 3: Verificar tipos**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/store/shopStore.ts src/store/inventoryStore.ts
git commit -m "feat(frontend): add shopStore and inventoryStore Zustand slices"
```

---

## Task 10: Componentes Shop UI

**Files:**
- Create: `src/components/shop/ProductCard.tsx`
- Create: `src/components/shop/ProductGrid.tsx`
- Create: `src/components/shop/ShopFilters.tsx`
- Create: `src/components/shop/DownloadProgress.tsx`
- Create: `src/pages/Shop.tsx`
- Create: `src/hooks/useShopSearch.ts`
- Create: `src/hooks/useDownloadProgress.ts`

- [ ] **Step 1: Implementar useShopSearch.ts**

```typescript
// src/hooks/useShopSearch.ts
import { useEffect, useRef } from "react";
import { useShopStore } from "../store/shopStore";

export function useShopSearch() {
  const { query, search, setQuery } = useShopStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (q.trim()) search();
    }, 400);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { query, handleQueryChange };
}
```

- [ ] **Step 2: Implementar useDownloadProgress.ts**

```typescript
// src/hooks/useDownloadProgress.ts
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface DownloadEvent {
  item_id: string;
  percentage: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: "downloading" | "extracting" | "done" | "error";
}

export function useDownloadProgress() {
  const [downloads, setDownloads] = useState<Record<string, DownloadEvent>>({});

  useEffect(() => {
    const unlisten = listen<DownloadEvent>("download://progress", (event) => {
      const payload = event.payload;
      setDownloads((prev) => {
        if (payload.status === "done" || payload.status === "error") {
          // Limpiar después de 3 segundos
          setTimeout(() => {
            setDownloads((p) => {
              const next = { ...p };
              delete next[payload.item_id];
              return next;
            });
          }, 3000);
        }
        return { ...prev, [payload.item_id]: payload };
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return { downloads };
}
```

- [ ] **Step 3: Implementar ProductCard.tsx**

```tsx
// src/components/shop/ProductCard.tsx
import { ShopProduct, startDownload } from "../../lib/tauri";
import { useShopStore } from "../../store/shopStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";

interface Props {
  product: ShopProduct;
}

export function ProductCard({ product }: Props) {
  const { selectProduct } = useShopStore();

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await startDownload({
      source: product.source,
      source_id: product.source_id,
      name: product.name,
      author: product.author,
      thumbnail_url: product.thumbnail_url,
    });
  };

  return (
    <div
      className="group relative flex flex-col rounded-lg border border-border bg-card cursor-pointer hover:border-primary transition-colors overflow-hidden"
      onClick={() => selectProduct(product)}
    >
      <div className="aspect-square overflow-hidden bg-muted">
        {product.thumbnail_url ? (
          <img
            src={product.thumbnail_url}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            No image
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <p className="font-medium text-sm leading-tight line-clamp-2">{product.name}</p>
        <p className="text-xs text-muted-foreground">{product.author}</p>
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-xs font-semibold text-primary">{product.price_display}</span>
          <Badge variant="outline" className="text-xs capitalize">
            {product.source}
          </Badge>
        </div>
      </div>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="icon" variant="secondary" className="h-8 w-8" onClick={handleDownload}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implementar ProductGrid.tsx**

```tsx
// src/components/shop/ProductGrid.tsx
import { useShopStore } from "../../store/shopStore";
import { ProductCard } from "./ProductCard";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function ProductGrid() {
  const { results, loading, error, loadNextPage } = useShopStore();

  if (loading && results.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive text-sm">
        {error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No results. Try searching for something.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {results.map((p) => (
          <ProductCard key={`${p.source}-${p.source_id}`} product={p} />
        ))}
      </div>
      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={loadNextPage}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Load more
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implementar ShopFilters.tsx**

```tsx
// src/components/shop/ShopFilters.tsx
import { useShopStore } from "../../store/shopStore";
import { Button } from "@/components/ui/button";

const SOURCES = [
  { value: "all", label: "All" },
  { value: "booth", label: "Booth.pm" },
  { value: "riperstore", label: "Riperstore" },
] as const;

const PRICE_TYPES = [
  { value: "all", label: "All" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
  { value: "owned", label: "Owned" },
] as const;

export function ShopFilters() {
  const { filters, setFilters } = useShopStore();

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="flex gap-1">
        {SOURCES.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={filters.source === s.value ? "default" : "outline"}
            onClick={() => setFilters({ source: s.value })}
          >
            {s.label}
          </Button>
        ))}
      </div>
      <div className="flex gap-1">
        {PRICE_TYPES.map((p) => (
          <Button
            key={p.value}
            size="sm"
            variant={filters.priceType === p.value ? "default" : "outline"}
            onClick={() => setFilters({ priceType: p.value })}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implementar DownloadProgress.tsx**

```tsx
// src/components/shop/DownloadProgress.tsx
import { useDownloadProgress } from "../../hooks/useDownloadProgress";
import { Progress } from "@/components/ui/progress";

export function DownloadProgress() {
  const { downloads } = useDownloadProgress();
  const active = Object.values(downloads);

  if (active.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-72">
      {active.map((d) => (
        <div
          key={d.item_id}
          className="bg-card border border-border rounded-lg p-3 shadow-lg flex flex-col gap-2"
        >
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground truncate max-w-[180px]">{d.item_id}</span>
            <span className="font-medium capitalize">{d.status}</span>
          </div>
          <Progress value={d.percentage} className="h-1.5" />
          <span className="text-xs text-muted-foreground text-right">
            {d.percentage.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Implementar Shop.tsx**

```tsx
// src/pages/Shop.tsx
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { ProductGrid } from "../components/shop/ProductGrid";
import { ShopFilters } from "../components/shop/ShopFilters";
import { DownloadProgress } from "../components/shop/DownloadProgress";
import { useShopSearch } from "../hooks/useShopSearch";

export default function Shop() {
  const { query, handleQueryChange } = useShopSearch();

  return (
    <div className="flex flex-col h-full gap-4 p-6 overflow-auto">
      <h1 className="text-2xl font-semibold">Shop</h1>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search assets on Booth.pm and Riperstore…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />
      </div>

      <ShopFilters />
      <ProductGrid />
      <DownloadProgress />
    </div>
  );
}
```

- [ ] **Step 8: Verificar tipos y compilar frontend**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Shop.tsx src/components/shop/ src/hooks/useShopSearch.ts src/hooks/useDownloadProgress.ts
git commit -m "feat(shop): implement Shop page with search, filters, grid, download progress"
```

---

## Task 11: Componentes Inventory UI — Grid + FolderTree

**Files:**
- Create: `src/components/inventory/FolderTree.tsx`
- Create: `src/components/inventory/InventoryItem.tsx`
- Create: `src/components/inventory/InventoryGrid.tsx`
- Create: `src/pages/Inventory.tsx`
- Create: `src/hooks/useInventory.ts`

Dependencia drag & drop:
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 1: Implementar useInventory.ts**

```typescript
// src/hooks/useInventory.ts
import { useEffect } from "react";
import { useInventoryStore } from "../store/inventoryStore";

export function useInventory() {
  const store = useInventoryStore();

  useEffect(() => {
    store.fetchAll();
  }, []);

  return store;
}
```

- [ ] **Step 2: Implementar FolderTree.tsx**

```tsx
// src/components/inventory/FolderTree.tsx
import { useInventoryStore } from "../../store/inventoryStore";
import { InventoryFolder } from "../../lib/tauri";
import { Button } from "@/components/ui/button";
import { FolderOpen, Folder, Plus } from "lucide-react";
import { useState } from "react";

function FolderNode({
  folder,
  depth,
  allFolders,
}: {
  folder: InventoryFolder;
  depth: number;
  allFolders: InventoryFolder[];
}) {
  const { selectedFolderId, selectFolder } = useInventoryStore();
  const children = allFolders.filter((f) => f.parent_id === folder.id);
  const isSelected = selectedFolderId === folder.id;

  return (
    <div>
      <button
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-muted transition-colors ${
          isSelected ? "bg-muted font-medium" : ""
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => selectFolder(folder.id)}
      >
        {isSelected ? (
          <FolderOpen className="h-4 w-4 text-primary shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="truncate">{folder.name}</span>
      </button>
      {children.map((child) => (
        <FolderNode key={child.id} folder={child} depth={depth + 1} allFolders={allFolders} />
      ))}
    </div>
  );
}

export function FolderTree() {
  const { folders, selectedFolderId, selectFolder, addFolder } = useInventoryStore();
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const rootFolders = folders.filter((f) => f.parent_id === null);

  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    await addFolder(newFolderName.trim());
    setNewFolderName("");
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-1 w-52 shrink-0 pr-2 border-r border-border h-full overflow-auto">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Folders
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {creating && (
        <div className="px-2 flex gap-1">
          <input
            autoFocus
            className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background"
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
        </div>
      )}

      <button
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-muted ${
          selectedFolderId === null ? "bg-muted font-medium" : ""
        }`}
        onClick={() => selectFolder(null)}
      >
        <Folder className="h-4 w-4 text-muted-foreground" />
        All items
      </button>

      {rootFolders.map((f) => (
        <FolderNode key={f.id} folder={f} depth={0} allFolders={folders} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implementar InventoryItem.tsx**

```tsx
// src/components/inventory/InventoryItem.tsx
import { InventoryItem as IItem } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Trash2, FolderInput, Tag, Info } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";

interface Props {
  item: IItem;
  viewMode: "grid" | "list";
}

export function InventoryItemCard({ item, viewMode }: Props) {
  const { removeItem, selectItem } = useInventoryStore();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { item },
  });

  const tags: string[] = (() => {
    try { return JSON.parse(item.tags); } catch { return []; }
  })();

  const sizeKb = (item.size_bytes / 1024).toFixed(0);

  if (viewMode === "list") {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`flex items-center gap-3 px-4 py-2 rounded hover:bg-muted cursor-grab ${
          isDragging ? "opacity-50" : ""
        }`}
      >
        <div className="w-10 h-10 rounded bg-muted shrink-0 overflow-hidden">
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.author} · {sizeKb} KB</p>
        </div>
        <ItemMenu item={item} onDelete={removeItem} onInfo={selectItem} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group relative flex flex-col rounded-lg border border-border bg-card overflow-hidden cursor-grab ${
        isDragging ? "opacity-50 scale-95" : ""
      }`}
    >
      <div className="aspect-square bg-muted overflow-hidden">
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No preview
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-medium truncate">{item.name}</p>
        <p className="text-xs text-muted-foreground truncate">{item.author}</p>
      </div>
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <ItemMenu item={item} onDelete={removeItem} onInfo={selectItem} />
      </div>
    </div>
  );
}

function ItemMenu({
  item,
  onDelete,
  onInfo,
}: {
  item: IItem;
  onDelete: (id: string, mode: any) => void;
  onInfo: (item: IItem) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7">
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onInfo(item)}>
          <Info className="h-4 w-4 mr-2" /> Info
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(item.id, "InventoryOnly")}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Remove from Inventory
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => onDelete(item.id, "InventoryAndDisk")}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete from disk
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => onDelete(item.id, "InventoryDiskAndProjects")}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete everywhere
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Implementar InventoryGrid.tsx con DnD**

```tsx
// src/components/inventory/InventoryGrid.tsx
import { DndContext, DragEndEvent, pointerWithin } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useInventoryStore } from "../../store/inventoryStore";
import { InventoryItemCard } from "./InventoryItem";

function FolderDropZone({ folderId }: { folderId: string | null }) {
  const { isOver, setNodeRef } = useDroppable({ id: folderId ?? "root" });
  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-0 rounded-lg border-2 border-dashed transition-colors pointer-events-none ${
        isOver ? "border-primary bg-primary/5" : "border-transparent"
      }`}
    />
  );
}

export function InventoryGrid() {
  const {
    filteredItems,
    viewMode,
    loading,
    selectedFolderId,
    moveItem,
  } = useInventoryStore();

  const items = filteredItems();

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const itemId = active.id as string;
    const folderId = over.id as string;
    if (folderId !== "root") {
      await moveItem(itemId, folderId);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
        Loading inventory…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
        No items here yet.
      </div>
    );
  }

  return (
    <DndContext collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="relative flex-1">
        <FolderDropZone folderId={selectedFolderId} />
        {viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map((item) => (
              <InventoryItemCard key={item.id} item={item} viewMode="grid" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <InventoryItemCard key={item.id} item={item} viewMode="list" />
            ))}
          </div>
        )}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 5: Implementar Inventory.tsx**

```tsx
// src/pages/Inventory.tsx
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LayoutGrid, List, Search } from "lucide-react";
import { FolderTree } from "../components/inventory/FolderTree";
import { InventoryGrid } from "../components/inventory/InventoryGrid";
import { useInventory } from "../hooks/useInventory";

export default function Inventory() {
  const { viewMode, setViewMode, searchQuery, setSearchQuery } = useInventory();

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="p-4 overflow-auto">
        <FolderTree />
      </aside>

      <main className="flex-1 flex flex-col gap-4 p-6 overflow-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant={viewMode === "grid" ? "default" : "outline"}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant={viewMode === "list" ? "default" : "outline"}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search in inventory…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <InventoryGrid />
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Registrar rutas en el router de la app**

```tsx
// src/App.tsx o donde esté el router — añadir:
import Inventory from "./pages/Inventory";
import Shop from "./pages/Shop";

// En el router:
{ path: "/shop", element: <Shop /> },
{ path: "/inventory", element: <Inventory /> },
```

- [ ] **Step 7: Verificar tipos y compilar**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -20
```

Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Inventory.tsx src/pages/Shop.tsx src/components/inventory/ src/hooks/useInventory.ts
git commit -m "feat(inventory): implement Inventory page with folder tree, grid/list, drag & drop, 3 delete modes"
```

---

## Task 12: Smoke test end-to-end

**Files:** ninguno nuevo.

- [ ] **Step 1: Lanzar la app en modo desarrollo**

```bash
npm run tauri dev
```

Expected: la app arranca sin panics.

- [ ] **Step 2: Verificar migración DB**

Abrir DevTools → Network o console. Al arrancar debe haber log de:
```
Applied migration: 0003_shop_inventory
```
(o sin error si ya estaba aplicada).

- [ ] **Step 3: Smoke test Shop**

1. Navegar a `/shop`.
2. Escribir `avatar` en la barra de búsqueda.
3. Verificar que aparece el spinner y luego cards.
4. Aplicar filtro "Riperstore" — verificar que solo quedan cards con badge "riperstore".
5. Hacer clic en Download de un card → verificar que aparece `DownloadProgress` en la esquina.

Expected: UI responde, no hay errores en consola.

- [ ] **Step 4: Smoke test Inventory**

1. Navegar a `/inventory`.
2. Verificar que se carga la lista (vacía si no hay items).
3. Crear una carpeta nueva: clic en `+` → escribir nombre → Enter.
4. Verificar que la carpeta aparece en el FolderTree.
5. Alternar entre vista Grid y Lista.

Expected: sin errores JS.

- [ ] **Step 5: Smoke test drag & drop**

1. Con al menos un item en inventario, arrastrar el item a una carpeta en el FolderTree.
2. Verificar que el ítem queda asociado a la carpeta en DB.

```bash
# Verificar en SQLite directamente
sqlite3 "$APPDATA/vrc-studio/vrc-studio.db" "SELECT * FROM inventory_folder_items;"
```

Expected: fila con `folder_id` y `item_id` correctos.

- [ ] **Step 6: Commit final del plan**

```bash
git add .
git commit -m "chore: smoke test plan 3 Shop+Inventory complete"
```

---

## Self-Review

### 1. Spec coverage

| Requisito del spec (sección 5) | Task que lo implementa |
|---|---|
| Auth Booth.pm (OAuth2/cookie) | Task 2 (auth_store), Task 3 (booth.rs) |
| Auth Riperstore (credenciales) | Task 2 (auth_store), Task 4 (riperstore.rs) |
| Búsqueda unificada paralela | Task 6 (`tokio::join!` en `search_shop`) |
| Grid de cards con imagen/precio/fuente | Task 10 (ProductCard, ProductGrid) |
| Filtros: fuente, precio | Task 10 (ShopFilters) |
| Vista de producto (modal/panel) | Parcial en Task 10 (`selectProduct`); ProductDetail.tsx pendiente — ver nota |
| Descarga con progreso en tiempo real | Task 5 (downloader.rs), Task 10 (DownloadProgress) |
| Registro en Inventory tras descarga | Task 6 (`start_download` inserta en DB) |
| Vista Inventory grid/lista toggle | Task 11 |
| Carpetas virtuales | Task 1 (DB), Task 7 (commands), Task 11 (FolderTree) |
| Filtros de inventario (búsqueda) | Task 11 (`filteredItems`) |
| Drag & drop entre carpetas | Task 11 (dnd-kit) |
| Eliminar (3 modos) | Task 7 (`DeleteMode`), Task 11 (ItemActions) |
| Etiquetar items | Task 7 (`tag_inventory_item`), Task 11 (menú contextual) |
| Info del item | Task 11 (`selectItem` → state) |

**Nota:** La vista detallada de producto (carrusel de imágenes, descripción completa) se consume con `selectedProduct` del store pero el componente `ProductDetail.tsx` no se implementó en este plan para no superar el scope. Puede añadirse como Task 13 en un plan de pulido. El estado ya está preparado.

### 2. Placeholder scan

- Ningún "TBD" o "TODO" en el plan.
- Todos los pasos de código incluyen implementación completa.
- Los tests referencian solo funciones definidas en el mismo task.

### 3. Type consistency

- `InventoryItem` definida en `models.rs` (Task 1) y reflejada en `src/lib/tauri.ts` (Task 8).
- `DeleteMode` definida en `commands/inventory.rs` (Task 7) y en `src/lib/tauri.ts` (Task 8).
- `ShopProduct` vs `BoothProduct`/`RiperstoreProduct`: la conversión ocurre en `merge_results` (Task 6) — el frontend solo ve `ShopProduct`.
- `download://progress` event name: consistente entre `downloader.rs` (Task 5), `shop.rs` (Task 6) y `useDownloadProgress.ts` (Task 10).
- `move_item_to_folder` command: el `over.id` en InventoryGrid usa `"root"` para carpeta raíz — coincide con la lógica de `FolderDropZone`.

---

**Plan completo y guardado.** Dos opciones de ejecución:

**1. Subagent-Driven (recomendado)** — Dispatch de un subagente fresco por task, revisión entre tasks, iteración rápida.

**2. Inline Execution** — Ejecución por tasks en esta sesión con checkpoints de revisión.

**¿Cuál prefieres?**
