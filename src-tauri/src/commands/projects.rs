use crate::error::AppError;
use crate::models::{
    CreateProjectProgress, CreateProjectRequest, Project, Shader, UnityInstallation, UnityType,
    VpmPackage,
};
use crate::services::{dependency_resolver, project_creator, unity_detector, vpm_client};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const INVALID_PATH_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
const OFFICIAL_VPM_URL: &str = "https://packages.vrchat.com/official?download";

pub fn validate_project_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("Project name cannot be empty".to_string()));
    }
    if trimmed.chars().any(|c| INVALID_PATH_CHARS.contains(&c)) {
        return Err(AppError::InvalidInput(
            r#"Project name contains invalid characters (/ \ : * ? " < > |)"#.to_string(),
        ));
    }
    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn row_to_project(
    id: String,
    name: String,
    path: String,
    unity_version: String,
    _unity_type: String,
    avatar_base_id: Option<String>,
    shader: Option<String>,
    vcs_enabled: i64,
    last_screenshot: Option<String>,
) -> Result<Project, AppError> {
    let unity_type = UnityType::Standard;
    let shader = match shader.as_deref() {
        Some("liltoon") => Some(Shader::Liltoon),
        Some("poiyomi") => Some(Shader::Poiyomi),
        _ => None,
    };
    Ok(Project { id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled: vcs_enabled != 0, last_screenshot })
}

async fn fetch_project_by_id(id: &str, pool: &SqlitePool) -> Result<Project, AppError> {
    let row = sqlx::query(
        "SELECT id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled, last_screenshot \
         FROM projects WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .ok_or_else(|| AppError::NotFound(format!("Project {id}")))?;

    use sqlx::Row;
    row_to_project(
        row.get("id"),
        row.get("name"),
        row.get("path"),
        row.get("unity_version"),
        row.get("unity_type"),
        row.get("avatar_base_id"),
        row.get("shader"),
        row.get("vcs_enabled"),
        row.get("last_screenshot"),
    )
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_projects(pool: State<'_, SqlitePool>) -> Result<Vec<Project>, AppError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled, last_screenshot \
         FROM projects ORDER BY updated_at DESC"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| AppError::External(e.to_string()))?;

    rows.into_iter()
        .map(|r| row_to_project(
            r.get("id"), r.get("name"), r.get("path"), r.get("unity_version"),
            r.get("unity_type"), r.get("avatar_base_id"), r.get("shader"), r.get("vcs_enabled"),
            r.get("last_screenshot"),
        ))
        .collect()
}

#[tauri::command]
pub async fn get_project(id: String, pool: State<'_, SqlitePool>) -> Result<Project, AppError> {
    fetch_project_by_id(&id, &pool).await
}

#[tauri::command]
pub async fn delete_project(
    id: String,
    also_delete_files: Option<bool>,
    pool: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    // Fetch path before deletion if we need to remove files from disk
    let path: Option<String> = if also_delete_files.unwrap_or(false) {
        sqlx::query_scalar("SELECT path FROM projects WHERE id = ?")
            .bind(&id)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| AppError::External(e.to_string()))?
    } else {
        None
    };

    let affected = sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&id)
        .execute(&*pool)
        .await
        .map_err(|e| AppError::External(e.to_string()))?
        .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(format!("Project {id}")));
    }

    if let Some(p) = path {
        tokio::fs::remove_dir_all(&p)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn list_unity_installations(app: AppHandle) -> Result<Vec<UnityInstallation>, AppError> {
    let result = unity_detector::detect_unity_installations().await;
    let _ = app.emit("unity:installations-detected", serde_json::json!({
        "count": result.len(),
        "installations": result.iter().map(|i| serde_json::json!({
            "version": i.version,
            "path": i.path,
            "is_custom": i.is_custom
        })).collect::<Vec<_>>()
    }));
    Ok(result)
}

#[tauri::command]
pub async fn fetch_vpm_index(url: Option<String>) -> Result<Vec<VpmPackage>, AppError> {
    let target = url.as_deref().unwrap_or(OFFICIAL_VPM_URL);
    vpm_client::fetch_vpm_repository(target).await
}

#[tauri::command]
pub async fn create_project(
    request: CreateProjectRequest,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<Project, AppError> {
    validate_project_name(&request.name)?;

    const ALLOWED_VERSIONS: &[&str] = &["2022.3.22f1", "2022.3.6f1", "2019.4.31f1"];
    if !ALLOWED_VERSIONS.contains(&request.unity_version.as_str()) {
        return Err(AppError::InvalidInput(format!(
            "Versión de Unity no permitida: '{}'. Versiones soportadas: {}",
            request.unity_version,
            ALLOWED_VERSIONS.join(", ")
        )));
    }

    let project_id = Uuid::new_v4().to_string();
    let project_dir = std::path::PathBuf::from(&request.destination_dir).join(&request.name);

    let emit = |progress: f32, message: &str, done: bool, error: Option<String>| {
        let _ = app.emit("project:progress", CreateProjectProgress {
            progress, message: message.to_string(), done, error,
        });
    };

    emit(0.05, "Creating project structure...", false, None);

    project_creator::create_project_structure(
        &project_dir,
        &project_creator::ProjectStructureOptions {
            unity_version: request.unity_version.clone(),
            vcs_enabled: request.vcs_enabled,
        },
    )
    .await
    .map_err(|e| { emit(0.0, "Failed to create project structure", true, Some(e.to_string())); e })?;

    emit(0.2, "Resolving VPM packages...", false, None);

    if !request.vpm_packages.is_empty() {
        let all_packages = vpm_client::fetch_vpm_repository(OFFICIAL_VPM_URL).await?;
        let refs: Vec<&str> = request.vpm_packages.iter().map(|s| s.as_str()).collect();
        let resolved = dependency_resolver::resolve(&refs, &all_packages)?;
        let total = resolved.len();
        for (i, pkg_version) in resolved.iter().enumerate() {
            let msg = format!("Installing {} {}...", pkg_version.display_name, pkg_version.version);
            emit(0.2 + 0.7 * (i as f32 / total as f32), &msg, false, None);
            project_creator::install_vpm_package(&project_dir, pkg_version, |_| {}).await?;
        }
        // Update vpm-manifest.json so installed packages are visible in the Packages tab
        emit(0.92, "Updating manifest...", false, None);
        for direct_id in &request.vpm_packages {
            update_vpm_manifest(&project_dir, direct_id, &resolved).await?;
        }
    }

    emit(0.95, "Saving to database...", false, None);

    let unity_type_str = "standard";
    let shader_str: Option<&str> = request.shader.as_ref().map(|s| match s {
        Shader::Liltoon => "liltoon",
        Shader::Poiyomi => "poiyomi",
    });
    let vcs_enabled_i: i64 = if request.vcs_enabled { 1 } else { 0 };
    let path_str = project_dir.to_string_lossy().to_string();

    sqlx::query(
        "INSERT INTO projects (id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&project_id)
    .bind(&request.name)
    .bind(&path_str)
    .bind(&request.unity_version)
    .bind(unity_type_str)
    .bind(&request.avatar_base_id)
    .bind(shader_str)
    .bind(vcs_enabled_i)
    .execute(&*pool)
    .await
    .map_err(|e| AppError::External(e.to_string()))?;

    emit(1.0, "Project created!", true, None);

    fetch_project_by_id(&project_id, &pool).await
}

#[tauri::command]
pub async fn open_project_in_unity(
    project_id: String,
    project_path: String,
    unity_path: String,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    tokio::process::Command::new(&unity_path)
        .arg("-projectPath")
        .arg(&project_path)
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to launch Unity: {e}")))?;

    // Schedule an automatic screenshot ~30 seconds after launch so the user
    // gets a preview of how their project looked the last time they opened it.
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::External(e.to_string()))?;
    let pool_clone = pool.inner().clone();
    let app_clone = app.clone();
    let pid = project_id.clone();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if let Ok(png_path) = capture_screen_to_file(&data_dir, &pid) {
            let _ = sqlx::query(
                "UPDATE projects SET last_screenshot = ?, updated_at = datetime('now') WHERE id = ?"
            )
            .bind(&png_path)
            .bind(&pid)
            .execute(&pool_clone)
            .await;
            let _ = app_clone.emit("project:screenshot_ready", &pid);
        }
    });

    Ok(())
}

/// Capture the Unity editor window to `{data_dir}/screenshots/{project_id}.png`.
///
/// On Windows we use `PrintWindow` with `PW_RENDERFULLCONTENT` (flag=2) so that
/// DirectX/OpenGL surfaces are included — plain `CopyFromScreen` only captures
/// the GDI composited layer and returns black for hardware-accelerated windows.
/// We target the running Unity process window; if Unity isn't open we skip.
fn capture_screen_to_file(data_dir: &std::path::Path, project_id: &str) -> Result<String, ()> {
    let screenshots_dir = data_dir.join("screenshots");
    std::fs::create_dir_all(&screenshots_dir).map_err(|_| ())?;
    let png_path = screenshots_dir.join(format!("{project_id}.png"));
    // Keep backslashes for the PowerShell path (Windows native).
    let png_str = png_path.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    {
        // Intentamos varios nombres de proceso por si el editor usa un nombre distinto.
        // PW_RENDERFULLCONTENT (flag=2) captura superficies DX/OpenGL, no solo GDI.
        let ps = format!(
            r#"Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    using System.Drawing;
    using System.Drawing.Imaging;
    public class VrcCap {{
        [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
        [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
        [StructLayout(LayoutKind.Sequential)] public struct RECT {{ public int L,T,R,B; }}
        public static bool CapWindow(IntPtr hwnd, string path) {{
            RECT r; GetClientRect(hwnd, out r);
            int w = r.R - r.L, h = r.B - r.T;
            if (w <= 0 || h <= 0) return false;
            using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp)) {{
                IntPtr dc = g.GetHdc();
                bool ok = PrintWindow(hwnd, dc, 2);
                g.ReleaseHdc(dc);
                if (ok) bmp.Save(path, ImageFormat.Png);
                return ok;
            }}
        }}
    }}
    "@ -ReferencedAssemblies System.Drawing -Language CSharp
    # Buscar la ventana de Unity por varios nombres de proceso posibles.
    # Si ninguno está activo con ventana visible, salir sin capturar (exit 0).
    $candidates = @('Unity', 'Unity Editor', 'UnityEditor')
    $u = $null
    foreach ($name in $candidates) {{
        $proc = Get-Process -Name $name -ErrorAction SilentlyContinue `
                | Where-Object {{ $_.MainWindowHandle -ne [IntPtr]::Zero }} `
                | Select-Object -First 1
        if ($proc) {{ $u = $proc; break }}
    }}
    if (-not $u) {{
        Write-Host "[VRCStudio] Unity window not found — skipping screenshot"
        exit 0
    }}
    $ok = [VrcCap]::CapWindow($u.MainWindowHandle, '{png_str}')
    if (-not $ok) {{
        Write-Host "[VRCStudio] PrintWindow returned false"
        exit 1
    }}"#,
            png_str = png_str.replace('\'', "''")
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
            .output();
        if output.map(|o| o.status.success()).unwrap_or(false) {
            if png_path.exists() {
                return Ok(png_path.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // 1. Obtener el ID de ventana de Unity Editor vía AppleScript.
        //    El proceso puede llamarse "Unity" o "Unity Editor" según la versión.
        let get_id = std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"
    set appNames to {"Unity", "Unity Editor"}
    repeat with appName in appNames
        try
            tell application "System Events"
                set procs to (processes whose name is appName)
                if (count of procs) > 0 then
                    set proc to first item of procs
                    set wins to windows of proc
                    if (count of wins) > 0 then
                        set win to first item of wins
                        return id of win
                    end if
                end if
            end tell
        end try
    end repeat
    return ""
            "#)
            .output();

        let window_id = match get_id {
            Ok(o) if o.status.success() => {
                String::from_utf8_lossy(&o.stdout).trim().to_string()
            }
            _ => String::new(),
        };

        if window_id.is_empty() {
            eprintln!("[VRCStudio] macOS: Unity window not found — skipping screenshot");
            return Err(());
        }

        // 2. Capturar solo esa ventana (sin el escritorio ni otras apps).
        //    -l: window id; -x: sin sonido de obturador; -o: sin sombra.
        let status = std::process::Command::new("screencapture")
            .args(["-l", &window_id, "-x", "-o",
                png_path.to_str().unwrap_or("")])
            .status();

        if status.map(|s| s.success()).unwrap_or(false) && png_path.exists() {
            return Ok(png_path.to_string_lossy().to_string());
        }
    }

    Err(())
}

/// Persist a manually-supplied screenshot path (e.g., picked from file dialog).
#[tauri::command]
pub async fn save_project_screenshot(
    id: String,
    screenshot_path: String,
    pool: State<'_, SqlitePool>,
) -> Result<Project, AppError> {
    sqlx::query(
        "UPDATE projects SET last_screenshot = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(&screenshot_path)
    .bind(&id)
    .execute(&*pool)
    .await
    .map_err(|e| AppError::External(e.to_string()))?;

    fetch_project_by_id(&id, &pool).await
}

// ── Scan & Import existing projects ──────────────────────────────────────────

/// Minimal info about a Unity project found on disk during a scan.
#[derive(serde::Serialize, Clone)]
pub struct ScannedProject {
    pub path: String,
    pub name: String,
    pub unity_version: String,
    /// true if this path is already registered in the DB
    pub already_imported: bool,
}

/// Recursively walk `root_dir` looking for Unity projects.
/// A directory is considered a Unity project when it contains
/// `ProjectSettings/ProjectVersion.txt`.  We cap depth at 6 to stay fast.
fn walk_for_unity_projects(dir: &std::path::Path, depth: u8, out: &mut Vec<std::path::PathBuf>) {
    if depth > 6 { return; }
    let version_file = dir.join("ProjectSettings").join("ProjectVersion.txt");
    if version_file.exists() {
        out.push(dir.to_path_buf());
        return; // don't recurse into a project
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                // Skip hidden dirs, Unity asset folders and system dirs
                if name.starts_with('.') || name == "Library" || name == "Temp"
                    || name == "node_modules" || name == "$RECYCLE.BIN"
                {
                    continue;
                }
                walk_for_unity_projects(&path, depth + 1, out);
            }
        }
    }
}

/// Parse `m_EditorVersion: X.Y.ZfW` from `ProjectSettings/ProjectVersion.txt`.
fn read_unity_version(project_dir: &std::path::Path) -> Option<String> {
    let txt = std::fs::read_to_string(
        project_dir.join("ProjectSettings").join("ProjectVersion.txt"),
    ).ok()?;
    for line in txt.lines() {
        if let Some(rest) = line.strip_prefix("m_EditorVersion:") {
            return Some(rest.trim().to_owned());
        }
    }
    None
}

#[tauri::command]
pub async fn scan_for_projects(
    root_dir: String,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<ScannedProject>, AppError> {
    // Run the blocking filesystem walk on a thread-pool thread
    let root = std::path::PathBuf::from(&root_dir);
    let found = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        walk_for_unity_projects(&root, 0, &mut out);
        out
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?;

    // Load already-imported paths from DB for deduplication
    let existing: Vec<String> = sqlx::query_scalar("SELECT path FROM projects")
        .fetch_all(&*pool)
        .await
        .unwrap_or_default();
    let existing_set: std::collections::HashSet<String> = existing.into_iter().collect();

    let mut result = Vec::new();
    for proj_path in found {
        let unity_version = read_unity_version(&proj_path)
            .unwrap_or_else(|| "Unknown".to_string());
        let name = proj_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_owned();
        let path_str = proj_path.to_string_lossy().to_string();
        let already_imported = existing_set.contains(&path_str);
        result.push(ScannedProject { path: path_str, name, unity_version, already_imported });
    }

    Ok(result)
}

#[tauri::command]
pub async fn import_existing_project(
    path: String,
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<Project, AppError> {
    // Verify it's actually a Unity project
    let project_dir = std::path::PathBuf::from(&path);
    let unity_version = read_unity_version(&project_dir)
        .ok_or_else(|| AppError::InvalidInput(
            format!("{path} does not appear to be a Unity project (missing ProjectSettings/ProjectVersion.txt)")
        ))?;

    // Check for duplicates
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM projects WHERE path = ?")
        .bind(&path)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| AppError::External(e.to_string()))?;

    if let Some(existing_id) = existing {
        return fetch_project_by_id(&existing_id, &pool).await;
    }

    let project_id = uuid::Uuid::new_v4().to_string();
    let vcs_enabled: i64 = if project_dir.join(".git").exists() { 1 } else { 0 };

    sqlx::query(
        "INSERT INTO projects (id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled) \
         VALUES (?, ?, ?, ?, 'standard', NULL, NULL, ?)"
    )
    .bind(&project_id)
    .bind(&name)
    .bind(&path)
    .bind(&unity_version)
    .bind(vcs_enabled)
    .execute(&*pool)
    .await
    .map_err(|e| AppError::External(e.to_string()))?;

    fetch_project_by_id(&project_id, &pool).await
}

// ── VPM package management for existing projects ──────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledVpmPackage {
    pub name: String,
    pub version: String,
    /// true = transitive dependency (in "locked"); false = directly added
    pub is_locked: bool,
}

/// Read vpm-manifest.json from the project and return installed packages.
#[tauri::command]
pub async fn get_installed_vpm_packages(
    project_path: String,
) -> Result<Vec<InstalledVpmPackage>, AppError> {
    let manifest_path = std::path::PathBuf::from(&project_path)
        .join("Packages")
        .join("vpm-manifest.json");

    if !manifest_path.exists() {
        return Ok(vec![]);
    }

    let content = tokio::fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;

    let manifest: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::External(format!("Invalid vpm-manifest.json: {e}")))?;

    let mut result: Vec<InstalledVpmPackage> = Vec::new();

    // Direct dependencies
    if let Some(deps) = manifest.get("dependencies").and_then(|v| v.as_object()) {
        for (name, info) in deps {
            let version = info
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("?")
                .to_owned();
            result.push(InstalledVpmPackage { name: name.clone(), version, is_locked: false });
        }
    }

    // Locked (transitive)
    if let Some(locked) = manifest.get("locked").and_then(|v| v.as_object()) {
        for (name, info) in locked {
            if result.iter().any(|p| &p.name == name) { continue; }
            let version = info
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("?")
                .to_owned();
            result.push(InstalledVpmPackage { name: name.clone(), version, is_locked: true });
        }
    }

    result.sort_by(|a, b| a.is_locked.cmp(&b.is_locked).then(a.name.cmp(&b.name)));
    Ok(result)
}

/// Update vpm-manifest.json, adding the package to "dependencies" and all resolved
/// packages to "locked".
async fn update_vpm_manifest(
    project_path: &std::path::Path,
    direct_id: &str,
    resolved: &[&crate::models::VpmPackageVersion],
) -> Result<(), AppError> {
    let manifest_path = project_path.join("Packages").join("vpm-manifest.json");

    let mut manifest: serde_json::Value = if manifest_path.exists() {
        let content = tokio::fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({ "dependencies": {}, "locked": {} }))
    } else {
        serde_json::json!({ "dependencies": {}, "locked": {} })
    };

    // Ensure top-level objects exist
    if manifest.get("dependencies").is_none() {
        manifest["dependencies"] = serde_json::json!({});
    }
    if manifest.get("locked").is_none() {
        manifest["locked"] = serde_json::json!({});
    }

    // Find the direct package's version
    if let Some(direct_pkg) = resolved.iter().find(|p| p.name == direct_id) {
        manifest["dependencies"][direct_id] = serde_json::json!({
            "version": direct_pkg.version
        });
    }

    // All resolved packages go into locked
    for pkg in resolved {
        let deps_map: serde_json::Map<String, serde_json::Value> = pkg
            .dependencies
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        manifest["locked"][&pkg.name] = serde_json::json!({
            "version": pkg.version,
            "dependencies": deps_map,
        });
    }

    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| AppError::External(e.to_string()))?;
    tokio::fs::write(&manifest_path, json)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;

    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
struct PkgProgress {
    package_id: String,
    step: String,
    progress: f32,
    done: bool,
    error: Option<String>,
}

/// Install a VPM package (+ transitive deps) into an existing project.
/// Emits `project:pkg_progress` events as it goes.
#[tauri::command]
pub async fn install_vpm_package_to_project(
    project_path: String,
    package_id: String,
    version: Option<String>,
    repo_urls: Option<Vec<String>>,
    app: AppHandle,
) -> Result<(), AppError> {
    let emit = |step: &str, progress: f32, done: bool, error: Option<String>| {
        let _ = app.emit("project:pkg_progress", PkgProgress {
            package_id: package_id.clone(),
            step: step.to_string(),
            progress,
            done,
            error,
        });
    };

    emit("Fetching package index…", 0.05, false, None);

    // Determinar qué repos consultar
    let urls: Vec<String> = match repo_urls {
        Some(ref urls) if !urls.is_empty() => urls.clone(),
        _ => vec![OFFICIAL_VPM_URL.to_string()],
    };

    // Fetch en paralelo y merge; si alguno falla, se ignora siempre que quede al menos uno
    let fetches: Vec<_> = urls.iter()
        .map(|url| vpm_client::fetch_vpm_repository(url))
        .collect();
    let results = futures::future::join_all(fetches).await;

    let mut all_packages: Vec<crate::models::VpmPackage> = Vec::new();
    let mut all_failed = true;
    for result in results {
        match result {
            Ok(pkgs) => {
                all_failed = false;
                for pkg in pkgs {
                    if !all_packages.iter().any(|p| p.id == pkg.id) {
                        all_packages.push(pkg);
                    }
                }
            }
            Err(e) => {
                eprintln!("[install] repo fetch error (non-fatal): {}", e);
            }
        }
    }
    if all_failed {
        let msg = "No se pudo conectar a ningún repositorio VPM".to_string();
        emit("Failed", 0.0, true, Some(msg.clone()));
        return Err(AppError::External(msg));
    }

    // Resolve requested version or use latest
    let pkg = all_packages.iter()
        .find(|p| p.id == package_id)
        .ok_or_else(|| AppError::NotFound(format!("Package {package_id} not in index")))?;

    let _pkg_version = if let Some(ref ver) = version {
        pkg.versions.get(ver)
            .ok_or_else(|| AppError::NotFound(format!("Version {ver} not found for {package_id}")))?
    } else {
        pkg.latest_version()
            .ok_or_else(|| AppError::NotFound(format!("No versions for {package_id}")))?
    };

    emit("Resolving dependencies…", 0.10, false, None);

    let refs = vec![package_id.as_str()];
    let resolved = dependency_resolver::resolve(&refs, &all_packages)?;

    let project_dir = std::path::PathBuf::from(&project_path);
    let total = resolved.len();

    for (i, dep) in resolved.iter().enumerate() {
        let frac_start = 0.15 + 0.75 * (i as f32 / total as f32);
        emit(
            &format!("Installing {} {}…", dep.display_name, dep.version),
            frac_start,
            false,
            None,
        );

        if let Err(e) = project_creator::install_vpm_package(&project_dir, dep, |_| {}).await {
            let msg = e.to_string();
            emit("Failed", frac_start, true, Some(msg.clone()));
            return Err(AppError::External(msg));
        }
    }

    emit("Updating manifest…", 0.92, false, None);

    if let Err(e) = update_vpm_manifest(&project_dir, &package_id, &resolved).await {
        let msg = e.to_string();
        emit("Failed", 0.92, true, Some(msg.clone()));
        return Err(e);
    }

    emit("Done", 1.0, true, None);
    Ok(())
}

/// Remove a directly-installed VPM package from the project:
/// deletes its directory under Packages/ and updates vpm-manifest.json.
#[tauri::command]
pub async fn remove_vpm_package_from_project(
    project_path: String,
    package_id: String,
) -> Result<(), AppError> {
    let project_dir = std::path::PathBuf::from(&project_path);

    // Remove the package directory if it exists
    let pkg_dir = project_dir.join("Packages").join(&package_id);
    if pkg_dir.exists() {
        tokio::fs::remove_dir_all(&pkg_dir)
            .await
            .map_err(|e| AppError::Io(format!("Failed to remove {package_id}: {e}")))?;
    }

    // Update vpm-manifest.json
    let manifest_path = project_dir.join("Packages").join("vpm-manifest.json");
    if manifest_path.exists() {
        let content = tokio::fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        let mut manifest: serde_json::Value = serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({ "dependencies": {}, "locked": {} }));

        if let Some(deps) = manifest.get_mut("dependencies").and_then(|v| v.as_object_mut()) {
            deps.remove(&package_id);
        }
        if let Some(locked) = manifest.get_mut("locked").and_then(|v| v.as_object_mut()) {
            locked.remove(&package_id);
        }

        let json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| AppError::External(e.to_string()))?;
        tokio::fs::write(&manifest_path, json)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    Ok(())
}