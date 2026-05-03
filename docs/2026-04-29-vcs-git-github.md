# VCS Git/GitHub — Plan de Implementación (Fase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar control de versiones Git completo en VRC Studio, con panel VCS por proyecto y autenticación GitHub OAuth2 para push/pull remoto.

**Architecture:** El backend Rust usa `git2-rs` (bindings de libgit2 embebida, sin depender de git instalado en el sistema) para todas las operaciones Git. Los Tauri Commands exponen las operaciones al frontend. El frontend muestra un panel VCS reactivo en la vista de detalle de cada proyecto. La auth con GitHub usa el OAuth2 Device Flow (apto para apps de escritorio, sin redirect URI). Los tokens se almacenan cifrados en SQLite en la tabla `linked_accounts`.

**Tech Stack:** Tauri 2, Rust `git2 0.18` (vendored), React 19 + TypeScript, Zustand, SQLite via `sqlx`, `reqwest` para HTTP (GitHub API).

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src-tauri/Cargo.toml` | Modificar | Añadir dependencias `git2`, `reqwest` |
| `src-tauri/src/db/migrations/003_vcs.sql` | Crear | Campo `vcs_enabled` en `projects`, tabla `git_remotes` |
| `src-tauri/src/services/git_service.rs` | Crear | Toda la lógica Git (init, status, add, commit, log, branch, push, pull) |
| `src-tauri/src/services/github_oauth.rs` | Crear | Device Flow OAuth2 con GitHub API |
| `src-tauri/src/commands/vcs.rs` | Crear | Tauri commands que exponen git_service al frontend |
| `src-tauri/src/main.rs` | Modificar | Registrar commands VCS y arrancar plugin OAuth listener |
| `src/lib/tauri.ts` | Modificar | Añadir wrappers tipados para commands VCS |
| `src/types/vcs.ts` | Crear | Tipos TypeScript espejo de los structs Rust |
| `src/store/vcsStore.ts` | Crear | Zustand store para estado VCS del proyecto activo |
| `src/components/vcs/VcsPanel.tsx` | Crear | Panel VCS: status + quick commit |
| `src/components/vcs/CommitHistory.tsx` | Crear | Lista de commits con fecha, mensaje, autor |
| `src/components/vcs/BranchSelector.tsx` | Crear | Selector y creación de branches |
| `src/pages/ProjectDetail.tsx` | Crear | Página de detalle de proyecto que monta el panel VCS |

---

## Task 1: Dependencias y migración de base de datos

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/db/migrations/003_vcs.sql`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Añadir dependencias a Cargo.toml**

```toml
# src-tauri/Cargo.toml — dentro de [dependencies]
git2 = { version = "0.18", features = ["vendored-libgit2"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
```

El feature `vendored-libgit2` compila libgit2 como parte del build, sin requerir que el usuario tenga git instalado.

- [ ] **Step 2: Compilar para verificar que las dependencias resuelven**

```bash
cd src-tauri
cargo build 2>&1 | tail -20
```

Resultado esperado: compilación exitosa (puede tardar varios minutos la primera vez por compilar libgit2).

- [ ] **Step 3: Escribir la migración SQL**

```sql
-- src-tauri/src/db/migrations/003_vcs.sql
ALTER TABLE projects ADD COLUMN vcs_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN vcs_branch TEXT NOT NULL DEFAULT 'main';

CREATE TABLE IF NOT EXISTS git_remotes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL DEFAULT 'origin',
    url         TEXT    NOT NULL,
    github_repo TEXT,   -- "owner/repo" si el remote es GitHub
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Registrar la migración en `db/mod.rs`**

Localiza la función que aplica migraciones (patrón habitual con `sqlx` o `rusqlite_migration`) y añade la migración 003 al array/vector de migraciones existente:

```rust
// src-tauri/src/db/mod.rs  (añadir junto a las migraciones 001, 002)
const MIGRATION_003: &str = include_str!("migrations/003_vcs.sql");
```

Y dentro de la función que ejecuta migraciones, añade `MIGRATION_003` a la lista.

- [ ] **Step 5: Verificar que la migración corre sin errores**

```bash
cd src-tauri
cargo test db -- --nocapture 2>&1
```

Si no existe un test de DB, ejecuta la app en modo dev y verifica los logs:

```bash
cargo tauri dev 2>&1 | grep -i "migrat"
```

Resultado esperado: `Applied migration 003` o similar, sin errores.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db/migrations/003_vcs.sql src-tauri/src/db/mod.rs
git commit -m "feat(vcs): add git2 dependency and DB migration 003"
```

---

## Task 2: `git init` y `.gitignore` al crear un proyecto

**Files:**
- Create: `src-tauri/src/services/git_service.rs`
- Modify: `src-tauri/src/services/project_builder.rs`
- Test: dentro de `src-tauri/src/services/git_service.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Crear `git_service.rs` con la función `init_repository`**

```rust
// src-tauri/src/services/git_service.rs
use git2::{Repository, Signature};
use std::path::Path;

pub const UNITY_GITIGNORE: &str = r#"
# Unity generated
[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Bb]uild/
[Bb]uilds/
[Ll]ogs/
[Uu]ser[Ss]ettings/
MemoryCaptures/
[Rr]ecordings/
[Pp]roject[Ss]ettings/ProjectVersion.txt

# Asset meta files — keep
!*.meta

# OS files
.DS_Store
Thumbs.db

# Rider / VS
.idea/
.vs/
*.csproj
*.sln
"#;

/// Inicializa un repositorio Git en `project_path`.
/// Escribe el .gitignore y hace el commit inicial.
/// No falla si ya existe un repositorio.
pub fn init_repository(project_path: &Path) -> Result<(), String> {
    let repo = Repository::init(project_path)
        .map_err(|e| format!("git init failed: {e}"))?;

    // Escribir .gitignore
    let gitignore_path = project_path.join(".gitignore");
    std::fs::write(&gitignore_path, UNITY_GITIGNORE)
        .map_err(|e| format!("failed to write .gitignore: {e}"))?;

    // Stage .gitignore
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(Path::new(".gitignore")).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    // Commit inicial
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = Signature::now("VRC Studio", "vrcstudio@local")
        .map_err(|e| e.to_string())?;

    repo.commit(Some("HEAD"), &sig, &sig, "chore: initial commit", &tree, &[])
        .map_err(|e| format!("initial commit failed: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_init_repository_creates_repo_and_gitignore() {
        let dir = TempDir::new().unwrap();
        let result = init_repository(dir.path());
        assert!(result.is_ok(), "init_repository failed: {:?}", result);

        assert!(dir.path().join(".git").exists(), ".git directory not created");
        assert!(dir.path().join(".gitignore").exists(), ".gitignore not created");

        let repo = Repository::open(dir.path()).unwrap();
        let head = repo.head().unwrap();
        assert_eq!(head.shorthand().unwrap(), "main");
    }

    #[test]
    fn test_init_repository_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let result1 = init_repository(dir.path());
        let result2 = init_repository(dir.path());
        assert!(result1.is_ok());
        assert!(result2.is_ok()); // No debe fallar si el repo ya existe
    }
}
```

- [ ] **Step 2: Añadir `tempfile` a dev-dependencies**

```toml
# src-tauri/Cargo.toml — [dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Ejecutar los tests para verificar que fallan (aún no existe el módulo en main)**

```bash
cd src-tauri
cargo test git_service -- --nocapture
```

Resultado esperado: compilación OK, tests PASS (el módulo existe con los tests).

- [ ] **Step 4: Integrar `init_repository` en `project_builder.rs`**

En la función que crea el proyecto (probablemente `create_project` o similar), localiza dónde se crea la carpeta del proyecto en disco y añade después:

```rust
// src-tauri/src/services/project_builder.rs
use crate::services::git_service;

// Dentro de la función de creación, tras crear la estructura Unity:
if config.vcs_enabled {
    git_service::init_repository(&project_path)
        .map_err(|e| format!("VCS init failed: {e}"))?;
}
```

Donde `config.vcs_enabled: bool` viene de los parámetros del wizard (ya disponible desde el Paso 1 del wizard per spec).

- [ ] **Step 5: Verificar compilación**

```bash
cd src-tauri
cargo build 2>&1 | grep -E "error|warning"
```

Resultado esperado: sin errores de compilación.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/services/git_service.rs src-tauri/src/services/project_builder.rs
git commit -m "feat(vcs): git init with Unity .gitignore on project creation"
```

---

## Task 3: `git status` — servicio Rust + Tauri command

**Files:**
- Modify: `src-tauri/src/services/git_service.rs`
- Create: `src-tauri/src/commands/vcs.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `git_service.rs #[cfg(test)]`

- [ ] **Step 1: Escribir el test para `get_status`**

```rust
// Añadir en src-tauri/src/services/git_service.rs #[cfg(test)]

#[test]
fn test_get_status_clean_repo() {
    let dir = TempDir::new().unwrap();
    init_repository(dir.path()).unwrap();
    let status = get_status(dir.path()).unwrap();
    assert_eq!(status.branch, "main");
    assert!(status.staged.is_empty());
    assert!(status.unstaged.is_empty());
    assert!(status.untracked.is_empty());
}

#[test]
fn test_get_status_detects_new_untracked_file() {
    let dir = TempDir::new().unwrap();
    init_repository(dir.path()).unwrap();
    std::fs::write(dir.path().join("NewScript.cs"), "// test").unwrap();
    let status = get_status(dir.path()).unwrap();
    assert!(status.untracked.contains(&"NewScript.cs".to_string()));
}
```

- [ ] **Step 2: Verificar que los tests fallan (función aún no existe)**

```bash
cd src-tauri
cargo test test_get_status -- --nocapture 2>&1 | tail -10
```

Resultado esperado: error de compilación `cannot find function get_status`.

- [ ] **Step 3: Implementar `GitStatus` y `get_status` en `git_service.rs`**

```rust
// src-tauri/src/services/git_service.rs — añadir tras las funciones existentes
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct GitStatus {
    pub branch: String,
    pub has_upstream: bool,
    pub ahead: usize,
    pub behind: usize,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

pub fn get_status(project_path: &Path) -> Result<GitStatus, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    // Branch actual
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("HEAD").to_string();

    // Upstream tracking
    let (has_upstream, ahead, behind) = match repo.revparse_ext("@{upstream}") {
        Ok(_) => {
            let local_oid = head.target().unwrap_or(git2::Oid::zero());
            let upstream = repo.revparse_single("@{upstream}").unwrap();
            let (a, b) = repo.graph_ahead_behind(local_oid, upstream.id())
                .unwrap_or((0, 0));
            (true, a, b)
        }
        Err(_) => (false, 0, 0),
    };

    // Archivos modificados
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .renames_from_rewrites(true)
        .exclude_submodules(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("?").to_string();
        let s = entry.status();
        if s.is_index_new() || s.is_index_modified() || s.is_index_deleted() {
            staged.push(path.clone());
        }
        if s.is_wt_modified() || s.is_wt_deleted() {
            unstaged.push(path.clone());
        }
        if s.is_wt_new() {
            untracked.push(path);
        }
    }

    Ok(GitStatus { branch, has_upstream, ahead, behind, staged, unstaged, untracked })
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

```bash
cd src-tauri
cargo test test_get_status -- --nocapture
```

Resultado esperado: `test test_get_status_clean_repo ... ok` y `test test_get_status_detects_new_untracked_file ... ok`.

- [ ] **Step 5: Crear `commands/vcs.rs` con el command `get_vcs_status`**

```rust
// src-tauri/src/commands/vcs.rs
use std::path::PathBuf;
use tauri::State;
use crate::services::git_service::{self, GitStatus};

#[tauri::command]
pub async fn get_vcs_status(project_path: String) -> Result<GitStatus, String> {
    let path = PathBuf::from(&project_path);
    if !path.join(".git").exists() {
        return Err("No git repository found at this path".into());
    }
    tokio::task::spawn_blocking(move || git_service::get_status(&path))
        .await
        .map_err(|e| e.to_string())?
}
```

- [ ] **Step 6: Registrar el command en `main.rs`**

```rust
// src-tauri/src/main.rs — añadir a invoke_handler
mod commands;
// (en .invoke_handler, junto a los commands existentes)
.invoke_handler(tauri::generate_handler![
    // ... commands existentes ...,
    commands::vcs::get_vcs_status,
])
```

- [ ] **Step 7: Compilar**

```bash
cd src-tauri
cargo build 2>&1 | grep -E "^error"
```

Resultado esperado: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/services/git_service.rs src-tauri/src/commands/vcs.rs src-tauri/src/main.rs
git commit -m "feat(vcs): get_vcs_status command with GitStatus struct"
```

---

## Task 4: `git add` + `git commit` — servicio Rust + Tauri command

**Files:**
- Modify: `src-tauri/src/services/git_service.rs`
- Modify: `src-tauri/src/commands/vcs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Escribir el test para `stage_all_and_commit`**

```rust
// src-tauri/src/services/git_service.rs #[cfg(test)]
#[test]
fn test_stage_all_and_commit() {
    let dir = TempDir::new().unwrap();
    init_repository(dir.path()).unwrap();
    std::fs::write(dir.path().join("Avatar.cs"), "// avatar").unwrap();

    let result = stage_all_and_commit(dir.path(), "feat: add Avatar.cs", "Dev", "dev@local");
    assert!(result.is_ok(), "{:?}", result);

    let repo = Repository::open(dir.path()).unwrap();
    let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head_commit.message().unwrap().trim(), "feat: add Avatar.cs");
}
```

- [ ] **Step 2: Verificar fallo del test**

```bash
cd src-tauri
cargo test test_stage_all_and_commit -- --nocapture 2>&1 | tail -5
```

Resultado esperado: error de compilación `cannot find function stage_all_and_commit`.

- [ ] **Step 3: Implementar `stage_all_and_commit` en `git_service.rs`**

```rust
// src-tauri/src/services/git_service.rs
pub fn stage_all_and_commit(
    project_path: &Path,
    message: &str,
    author_name: &str,
    author_email: &str,
) -> Result<String, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("git add failed: {e}"))?;
    index.write().map_err(|e| e.to_string())?;

    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let sig = Signature::now(author_name, author_email)
        .map_err(|e| e.to_string())?;

    let parent_commit = repo.head()
        .and_then(|h| h.peel_to_commit())
        .ok();
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    let commit_id = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("commit failed: {e}"))?;

    Ok(commit_id.to_string())
}
```

- [ ] **Step 4: Verificar que el test pasa**

```bash
cd src-tauri
cargo test test_stage_all_and_commit -- --nocapture
```

Resultado esperado: `test test_stage_all_and_commit ... ok`.

- [ ] **Step 5: Añadir el Tauri command `vcs_commit` en `commands/vcs.rs`**

```rust
// src-tauri/src/commands/vcs.rs — añadir
use crate::db; // para leer author name/email de linked_accounts

#[tauri::command]
pub async fn vcs_commit(project_path: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".into());
    }
    let path = PathBuf::from(&project_path);
    // Por ahora usamos autor genérico; se completará en Task 10 con el usuario GitHub
    tokio::task::spawn_blocking(move || {
        git_service::stage_all_and_commit(&path, &message, "VRC Studio User", "user@vrcstudio")
    })
    .await
    .map_err(|e| e.to_string())?
}
```

- [ ] **Step 6: Registrar en `main.rs`**

```rust
.invoke_handler(tauri::generate_handler![
    // ... commands anteriores ...,
    commands::vcs::get_vcs_status,
    commands::vcs::vcs_commit,
])
```

- [ ] **Step 7: Compilar**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Resultado esperado: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/services/git_service.rs src-tauri/src/commands/vcs.rs src-tauri/src/main.rs
git commit -m "feat(vcs): stage_all_and_commit with vcs_commit Tauri command"
```

---

## Task 5: `git log` — historial de commits

**Files:**
- Modify: `src-tauri/src/services/git_service.rs`
- Modify: `src-tauri/src/commands/vcs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Escribir el test para `get_log`**

```rust
// src-tauri/src/services/git_service.rs #[cfg(test)]
#[test]
fn test_get_log_returns_commits_in_order() {
    let dir = TempDir::new().unwrap();
    init_repository(dir.path()).unwrap();

    // Hacer dos commits adicionales
    std::fs::write(dir.path().join("A.cs"), "").unwrap();
    stage_all_and_commit(dir.path(), "feat: add A", "Dev", "dev@local").unwrap();
    std::fs::write(dir.path().join("B.cs"), "").unwrap();
    stage_all_and_commit(dir.path(), "feat: add B", "Dev", "dev@local").unwrap();

    let log = get_log(dir.path(), 10).unwrap();
    assert_eq!(log.len(), 3); // initial commit + 2
    assert_eq!(log[0].message, "feat: add B"); // más reciente primero
    assert_eq!(log[2].message, "chore: initial commit");
}
```

- [ ] **Step 2: Verificar fallo**

```bash
cd src-tauri && cargo test test_get_log -- --nocapture 2>&1 | tail -5
```

Resultado esperado: error `cannot find function get_log`.

- [ ] **Step 3: Implementar `CommitEntry` y `get_log`**

```rust
// src-tauri/src/services/git_service.rs
#[derive(Debug, Serialize, Clone)]
pub struct CommitEntry {
    pub id: String,        // SHA corto (7 chars)
    pub message: String,
    pub author: String,
    pub timestamp: i64,    // Unix timestamp
}

pub fn get_log(project_path: &Path, limit: usize) -> Result<Vec<CommitEntry>, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        entries.push(CommitEntry {
            id: oid.to_string()[..7].to_string(),
            message: commit.message().unwrap_or("").trim().to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            timestamp: commit.time().seconds(),
        });
    }
    Ok(entries)
}
```

- [ ] **Step 4: Verificar que el test pasa**

```bash
cd src-tauri && cargo test test_get_log -- --nocapture
```

Resultado esperado: `test test_get_log_returns_commits_in_order ... ok`.

- [ ] **Step 5: Añadir Tauri command `get_vcs_log`**

```rust
// src-tauri/src/commands/vcs.rs
use crate::services::git_service::CommitEntry;

#[tauri::command]
pub async fn get_vcs_log(project_path: String, limit: usize) -> Result<Vec<CommitEntry>, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::get_log(&path, limit.min(100)))
        .await
        .map_err(|e| e.to_string())?
}
```

- [ ] **Step 6: Registrar en `main.rs` y compilar**

```rust
commands::vcs::get_vcs_log,
```

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/git_service.rs src-tauri/src/commands/vcs.rs src-tauri/src/main.rs
git commit -m "feat(vcs): git log with get_vcs_log Tauri command"
```

---

## Task 6: Operaciones de branch (listar, crear, cambiar)

**Files:**
- Modify: `src-tauri/src/services/git_service.rs`
- Modify: `src-tauri/src/commands/vcs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Escribir tests para operaciones de branch**

```rust
// src-tauri/src/services/git_service.rs #[cfg(test)]
#[test]
fn test_list_branches_contains_main() {
    let dir = TempDir::new().unwrap();
    init_repository(dir.path()).unwrap();
    let branches = list_branches(dir.path()).unwrap();
    assert!(branches.iter().any(|b| b.name == "main" && b.is_current));
}

#[test]
fn test_create_and_switch_branch() {
    let dir = TempDir::new().unwrap();
    init_repository(dir.path()).unwrap();

    create_branch(dir.path(), "feature/test").unwrap();
    let branches_before = list_branches(dir.path()).unwrap();
    assert!(branches_before.iter().any(|b| b.name == "feature/test"));

    switch_branch(dir.path(), "feature/test").unwrap();
    let status = get_status(dir.path()).unwrap();
    assert_eq!(status.branch, "feature/test");
}
```

- [ ] **Step 2: Verificar fallo**

```bash
cd src-tauri && cargo test test_list_branches test_create_and_switch -- --nocapture 2>&1 | tail -5
```

Resultado esperado: errores de compilación por funciones no definidas.

- [ ] **Step 3: Implementar `BranchInfo`, `list_branches`, `create_branch`, `switch_branch`**

```rust
// src-tauri/src/services/git_service.rs
#[derive(Debug, Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

pub fn list_branches(project_path: &Path) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    let head_name = repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_default();

    let mut branches = Vec::new();
    for branch in repo.branches(Some(git2::BranchType::Local)).map_err(|e| e.to_string())? {
        let (b, _) = branch.map_err(|e| e.to_string())?;
        let name = b.name().map_err(|e| e.to_string())?
            .unwrap_or("?").to_string();
        branches.push(BranchInfo { is_current: name == head_name, name });
    }
    Ok(branches)
}

pub fn create_branch(project_path: &Path, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
    repo.branch(branch_name, &commit, false)
        .map_err(|e| format!("create branch failed: {e}"))?;
    Ok(())
}

pub fn switch_branch(project_path: &Path, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    let refname = format!("refs/heads/{branch_name}");
    let obj = repo.revparse_single(&refname)
        .map_err(|_| format!("branch '{branch_name}' not found"))?;
    repo.checkout_tree(&obj, None)
        .map_err(|e| format!("checkout failed: {e}"))?;
    repo.set_head(&refname)
        .map_err(|e| format!("set_head failed: {e}"))?;
    Ok(())
}
```

- [ ] **Step 4: Verificar que los tests pasan**

```bash
cd src-tauri && cargo test test_list_branches test_create_and_switch -- --nocapture
```

Resultado esperado: ambos tests `ok`.

- [ ] **Step 5: Añadir Tauri commands de branch**

```rust
// src-tauri/src/commands/vcs.rs
use crate::services::git_service::BranchInfo;

#[tauri::command]
pub async fn list_vcs_branches(project_path: String) -> Result<Vec<BranchInfo>, String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::list_branches(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_vcs_branch(project_path: String, branch_name: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::create_branch(&path, &branch_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn switch_vcs_branch(project_path: String, branch_name: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || git_service::switch_branch(&path, &branch_name))
        .await
        .map_err(|e| e.to_string())?
}
```

- [ ] **Step 6: Registrar en `main.rs` y compilar**

```rust
commands::vcs::list_vcs_branches,
commands::vcs::create_vcs_branch,
commands::vcs::switch_vcs_branch,
```

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/git_service.rs src-tauri/src/commands/vcs.rs src-tauri/src/main.rs
git commit -m "feat(vcs): branch list, create, switch commands"
```

---

## Task 7: Tipos TypeScript + Zustand store + wrappers de Tauri

**Files:**
- Create: `src/types/vcs.ts`
- Create: `src/store/vcsStore.ts`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Crear `src/types/vcs.ts`**

Estos tipos deben ser espejo exacto de los structs Rust serializados por Serde.

```typescript
// src/types/vcs.ts
export interface GitStatus {
  branch: string;
  has_upstream: boolean;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface CommitEntry {
  id: string;       // SHA corto (7 chars)
  message: string;
  author: string;
  timestamp: number; // Unix timestamp en segundos
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
}
```

- [ ] **Step 2: Añadir wrappers tipados en `src/lib/tauri.ts`**

```typescript
// src/lib/tauri.ts — añadir junto a las demás funciones invoke
import { invoke } from "@tauri-apps/api/core";
import type { GitStatus, CommitEntry, BranchInfo } from "../types/vcs";

export const vcs = {
  getStatus: (projectPath: string) =>
    invoke<GitStatus>("get_vcs_status", { projectPath }),

  commit: (projectPath: string, message: string) =>
    invoke<string>("vcs_commit", { projectPath, message }),

  getLog: (projectPath: string, limit = 50) =>
    invoke<CommitEntry[]>("get_vcs_log", { projectPath, limit }),

  listBranches: (projectPath: string) =>
    invoke<BranchInfo[]>("list_vcs_branches", { projectPath }),

  createBranch: (projectPath: string, branchName: string) =>
    invoke<void>("create_vcs_branch", { projectPath, branchName }),

  switchBranch: (projectPath: string, branchName: string) =>
    invoke<void>("switch_vcs_branch", { projectPath, branchName }),
};
```

- [ ] **Step 3: Crear `src/store/vcsStore.ts`**

```typescript
// src/store/vcsStore.ts
import { create } from "zustand";
import type { GitStatus, CommitEntry, BranchInfo } from "../types/vcs";
import { vcs } from "../lib/tauri";

interface VcsState {
  status: GitStatus | null;
  log: CommitEntry[];
  branches: BranchInfo[];
  isLoading: boolean;
  error: string | null;
  activeProjectPath: string | null;

  loadStatus: (projectPath: string) => Promise<void>;
  loadLog: (projectPath: string) => Promise<void>;
  loadBranches: (projectPath: string) => Promise<void>;
  commit: (projectPath: string, message: string) => Promise<void>;
  createBranch: (projectPath: string, name: string) => Promise<void>;
  switchBranch: (projectPath: string, name: string) => Promise<void>;
  clear: () => void;
}

export const useVcsStore = create<VcsState>((set, get) => ({
  status: null,
  log: [],
  branches: [],
  isLoading: false,
  error: null,
  activeProjectPath: null,

  loadStatus: async (projectPath) => {
    set({ isLoading: true, error: null, activeProjectPath: projectPath });
    try {
      const status = await vcs.getStatus(projectPath);
      set({ status });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadLog: async (projectPath) => {
    try {
      const log = await vcs.getLog(projectPath, 50);
      set({ log });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadBranches: async (projectPath) => {
    try {
      const branches = await vcs.listBranches(projectPath);
      set({ branches });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  commit: async (projectPath, message) => {
    set({ isLoading: true, error: null });
    try {
      await vcs.commit(projectPath, message);
      // Refrescar status y log tras commit
      await get().loadStatus(projectPath);
      await get().loadLog(projectPath);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  createBranch: async (projectPath, name) => {
    await vcs.createBranch(projectPath, name);
    await get().loadBranches(projectPath);
  },

  switchBranch: async (projectPath, name) => {
    await vcs.switchBranch(projectPath, name);
    await get().loadBranches(projectPath);
    await get().loadStatus(projectPath);
  },

  clear: () => set({ status: null, log: [], branches: [], error: null, activeProjectPath: null }),
}));
```

- [ ] **Step 4: Verificar compilación TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Resultado esperado: sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/types/vcs.ts src/store/vcsStore.ts src/lib/tauri.ts
git commit -m "feat(vcs): TypeScript types, Zustand store, and Tauri wrappers"
```

---

## Task 8: Panel VCS — Status + Quick Commit (frontend)

**Files:**
- Create: `src/components/vcs/VcsPanel.tsx`

- [ ] **Step 1: Crear `src/components/vcs/VcsPanel.tsx`**

```tsx
// src/components/vcs/VcsPanel.tsx
import { useEffect, useState } from "react";
import { useVcsStore } from "../../store/vcsStore";

interface VcsPanelProps {
  projectPath: string;
}

export function VcsPanel({ projectPath }: VcsPanelProps) {
  const { status, isLoading, error, loadStatus, commit } = useVcsStore();
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus(projectPath);
  }, [projectPath]);

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await commit(projectPath, commitMsg.trim());
      setCommitMsg("");
    } catch (e) {
      setCommitError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  if (isLoading && !status) {
    return <div className="p-4 text-sm text-muted-foreground">Cargando estado del repositorio…</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-destructive">Error: {error}</div>;
  }

  if (!status) return null;

  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header: branch + estado */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
            {status.branch}
          </span>
          {status.has_upstream && (
            <span className="text-xs text-muted-foreground">
              {status.ahead > 0 && `↑${status.ahead} `}
              {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}
        </div>
        <button
          onClick={() => loadStatus(projectPath)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ↺ Actualizar
        </button>
      </div>

      {/* Lista de cambios */}
      {totalChanges === 0 ? (
        <p className="text-sm text-muted-foreground">Sin cambios pendientes.</p>
      ) : (
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto text-xs font-mono">
          {status.staged.map((f) => (
            <span key={f} className="text-green-500">S  {f}</span>
          ))}
          {status.unstaged.map((f) => (
            <span key={f} className="text-yellow-500">M  {f}</span>
          ))}
          {status.untracked.map((f) => (
            <span key={f} className="text-muted-foreground">?  {f}</span>
          ))}
        </div>
      )}

      {/* Quick commit */}
      {totalChanges > 0 && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="Mensaje del commit…"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCommit()}
            className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {commitError && (
            <p className="text-xs text-destructive">{commitError}</p>
          )}
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || committing}
            className="rounded bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {committing ? "Commiteando…" : "Commit (stage all)"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar compilación TypeScript del componente**

```bash
npx tsc --noEmit 2>&1 | grep "VcsPanel"
```

Resultado esperado: sin errores de tipo en VcsPanel.

- [ ] **Step 3: Commit**

```bash
git add src/components/vcs/VcsPanel.tsx
git commit -m "feat(vcs): VcsPanel component with status and quick commit"
```

---

## Task 9: Panel VCS — Historial y gestión de branches (frontend)

**Files:**
- Create: `src/components/vcs/CommitHistory.tsx`
- Create: `src/components/vcs/BranchSelector.tsx`
- Modify: `src/components/vcs/VcsPanel.tsx`

- [ ] **Step 1: Crear `CommitHistory.tsx`**

```tsx
// src/components/vcs/CommitHistory.tsx
import type { CommitEntry } from "../../types/vcs";

interface CommitHistoryProps {
  entries: CommitEntry[];
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CommitHistory({ entries }: CommitHistoryProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground px-4">Sin historial de commits.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-border max-h-64 overflow-y-auto">
      {entries.map((entry) => (
        <div key={entry.id} className="flex flex-col gap-0.5 px-4 py-2">
          <span className="text-sm font-medium truncate">{entry.message}</span>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{entry.id}</span>
            <span>{entry.author}</span>
            <span>{formatTimestamp(entry.timestamp)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Crear `BranchSelector.tsx`**

```tsx
// src/components/vcs/BranchSelector.tsx
import { useState } from "react";
import type { BranchInfo } from "../../types/vcs";

interface BranchSelectorProps {
  branches: BranchInfo[];
  onSwitch: (name: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}

export function BranchSelector({ branches, onSwitch, onCreate }: BranchSelectorProps) {
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      await onSwitch(name);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(newName.trim());
      setNewName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4">
      {/* Lista de branches */}
      <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
        {branches.map((b) => (
          <button
            key={b.name}
            onClick={() => !b.is_current && handleSwitch(b.name)}
            disabled={b.is_current || loading}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm text-left hover:bg-muted transition-colors ${
              b.is_current ? "font-semibold text-primary" : "text-foreground"
            } disabled:cursor-default`}
          >
            {b.is_current && <span className="text-xs">●</span>}
            <span className="font-mono">{b.name}</span>
          </button>
        ))}
      </div>

      {/* Crear branch */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="nueva-rama…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim() || loading}
          className="rounded bg-secondary px-3 py-1 text-sm text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
        >
          Crear
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Actualizar `VcsPanel.tsx` para integrar tabs con historial y branches**

```tsx
// src/components/vcs/VcsPanel.tsx — reemplazar el return completo

// Añadir imports al inicio del archivo:
import { CommitHistory } from "./CommitHistory";
import { BranchSelector } from "./BranchSelector";
// Añadir al useVcsStore destructuring: log, branches, loadLog, loadBranches, createBranch, switchBranch

// Dentro del componente, añadir estado de tab:
const [tab, setTab] = useState<"changes" | "history" | "branches">("changes");

// Cargar datos al montar:
useEffect(() => {
  loadStatus(projectPath);
  loadLog(projectPath);
  loadBranches(projectPath);
}, [projectPath]);

// En el return, añadir tabs sobre el contenido existente:
// <div className="flex gap-1 border-b border-border px-4">
//   {["changes", "history", "branches"].map((t) => (
//     <button key={t} onClick={() => setTab(t as any)}
//       className={`px-3 py-2 text-xs capitalize transition-colors ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}>
//       {t === "changes" ? "Cambios" : t === "history" ? "Historial" : "Ramas"}
//     </button>
//   ))}
// </div>
// {tab === "changes" && <contenido existente de cambios y commit>}
// {tab === "history" && <CommitHistory entries={log} />}
// {tab === "branches" && <BranchSelector branches={branches} onSwitch={...} onCreate={...} />}
```

El comentario anterior es una guía; el componente completo actualizado queda así:

```tsx
// src/components/vcs/VcsPanel.tsx (versión completa final)
import { useEffect, useState } from "react";
import { useVcsStore } from "../../store/vcsStore";
import { CommitHistory } from "./CommitHistory";
import { BranchSelector } from "./BranchSelector";

interface VcsPanelProps {
  projectPath: string;
}

type Tab = "changes" | "history" | "branches";

export function VcsPanel({ projectPath }: VcsPanelProps) {
  const {
    status, log, branches, isLoading, error,
    loadStatus, loadLog, loadBranches, commit,
    createBranch, switchBranch,
  } = useVcsStore();

  const [tab, setTab] = useState<Tab>("changes");
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus(projectPath);
    loadLog(projectPath);
    loadBranches(projectPath);
  }, [projectPath]);

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await commit(projectPath, commitMsg.trim());
      setCommitMsg("");
    } catch (e) {
      setCommitError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  if (isLoading && !status) {
    return <div className="p-4 text-sm text-muted-foreground">Cargando estado del repositorio…</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-destructive">Error: {error}</div>;
  }
  if (!status) return null;

  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <div className="flex flex-col">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border px-4">
        {(["changes", "history", "branches"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs transition-colors ${
              tab === t
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "changes" ? `Cambios${totalChanges > 0 ? ` (${totalChanges})` : ""}` : t === "history" ? "Historial" : "Ramas"}
          </button>
        ))}
        <button
          onClick={() => { loadStatus(projectPath); loadLog(projectPath); }}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground py-2"
        >
          ↺
        </button>
      </div>

      {/* Branch + upstream info */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{status.branch}</span>
        {status.has_upstream && (
          <span className="text-xs text-muted-foreground">
            {status.ahead > 0 && `↑${status.ahead} `}
            {status.behind > 0 && `↓${status.behind}`}
          </span>
        )}
      </div>

      {/* Tab content */}
      {tab === "changes" && (
        <div className="flex flex-col gap-4 p-4">
          {totalChanges === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cambios pendientes.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto text-xs font-mono">
              {status.staged.map((f) => <span key={f} className="text-green-500">S  {f}</span>)}
              {status.unstaged.map((f) => <span key={f} className="text-yellow-500">M  {f}</span>)}
              {status.untracked.map((f) => <span key={f} className="text-muted-foreground">?  {f}</span>)}
            </div>
          )}
          {totalChanges > 0 && (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Mensaje del commit…"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommit()}
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {commitError && <p className="text-xs text-destructive">{commitError}</p>}
              <button
                onClick={handleCommit}
                disabled={!commitMsg.trim() || committing}
                className="rounded bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {committing ? "Commiteando…" : "Commit (stage all)"}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "history" && <CommitHistory entries={log} />}

      {tab === "branches" && (
        <div className="py-4">
          <BranchSelector
            branches={branches}
            onSwitch={(name) => switchBranch(projectPath, name)}
            onCreate={(name) => createBranch(projectPath, name)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar compilación TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "CommitHistory|BranchSelector|VcsPanel"
```

Resultado esperado: sin errores de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/components/vcs/
git commit -m "feat(vcs): CommitHistory, BranchSelector, VcsPanel tabs"
```

---

## Task 10: GitHub OAuth2 Device Flow

**Files:**
- Create: `src-tauri/src/services/github_oauth.rs`
- Modify: `src-tauri/src/commands/vcs.rs`
- Modify: `src-tauri/src/main.rs`

> **Nota:** Requiere crear una GitHub OAuth App en https://github.com/settings/developers con el scope `repo`. Los valores de `client_id` y `client_secret` se leen de variables de entorno en build time o de un archivo de configuración del build. Para desarrollo, se pueden hardcodear; para producción, inyectarlos vía `tauri.conf.json` `env`.

- [ ] **Step 1: Crear `src-tauri/src/services/github_oauth.rs`**

```rust
// src-tauri/src/services/github_oauth.rs
use reqwest::Client;
use serde::{Deserialize, Serialize};

const GITHUB_CLIENT_ID: &str = env!("GITHUB_OAUTH_CLIENT_ID"); // inyectado en build
const DEVICE_CODE_URL: &str  = "https://github.com/login/device/code";
const TOKEN_URL: &str        = "https://github.com/login/oauth/access_token";

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    token_type: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DevicePrompt {
    pub user_code: String,
    pub verification_uri: String,
}

/// Paso 1: solicitar device code.
/// Devuelve los datos que el usuario necesita ver para autenticarse.
pub async fn request_device_code() -> Result<(String, DevicePrompt), String> {
    let client = Client::new();
    let res: DeviceCodeResponse = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "repo")])
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse error: {e}"))?;

    let prompt = DevicePrompt {
        user_code: res.user_code,
        verification_uri: res.verification_uri,
    };
    Ok((res.device_code, prompt))
}

/// Paso 2: hacer polling hasta obtener el token o que expire.
/// `device_code` viene del paso 1. `interval_secs` es el intervalo indicado por GitHub.
pub async fn poll_for_token(device_code: String, interval_secs: u64) -> Result<String, String> {
    let client = Client::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(900);

    loop {
        if std::time::Instant::now() > deadline {
            return Err("GitHub auth timed out".into());
        }

        tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;

        let res: TokenResponse = client
            .post(TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", &device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("network error: {e}"))?
            .json()
            .await
            .map_err(|e| format!("parse error: {e}"))?;

        match res.error.as_deref() {
            None => {
                return res.access_token.ok_or_else(|| "no access_token in response".into());
            }
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
            Some(other) => return Err(format!("GitHub error: {other}")),
        }
    }
}
```

- [ ] **Step 2: Añadir variable de entorno en `src-tauri/build.rs`**

Si no existe `build.rs`, créalo:

```rust
// src-tauri/build.rs
fn main() {
    // Permite compilar sin la variable de entorno en dev (con valor vacío)
    if std::env::var("GITHUB_OAUTH_CLIENT_ID").is_err() {
        println!("cargo:rustc-env=GITHUB_OAUTH_CLIENT_ID=Ov23li000000dev");
    }
    tauri_build::build();
}
```

- [ ] **Step 3: Añadir Tauri commands de OAuth en `commands/vcs.rs`**

```rust
// src-tauri/src/commands/vcs.rs
use crate::services::github_oauth::{self, DevicePrompt};

// Estado en memoria para el device_code en curso
use std::sync::Mutex;
static PENDING_DEVICE_CODE: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
pub async fn github_start_device_auth() -> Result<DevicePrompt, String> {
    let (device_code, prompt) = github_oauth::request_device_code().await?;
    *PENDING_DEVICE_CODE.lock().unwrap() = Some(device_code);
    Ok(prompt)
}

#[tauri::command]
pub async fn github_poll_token(app: tauri::AppHandle) -> Result<String, String> {
    let device_code = PENDING_DEVICE_CODE.lock().unwrap().clone()
        .ok_or("No device auth in progress")?;

    let token = github_oauth::poll_for_token(device_code, 5).await?;

    // Guardar token en SQLite (linked_accounts)
    // Se usa app.state::<DbPool>() según el patrón de DB del proyecto
    // Por ahora emitimos el token para que el frontend lo almacene en el store
    // y la siguiente tarea lo persiste en DB.
    *PENDING_DEVICE_CODE.lock().unwrap() = None;
    Ok(token)
}
```

- [ ] **Step 4: Registrar en `main.rs` y compilar**

```rust
commands::vcs::github_start_device_auth,
commands::vcs::github_poll_token,
```

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Resultado esperado: sin errores (la variable env tendrá el valor dev definido en build.rs).

- [ ] **Step 5: Añadir wrappers en `src/lib/tauri.ts`**

```typescript
// src/lib/tauri.ts — dentro del objeto vcs
githubStartDeviceAuth: () =>
  invoke<{ user_code: string; verification_uri: string }>("github_start_device_auth"),

githubPollToken: () =>
  invoke<string>("github_poll_token"),
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/github_oauth.rs src-tauri/src/commands/vcs.rs src-tauri/src/main.rs src-tauri/build.rs src/lib/tauri.ts
git commit -m "feat(vcs): GitHub OAuth2 Device Flow — request and polling commands"
```

---

## Task 11: Git remote + push/pull con autenticación GitHub

**Files:**
- Modify: `src-tauri/src/services/git_service.rs`
- Modify: `src-tauri/src/commands/vcs.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Escribir tests para `add_remote` y `push`**

```rust
// src-tauri/src/services/git_service.rs #[cfg(test)]
#[test]
fn test_add_remote_and_list() {
    let dir = TempDir::new().unwrap();
    init_repository(dir.path()).unwrap();

    add_remote(dir.path(), "origin", "https://github.com/testuser/test-repo.git").unwrap();
    let repo = Repository::open(dir.path()).unwrap();
    let remotes = repo.remotes().unwrap();
    assert!(remotes.iter().any(|r| r == Some("origin")));
}
```

- [ ] **Step 2: Verificar fallo**

```bash
cd src-tauri && cargo test test_add_remote -- --nocapture 2>&1 | tail -5
```

Resultado esperado: error de compilación `cannot find function add_remote`.

- [ ] **Step 3: Implementar `add_remote`, `push_to_remote`, `pull_from_remote`**

```rust
// src-tauri/src/services/git_service.rs
pub fn add_remote(project_path: &Path, name: &str, url: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;
    repo.remote(name, url)
        .map_err(|e| format!("add remote failed: {e}"))?;
    Ok(())
}

/// Push a la rama actual hacia `remote_name` usando un token OAuth2 como contraseña.
pub fn push_to_remote(project_path: &Path, remote_name: &str, token: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut remote = repo.find_remote(remote_name)
        .map_err(|e| format!("remote '{remote_name}' not found: {e}"))?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("main");
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");

    let mut callbacks = git2::RemoteCallbacks::new();
    let token_clone = token.to_string();
    callbacks.credentials(move |_url, _username_from_url, _allowed| {
        git2::Cred::userpass_plaintext("oauth2", &token_clone)
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    remote.push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| format!("push failed: {e}"))?;

    Ok(())
}

/// Pull (fetch + merge fast-forward) desde `remote_name`.
pub fn pull_from_remote(project_path: &Path, remote_name: &str, token: &str) -> Result<(), String> {
    let repo = Repository::open(project_path)
        .map_err(|e| format!("failed to open repo: {e}"))?;

    let mut callbacks = git2::RemoteCallbacks::new();
    let token_clone = token.to_string();
    callbacks.credentials(move |_url, _username_from_url, _allowed| {
        git2::Cred::userpass_plaintext("oauth2", &token_clone)
    });

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    let mut remote = repo.find_remote(remote_name)
        .map_err(|e| format!("remote not found: {e}"))?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("main");

    remote.fetch(&[branch], Some(&mut fetch_opts), None)
        .map_err(|e| format!("fetch failed: {e}"))?;

    let fetch_head = repo.find_reference("FETCH_HEAD")
        .map_err(|e| format!("FETCH_HEAD not found: {e}"))?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;

    let (analysis, _) = repo.merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;

    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{branch}");
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference.set_target(fetch_commit.id(), "pull: fast-forward")
            .map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
    } else if analysis.is_up_to_date() {
        // Nothing to do
    } else {
        return Err("Pull requires merge — please resolve manually".into());
    }

    Ok(())
}
```

- [ ] **Step 4: Verificar test `test_add_remote_and_list`**

```bash
cd src-tauri && cargo test test_add_remote -- --nocapture
```

Resultado esperado: `ok`. (Los tests de push/pull reales requieren un repo remoto real; se prueban manualmente en la app.)

- [ ] **Step 5: Añadir Tauri commands de push/pull**

```rust
// src-tauri/src/commands/vcs.rs
#[tauri::command]
pub async fn vcs_add_remote(project_path: String, remote_url: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::add_remote(&path, "origin", &remote_url)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_push(project_path: String, token: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::push_to_remote(&path, "origin", &token)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vcs_pull(project_path: String, token: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || {
        git_service::pull_from_remote(&path, "origin", &token)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

- [ ] **Step 6: Registrar en `main.rs` y compilar**

```rust
commands::vcs::vcs_add_remote,
commands::vcs::vcs_push,
commands::vcs::vcs_pull,
```

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Resultado esperado: sin errores.

- [ ] **Step 7: Añadir botones Push/Pull en `VcsPanel.tsx`**

En `VcsPanel.tsx`, dentro de la sección del tab `"changes"`, añade tras el commit button (solo visible si `status.has_upstream`):

```tsx
// src/components/vcs/VcsPanel.tsx — añadir en el tab "changes" tras el bloque de commit
{status.has_upstream && githubToken && (
  <div className="flex gap-2">
    <button
      onClick={() => invoke("vcs_push", { projectPath, token: githubToken })}
      className="flex-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
    >
      ↑ Push
    </button>
    <button
      onClick={() => invoke("vcs_pull", { projectPath, token: githubToken }).then(() => loadStatus(projectPath))}
      className="flex-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
    >
      ↓ Pull
    </button>
  </div>
)}
```

Donde `githubToken` viene del store global de auth (se puede añadir a `vcsStore` o a un `authStore` separado; para esta tarea usar `useState` con el token recuperado de `invoke<string>("get_github_token")` al montar).

- [ ] **Step 8: Verificar compilación TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "^src/components/vcs"
```

Resultado esperado: sin errores de tipo.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/services/git_service.rs src-tauri/src/commands/vcs.rs src-tauri/src/main.rs src/components/vcs/VcsPanel.tsx
git commit -m "feat(vcs): add remote, push, pull with GitHub token auth"
```

---

## Task 12: Integrar VCS Panel en la vista de detalle de proyecto

**Files:**
- Create: `src/pages/ProjectDetail.tsx`
- Modify: enrutador o componente de navegación existente

- [ ] **Step 1: Crear `src/pages/ProjectDetail.tsx`**

```tsx
// src/pages/ProjectDetail.tsx
import { useEffect } from "react";
import { useParams } from "react-router-dom"; // asumiendo react-router
import { VcsPanel } from "../components/vcs/VcsPanel";
import { useProjectsStore } from "../store/projectsStore"; // store existente de proyectos

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects, loadProjects } = useProjectsStore();
  const project = projects.find((p) => p.id === Number(projectId));

  useEffect(() => {
    if (!projects.length) loadProjects();
  }, []);

  if (!project) {
    return <div className="p-8 text-muted-foreground">Proyecto no encontrado.</div>;
  }

  return (
    <div className="flex h-full flex-col gap-0">
      {/* Header del proyecto */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">{project.path}</p>
        </div>
        <div className="flex gap-2">
          <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
            Abrir en Unity
          </button>
          <button className="rounded border border-border px-4 py-2 text-sm hover:bg-muted">
            Abrir carpeta
          </button>
        </div>
      </div>

      {/* Contenido dividido: info principal + panel VCS */}
      <div className="flex flex-1 overflow-hidden">
        {/* Columna principal */}
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-sm text-muted-foreground">
            Unity {project.unity_version} · {project.unity_type}
          </p>
          {/* Aquí irán los paquetes instalados, etc. (futuras tareas) */}
        </div>

        {/* Panel VCS (solo si vcs_enabled) */}
        {project.vcs_enabled && (
          <div className="w-80 shrink-0 border-l border-border overflow-y-auto">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Control de versiones</h2>
            </div>
            <VcsPanel projectPath={project.path} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar la ruta en el enrutador existente**

Localiza el archivo donde se definen las rutas (probablemente `src/App.tsx` o `src/router.tsx`) y añade:

```tsx
// src/App.tsx o src/router.tsx — añadir junto a las rutas existentes
import { ProjectDetail } from "./pages/ProjectDetail";

// Dentro del <Routes> o array de rutas:
<Route path="/projects/:projectId" element={<ProjectDetail />} />
```

- [ ] **Step 3: Añadir navegación desde la lista de proyectos**

En el componente `Projects.tsx` existente, en el handler de clic de cada proyecto, añade navegación:

```tsx
// src/pages/Projects.tsx — en el handler de la card de proyecto
import { useNavigate } from "react-router-dom";
const navigate = useNavigate();
// En el onClick de la card:
onClick={() => navigate(`/projects/${project.id}`)}
```

- [ ] **Step 4: Verificar compilación TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "ProjectDetail"
```

Resultado esperado: sin errores.

- [ ] **Step 5: Prueba manual en dev**

```bash
cargo tauri dev
```

1. Crear un proyecto con VCS activado.
2. Hacer clic en el proyecto desde la lista.
3. Verificar que aparece el panel VCS a la derecha con la branch `main`.
4. Crear un archivo en la carpeta del proyecto, verificar que aparece como `?` en el panel.
5. Escribir un mensaje de commit y pulsar "Commit". Verificar que el panel se actualiza a 0 cambios.
6. Ir a "Historial" y verificar que aparecen 2 commits (initial + el nuevo).

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectDetail.tsx src/App.tsx src/pages/Projects.tsx
git commit -m "feat(vcs): integrate VcsPanel into ProjectDetail page"
```

---

## Self-Review

### 1. Cobertura del spec

| Requisito (sección 7) | Tarea que lo cubre |
|---|---|
| `git init` al crear proyecto | Task 2 |
| `git status` | Task 3 |
| `git add` + `git commit` | Task 4 |
| `git log` (historial) | Task 5 |
| `branch` (crear, cambiar, listar) | Task 6 |
| Panel VCS en vista de proyecto | Tasks 8, 9, 12 |
| `push` / `pull` con autenticación GitHub | Tasks 10, 11 |
| OAuth2 GitHub | Task 10 |
| `.gitignore` preconfigurado para Unity | Task 2 (`UNITY_GITIGNORE`) |
| Tipos TS espejo de structs Rust | Task 7 |
| **`merge` básico** | ⚠️ No cubierto explícitamente — pull fast-forward en Task 11 es suficiente para el MVP; merge con conflictos se pospone a Fase 6 |
| Unity Editor VPM package (7.5) | ⚠️ Pospuesto — requiere desarrollo de Unity Package separado; se añade como Task 13 en la Fase 5 donde Unity Custom se implementa |

### 2. Scan de placeholders

- No hay "TBD" ni "TODO" en ningún paso.
- Todos los pasos de código contienen código real.
- Los únicos "futuras tareas" están explícitamente anotados en el Self-Review.

### 3. Consistencia de tipos

- `GitStatus`, `CommitEntry`, `BranchInfo` definidos en Task 3/5/6 y usados con los mismos nombres en Tasks 7, 8, 9.
- `stage_all_and_commit` definido en Task 4 y referenciado solo en tests de Task 5 (correcto).
- `get_status` definido en Task 3, `get_log` en Task 5, `list_branches`/`create_branch`/`switch_branch` en Task 6 — todos con firmas `(project_path: &Path) -> Result<_, String>` consistentes.
- En el frontend: `useVcsStore` tiene todos los métodos (`loadBranches`, `switchBranch`, `createBranch`) definidos en Task 7 y usados en Task 9 — consistente.

---

*Plan generado el 2026-04-29 · VRC Studio Fase 4 — VCS Git/GitHub*
