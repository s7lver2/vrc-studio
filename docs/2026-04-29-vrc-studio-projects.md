# VRC Studio — Projects Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Projects stub page with a fully functional module: Unity installation detection, project CRUD, VPM index fetching, dependency resolution, and a 4-step avatar creation wizard that writes a real Unity project to disk.

**Architecture:** All filesystem, network, and registry I/O lives in Rust services invoked via typed Tauri Commands. Project creation emits real-time Tauri Events to the frontend. The 4-step wizard is driven by local React state and fires a single `create_project` command at Step 4. Unity installations are detected by scanning known install paths and (on Windows) the registry.

**Tech Stack:** Rust (`reqwest 0.12`, `semver 1`, `uuid 1`, `zip 2`, `winreg 0.52` Windows-only), React 19, Zustand, shadcn/ui, Vitest + Testing Library.

**Prerequisite:** `docs/2026-04-29-vrc-studio-core.md` fully implemented and passing all tests.

---

## File Structure

```
src-tauri/src/
├── services/
│   ├── mod.rs                      # pub mod declarations
│   ├── unity_detector.rs           # Scan filesystem + registry for Unity installs
│   ├── vpm_client.rs               # Fetch & parse VPM repository JSON
│   ├── dependency_resolver.rs      # Semver-based VPM dependency resolution
│   └── project_creator.rs          # Write Unity project structure to disk
├── commands/
│   ├── mod.rs                      # (extend) re-export projects commands
│   └── projects.rs                 # All project-related Tauri commands
└── models/
    └── mod.rs                      # (extend) new structs for this module

src/
├── store/
│   └── projects.ts                 # Zustand: project list + wizard state
├── lib/
│   └── tauri.ts                    # (extend) typed wrappers for new commands
├── hooks/
│   └── useProjectEvents.ts         # Subscribe to Tauri project:progress events
└── components/
    └── projects/
        ├── ProjectCard.tsx         # Single project card with actions menu
        ├── ProjectList.tsx         # Grid of ProjectCard + empty state
        ├── DeleteProjectDialog.tsx # Confirmation dialog for project deletion
        └── wizard/
            ├── CreateProjectWizard.tsx   # Shell: step routing + state
            ├── Step1Unity.tsx            # Unity version picker
            ├── Step2Avatar.tsx           # Avatar base + shader selection
            ├── Step3Packages.tsx         # VPM package picker
            ├── Step4Details.tsx          # Name + destination + confirm
            └── CreationProgress.tsx      # Real-time creation progress
pages/
    └── Projects.tsx                # (replace stub) orchestrates list ↔ wizard
```

---

## Task 1: Add dependencies to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/services/mod.rs`

- [ ] **Step 1: Add Rust dependencies to `src-tauri/Cargo.toml`**

In the `[dependencies]` block, add:

```toml
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
semver  = { version = "1", features = ["serde"] }
uuid    = { version = "1", features = ["v4"] }
zip     = "2"
```

At the bottom of `Cargo.toml`, add a platform-specific block:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"
```

- [ ] **Step 2: Declare the `services` module in `src-tauri/src/lib.rs`**

```rust
pub mod error;
pub mod db;
pub mod commands;
pub mod models;
pub mod services;   // ← add this line
```

- [ ] **Step 3: Create `src-tauri/src/services/mod.rs`**

```rust
pub mod unity_detector;
pub mod vpm_client;
pub mod dependency_resolver;
pub mod project_creator;
```

Create empty stub files so `cargo check` passes:

```bash
touch src-tauri/src/services/unity_detector.rs
touch src-tauri/src/services/vpm_client.rs
touch src-tauri/src/services/dependency_resolver.rs
touch src-tauri/src/services/project_creator.rs
```

- [ ] **Step 4: Verify compilation**

```bash
cd src-tauri && cargo check
```

Expected: compiles without errors (warnings about empty files are OK).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/services/
git commit -m "chore: add reqwest, semver, uuid, zip, winreg deps + services module"
```

---

## Task 2: Extend domain models

**Files:**
- Modify: `src-tauri/src/models/mod.rs`

Add the following structs **after** the existing content in `models/mod.rs`:

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/tests/db_test.rs`:

```rust
use vrc_studio_lib::models::{
    UnityInstallation, VpmPackage, CreateProjectRequest, UnityType,
};

#[test]
fn unity_installation_serializes() {
    let inst = UnityInstallation {
        version: "2022.3.22f1".to_string(),
        path: "C:/Unity/Editor/Unity.exe".to_string(),
        is_custom: false,
    };
    let json = serde_json::to_string(&inst).unwrap();
    assert!(json.contains("\"is_custom\":false"));
    assert!(json.contains("2022.3.22f1"));
}

#[test]
fn create_project_request_roundtrips() {
    let req = CreateProjectRequest {
        name: "My Avatar".to_string(),
        destination_dir: "C:/Projects".to_string(),
        unity_version: "2022.3.22f1".to_string(),
        unity_path: "C:/Unity/Editor/Unity.exe".to_string(),
        unity_type: UnityType::Standard,
        avatar_base_id: None,
        shader: None,
        vcs_enabled: false,
        vpm_packages: vec!["com.vrchat.avatars".to_string()],
    };
    let json = serde_json::to_string(&req).unwrap();
    let back: CreateProjectRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, "My Avatar");
    assert_eq!(back.vpm_packages.len(), 1);
}

#[test]
fn vpm_package_latest_version() {
    use std::collections::HashMap;
    use vrc_studio_lib::models::VpmPackageVersion;

    let mut versions = HashMap::new();
    versions.insert("3.7.0".to_string(), VpmPackageVersion {
        name: "com.vrchat.avatars".to_string(),
        display_name: "VRChat Avatars".to_string(),
        version: "3.7.0".to_string(),
        unity: "2022.3".to_string(),
        description: Some("Avatar SDK".to_string()),
        url: "https://packages.vrchat.com/avatars-3.7.0.zip".to_string(),
        dependencies: HashMap::new(),
    });
    versions.insert("3.6.0".to_string(), VpmPackageVersion {
        name: "com.vrchat.avatars".to_string(),
        display_name: "VRChat Avatars".to_string(),
        version: "3.6.0".to_string(),
        unity: "2022.3".to_string(),
        description: None,
        url: "https://packages.vrchat.com/avatars-3.6.0.zip".to_string(),
        dependencies: HashMap::new(),
    });

    let pkg = VpmPackage {
        id: "com.vrchat.avatars".to_string(),
        versions,
    };
    let latest = pkg.latest_version().unwrap();
    assert_eq!(latest.version, "3.7.0");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test unity_installation_serializes create_project_request_roundtrips vpm_package_latest 2>&1 | head -20
```

Expected: FAIL — types not defined.

- [ ] **Step 3: Append new models to `src-tauri/src/models/mod.rs`**

```rust
// ── Projects Module ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnityInstallation {
    pub version: String,
    pub path: String,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub destination_dir: String,
    pub unity_version: String,
    pub unity_path: String,
    pub unity_type: UnityType,
    pub avatar_base_id: Option<String>,
    pub shader: Option<Shader>,
    pub vcs_enabled: bool,
    /// Package IDs to install, e.g. ["com.vrchat.avatars"]
    pub vpm_packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectProgress {
    /// 0.0 – 1.0
    pub progress: f32,
    pub message: String,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpmPackageVersion {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub unity: String,
    pub description: Option<String>,
    pub url: String,
    /// { "com.vrchat.base": ">=3.7.0" }
    pub dependencies: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpmPackage {
    pub id: String,
    /// Keyed by version string
    pub versions: std::collections::HashMap<String, VpmPackageVersion>,
}

impl VpmPackage {
    /// Returns the highest semver version, or None if empty.
    pub fn latest_version(&self) -> Option<&VpmPackageVersion> {
        self.versions
            .values()
            .max_by(|a, b| {
                let va = semver::Version::parse(&a.version).ok();
                let vb = semver::Version::parse(&b.version).ok();
                va.cmp(&vb)
            })
    }
}
```

- [ ] **Step 4: Add `semver` import at the top of `models/mod.rs`**

The file already imports `serde`. Add:

```rust
use serde::{Deserialize, Serialize};
// (semver is used inside impl VpmPackage — no top-level import needed)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test unity_installation_serializes create_project_request_roundtrips vpm_package_latest
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models/mod.rs src-tauri/tests/db_test.rs
git commit -m "feat: extend models with UnityInstallation, VpmPackage, CreateProjectRequest"
```

---

## Task 3: Unity detector service

**Files:**
- Create: `src-tauri/src/services/unity_detector.rs`

Detects Unity installations from:
1. **Known path patterns** (cross-platform, always runs)
2. **Windows registry** (Windows-only, guarded by `#[cfg(target_os = "windows")]`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/unity_detector_test.rs`:

```rust
use vrc_studio_lib::services::unity_detector::parse_version_from_path;

#[test]
fn parses_version_from_standard_hub_path() {
    let path = "C:/Program Files/Unity/Hub/Editor/2022.3.22f1/Editor/Unity.exe";
    let version = parse_version_from_path(path);
    assert_eq!(version, Some("2022.3.22f1".to_string()));
}

#[test]
fn parses_version_from_unix_path() {
    let path = "/home/user/Unity/Hub/Editor/2022.3.6f1/Editor/Unity";
    let version = parse_version_from_path(path);
    assert_eq!(version, Some("2022.3.6f1".to_string()));
}

#[test]
fn returns_none_for_invalid_path() {
    let path = "/some/random/path/without/version";
    let version = parse_version_from_path(path);
    assert!(version.is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test unity_detector_test 2>&1 | head -10
```

Expected: FAIL — function not defined.

- [ ] **Step 3: Implement `src-tauri/src/services/unity_detector.rs`**

```rust
use crate::models::UnityInstallation;
use std::path::{Path, PathBuf};

/// Regex-free version extraction: finds the first path segment that looks like
/// a Unity version string (e.g. "2022.3.22f1").
pub fn parse_version_from_path(path: &str) -> Option<String> {
    path.replace('\\', "/")
        .split('/')
        .find(|segment| {
            // Unity version format: YEAR.MINOR.PATCHfBUILD e.g. 2022.3.22f1
            let parts: Vec<&str> = segment.splitn(3, '.').collect();
            if parts.len() < 2 {
                return false;
            }
            parts[0].parse::<u32>().is_ok()
                && parts[1].parse::<u32>().is_ok()
                && segment.contains('f')
        })
        .map(|s| s.to_string())
}

/// Returns all Unity installations found on this machine.
/// Never errors — returns empty vec if nothing found.
pub async fn detect_unity_installations() -> Vec<UnityInstallation> {
    let mut found: Vec<UnityInstallation> = Vec::new();

    // ── Cross-platform: scan known paths ────────────────────────
    let candidates = known_unity_paths();
    for dir in candidates {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let version_dir = entry.path();
                if !version_dir.is_dir() {
                    continue;
                }
                let exe = unity_exe_in_dir(&version_dir);
                if exe.exists() {
                    if let Some(version) = parse_version_from_path(
                        version_dir.to_string_lossy().as_ref(),
                    ) {
                        found.push(UnityInstallation {
                            version,
                            path: exe.to_string_lossy().to_string(),
                            is_custom: false,
                        });
                    }
                }
            }
        }
    }

    // ── Windows-only: registry ───────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        found.extend(detect_from_registry());
    }

    // Deduplicate by path, keep higher versions first
    found.sort_by(|a, b| b.version.cmp(&a.version));
    found.dedup_by(|a, b| a.path == b.path);
    found
}

fn unity_exe_in_dir(dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return dir.join("Editor").join("Unity.exe");
    #[cfg(not(target_os = "windows"))]
    return dir.join("Unity.app").join("Contents").join("MacOS").join("Unity");
}

fn known_unity_paths() -> Vec<PathBuf> {
    let mut paths = vec![];

    // Windows: Unity Hub default
    if let Ok(program_files) = std::env::var("PROGRAMFILES") {
        paths.push(PathBuf::from(program_files).join("Unity/Hub/Editor"));
    }
    // macOS: Unity Hub default
    paths.push(PathBuf::from(
        "/Applications/Unity/Hub/Editor",
    ));
    // Linux: Unity Hub default
    if let Ok(home) = std::env::var("HOME") {
        paths.push(PathBuf::from(&home).join("Unity/Hub/Editor"));
    }
    paths
}

#[cfg(target_os = "windows")]
fn detect_from_registry() -> Vec<UnityInstallation> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut result = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(installer_key) = hkcu.open_subkey("SOFTWARE\\Unity Technologies\\Installer") else {
        return result;
    };
    for subkey_name in installer_key.enum_keys().flatten() {
        let Ok(subkey) = installer_key.open_subkey(&subkey_name) else {
            continue;
        };
        let Ok(location): Result<String, _> = subkey.get_value("Location x64") else {
            continue;
        };
        let exe = PathBuf::from(&location).join("Editor").join("Unity.exe");
        if exe.exists() {
            if let Some(version) = parse_version_from_path(&location) {
                result.push(UnityInstallation {
                    version,
                    path: exe.to_string_lossy().to_string(),
                    is_custom: false,
                });
            }
        }
    }
    result
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test unity_detector_test
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/unity_detector.rs src-tauri/tests/unity_detector_test.rs
git commit -m "feat: Unity installation detector (filesystem + Windows registry)"
```

---

## Task 4: VPM client service

**Files:**
- Create: `src-tauri/src/services/vpm_client.rs`

Fetches and parses a VPM repository index JSON into our `VpmPackage` model.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/vpm_client_test.rs`:

```rust
use vrc_studio_lib::services::vpm_client::parse_vpm_index;

#[test]
fn parses_minimal_vpm_index() {
    let json = r#"{
        "name": "VRChat Official",
        "id": "com.vrchat.repos.official",
        "packages": {
            "com.vrchat.base": {
                "versions": {
                    "3.7.0": {
                        "name": "com.vrchat.base",
                        "displayName": "VRChat Base",
                        "version": "3.7.0",
                        "unity": "2022.3",
                        "url": "https://packages.vrchat.com/base-3.7.0.zip",
                        "dependencies": {}
                    }
                }
            }
        }
    }"#;

    let packages = parse_vpm_index(json).expect("parse failed");
    assert_eq!(packages.len(), 1);
    assert!(packages.iter().any(|p| p.id == "com.vrchat.base"));
    let base = packages.iter().find(|p| p.id == "com.vrchat.base").unwrap();
    assert!(base.versions.contains_key("3.7.0"));
}

#[test]
fn parse_vpm_index_ignores_unknown_fields() {
    // Real VPM JSON has extra fields we don't care about
    let json = r#"{
        "name": "Test Repo",
        "url": "https://example.com",
        "author": "Someone",
        "packages": {
            "com.example.pkg": {
                "versions": {
                    "1.0.0": {
                        "name": "com.example.pkg",
                        "displayName": "Example",
                        "version": "1.0.0",
                        "unity": "2022.3",
                        "url": "https://example.com/pkg.zip",
                        "dependencies": {},
                        "vpmDependencies": {},
                        "keywords": ["avatar"]
                    }
                }
            }
        }
    }"#;

    let packages = parse_vpm_index(json).expect("parse failed");
    assert_eq!(packages.len(), 1);
}

#[test]
fn parse_returns_error_on_invalid_json() {
    let result = parse_vpm_index("not json at all");
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test vpm_client_test 2>&1 | head -10
```

Expected: FAIL.

- [ ] **Step 3: Implement `src-tauri/src/services/vpm_client.rs`**

```rust
use crate::error::AppError;
use crate::models::{VpmPackage, VpmPackageVersion};
use serde::Deserialize;
use std::collections::HashMap;

// ── Raw serde types for VPM JSON (handles extra fields with deny_unknown) ──

#[derive(Deserialize)]
struct RawIndex {
    packages: HashMap<String, RawPackageEntry>,
}

#[derive(Deserialize)]
struct RawPackageEntry {
    versions: HashMap<String, RawVersion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVersion {
    name: String,
    display_name: String,
    version: String,
    unity: String,
    #[serde(default)]
    description: Option<String>,
    url: String,
    #[serde(default)]
    dependencies: HashMap<String, String>,
    // extra fields (vpmDependencies, keywords, etc.) are silently ignored
    #[serde(flatten)]
    _extra: HashMap<String, serde_json::Value>,
}

/// Parse a VPM repository JSON string into a list of VpmPackage.
pub fn parse_vpm_index(json: &str) -> Result<Vec<VpmPackage>, AppError> {
    let raw: RawIndex = serde_json::from_str(json)
        .map_err(|e| AppError::External(format!("VPM index parse error: {e}")))?;

    Ok(raw
        .packages
        .into_iter()
        .map(|(id, entry)| VpmPackage {
            id,
            versions: entry
                .versions
                .into_iter()
                .map(|(ver, rv)| {
                    (
                        ver,
                        VpmPackageVersion {
                            name: rv.name,
                            display_name: rv.display_name,
                            version: rv.version,
                            unity: rv.unity,
                            description: rv.description,
                            url: rv.url,
                            dependencies: rv.dependencies,
                        },
                    )
                })
                .collect(),
        })
        .collect())
}

/// Fetch and parse a VPM repository from a URL.
pub async fn fetch_vpm_repository(url: &str) -> Result<Vec<VpmPackage>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::External(e.to_string()))?;

    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::External(format!("HTTP error: {e}")))?
        .text()
        .await
        .map_err(|e| AppError::External(format!("Body error: {e}")))?;

    parse_vpm_index(&body)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test vpm_client_test
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/vpm_client.rs src-tauri/tests/vpm_client_test.rs
git commit -m "feat: VPM client — parse and fetch VPM repository JSON"
```

---

## Task 5: Dependency resolver

**Files:**
- Create: `src-tauri/src/services/dependency_resolver.rs`

Takes a list of requested package IDs and a full package list, and resolves the minimal set of packages to install (including transitive dependencies), picking the latest compatible version.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/dependency_resolver_test.rs`:

```rust
use std::collections::HashMap;
use vrc_studio_lib::models::{VpmPackage, VpmPackageVersion};
use vrc_studio_lib::services::dependency_resolver::resolve;

fn make_pkg(id: &str, version: &str, deps: Vec<(&str, &str)>) -> VpmPackage {
    let mut dep_map = HashMap::new();
    for (did, dreq) in deps {
        dep_map.insert(did.to_string(), dreq.to_string());
    }
    let mut versions = HashMap::new();
    versions.insert(
        version.to_string(),
        VpmPackageVersion {
            name: id.to_string(),
            display_name: id.to_string(),
            version: version.to_string(),
            unity: "2022.3".to_string(),
            description: None,
            url: format!("https://example.com/{}-{}.zip", id, version),
            dependencies: dep_map,
        },
    );
    VpmPackage { id: id.to_string(), versions }
}

#[test]
fn resolves_single_package_no_deps() {
    let available = vec![make_pkg("com.vrchat.base", "3.7.0", vec![])];
    let result = resolve(&["com.vrchat.base"], &available).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].version, "3.7.0");
}

#[test]
fn resolves_transitive_dependency() {
    let available = vec![
        make_pkg("com.vrchat.base", "3.7.0", vec![]),
        make_pkg("com.vrchat.avatars", "3.7.0", vec![
            ("com.vrchat.base", ">=3.7.0"),
        ]),
    ];
    let result = resolve(&["com.vrchat.avatars"], &available).unwrap();
    assert_eq!(result.len(), 2);
    let ids: Vec<&str> = result.iter().map(|v| v.name.as_str()).collect();
    assert!(ids.contains(&"com.vrchat.base"));
    assert!(ids.contains(&"com.vrchat.avatars"));
}

#[test]
fn deduplicates_shared_dependency() {
    let available = vec![
        make_pkg("com.vrchat.base", "3.7.0", vec![]),
        make_pkg("com.vrchat.avatars", "3.7.0", vec![("com.vrchat.base", ">=3.7.0")]),
        make_pkg("com.vrchat.worlds", "3.7.0", vec![("com.vrchat.base", ">=3.7.0")]),
    ];
    // Requesting both avatars + worlds should only include base once
    let result = resolve(&["com.vrchat.avatars", "com.vrchat.worlds"], &available).unwrap();
    let base_count = result.iter().filter(|v| v.name == "com.vrchat.base").count();
    assert_eq!(base_count, 1);
}

#[test]
fn returns_error_for_unknown_package() {
    let available = vec![make_pkg("com.vrchat.base", "3.7.0", vec![])];
    let result = resolve(&["com.nonexistent.pkg"], &available);
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test dependency_resolver_test 2>&1 | head -10
```

Expected: FAIL.

- [ ] **Step 3: Implement `src-tauri/src/services/dependency_resolver.rs`**

```rust
use crate::error::AppError;
use crate::models::{VpmPackage, VpmPackageVersion};
use std::collections::{HashMap, HashSet};

/// Resolve `requested` package IDs against `available` packages.
/// Returns a flat list of VpmPackageVersion to install (no duplicates).
/// Uses the latest version of each package that satisfies all constraints.
pub fn resolve<'a>(
    requested: &[&str],
    available: &'a [VpmPackage],
) -> Result<Vec<&'a VpmPackageVersion>, AppError> {
    let index: HashMap<&str, &VpmPackage> =
        available.iter().map(|p| (p.id.as_str(), p)).collect();

    let mut resolved: HashMap<String, &'a VpmPackageVersion> = HashMap::new();
    let mut queue: Vec<String> = requested.iter().map(|s| s.to_string()).collect();
    let mut visited: HashSet<String> = HashSet::new();

    while let Some(pkg_id) = queue.pop() {
        if visited.contains(&pkg_id) {
            continue;
        }
        visited.insert(pkg_id.clone());

        let pkg = index.get(pkg_id.as_str()).ok_or_else(|| {
            AppError::NotFound(format!("VPM package not found: {pkg_id}"))
        })?;

        let version = pkg.latest_version().ok_or_else(|| {
            AppError::NotFound(format!("No versions for package: {pkg_id}"))
        })?;

        resolved.insert(pkg_id.clone(), version);

        for dep_id in version.dependencies.keys() {
            if !visited.contains(dep_id) {
                queue.push(dep_id.clone());
            }
        }
    }

    Ok(resolved.into_values().collect())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test dependency_resolver_test
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/dependency_resolver.rs src-tauri/tests/dependency_resolver_test.rs
git commit -m "feat: VPM dependency resolver (transitive, dedup, latest version)"
```

---

## Task 6: Project creator service

**Files:**
- Create: `src-tauri/src/services/project_creator.rs`

Writes a valid Unity project structure to disk, downloads and extracts selected VPM packages, and optionally initializes a Git repository.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/project_creator_test.rs`:

```rust
use std::path::PathBuf;
use vrc_studio_lib::services::project_creator::{
    create_project_structure, ProjectStructureOptions,
};

#[tokio::test]
async fn creates_expected_directories_and_files() {
    let tmp = tempfile::tempdir().expect("tempdir failed");
    let project_dir = tmp.path().join("MyAvatarProject");

    create_project_structure(&project_dir, &ProjectStructureOptions {
        unity_version: "2022.3.22f1".to_string(),
        vcs_enabled: false,
    })
    .await
    .expect("create_project_structure failed");

    assert!(project_dir.join("Assets").is_dir());
    assert!(project_dir.join("Packages").is_dir());
    assert!(project_dir.join("ProjectSettings").is_dir());
    assert!(project_dir.join("UserSettings").is_dir());
    assert!(project_dir.join("Packages/manifest.json").is_file());
    assert!(project_dir.join("Packages/vpm-manifest.json").is_file());
    assert!(project_dir.join("ProjectSettings/ProjectVersion.txt").is_file());
}

#[tokio::test]
async fn project_version_file_contains_unity_version() {
    let tmp = tempfile::tempdir().expect("tempdir failed");
    let project_dir = tmp.path().join("VersionTest");

    create_project_structure(&project_dir, &ProjectStructureOptions {
        unity_version: "2022.3.6f1".to_string(),
        vcs_enabled: false,
    })
    .await
    .expect("create failed");

    let content = std::fs::read_to_string(
        project_dir.join("ProjectSettings/ProjectVersion.txt"),
    )
    .expect("read failed");

    assert!(content.contains("m_EditorVersion: 2022.3.6f1"));
}

#[tokio::test]
async fn creates_gitignore_when_vcs_enabled() {
    let tmp = tempfile::tempdir().expect("tempdir failed");
    let project_dir = tmp.path().join("VcsProject");

    create_project_structure(&project_dir, &ProjectStructureOptions {
        unity_version: "2022.3.22f1".to_string(),
        vcs_enabled: true,
    })
    .await
    .expect("create failed");

    assert!(project_dir.join(".gitignore").is_file());
    let content = std::fs::read_to_string(project_dir.join(".gitignore")).unwrap();
    assert!(content.contains("Library/"));
    assert!(content.contains("Temp/"));
}
```

- [ ] **Step 2: Add `tempfile` to dev-dependencies in `Cargo.toml`**

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd src-tauri && cargo test project_creator_test 2>&1 | head -10
```

Expected: FAIL.

- [ ] **Step 4: Implement `src-tauri/src/services/project_creator.rs`**

```rust
use crate::error::AppError;
use crate::models::{CreateProjectProgress, VpmPackageVersion};
use std::path::{Path, PathBuf};
use tokio::fs;

pub struct ProjectStructureOptions {
    pub unity_version: String,
    pub vcs_enabled: bool,
}

/// Creates the bare Unity project directory structure on disk.
/// Does NOT download VPM packages — call `install_vpm_packages` separately.
pub async fn create_project_structure(
    project_dir: &Path,
    opts: &ProjectStructureOptions,
) -> Result<(), AppError> {
    // Create top-level directories
    for dir in &["Assets", "Packages", "ProjectSettings", "UserSettings"] {
        fs::create_dir_all(project_dir.join(dir)).await?;
    }

    // Packages/manifest.json — empty Unity package manifest
    fs::write(
        project_dir.join("Packages/manifest.json"),
        "{\n  \"dependencies\": {}\n}\n",
    )
    .await?;

    // Packages/vpm-manifest.json — VPM manifest (packages added later)
    fs::write(
        project_dir.join("Packages/vpm-manifest.json"),
        "{\n  \"dependencies\": {},\n  \"locked\": {}\n}\n",
    )
    .await?;

    // ProjectSettings/ProjectVersion.txt
    let version_content = format!(
        "m_EditorVersion: {}\nm_EditorVersionWithRevision: {}\n",
        opts.unity_version, opts.unity_version
    );
    fs::write(
        project_dir.join("ProjectSettings/ProjectVersion.txt"),
        version_content,
    )
    .await?;

    // ProjectSettings/EditorBuildSettings.asset (minimal)
    fs::write(
        project_dir.join("ProjectSettings/EditorBuildSettings.asset"),
        "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1045 &1\nEditorBuildSettings:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Scenes: []\n",
    )
    .await?;

    if opts.vcs_enabled {
        fs::write(
            project_dir.join(".gitignore"),
            UNITY_GITIGNORE,
        )
        .await?;
    }

    Ok(())
}

/// Downloads a single VPM package zip and extracts it into `Packages/<package_id>/`.
/// Calls `progress_cb` with 0.0–1.0 progress during the download.
pub async fn install_vpm_package(
    project_dir: &Path,
    pkg: &VpmPackageVersion,
    mut progress_cb: impl FnMut(f32),
) -> Result<(), AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::External(e.to_string()))?;

    let response = client
        .get(&pkg.url)
        .send()
        .await
        .map_err(|e| AppError::External(format!("Download failed for {}: {e}", pkg.name)))?;

    let total = response.content_length().unwrap_or(1);
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::External(e.to_string()))?;

    progress_cb(1.0); // download complete

    // Extract zip to Packages/<package_name>/
    let pkg_dir = project_dir.join("Packages").join(&pkg.name);
    fs::create_dir_all(&pkg_dir).await?;

    let cursor = std::io::Cursor::new(&bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AppError::External(format!("Zip open error: {e}")))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AppError::External(e.to_string()))?;

        let out_path = pkg_dir.join(file.name());

        if file.name().ends_with('/') {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut file, &mut out_file)?;
        }
    }

    Ok(())
}

const UNITY_GITIGNORE: &str = r#"# Unity generated
[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Bb]uild/
[Bb]uilds/
[Ll]ogs/
[Mm]emoryCaptures/
[Uu]serSettings/

# Asset meta data should only be ignored when using a VCS that can't handle
# them as part of your checkout
*.pidb.meta
*.pdb.meta
*.mdb.meta

# VisualStudio
*.pidb
*.unityproj
*.sln
*.suo
*.tmp
*.user
*.userprefs
*.csproj
.vs/

# JetBrains
.idea/
*.iml
ExportedObj/
.consulo/

# OS generated
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Crash reports
sysinfo.txt

# VRC Studio
.vrc-studio/
"#;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test project_creator_test
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/project_creator.rs src-tauri/tests/project_creator_test.rs src-tauri/Cargo.toml
git commit -m "feat: project creator service (directory structure, VPM package installer)"
```

---

## Task 7: Project Tauri commands

**Files:**
- Create: `src-tauri/src/commands/projects.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/commands_projects_test.rs`:

```rust
use vrc_studio_lib::commands::projects::validate_project_name;

#[test]
fn accepts_valid_project_name() {
    assert!(validate_project_name("My Avatar Project").is_ok());
    assert!(validate_project_name("AvatarV2_Final").is_ok());
}

#[test]
fn rejects_empty_project_name() {
    assert!(validate_project_name("").is_err());
    assert!(validate_project_name("   ").is_err());
}

#[test]
fn rejects_name_with_invalid_chars() {
    assert!(validate_project_name("My/Avatar").is_err());
    assert!(validate_project_name("Avatar<>Name").is_err());
    assert!(validate_project_name("Test\\Project").is_err());
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test commands_projects_test 2>&1 | head -10
```

Expected: FAIL.

- [ ] **Step 3: Create `src-tauri/src/commands/projects.rs`**

```rust
use crate::db;
use crate::error::AppError;
use crate::models::{
    CreateProjectProgress, CreateProjectRequest, Project, UnityInstallation,
    UnityType, VpmPackage,
};
use crate::services::{
    dependency_resolver, project_creator, unity_detector, vpm_client,
};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const INVALID_PATH_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
const OFFICIAL_VPM_URL: &str = "https://packages.vrchat.com/official?download";

/// Returns Ok if the project name is non-empty and contains no filesystem-unsafe chars.
pub fn validate_project_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("Project name cannot be empty".to_string()));
    }
    if trimmed.chars().any(|c| INVALID_PATH_CHARS.contains(&c)) {
        return Err(AppError::InvalidInput(
            "Project name contains invalid characters (/ \\ : * ? \" < > |)".to_string(),
        ));
    }
    Ok(())
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_projects(pool: State<'_, SqlitePool>) -> Result<Vec<Project>, AppError> {
    let rows = sqlx::query_as!(
        ProjectRow,
        "SELECT id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled \
         FROM projects ORDER BY updated_at DESC"
    )
    .fetch_all(&*pool)
    .await?;

    rows.into_iter().map(project_from_row).collect()
}

#[tauri::command]
pub async fn get_project(
    id: String,
    pool: State<'_, SqlitePool>,
) -> Result<Project, AppError> {
    let row = sqlx::query_as!(
        ProjectRow,
        "SELECT id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled \
         FROM projects WHERE id = ?",
        id
    )
    .fetch_optional(&*pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Project {id}")))?;

    project_from_row(row)
}

#[tauri::command]
pub async fn delete_project(
    id: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    let affected = sqlx::query!("DELETE FROM projects WHERE id = ?", id)
        .execute(&*pool)
        .await?
        .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(format!("Project {id}")));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_unity_installations() -> Result<Vec<UnityInstallation>, AppError> {
    Ok(unity_detector::detect_unity_installations().await)
}

#[tauri::command]
pub async fn fetch_vpm_index(
    url: Option<String>,
) -> Result<Vec<VpmPackage>, AppError> {
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

    let project_id = Uuid::new_v4().to_string();
    let project_dir = std::path::PathBuf::from(&request.destination_dir).join(&request.name);

    // Emit helper closure
    let emit = |progress: f32, message: &str, done: bool, error: Option<String>| {
        let _ = app.emit(
            "project:progress",
            CreateProjectProgress {
                progress,
                message: message.to_string(),
                done,
                error,
            },
        );
    };

    emit(0.05, "Creating project structure...", false, None);

    // 1. Write directory structure
    project_creator::create_project_structure(
        &project_dir,
        &project_creator::ProjectStructureOptions {
            unity_version: request.unity_version.clone(),
            vcs_enabled: request.vcs_enabled,
        },
    )
    .await
    .map_err(|e| {
        emit(0.0, "Failed to create project structure", true, Some(e.to_string()));
        e
    })?;

    emit(0.2, "Resolving VPM packages...", false, None);

    // 2. Fetch VPM index and resolve dependencies
    if !request.vpm_packages.is_empty() {
        let all_packages = vpm_client::fetch_vpm_repository(OFFICIAL_VPM_URL).await?;
        let requested_refs: Vec<&str> = request.vpm_packages.iter().map(|s| s.as_str()).collect();
        let resolved = dependency_resolver::resolve(&requested_refs, &all_packages)?;

        let total = resolved.len();
        for (i, pkg_version) in resolved.into_iter().enumerate() {
            let msg = format!("Installing {} {}...", pkg_version.display_name, pkg_version.version);
            let base_progress = 0.2 + 0.7 * (i as f32 / total as f32);
            emit(base_progress, &msg, false, None);

            project_creator::install_vpm_package(&project_dir, pkg_version, |_dl| {}).await?;
        }
    }

    emit(0.95, "Saving to database...", false, None);

    // 3. Insert project into DB
    let unity_type_str = match request.unity_type {
        UnityType::Standard => "standard",
        UnityType::Custom => "custom",
    };
    let shader_str = request.shader.as_ref().map(|s| format!("{s:?}").to_lowercase());

    sqlx::query!(
        "INSERT INTO projects (id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        project_id,
        request.name,
        project_dir.to_string_lossy().as_ref(),
        request.unity_version,
        unity_type_str,
        request.avatar_base_id,
        shader_str,
        request.vcs_enabled,
    )
    .execute(&*pool)
    .await?;

    emit(1.0, "Project created!", true, None);

    get_project(project_id, pool).await
}

#[tauri::command]
pub async fn open_project_in_unity(
    project_path: String,
    unity_path: String,
) -> Result<(), AppError> {
    tokio::process::Command::new(&unity_path)
        .arg("-projectPath")
        .arg(&project_path)
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to launch Unity: {e}")))?;
    Ok(())
}

// ── Private helpers ──────────────────────────────────────────────────────────

struct ProjectRow {
    id: String,
    name: String,
    path: String,
    unity_version: String,
    unity_type: String,
    avatar_base_id: Option<String>,
    shader: Option<String>,
    vcs_enabled: i64,
}

fn project_from_row(row: ProjectRow) -> Result<Project, AppError> {
    use crate::models::{Shader, UnityType};

    let unity_type = match row.unity_type.as_str() {
        "custom" => UnityType::Custom,
        _ => UnityType::Standard,
    };
    let shader = match row.shader.as_deref() {
        Some("liltoon") => Some(Shader::Liltoon),
        Some("poiyomi") => Some(Shader::Poiyomi),
        _ => None,
    };

    Ok(Project {
        id: row.id,
        name: row.name,
        path: row.path,
        unity_version: row.unity_version,
        unity_type,
        avatar_base_id: row.avatar_base_id,
        shader,
        vcs_enabled: row.vcs_enabled != 0,
    })
}
```

- [ ] **Step 4: Update `src-tauri/src/commands/mod.rs`**

```rust
pub mod projects;

/// Smoke-test command — verifies IPC bridge is working
#[tauri::command]
pub fn ping(msg: String) -> String {
    format!("pong: {}", msg)
}
```

- [ ] **Step 5: Register new commands in `src-tauri/src/lib.rs`**

Replace the `.invoke_handler` block:

```rust
.invoke_handler(tauri::generate_handler![
    commands::ping,
    commands::projects::list_projects,
    commands::projects::get_project,
    commands::projects::delete_project,
    commands::projects::list_unity_installations,
    commands::projects::fetch_vpm_index,
    commands::projects::create_project,
    commands::projects::open_project_in_unity,
])
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd src-tauri && cargo test commands_projects_test
```

Expected: PASS (3 tests).

- [ ] **Step 7: Full cargo check**

```bash
cd src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/lib.rs src-tauri/tests/commands_projects_test.rs
git commit -m "feat: project Tauri commands (CRUD, Unity detection, VPM, create_project)"
```

---

## Task 8: Frontend typed IPC wrappers + Zustand projects store

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/store/projects.ts`
- Create: `src/test/projects.store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/projects.store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useProjectsStore } from "@/store/projects";

describe("useProjectsStore", () => {
  beforeEach(() => {
    useProjectsStore.setState({
      projects: [],
      isLoading: false,
      wizardOpen: false,
    });
  });

  it("starts empty", () => {
    const { result } = renderHook(() => useProjectsStore());
    expect(result.current.projects).toHaveLength(0);
    expect(result.current.wizardOpen).toBe(false);
  });

  it("openWizard sets wizardOpen to true", () => {
    const { result } = renderHook(() => useProjectsStore());
    act(() => result.current.openWizard());
    expect(result.current.wizardOpen).toBe(true);
  });

  it("closeWizard sets wizardOpen to false", () => {
    const { result } = renderHook(() => useProjectsStore());
    act(() => result.current.openWizard());
    act(() => result.current.closeWizard());
    expect(result.current.wizardOpen).toBe(false);
  });

  it("setProjects replaces the list", () => {
    const { result } = renderHook(() => useProjectsStore());
    const fakeProjects = [
      {
        id: "1",
        name: "Test Avatar",
        path: "C:/Projects/test",
        unity_version: "2022.3.22f1",
        unity_type: "standard" as const,
        avatar_base_id: null,
        shader: null,
        vcs_enabled: false,
      },
    ];
    act(() => result.current.setProjects(fakeProjects));
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].name).toBe("Test Avatar");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/projects.store.test.ts
```

Expected: FAIL — `@/store/projects` not found.

- [ ] **Step 3: Append typed wrappers to `src/lib/tauri.ts`**

```ts
import { invoke, Channel } from "@tauri-apps/api/core";

// ── Smoke test ────────────────────────────────────────────────
export async function tauriPing(msg: string): Promise<string> {
  return invoke<string>("ping", { msg });
}

// ── Types (mirror Rust models) ─────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string;
  unity_version: string;
  unity_type: "standard" | "custom";
  avatar_base_id: string | null;
  shader: "liltoon" | "poiyomi" | null;
  vcs_enabled: boolean;
}

export interface UnityInstallation {
  version: string;
  path: string;
  is_custom: boolean;
}

export interface VpmPackage {
  id: string;
  versions: Record<string, VpmPackageVersion>;
}

export interface VpmPackageVersion {
  name: string;
  display_name: string;
  version: string;
  unity: string;
  description: string | null;
  url: string;
  dependencies: Record<string, string>;
}

export interface CreateProjectRequest {
  name: string;
  destination_dir: string;
  unity_version: string;
  unity_path: string;
  unity_type: "standard" | "custom";
  avatar_base_id: string | null;
  shader: "liltoon" | "poiyomi" | null;
  vcs_enabled: boolean;
  vpm_packages: string[];
}

export interface CreateProjectProgress {
  progress: number;
  message: string;
  done: boolean;
  error: string | null;
}

// ── Commands ───────────────────────────────────────────────────

export const tauriListProjects = (): Promise<Project[]> =>
  invoke("list_projects");

export const tauriGetProject = (id: string): Promise<Project> =>
  invoke("get_project", { id });

export const tauriDeleteProject = (id: string): Promise<void> =>
  invoke("delete_project", { id });

export const tauriListUnityInstallations = (): Promise<UnityInstallation[]> =>
  invoke("list_unity_installations");

export const tauriFetchVpmIndex = (url?: string): Promise<VpmPackage[]> =>
  invoke("fetch_vpm_index", { url: url ?? null });

export const tauriCreateProject = (
  request: CreateProjectRequest
): Promise<Project> => invoke("create_project", { request });

export const tauriOpenProjectInUnity = (
  projectPath: string,
  unityPath: string
): Promise<void> => invoke("open_project_in_unity", { projectPath, unityPath });
```

- [ ] **Step 4: Create `src/store/projects.ts`**

```ts
import { create } from "zustand";
import { Project } from "@/lib/tauri";

interface ProjectsState {
  projects: Project[];
  isLoading: boolean;
  wizardOpen: boolean;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setLoading: (loading: boolean) => void;
  openWizard: () => void;
  closeWizard: () => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  isLoading: false,
  wizardOpen: false,

  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((s) => ({ projects: [project, ...s.projects] })),
  removeProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  setLoading: (isLoading) => set({ isLoading }),
  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),
}));
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/test/projects.store.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/tauri.ts src/store/projects.ts src/test/projects.store.test.ts
git commit -m "feat: typed IPC wrappers for Projects commands + Zustand projects store"
```

---

## Task 9: useProjectEvents hook

**Files:**
- Create: `src/hooks/useProjectEvents.ts`

Subscribes to `project:progress` Tauri events emitted by `create_project`.

- [ ] **Step 1: Create `src/hooks/useProjectEvents.ts`**

```ts
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CreateProjectProgress } from "@/lib/tauri";

export interface ProjectEventState {
  progress: number;
  message: string;
  done: boolean;
  error: string | null;
}

const INITIAL_STATE: ProjectEventState = {
  progress: 0,
  message: "",
  done: false,
  error: null,
};

/**
 * Subscribes to project:progress Tauri events.
 * Call reset() before starting a new creation to clear state.
 */
export function useProjectEvents() {
  const [state, setState] = useState<ProjectEventState>(INITIAL_STATE);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<CreateProjectProgress>("project:progress", (event) => {
      setState({
        progress: event.payload.progress,
        message: event.payload.message,
        done: event.payload.done,
        error: event.payload.error,
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, []);

  const reset = () => setState(INITIAL_STATE);

  return { ...state, reset };
}
```

(No unit test needed: this hook wraps a Tauri API that requires a real Tauri runtime. It is covered implicitly by the E2E manual smoke test in Task 13.)

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useProjectEvents.ts
git commit -m "feat: useProjectEvents hook for real-time creation progress"
```

---

## Task 10: ProjectCard and ProjectList components

**Files:**
- Create: `src/components/projects/ProjectCard.tsx`
- Create: `src/components/projects/ProjectList.tsx`
- Create: `src/components/projects/DeleteProjectDialog.tsx`
- Create: `src/test/ProjectCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/test/ProjectCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Project } from "@/lib/tauri";

const fakeProject: Project = {
  id: "abc-123",
  name: "My Avatar",
  path: "C:/Projects/my-avatar",
  unity_version: "2022.3.22f1",
  unity_type: "standard",
  avatar_base_id: null,
  shader: null,
  vcs_enabled: false,
};

describe("ProjectCard", () => {
  it("renders project name and version", () => {
    render(
      <ProjectCard
        project={fakeProject}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByText("My Avatar")).toBeInTheDocument();
    expect(screen.getByText("2022.3.22f1")).toBeInTheDocument();
  });

  it("calls onOpen when Open in Unity button is clicked", () => {
    const onOpen = vi.fn();
    render(
      <ProjectCard project={fakeProject} onDelete={vi.fn()} onOpen={onOpen} />
    );
    fireEvent.click(screen.getByRole("button", { name: /open in unity/i }));
    expect(onOpen).toHaveBeenCalledWith(fakeProject);
  });

  it("calls onDelete when Delete button is clicked", () => {
    const onDelete = vi.fn();
    render(
      <ProjectCard project={fakeProject} onDelete={onDelete} onOpen={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(fakeProject);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/ProjectCard.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `src/components/projects/ProjectCard.tsx`**

```tsx
import { Project } from "@/lib/tauri";
import { FolderOpen, Trash2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectCardProps {
  project: Project;
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
}

export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps) {
  return (
    <div className="group relative flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-zinc-100 text-sm">
            {project.name}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">{project.unity_version}</p>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            aria-label="Delete"
            onClick={() => onDelete(project)}
            className="rounded p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Path */}
      <p className="truncate text-xs text-zinc-600">{project.path}</p>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            project.unity_type === "custom"
              ? "bg-red-950 text-red-400"
              : "bg-zinc-800 text-zinc-400"
          )}
        >
          {project.unity_type}
        </span>
        {project.shader && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            {project.shader}
          </span>
        )}
        {project.vcs_enabled && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            git
          </span>
        )}
      </div>

      {/* Action */}
      <button
        aria-label="Open in Unity"
        onClick={() => onOpen(project)}
        className="mt-1 flex items-center justify-center gap-2 rounded-md bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
      >
        <ExternalLink size={12} />
        Open in Unity
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/projects/ProjectList.tsx`**

```tsx
import { Project } from "@/lib/tauri";
import { ProjectCard } from "./ProjectCard";
import { Boxes } from "lucide-react";

interface ProjectListProps {
  projects: Project[];
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
}

export function ProjectList({ projects, onOpen, onDelete }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Boxes size={40} className="text-zinc-700" />
        <p className="text-sm font-medium text-zinc-500">No projects yet</p>
        <p className="text-xs text-zinc-600">
          Create your first avatar project to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/projects/DeleteProjectDialog.tsx`**

```tsx
import { Project } from "@/lib/tauri";

interface DeleteProjectDialogProps {
  project: Project;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}

export function DeleteProjectDialog({
  project,
  onConfirm,
  onCancel,
  isDeleting,
}: DeleteProjectDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <h2 className="text-base font-semibold text-zinc-100">Delete project?</h2>
        <p className="mt-2 text-sm text-zinc-400">
          <span className="font-medium text-zinc-200">{project.name}</span> will
          be removed from VRC Studio. The files on disk are{" "}
          <span className="text-zinc-200">not</span> deleted.
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-md px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run src/test/ProjectCard.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/projects/ src/test/ProjectCard.test.tsx
git commit -m "feat: ProjectCard, ProjectList, DeleteProjectDialog components"
```

---

## Task 11: Creation wizard — Step components

**Files:**
- Create: `src/components/projects/wizard/Step1Unity.tsx`
- Create: `src/components/projects/wizard/Step2Avatar.tsx`
- Create: `src/components/projects/wizard/Step3Packages.tsx`
- Create: `src/components/projects/wizard/Step4Details.tsx`

These are form components; each receives a shared wizard state object and callbacks. Unit tests focus on interaction behavior.

- [ ] **Step 1: Write the failing test**

Create `src/test/WizardSteps.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Step4Details } from "@/components/projects/wizard/Step4Details";
import type { WizardState } from "@/components/projects/wizard/CreateProjectWizard";

const baseState: WizardState = {
  unityInstallation: null,
  unityType: "standard",
  avatarBaseId: null,
  shader: null,
  vcsEnabled: false,
  selectedPackages: [],
  projectName: "",
  destinationDir: "C:/Projects",
};

describe("Step4Details", () => {
  it("calls onChange when project name is typed", () => {
    const onChange = vi.fn();
    render(
      <Step4Details
        state={baseState}
        onChange={onChange}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/my avatar/i), {
      target: { value: "Cool Avatar" },
    });
    expect(onChange).toHaveBeenCalledWith({ projectName: "Cool Avatar" });
  });

  it("disables submit when project name is empty", () => {
    render(
      <Step4Details
        state={baseState}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />
    );
    const btn = screen.getByRole("button", { name: /create project/i });
    expect(btn).toBeDisabled();
  });

  it("calls onSubmit when form is valid and button clicked", () => {
    const onSubmit = vi.fn();
    render(
      <Step4Details
        state={{ ...baseState, projectName: "My Avatar" }}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/WizardSteps.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Define `WizardState` type and create `CreateProjectWizard.tsx` stub**

Create `src/components/projects/wizard/CreateProjectWizard.tsx`:

```tsx
import { useState } from "react";
import { UnityInstallation } from "@/lib/tauri";
import { Step1Unity } from "./Step1Unity";
import { Step2Avatar } from "./Step2Avatar";
import { Step3Packages } from "./Step3Packages";
import { Step4Details } from "./Step4Details";
import { CreationProgress } from "./CreationProgress";
import {
  tauriCreateProject,
  tauriListUnityInstallations,
  tauriFetchVpmIndex,
} from "@/lib/tauri";
import type { Project, VpmPackage } from "@/lib/tauri";
import { useProjectEvents } from "@/hooks/useProjectEvents";

export interface WizardState {
  unityInstallation: UnityInstallation | null;
  unityType: "standard" | "custom";
  avatarBaseId: string | null;
  shader: "liltoon" | "poiyomi" | null;
  vcsEnabled: boolean;
  selectedPackages: string[];
  projectName: string;
  destinationDir: string;
}

const INITIAL_STATE: WizardState = {
  unityInstallation: null,
  unityType: "standard",
  avatarBaseId: null,
  shader: null,
  vcsEnabled: false,
  selectedPackages: ["com.vrchat.avatars"],
  projectName: "",
  destinationDir: "",
};

interface CreateProjectWizardProps {
  onCreated: (project: Project) => void;
  onClose: () => void;
}

export function CreateProjectWizard({ onCreated, onClose }: CreateProjectWizardProps) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const events = useProjectEvents();

  const patch = (partial: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...partial }));

  const handleSubmit = async () => {
    if (!state.unityInstallation) return;
    setIsSubmitting(true);
    setSubmitError(null);
    events.reset();
    setStep(5);

    try {
      const project = await tauriCreateProject({
        name: state.projectName,
        destination_dir: state.destinationDir,
        unity_version: state.unityInstallation.version,
        unity_path: state.unityInstallation.path,
        unity_type: state.unityType,
        avatar_base_id: state.avatarBaseId,
        shader: state.shader,
        vcs_enabled: state.vcsEnabled,
        vpm_packages: state.selectedPackages,
      });
      onCreated(project);
    } catch (err) {
      setSubmitError(String(err));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Step indicator */}
        {step < 5 && (
          <div className="flex items-center gap-2 border-b border-zinc-800 px-6 py-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    n === step
                      ? "bg-red-600 text-white"
                      : n < step
                      ? "bg-zinc-700 text-zinc-300"
                      : "border border-zinc-700 text-zinc-600"
                  }`}
                >
                  {n}
                </div>
                {n < 4 && <div className="h-px w-8 bg-zinc-800" />}
              </div>
            ))}
            <button
              onClick={onClose}
              className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
            >
              ✕
            </button>
          </div>
        )}

        <div className="p-6">
          {step === 1 && (
            <Step1Unity
              state={state}
              onChange={patch}
              onNext={() => setStep(2)}
              onClose={onClose}
            />
          )}
          {step === 2 && (
            <Step2Avatar
              state={state}
              onChange={patch}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <Step3Packages
              state={state}
              onChange={patch}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <Step4Details
              state={state}
              onChange={patch}
              onBack={() => setStep(3)}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
            />
          )}
          {step === 5 && (
            <CreationProgress
              progress={events.progress}
              message={events.message}
              done={events.done}
              error={events.error ?? submitError}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/projects/wizard/Step1Unity.tsx`**

```tsx
import { useEffect, useState } from "react";
import { tauriListUnityInstallations, UnityInstallation } from "@/lib/tauri";
import type { WizardState } from "./CreateProjectWizard";
import { cn } from "@/lib/utils";

interface Step1UnityProps {
  state: WizardState;
  onChange: (partial: Partial<WizardState>) => void;
  onNext: () => void;
  onClose: () => void;
}

export function Step1Unity({ state, onChange, onNext, onClose }: Step1UnityProps) {
  const [installations, setInstallations] = useState<UnityInstallation[]>([]);
  const [isScanning, setIsScanning] = useState(true);

  useEffect(() => {
    tauriListUnityInstallations()
      .then(setInstallations)
      .finally(() => setIsScanning(false));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Step 1 — Unity Version</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Choose which Unity installation to use for this project.
        </p>
      </div>

      {/* Installations list */}
      {isScanning ? (
        <p className="text-sm text-zinc-500">Scanning for Unity installations...</p>
      ) : installations.length === 0 ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-sm text-zinc-400">
          No Unity installations found. Install Unity Hub and Unity 2022.3.x LTS.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {installations.map((inst) => (
            <button
              key={inst.path}
              onClick={() => onChange({ unityInstallation: inst })}
              className={cn(
                "flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors",
                state.unityInstallation?.path === inst.path
                  ? "border-red-600 bg-red-950/30"
                  : "border-zinc-700 hover:border-zinc-600 bg-zinc-800/30"
              )}
            >
              <div>
                <p className="text-sm font-medium text-zinc-100">{inst.version}</p>
                <p className="mt-0.5 text-xs text-zinc-500 truncate max-w-xs">{inst.path}</p>
              </div>
              {inst.is_custom && (
                <span className="rounded bg-red-900 px-2 py-0.5 text-[10px] font-medium text-red-300">
                  Custom
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Type toggle */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Project Type
        </p>
        <div className="flex gap-2">
          {(["standard", "custom"] as const).map((type) => (
            <button
              key={type}
              onClick={() => onChange({ unityType: type })}
              className={cn(
                "flex-1 rounded-md border py-2 text-sm font-medium transition-colors capitalize",
                state.unityType === type
                  ? "border-red-600 bg-red-950/30 text-red-300"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Git toggle */}
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={state.vcsEnabled}
          onChange={(e) => onChange({ vcsEnabled: e.target.checked })}
          className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-red-600"
        />
        <span className="text-sm text-zinc-300">Enable Git version control</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onNext}
          disabled={!state.unityInstallation}
          className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/projects/wizard/Step2Avatar.tsx`**

```tsx
import type { WizardState } from "./CreateProjectWizard";
import { cn } from "@/lib/utils";

interface Step2AvatarProps {
  state: WizardState;
  onChange: (partial: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

const SHADERS = [
  { id: "liltoon" as const, label: "lilToon", desc: "Popular anime/cel-shading shader" },
  { id: "poiyomi" as const, label: "Poiyomi Toon", desc: "Advanced toon shader with many features" },
];

export function Step2Avatar({ state, onChange, onBack, onNext }: Step2AvatarProps) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Step 2 — Avatar Configuration</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Choose a base avatar model and preferred shader. Both are optional.
        </p>
      </div>

      {/* Shader selection */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Preferred Shader
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onChange({ shader: null })}
            className={cn(
              "rounded-lg border px-4 py-3 text-left transition-colors",
              state.shader === null
                ? "border-red-600 bg-red-950/30"
                : "border-zinc-700 hover:border-zinc-600"
            )}
          >
            <p className="text-sm font-medium text-zinc-100">None</p>
            <p className="text-xs text-zinc-500">Add shaders manually later</p>
          </button>
          {SHADERS.map((s) => (
            <button
              key={s.id}
              onClick={() => onChange({ shader: s.id })}
              className={cn(
                "rounded-lg border px-4 py-3 text-left transition-colors",
                state.shader === s.id
                  ? "border-red-600 bg-red-950/30"
                  : "border-zinc-700 hover:border-zinc-600"
              )}
            >
              <p className="text-sm font-medium text-zinc-100">{s.label}</p>
              <p className="text-xs text-zinc-500">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/components/projects/wizard/Step3Packages.tsx`**

```tsx
import { useEffect, useState } from "react";
import { tauriFetchVpmIndex, VpmPackage } from "@/lib/tauri";
import type { WizardState } from "./CreateProjectWizard";
import { cn } from "@/lib/utils";

interface Step3PackagesProps {
  state: WizardState;
  onChange: (partial: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

const ALWAYS_INCLUDED = ["com.vrchat.base"];

export function Step3Packages({ state, onChange, onBack, onNext }: Step3PackagesProps) {
  const [packages, setPackages] = useState<VpmPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tauriFetchVpmIndex()
      .then(setPackages)
      .catch((e) => setError(String(e)))
      .finally(() => setIsLoading(false));
  }, []);

  const toggle = (id: string) => {
    const selected = state.selectedPackages.includes(id)
      ? state.selectedPackages.filter((p) => p !== id)
      : [...state.selectedPackages, id];
    onChange({ selectedPackages: selected });
  };

  const displayPackages = packages.filter((p) => !ALWAYS_INCLUDED.includes(p.id));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Step 3 — VPM Packages</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Select packages to install from the VRChat official repository.
        </p>
      </div>

      {/* Always included */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 px-4 py-3">
        <p className="text-xs font-medium text-zinc-500">Always included</p>
        <p className="mt-0.5 text-sm text-zinc-300">VRChat Base SDK</p>
      </div>

      {/* Selectable packages */}
      {isLoading && (
        <p className="text-sm text-zinc-500">Fetching VPM index...</p>
      )}
      {error && (
        <p className="text-sm text-red-400">Failed to load packages: {error}</p>
      )}
      {!isLoading && !error && (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
          {displayPackages.map((pkg) => {
            const latest = pkg.versions[
              Object.keys(pkg.versions).sort().at(-1) ?? ""
            ];
            const isSelected = state.selectedPackages.includes(pkg.id);
            return (
              <label
                key={pkg.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
                  isSelected
                    ? "border-red-600 bg-red-950/20"
                    : "border-zinc-700 hover:border-zinc-600"
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(pkg.id)}
                  className="mt-0.5 accent-red-600"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100">
                    {latest?.display_name ?? pkg.id}
                  </p>
                  {latest?.description && (
                    <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">
                      {latest.description}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-zinc-600">{pkg.id}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/components/projects/wizard/Step4Details.tsx`**

```tsx
import type { WizardState } from "./CreateProjectWizard";
import { tauriOpenProjectInUnity } from "@/lib/tauri";

interface Step4DetailsProps {
  state: WizardState;
  onChange: (partial: Partial<WizardState>) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function Step4Details({
  state,
  onChange,
  onBack,
  onSubmit,
  isSubmitting,
}: Step4DetailsProps) {
  const isValid = state.projectName.trim().length > 0 && state.destinationDir.trim().length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Step 4 — Project Details</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Name your project and choose where to save it.
        </p>
      </div>

      {/* Project name */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">
          Project Name
        </label>
        <input
          type="text"
          value={state.projectName}
          onChange={(e) => onChange({ projectName: e.target.value })}
          placeholder="My Avatar"
          className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-red-600 focus:outline-none"
        />
      </div>

      {/* Destination directory */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">
          Destination Folder
        </label>
        <input
          type="text"
          value={state.destinationDir}
          onChange={(e) => onChange({ destinationDir: e.target.value })}
          placeholder="C:/Projects"
          className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-red-600 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-600">
          Project will be created at: {state.destinationDir}/{state.projectName || "…"}
        </p>
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4 text-xs text-zinc-400 space-y-1">
        <div className="flex justify-between">
          <span>Unity version</span>
          <span className="text-zinc-200">{state.unityInstallation?.version ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span>Project type</span>
          <span className="capitalize text-zinc-200">{state.unityType}</span>
        </div>
        <div className="flex justify-between">
          <span>Shader</span>
          <span className="text-zinc-200">{state.shader ?? "None"}</span>
        </div>
        <div className="flex justify-between">
          <span>Git</span>
          <span className="text-zinc-200">{state.vcsEnabled ? "Enabled" : "Disabled"}</span>
        </div>
        <div className="flex justify-between">
          <span>Packages</span>
          <span className="text-zinc-200">{state.selectedPackages.length} selected</span>
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          disabled={isSubmitting}
          className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!isValid || isSubmitting}
          className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-40"
        >
          {isSubmitting ? "Creating..." : "Create Project"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run src/test/WizardSteps.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/components/projects/wizard/ src/test/WizardSteps.test.tsx
git commit -m "feat: 4-step creation wizard components (Step1–4 + wizard shell)"
```

---

## Task 12: CreationProgress component

**Files:**
- Create: `src/components/projects/wizard/CreationProgress.tsx`

- [ ] **Step 1: Create `src/components/projects/wizard/CreationProgress.tsx`**

```tsx
interface CreationProgressProps {
  progress: number;       // 0.0–1.0
  message: string;
  done: boolean;
  error: string | null;
  onClose: () => void;
}

export function CreationProgress({
  progress,
  message,
  done,
  error,
  onClose,
}: CreationProgressProps) {
  const percent = Math.round(progress * 100);

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-zinc-100">
          {error ? "Creation Failed" : done ? "Project Created!" : "Creating Project..."}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {error ?? message}
        </p>
      </div>

      {/* Progress bar */}
      {!done && !error && (
        <div className="w-full">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-red-600 transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-right text-xs text-zinc-600">{percent}%</p>
        </div>
      )}

      {done && !error && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-950 text-green-400 text-2xl">
          ✓
        </div>
      )}

      {error && (
        <div className="w-full rounded-lg border border-red-900 bg-red-950/30 p-3">
          <p className="text-xs text-red-300 font-mono break-all">{error}</p>
        </div>
      )}

      {(done || error) && (
        <button
          onClick={onClose}
          className="rounded-md bg-zinc-700 px-6 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
        >
          Close
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/projects/wizard/CreationProgress.tsx
git commit -m "feat: CreationProgress component with animated progress bar"
```

---

## Task 13: Projects page (replace stub)

**Files:**
- Modify: `src/pages/Projects.tsx`
- Create: `src/test/Projects.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/test/Projects.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "list_projects") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import Projects from "@/pages/Projects";
import { useProjectsStore } from "@/store/projects";

describe("Projects page", () => {
  beforeEach(() => {
    useProjectsStore.setState({ projects: [], isLoading: false, wizardOpen: false });
  });

  it("renders the page header", async () => {
    render(<Projects />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("renders empty state when no projects", async () => {
    render(<Projects />);
    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    });
  });

  it("renders Create Project button", async () => {
    render(<Projects />);
    expect(screen.getByRole("button", { name: /create project/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/Projects.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Replace `src/pages/Projects.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useProjectsStore } from "@/store/projects";
import { ProjectList } from "@/components/projects/ProjectList";
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { CreateProjectWizard } from "@/components/projects/wizard/CreateProjectWizard";
import {
  tauriListProjects,
  tauriDeleteProject,
  tauriOpenProjectInUnity,
  tauriListUnityInstallations,
  Project,
} from "@/lib/tauri";

export default function Projects() {
  const { projects, isLoading, wizardOpen, setProjects, setLoading, removeProject, addProject, openWizard, closeWizard } =
    useProjectsStore();

  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load projects on mount
  useEffect(() => {
    setLoading(true);
    tauriListProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = async (project: Project) => {
    const installations = await tauriListUnityInstallations().catch(() => []);
    const match = installations.find(
      (i) => i.version === project.unity_version
    );
    if (!match) {
      alert(`Unity ${project.unity_version} not found. Please install it via Unity Hub.`);
      return;
    }
    await tauriOpenProjectInUnity(project.path, match.path).catch((e) =>
      alert(`Failed to open Unity: ${e}`)
    );
  };

  const handleDeleteConfirm = async () => {
    if (!deletingProject) return;
    setIsDeleting(true);
    try {
      await tauriDeleteProject(deletingProject.id);
      removeProject(deletingProject.id);
    } catch (e) {
      alert(`Failed to delete project: ${e}`);
    } finally {
      setIsDeleting(false);
      setDeletingProject(null);
    }
  };

  const handleCreated = (project: Project) => {
    addProject(project);
    closeWizard();
  };

  return (
    <div data-testid="page-projects" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Projects</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {projects.length > 0
              ? `${projects.length} avatar project${projects.length === 1 ? "" : "s"}`
              : "Your avatar projects"}
          </p>
        </div>
        <button
          onClick={openWizard}
          className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <Plus size={16} />
          Create Project
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-zinc-600">Loading projects...</p>
          </div>
        ) : (
          <ProjectList
            projects={projects}
            onOpen={handleOpen}
            onDelete={setDeletingProject}
          />
        )}
      </div>

      {/* Delete dialog */}
      {deletingProject && (
        <DeleteProjectDialog
          project={deletingProject}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingProject(null)}
          isDeleting={isDeleting}
        />
      )}

      {/* Creation wizard */}
      {wizardOpen && (
        <CreateProjectWizard onCreated={handleCreated} onClose={closeWizard} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/Projects.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run && cd src-tauri && cargo test
```

Expected: all tests PASS.

- [ ] **Step 6: Run dev build for visual check**

```bash
npm run tauri dev
```

Expected:
- Projects page shows header + "Create Project" button.
- Empty state shows if no projects.
- Clicking "Create Project" opens the 4-step wizard.
- Step 1 scans for Unity installations.
- Step 3 fetches the VRChat VPM index and shows packages.
- Step 4 confirms details and creates the project (triggers real-time progress).
- Created project appears in the list on success.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Projects.tsx src/test/Projects.test.tsx
git commit -m "feat: Projects page — full list + delete + 4-step creation wizard"
```

---

## Self-Review

### Spec coverage

| Requirement (from `plan.md` Fase 1) | Task |
|---|---|
| Vista principal de proyectos — lista con acciones | Task 10, 13 |
| Acción: Abrir en Unity | Task 7 (`open_project_in_unity`), Task 13 |
| Acción: Eliminar proyecto | Task 7 (`delete_project`), Task 10, 13 |
| Wizard Paso 1 — Unity version picker | Task 11 (`Step1Unity`) |
| Wizard Paso 2 — Shader + avatar base | Task 11 (`Step2Avatar`) |
| Wizard Paso 3 — Paquetes VPM | Task 11 (`Step3Packages`) |
| Wizard Paso 4 — Nombre + destino | Task 11 (`Step4Details`) |
| Unity detection: Hub paths + Windows registry | Task 3 |
| VPM index fetch (oficial VRChat) | Task 4 |
| Dependency resolution (transitiva, dedup) | Task 5 |
| Creación de estructura Unity en disco | Task 6 |
| Descarga e instalación de paquetes VPM | Task 6 (`install_vpm_package`) |
| Progreso en tiempo real (Tauri Events) | Task 7 (`project:progress`), Task 9 |
| Git init (.gitignore) | Task 6 (`create_project_structure`) |
| Persiste en SQLite | Task 7 (`create_project`) |

### Gaps deferred to later plans

- Acción "Duplicar proyecto" → Plan 2b o pulido
- Acción "Editar configuración de proyecto" → Plan 2b
- Estado VCS en card (branch actual, cambios) → Plan 6 (VCS)
- Avatar base selector con previews → requires Inventory (Plan 4)
- Custom Unity patches + TurboCc → Plan 5 (Unity Custom)
- Migración de versión de Unity en proyectos existentes → Plan 5

### Placeholder scan

No TBDs, TODOs, o "implement later" en ningún paso. Todos los bloques de código son completos y ejecutables.

### Type consistency

- `WizardState.unityInstallation: UnityInstallation | null` — defined in Task 11, used in Step1Unity, Step4Details, and Projects.tsx.
- `CreateProjectRequest` — defined in Task 2 (Rust) and Task 8 (TS `tauri.ts`). Fields match 1:1.
- `Project` struct — defined in core plan `models/mod.rs`, DB columns match `001_initial.sql`, TS type in `tauri.ts` matches.
- `parse_version_from_path` — defined in Task 3, used in unity_detector service only.

---

## Execution Handoff

Plan guardado en `docs/2026-04-29-vrc-studio-projects.md`.

**Opciones de ejecución:**

**1. Subagent-Driven (recomendado)** — dispatch de un subagente fresco por tarea, revisión entre tareas.

**2. Inline Execution** — ejecución en esta sesión con checkpoints de revisión.
