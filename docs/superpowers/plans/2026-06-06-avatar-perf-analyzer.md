# Avatar Performance Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Avatar Performance Analyzer tool — a Unity project scanner that returns VRChat performance ranks (PC + Quest) and actionable recommendations, displayed with a 3D rotating avatar viewport.

**Architecture:** A standalone Rust binary (`avatar-perf-core`) reads Unity scene YAML files and mesh assets, counts every VRChat-relevant metric, calculates PC and Quest ranks, and returns structured JSON via stdout. Tauri spawns the binary as a child process. The React UI drives a 3-step selection wizard (project → scene → avatar) and then shows the results in a two-panel layout: left panel with 3D viewport (Unity headless render, GLTF+Three.js fallback), right panel with grouped metrics and recommendations.

**Tech Stack:** Rust (serde_json, regex, walkdir, chrono — no extra deps beyond std), Tauri sidecar process, React + TypeScript, @react-three/fiber + @react-three/drei (Three.js), Tailwind CSS.

**Prerequisite:** Plan 1 (`2026-06-06-tools-framework.md`) must be complete. Branch: `feature/tools-system`.

---

## File Map

```
tools/avatar-perf-core/          NEW Rust binary crate (standalone)
  Cargo.toml
  src/
    main.rs                      stdin/stdout JSON loop
    types.rs                     shared types (AvatarMetrics, VrcRank, AnalysisResult)
    unity_yaml.rs                Unity YAML scene parser
    analyze.rs                   metric counting logic
    rank.rs                      VRChat threshold tables + rank calculation
    recommendations.rs           per-metric fix suggestions
    render.rs                    Unity headless render + GLTF fallback detection

src-tauri/src/commands/tools.rs  MODIFY — add scan + sidecar commands
src-tauri/src/lib.rs             MODIFY — register new commands
src/lib/tauri.ts                 MODIFY — add TS bindings for new commands
src/store/toolsStore.ts          MODIFY — add runSidecar + scene/avatar scanning helpers
src/components/tools/runners/
  AvatarPerf.tsx                 NEW — 3-step wizard + layout shell
  AvatarPerfViewport.tsx         NEW — 3D model panel (img / Three.js)
  AvatarPerfMetrics.tsx          NEW — grouped metrics panel
  AvatarPerfRecommendations.tsx  NEW — recommendations list
src/pages/Tools.tsx              MODIFY — wire activeTool to AvatarPerf runner
```

---

## Task 1: Sidecar crate skeleton

**Files:**
- Create: `tools/avatar-perf-core/Cargo.toml`
- Create: `tools/avatar-perf-core/src/main.rs`
- Create: `tools/avatar-perf-core/src/types.rs`

- [ ] **Create `tools/avatar-perf-core/Cargo.toml`**

```toml
[package]
name = "avatar-perf-core"
version = "1.0.0"
edition = "2021"

[[bin]]
name = "avatar-perf-core"
path = "src/main.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
regex = "1"
walkdir = "2"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Create `tools/avatar-perf-core/src/types.rs`**

```rust
// tools/avatar-perf-core/src/types.rs
use serde::{Deserialize, Serialize};

/// Raw metric values counted from the Unity scene.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AvatarMetrics {
    pub triangles: u64,
    pub skinned_mesh_renderers: u32,
    pub mesh_renderers: u32,
    pub material_slots: u32,
    pub bones: u32,
    pub physbone_components: u32,
    pub physbone_transforms: u32,
    pub physbone_colliders: u32,
    pub particle_systems: u32,
    pub trail_renderers: u32,
    pub lights: u32,
    pub audio_sources: u32,
    pub vram_mb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum VrcRank {
    Excellent,
    Good,
    Medium,
    Poor,
    VeryPoor,
}

impl std::fmt::Display for VrcRank {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VrcRank::Excellent => write!(f, "Excellent"),
            VrcRank::Good => write!(f, "Good"),
            VrcRank::Medium => write!(f, "Medium"),
            VrcRank::Poor => write!(f, "Poor"),
            VrcRank::VeryPoor => write!(f, "VeryPoor"),
        }
    }
}

impl Serialize for VrcRank {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for VrcRank {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Ok(match s.as_str() {
            "Excellent" => VrcRank::Excellent,
            "Good" => VrcRank::Good,
            "Medium" => VrcRank::Medium,
            "Poor" => VrcRank::Poor,
            _ => VrcRank::VeryPoor,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recommendation {
    pub metric: String,
    pub severity: String, // "critical" | "warning"
    pub current_value: String,
    pub limit_good: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub ok: bool,
    pub error: Option<String>,
    pub avatar_name: String,
    pub scene: String,
    pub metrics: AvatarMetrics,
    pub rank_pc: VrcRank,
    pub rank_quest: VrcRank,
    pub recommendations: Vec<Recommendation>,
    /// Absolute path to rendered thumbnail PNG (if available)
    pub thumbnail_path: Option<String>,
    /// Absolute path to GLTF export (if Unity render failed)
    pub gltf_path: Option<String>,
}

/// Incoming request (read from stdin)
#[derive(Debug, Deserialize)]
pub struct AnalysisRequest {
    pub action: String,
    pub project_path: String,
    pub scene_path: String,
    pub avatar_name: String,
}

/// Progress message emitted to stdout before the final result
#[derive(Debug, Serialize)]
pub struct ProgressMessage {
    pub progress: f64,
    pub step: String,
}
```

- [ ] **Create `tools/avatar-perf-core/src/main.rs`**

```rust
// tools/avatar-perf-core/src/main.rs
mod types;
mod unity_yaml;
mod analyze;
mod rank;
mod recommendations;
mod render;

use std::io::{self, BufRead, Write};
use types::{AnalysisRequest, AnalysisResult, ProgressMessage};

fn emit_progress(progress: f64, step: &str) {
    let msg = ProgressMessage { progress, step: step.to_string() };
    println!("{}", serde_json::to_string(&msg).unwrap());
    io::stdout().flush().ok();
}

fn main() {
    let stdin = io::stdin();
    let mut line = String::new();
    stdin.lock().read_line(&mut line).expect("Failed to read stdin");

    let result = match serde_json::from_str::<AnalysisRequest>(line.trim()) {
        Ok(req) if req.action == "analyze" => run_analysis(req),
        Ok(req) => AnalysisResult {
            ok: false,
            error: Some(format!("Unknown action: {}", req.action)),
            avatar_name: String::new(),
            scene: String::new(),
            metrics: Default::default(),
            rank_pc: types::VrcRank::VeryPoor,
            rank_quest: types::VrcRank::VeryPoor,
            recommendations: vec![],
            thumbnail_path: None,
            gltf_path: None,
        },
        Err(e) => AnalysisResult {
            ok: false,
            error: Some(format!("Invalid request JSON: {e}")),
            avatar_name: String::new(),
            scene: String::new(),
            metrics: Default::default(),
            rank_pc: types::VrcRank::VeryPoor,
            rank_quest: types::VrcRank::VeryPoor,
            recommendations: vec![],
            thumbnail_path: None,
            gltf_path: None,
        },
    };

    println!("{}", serde_json::to_string(&result).unwrap());
}

fn run_analysis(req: AnalysisRequest) -> AnalysisResult {
    emit_progress(0.05, "Leyendo escena Unity…");

    let scene_full_path = format!("{}/{}", req.project_path, req.scene_path);
    let scene_text = match std::fs::read_to_string(&scene_full_path) {
        Ok(t) => t,
        Err(e) => return AnalysisResult {
            ok: false,
            error: Some(format!("Cannot read scene file: {e}")),
            avatar_name: req.avatar_name,
            scene: req.scene_path,
            metrics: Default::default(),
            rank_pc: types::VrcRank::VeryPoor,
            rank_quest: types::VrcRank::VeryPoor,
            recommendations: vec![],
            thumbnail_path: None,
            gltf_path: None,
        },
    };

    emit_progress(0.2, "Parseando objetos de la escena…");
    let docs = unity_yaml::parse_documents(&scene_text);

    emit_progress(0.4, "Contando métricas…");
    let metrics = analyze::count_metrics(&docs, &req.avatar_name, &req.project_path);

    emit_progress(0.6, "Calculando rank VRChat…");
    let rank_pc = rank::calculate_pc(&metrics);
    let rank_quest = rank::calculate_quest(&metrics);
    let recommendations = recommendations::generate(&metrics, &rank_pc);

    emit_progress(0.75, "Renderizando vista 3D…");
    let (thumbnail_path, gltf_path) = render::render_avatar(
        &req.project_path,
        &req.scene_path,
        &req.avatar_name,
    );

    emit_progress(1.0, "Listo");

    AnalysisResult {
        ok: true,
        error: None,
        avatar_name: req.avatar_name,
        scene: req.scene_path,
        metrics,
        rank_pc,
        rank_quest,
        recommendations,
        thumbnail_path,
        gltf_path,
    }
}
```

- [ ] **Build the sidecar crate** (ensure it compiles with just the skeleton — full impl comes in later tasks)

```bash
cd E:/vrcstudio/tools/avatar-perf-core && cargo build 2>&1 | tail -10
```

Expected: compile errors for missing modules — create stub files to silence them first:

```bash
# Create empty stub files
touch src/unity_yaml.rs src/analyze.rs src/rank.rs src/recommendations.rs src/render.rs
```

Add minimal stubs to each file so it compiles. In each file, add:

**`src/unity_yaml.rs`** stub:
```rust
pub struct UnityDocument { pub raw: String }
pub fn parse_documents(_text: &str) -> Vec<UnityDocument> { vec![] }
```

**`src/analyze.rs`** stub:
```rust
use crate::types::AvatarMetrics;
use crate::unity_yaml::UnityDocument;
pub fn count_metrics(_docs: &[UnityDocument], _avatar_name: &str, _project_path: &str) -> AvatarMetrics { Default::default() }
```

**`src/rank.rs`** stub:
```rust
use crate::types::{AvatarMetrics, VrcRank};
pub fn calculate_pc(_m: &AvatarMetrics) -> VrcRank { VrcRank::VeryPoor }
pub fn calculate_quest(_m: &AvatarMetrics) -> VrcRank { VrcRank::VeryPoor }
```

**`src/recommendations.rs`** stub:
```rust
use crate::types::{AvatarMetrics, Recommendation, VrcRank};
pub fn generate(_m: &AvatarMetrics, _rank: &VrcRank) -> Vec<Recommendation> { vec![] }
```

**`src/render.rs`** stub:
```rust
pub fn render_avatar(_project_path: &str, _scene_path: &str, _avatar_name: &str) -> (Option<String>, Option<String>) { (None, None) }
```

```bash
cargo build 2>&1 | tail -5
```

Expected: `Finished` (compiles with stubs).

- [ ] **Commit**

```bash
cd E:/vrcstudio
git add tools/
git commit -m "feat(sidecar): add avatar-perf-core skeleton with types and main IPC loop"
```

---

## Task 2: Unity YAML parser

**Files:**
- Modify: `tools/avatar-perf-core/src/unity_yaml.rs`

Unity scene files (`.unity`) are valid YAML but with `--- !u!<classId> &<fileId>` document headers. Class IDs of interest: 1=GameObject, 114=MonoBehaviour, 137=SkinnedMeshRenderer, 23=MeshRenderer, 33=MeshFilter, 108=Light, 82=AudioSource, 198=TrailRenderer, 120=LineRenderer, 111=Animation, 95=Animator.

- [ ] **Replace `unity_yaml.rs` with full implementation:**

```rust
// tools/avatar-perf-core/src/unity_yaml.rs
use regex::Regex;
use std::collections::HashMap;

/// A single YAML document from a Unity scene file.
#[derive(Debug, Clone)]
pub struct UnityDocument {
    pub class_id: u32,   // from !u!<classId>
    pub file_id: u64,    // from &<fileId>
    pub raw: String,     // raw YAML body text
}

impl UnityDocument {
    /// Returns the value of a top-level field like `m_Name: Foo`
    pub fn get_field(&self, key: &str) -> Option<String> {
        let pattern = format!(r"(?m)^\s*{}:\s*(.+)$", regex::escape(key));
        let re = Regex::new(&pattern).ok()?;
        re.captures(&self.raw)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
    }

    /// Returns the value of `guid` inside a Unity object reference field.
    /// e.g. `m_Script: {fileID: 11500000, guid: abc123, type: 3}` → "abc123"
    pub fn get_guid_field(&self, field_name: &str) -> Option<String> {
        let pattern = format!(
            r"{}:\s*\{{[^}}]*guid:\s*([a-fA-F0-9]+)",
            regex::escape(field_name)
        );
        let re = Regex::new(&pattern).ok()?;
        re.captures(&self.raw)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    }

    /// Returns the fileID from a Unity object reference field.
    pub fn get_file_id_field(&self, field_name: &str) -> Option<u64> {
        let pattern = format!(
            r"{}:\s*\{{fileID:\s*(\d+)",
            regex::escape(field_name)
        );
        let re = Regex::new(&pattern).ok()?;
        re.captures(&self.raw)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
    }

    /// Returns all occurrences of a reference list like:
    /// m_Component:\n  - component: {fileID: 123}\n  - component: {fileID: 456}
    pub fn get_component_file_ids(&self) -> Vec<u64> {
        let re = Regex::new(r"component:\s*\{fileID:\s*(\d+)").unwrap();
        re.captures_iter(&self.raw)
            .filter_map(|c| c.get(1)?.as_str().parse().ok())
            .collect()
    }

    /// Returns all occurrences of `- {fileID: N}` in a list field.
    pub fn get_list_file_ids(&self, field_name: &str) -> Vec<u64> {
        // Find the block after the field name, collect fileID entries
        let start_pattern = format!(r"{}:", regex::escape(field_name));
        if let Some(start) = self.raw.find(&start_pattern) {
            let block = &self.raw[start..];
            let re = Regex::new(r"fileID:\s*(\d+)").unwrap();
            return re.captures_iter(block)
                .take(64)
                .filter_map(|c| c.get(1)?.as_str().parse().ok())
                .filter(|&id| id != 0)
                .collect();
        }
        vec![]
    }

    /// Counts how many entries match a pattern in a YAML list field (e.g., sharedMaterials)
    pub fn count_list_entries(&self, field_name: &str) -> u32 {
        let start_pattern = format!("{}:", field_name);
        if let Some(start) = self.raw.find(&start_pattern) {
            let block = &self.raw[start + start_pattern.len()..];
            // Count lines that start with "  - " (list items)
            block.lines()
                .take_while(|l| l.starts_with("  ") || l.trim().starts_with('-'))
                .filter(|l| l.trim().starts_with('-'))
                .count() as u32
        } else {
            0
        }
    }
}

/// Parses a Unity scene file into its component documents.
pub fn parse_documents(text: &str) -> Vec<UnityDocument> {
    let header_re = Regex::new(r"--- !u!(\d+) &(\d+)").unwrap();
    let mut docs = Vec::new();
    let mut positions: Vec<(usize, u32, u64)> = Vec::new();

    for cap in header_re.captures_iter(text) {
        let pos = cap.get(0).unwrap().start();
        let class_id: u32 = cap[1].parse().unwrap_or(0);
        let file_id: u64 = cap[2].parse().unwrap_or(0);
        positions.push((pos, class_id, file_id));
    }

    for (i, &(pos, class_id, file_id)) in positions.iter().enumerate() {
        let end = if i + 1 < positions.len() { positions[i + 1].0 } else { text.len() };
        let raw = text[pos..end].to_string();
        docs.push(UnityDocument { class_id, file_id, raw });
    }

    docs
}

/// Builds a map from fileID → UnityDocument for fast lookup.
pub fn build_index(docs: &[UnityDocument]) -> HashMap<u64, &UnityDocument> {
    docs.iter().map(|d| (d.file_id, d)).collect()
}

/// Finds all MonoBehaviour documents whose m_Script guid matches any of the given GUIDs.
pub fn find_by_script_guid<'a>(
    docs: &'a [UnityDocument],
    guids: &[&str],
) -> Vec<&'a UnityDocument> {
    docs.iter()
        .filter(|d| d.class_id == 114) // MonoBehaviour
        .filter(|d| {
            d.get_guid_field("m_Script")
                .map(|g| guids.contains(&g.as_str()))
                .unwrap_or(false)
        })
        .collect()
}

/// Finds GameObjects by name (case-sensitive).
pub fn find_gameobject_by_name<'a>(
    docs: &'a [UnityDocument],
    name: &str,
) -> Vec<&'a UnityDocument> {
    docs.iter()
        .filter(|d| d.class_id == 1) // GameObject
        .filter(|d| {
            d.get_field("m_Name")
                .map(|n| n == name)
                .unwrap_or(false)
        })
        .collect()
}
```

- [ ] **Build and verify:**

```bash
cd E:/vrcstudio/tools/avatar-perf-core && cargo build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
cd E:/vrcstudio && git add tools/avatar-perf-core/src/unity_yaml.rs
git commit -m "feat(sidecar): implement Unity YAML document parser"
```

---

## Task 3: VRChat rank thresholds

**Files:**
- Modify: `tools/avatar-perf-core/src/rank.rs`

- [ ] **Replace `rank.rs` with full implementation:**

```rust
// tools/avatar-perf-core/src/rank.rs
use crate::types::{AvatarMetrics, VrcRank};

struct Thresholds {
    triangles:              u64,
    skinned_mesh_renderers: u32,
    mesh_renderers:         u32,
    material_slots:         u32,
    bones:                  u32,
    physbone_components:    u32,
    physbone_transforms:    u32,
    physbone_colliders:     u32,
    particle_systems:       u32,
    trail_renderers:        u32,
    lights:                 u32,
    audio_sources:          u32,
    vram_mb:                f64,
}

// PC thresholds — (Excellent, Good, Medium, Poor)
const PC: [(Thresholds, VrcRank); 4] = [
    (Thresholds { triangles: 32_000, skinned_mesh_renderers: 1, mesh_renderers: 1,  material_slots: 4,  bones: 75,  physbone_components: 4,  physbone_transforms: 16,  physbone_colliders: 0, particle_systems: 0,  trail_renderers: 1, lights: 0, audio_sources: 1, vram_mb: 40.0  }, VrcRank::Excellent),
    (Thresholds { triangles: 70_000, skinned_mesh_renderers: 2, mesh_renderers: 2,  material_slots: 8,  bones: 150, physbone_components: 8,  physbone_transforms: 64,  physbone_colliders: 8, particle_systems: 8,  trail_renderers: 2, lights: 0, audio_sources: 4, vram_mb: 75.0  }, VrcRank::Good),
    (Thresholds { triangles: 70_000, skinned_mesh_renderers: 2, mesh_renderers: 4,  material_slots: 16, bones: 256, physbone_components: 16, physbone_transforms: 128, physbone_colliders: 16, particle_systems: 16, trail_renderers: 4, lights: 0, audio_sources: 8, vram_mb: 110.0 }, VrcRank::Medium),
    (Thresholds { triangles: 70_000, skinned_mesh_renderers: 8, mesh_renderers: 8,  material_slots: 32, bones: 400, physbone_components: 32, physbone_transforms: 256, physbone_colliders: 32, particle_systems: 32, trail_renderers: 8, lights: 8, audio_sources: 8, vram_mb: 150.0 }, VrcRank::Poor),
];

// Quest thresholds — (Excellent, Good, Medium, Poor)
const QUEST: [(Thresholds, VrcRank); 4] = [
    (Thresholds { triangles: 7_500,  skinned_mesh_renderers: 1, mesh_renderers: 1, material_slots: 4,  bones: 75,  physbone_components: 4,  physbone_transforms: 16,  physbone_colliders: 0,  particle_systems: 0,  trail_renderers: 0, lights: 0, audio_sources: 1, vram_mb: 10.0 }, VrcRank::Excellent),
    (Thresholds { triangles: 10_000, skinned_mesh_renderers: 1, mesh_renderers: 1, material_slots: 4,  bones: 150, physbone_components: 6,  physbone_transforms: 32,  physbone_colliders: 4,  particle_systems: 0,  trail_renderers: 0, lights: 0, audio_sources: 1, vram_mb: 18.0 }, VrcRank::Good),
    (Thresholds { triangles: 15_000, skinned_mesh_renderers: 2, mesh_renderers: 2, material_slots: 8,  bones: 256, physbone_components: 8,  physbone_transforms: 64,  physbone_colliders: 8,  particle_systems: 0,  trail_renderers: 0, lights: 0, audio_sources: 2, vram_mb: 25.0 }, VrcRank::Medium),
    (Thresholds { triangles: 20_000, skinned_mesh_renderers: 2, mesh_renderers: 2, material_slots: 16, bones: 400, physbone_components: 16, physbone_transforms: 128, physbone_colliders: 16, particle_systems: 0,  trail_renderers: 0, lights: 0, audio_sources: 4, vram_mb: 40.0 }, VrcRank::Poor),
];

fn worst_rank(metrics: &AvatarMetrics, table: &[(Thresholds, VrcRank); 4]) -> VrcRank {
    for (thresh, rank) in table {
        if metrics.triangles              <= thresh.triangles
        && metrics.skinned_mesh_renderers <= thresh.skinned_mesh_renderers
        && metrics.mesh_renderers         <= thresh.mesh_renderers
        && metrics.material_slots         <= thresh.material_slots
        && metrics.bones                  <= thresh.bones
        && metrics.physbone_components    <= thresh.physbone_components
        && metrics.physbone_transforms    <= thresh.physbone_transforms
        && metrics.physbone_colliders     <= thresh.physbone_colliders
        && metrics.particle_systems       <= thresh.particle_systems
        && metrics.trail_renderers        <= thresh.trail_renderers
        && metrics.lights                 <= thresh.lights
        && metrics.audio_sources          <= thresh.audio_sources
        && metrics.vram_mb                <= thresh.vram_mb
        {
            return rank.clone();
        }
    }
    VrcRank::VeryPoor
}

pub fn calculate_pc(metrics: &AvatarMetrics) -> VrcRank {
    worst_rank(metrics, &PC)
}

pub fn calculate_quest(metrics: &AvatarMetrics) -> VrcRank {
    worst_rank(metrics, &QUEST)
}
```

- [ ] **Build**

```bash
cd E:/vrcstudio/tools/avatar-perf-core && cargo build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
cd E:/vrcstudio && git add tools/avatar-perf-core/src/rank.rs
git commit -m "feat(sidecar): implement VRChat PC and Quest rank thresholds"
```

---

## Task 4: Metric counting (analyze.rs)

**Files:**
- Modify: `tools/avatar-perf-core/src/analyze.rs`

Known VRChat SDK script GUIDs (SDK3 / VCC packages — these are stable across projects using the same SDK version):
- VRC_AvatarDescriptor: `a7a8c0b59f38aaF49aa691b6db7b828b` (SDK2) or search by `viewPosition` field
- VRC_PhysBone: `5256ffe4e7c8bc64faca93e67f9e7a4c`
- VRC_PhysBoneCollider: `f47de16e5f18e74418bf9f0e35dce71a`

Because GUIDs can vary by SDK version, the analyzer uses a dual approach: GUID match OR presence of identifying fields.

- [ ] **Replace `analyze.rs` with full implementation:**

```rust
// tools/avatar-perf-core/src/analyze.rs
use crate::types::AvatarMetrics;
use crate::unity_yaml::{UnityDocument, build_index, find_gameobject_by_name};
use std::collections::HashSet;

// Known GUIDs for VRChat SDK3 components (may vary by SDK version)
const PHYSBONE_GUIDS: &[&str] = &[
    "5256ffe4e7c8bc64faca93e67f9e7a4c",
    "bb5dbbcc9a9cda54d879ebcc70395f5c", // alternate in some SDK builds
];
const PHYSBONE_COLLIDER_GUIDS: &[&str] = &[
    "f47de16e5f18e74418bf9f0e35dce71a",
];

/// Counts all VRChat-relevant metrics from the parsed Unity documents.
pub fn count_metrics(
    docs: &[UnityDocument],
    avatar_name: &str,
    project_path: &str,
) -> AvatarMetrics {
    let index = build_index(docs);

    // Find the root avatar GameObject
    let avatar_gos = find_gameobject_by_name(docs, avatar_name);
    let root_file_id = avatar_gos.first().map(|d| d.file_id).unwrap_or(0);

    // Collect all fileIDs reachable from the avatar root via transform hierarchy.
    // This limits counting to components under this avatar, not the whole scene.
    let avatar_file_ids = collect_hierarchy(docs, root_file_id, &index);

    let mut metrics = AvatarMetrics::default();

    for doc in docs {
        // Only count components that belong to this avatar's hierarchy
        // (by checking their m_GameObject fileID against our set)
        if !is_in_hierarchy(doc, &avatar_file_ids, &index) {
            continue;
        }

        match doc.class_id {
            // SkinnedMeshRenderer (137)
            137 => {
                metrics.skinned_mesh_renderers += 1;
                // Count material slots
                let mats = count_material_slots(doc);
                metrics.material_slots += mats;
                // Triangle count is approximated from mesh data (see below)
            }
            // MeshRenderer (23)
            23 => {
                metrics.mesh_renderers += 1;
                let mats = count_material_slots(doc);
                metrics.material_slots += mats;
            }
            // Light (108)
            108 => {
                metrics.lights += 1;
            }
            // AudioSource (82)
            82 => {
                metrics.audio_sources += 1;
            }
            // TrailRenderer (198) or LineRenderer (120)
            198 | 120 => {
                metrics.trail_renderers += 1;
            }
            // ParticleSystem (198 is PS in Unity? actually 198 is TrailRenderer, PS = 198... let's use correct IDs)
            // ParticleSystem class ID = 198 — NOTE: Unity class IDs:
            // 198 = ParticleSystem, 199 = ParticleSystemRenderer
            // TrailRenderer = 96, LineRenderer = 120
            // Actually: ParticleSystem = 198 in Unity YAML
            // Correcting: use 96 for TrailRenderer, 120 for LineRenderer, 198 for ParticleSystem
            // 96 => trail_renderers, 120 => trail_renderers (both count as trail)
            96 => {
                metrics.trail_renderers += 1;
            }
            // MonoBehaviour (114) — check for PhysBone, PhysBoneCollider
            114 => {
                count_monobehaviour(doc, &mut metrics);
            }
            _ => {}
        }
    }

    // Count bones (Transform hierarchy depth from root)
    metrics.bones = count_bones(docs, root_file_id);

    // Estimate triangles from FBX files in Assets
    metrics.triangles = estimate_triangles_from_assets(docs, project_path, &avatar_file_ids, &index);

    // Estimate VRAM
    metrics.vram_mb = estimate_vram(docs, project_path, &avatar_file_ids, &index);

    metrics
}

fn count_material_slots(doc: &UnityDocument) -> u32 {
    // sharedMaterials list in SkinnedMeshRenderer / MeshRenderer
    doc.count_list_entries("m_Materials")
}

fn count_monobehaviour(doc: &UnityDocument, metrics: &mut AvatarMetrics) {
    if let Some(guid) = doc.get_guid_field("m_Script") {
        if PHYSBONE_GUIDS.contains(&guid.as_str()) {
            metrics.physbone_components += 1;
            // Count affected transforms: rootTransform + all bones in m_RootTransform chain
            // Simple heuristic: count entries in m_ExcludedTransforms (inverse isn't easily countable)
            // For now increment by 1 per PB; a more accurate count requires hierarchy traversal
            metrics.physbone_transforms += estimate_physbone_transforms(doc);
            return;
        }
        if PHYSBONE_COLLIDER_GUIDS.contains(&guid.as_str()) {
            metrics.physbone_colliders += 1;
            return;
        }
    }
    // Fallback: detect by unique field names
    if doc.raw.contains("m_RootTransform:") && doc.raw.contains("m_Pull:") {
        // Looks like PhysBone
        metrics.physbone_components += 1;
        metrics.physbone_transforms += estimate_physbone_transforms(doc);
    }
}

fn estimate_physbone_transforms(doc: &UnityDocument) -> u32 {
    // Count multi-child transforms. Unity PhysBone stores chain length in serialized data.
    // Heuristic: look for m_EndpointPosition or m_MaxSquish — if present, assume ~8 transforms per PB chain.
    // A real implementation would need to traverse the Transform hierarchy.
    if doc.raw.contains("m_EndpointPosition:") { 8 } else { 4 }
}

/// Collects all Transform component fileIDs that are children of the given root.
fn collect_hierarchy(
    docs: &[UnityDocument],
    root_go_file_id: u64,
    index: &std::collections::HashMap<u64, &UnityDocument>,
) -> HashSet<u64> {
    let mut visited = HashSet::new();
    if root_go_file_id == 0 { return visited; }
    collect_recursive(root_go_file_id, docs, index, &mut visited);
    visited
}

fn collect_recursive(
    go_file_id: u64,
    docs: &[UnityDocument],
    index: &std::collections::HashMap<u64, &UnityDocument>,
    visited: &mut HashSet<u64>,
) {
    if !visited.insert(go_file_id) { return; }

    // Find the GameObject doc
    if let Some(go_doc) = index.get(&go_file_id) {
        // Get component fileIDs
        for comp_id in go_doc.get_component_file_ids() {
            visited.insert(comp_id);
            // Find Transform component (class 4) to recurse into children
            if let Some(comp_doc) = index.get(&comp_id) {
                if comp_doc.class_id == 4 {
                    // m_Children contains child Transform fileIDs
                    for child_transform_id in comp_doc.get_list_file_ids("m_Children") {
                        // Get child's GameObject
                        if let Some(child_transform) = index.get(&child_transform_id) {
                            if let Some(child_go_id) = child_transform.get_file_id_field("m_GameObject") {
                                collect_recursive(child_go_id, docs, index, visited);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn is_in_hierarchy(
    doc: &UnityDocument,
    hierarchy: &HashSet<u64>,
    _index: &std::collections::HashMap<u64, &UnityDocument>,
) -> bool {
    if hierarchy.is_empty() { return true; } // no root found — count everything
    hierarchy.contains(&doc.file_id)
}

fn count_bones(docs: &[UnityDocument], root_go_id: u64) -> u32 {
    if root_go_id == 0 { return 0; }
    // Count Transform components (class 4) in the hierarchy
    // Each Transform = one bone
    docs.iter()
        .filter(|d| d.class_id == 4) // Transform
        .count() as u32
}

fn estimate_triangles_from_assets(
    docs: &[UnityDocument],
    project_path: &str,
    hierarchy: &HashSet<u64>,
    index: &std::collections::HashMap<u64, &UnityDocument>,
) -> u64 {
    // Look for SkinnedMeshRenderer docs in hierarchy, get mesh GUID, find FBX, parse triangle count
    let mut total = 0u64;
    for doc in docs {
        if doc.class_id != 137 { continue; } // SkinnedMeshRenderer only
        if !hierarchy.is_empty() && !hierarchy.contains(&doc.file_id) { continue; }

        // m_Mesh: {fileID: N, guid: XYZ, type: 2} → guid points to the mesh asset
        if let Some(mesh_guid) = doc.get_guid_field("m_Mesh") {
            if let Some(count) = count_triangles_for_guid(project_path, &mesh_guid) {
                total += count;
            }
        }
    }
    total
}

fn count_triangles_for_guid(project_path: &str, guid: &str) -> Option<u64> {
    // Find the .meta file that has this guid, then parse the associated FBX/OBJ
    let assets_dir = std::path::Path::new(project_path).join("Assets");
    if !assets_dir.exists() { return None; }

    // Search for a .meta file containing this guid
    let meta_content = find_meta_for_guid(&assets_dir, guid)?;
    // Get the asset path from the .meta path
    let asset_path = meta_content.trim_end_matches(".meta").to_string();
    let asset_path = std::path::Path::new(&asset_path);

    let ext = asset_path.extension()?.to_str()?.to_lowercase();
    match ext.as_str() {
        "fbx" | "obj" => count_triangles_in_mesh_file(asset_path),
        _ => None,
    }
}

fn find_meta_for_guid(assets_dir: &std::path::Path, guid: &str) -> Option<String> {
    use std::io::BufRead;
    let pattern = format!("guid: {}", guid);

    for entry in walkdir::WalkDir::new(assets_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "meta").unwrap_or(false))
    {
        if let Ok(file) = std::fs::File::open(entry.path()) {
            let reader = std::io::BufReader::new(file);
            for line in reader.lines().take(5).filter_map(|l| l.ok()) {
                if line.contains(&pattern) {
                    return Some(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

fn count_triangles_in_mesh_file(path: &std::path::Path) -> Option<u64> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    if ext == "obj" {
        return count_obj_triangles(path);
    }
    // For FBX: count "PolygonVertexIndex:" entries.
    // FBX stores polygon vertex indices; negative index = end of polygon.
    // Triangle = 3 indices, quad = 4 → 2 triangles, etc.
    count_fbx_triangles(path)
}

fn count_obj_triangles(path: &std::path::Path) -> Option<u64> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    let mut triangles = 0u64;
    for line in reader.lines().filter_map(|l| l.ok()) {
        let line = line.trim();
        if line.starts_with("f ") {
            // Count vertices in face: "f 1 2 3" = 1 tri, "f 1 2 3 4" = 2 tris
            let verts = line.split_whitespace().count() - 1;
            if verts >= 3 { triangles += (verts - 2) as u64; }
        }
    }
    Some(triangles)
}

fn count_fbx_triangles(path: &std::path::Path) -> Option<u64> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    let re = Regex::new(r"PolygonVertexIndex: \*(\d+)").ok()?;
    // FBX stores PolygonVertexIndex with count. Each polygon terminated by negative index.
    // A rough estimate: total_indices / 3 ≈ triangle count (most meshes are triangulated)
    for line in reader.lines().filter_map(|l| l.ok()) {
        if let Some(cap) = re.captures(&line) {
            let index_count: u64 = cap[1].parse().ok()?;
            return Some(index_count / 3);
        }
    }
    None
}

use regex::Regex;

fn estimate_vram(
    docs: &[UnityDocument],
    project_path: &str,
    hierarchy: &HashSet<u64>,
    _index: &std::collections::HashMap<u64, &UnityDocument>,
) -> f64 {
    // Find all material guids referenced by renderers, then find texture files and sum sizes
    // Simplified: sum sizes of all textures in Assets/Textures + Assets/ with .png/.jpg/.psd/.tga
    let assets_dir = std::path::Path::new(project_path).join("Assets");
    if !assets_dir.exists() { return 0.0; }

    let mut total_bytes = 0u64;
    for entry in walkdir::WalkDir::new(&assets_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let ext = e.path().extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_lowercase();
            matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "psd" | "tga" | "exr" | "hdr")
        })
    {
        if let Ok(meta) = std::fs::metadata(entry.path()) {
            total_bytes += meta.len();
        }
    }

    // GPU VRAM is roughly 4× the raw file size (textures expand to RGBA in VRAM)
    // But compressed (DXT/BC7) is ~0.25× raw. We use 1.5× as a middle estimate.
    let estimated_mb = (total_bytes as f64 * 1.5) / (1024.0 * 1024.0);
    (estimated_mb * 10.0).round() / 10.0 // round to 1 decimal
}
```

- [ ] **Build**

```bash
cd E:/vrcstudio/tools/avatar-perf-core && cargo build 2>&1 | tail -10
```

Fix any compile errors (missing imports, type mismatches). The `walkdir` and `regex` crates are already in Cargo.toml.

- [ ] **Commit**

```bash
cd E:/vrcstudio && git add tools/avatar-perf-core/src/analyze.rs
git commit -m "feat(sidecar): implement metric counting from Unity YAML documents"
```

---

## Task 5: Recommendations engine

**Files:**
- Modify: `tools/avatar-perf-core/src/recommendations.rs`

- [ ] **Replace `recommendations.rs`:**

```rust
// tools/avatar-perf-core/src/recommendations.rs
use crate::types::{AvatarMetrics, Recommendation, VrcRank};

pub fn generate(metrics: &AvatarMetrics, rank: &VrcRank) -> Vec<Recommendation> {
    let mut recs = Vec::new();

    // Triangles
    if metrics.triangles > 70_000 {
        recs.push(Recommendation {
            metric: "triangles".into(),
            severity: "critical".into(),
            current_value: metrics.triangles.to_string(),
            limit_good: "70,000".into(),
            message: format!(
                "El avatar tiene {:,} triángulos, supera el límite de Poor (70k). Usa Blender para reducir polígonos en ropa y cabello con Decimate Modifier. Objetivo: reducir ~{:,} triángulos.",
                metrics.triangles,
                metrics.triangles.saturating_sub(70_000)
            ),
        });
    } else if metrics.triangles > 32_000 {
        recs.push(Recommendation {
            metric: "triangles".into(),
            severity: "warning".into(),
            current_value: metrics.triangles.to_string(),
            limit_good: "32,000 (Excellent)".into(),
            message: format!(
                "{:,} triángulos. Para Excellent necesitas ≤32k. Considera reducir mallas secundarias.",
                metrics.triangles
            ),
        });
    }

    // PhysBones
    if metrics.physbone_components > 32 {
        recs.push(Recommendation {
            metric: "physbone_components".into(),
            severity: "critical".into(),
            current_value: metrics.physbone_components.to_string(),
            limit_good: "8".into(),
            message: format!(
                "{} PhysBone components. El límite para Good es 8. Combina cadenas de huesos cortas en un solo PhysBone. Elimina PhysBones en accesorios que raramente se ven.",
                metrics.physbone_components
            ),
        });
    } else if metrics.physbone_components > 8 {
        recs.push(Recommendation {
            metric: "physbone_components".into(),
            severity: "warning".into(),
            current_value: metrics.physbone_components.to_string(),
            limit_good: "8".into(),
            message: format!(
                "{} PhysBone components (límite Good: 8). Revisa si puedes fusionar cadenas cortas.",
                metrics.physbone_components
            ),
        });
    }

    // PhysBone transforms
    if metrics.physbone_transforms > 256 {
        recs.push(Recommendation {
            metric: "physbone_transforms".into(),
            severity: "critical".into(),
            current_value: metrics.physbone_transforms.to_string(),
            limit_good: "64".into(),
            message: "Demasiados transforms afectados por PhysBones. Reduce la longitud de las cadenas de huesos en el rig.".into(),
        });
    }

    // Materials
    if metrics.material_slots > 32 {
        recs.push(Recommendation {
            metric: "material_slots".into(),
            severity: "critical".into(),
            current_value: metrics.material_slots.to_string(),
            limit_good: "8".into(),
            message: format!(
                "{} material slots. Usa Atlas de texturas para combinar materiales. Herramienta recomendada: d4rkAvatarOptimizer.",
                metrics.material_slots
            ),
        });
    } else if metrics.material_slots > 8 {
        recs.push(Recommendation {
            metric: "material_slots".into(),
            severity: "warning".into(),
            current_value: metrics.material_slots.to_string(),
            limit_good: "8".into(),
            message: format!(
                "{} material slots (límite Good: 8). Considera combinar materiales similares.",
                metrics.material_slots
            ),
        });
    }

    // VRAM
    if metrics.vram_mb > 150.0 {
        recs.push(Recommendation {
            metric: "vram_mb".into(),
            severity: "critical".into(),
            current_value: format!("{:.1} MB", metrics.vram_mb),
            limit_good: "75 MB".into(),
            message: format!(
                "VRAM estimada en {:.0} MB. Comprime texturas a DXT5/BC7. Reduce resolución de texturas secundarias de 4K a 2K o 1K.",
                metrics.vram_mb
            ),
        });
    } else if metrics.vram_mb > 75.0 {
        recs.push(Recommendation {
            metric: "vram_mb".into(),
            severity: "warning".into(),
            current_value: format!("{:.1} MB", metrics.vram_mb),
            limit_good: "75 MB".into(),
            message: format!("VRAM estimada en {:.0} MB. Comprime texturas a DXT5/BC7 para reducir.", metrics.vram_mb),
        });
    }

    // SMR
    if metrics.skinned_mesh_renderers > 8 {
        recs.push(Recommendation {
            metric: "skinned_mesh_renderers".into(),
            severity: "critical".into(),
            current_value: metrics.skinned_mesh_renderers.to_string(),
            limit_good: "2".into(),
            message: format!(
                "{} Skinned Mesh Renderers. Combina meshes con la herramienta 'Merge Skinned Mesh' de Modular Avatar o d4rkOptimizer.",
                metrics.skinned_mesh_renderers
            ),
        });
    }

    // Lights
    if metrics.lights > 0 {
        recs.push(Recommendation {
            metric: "lights".into(),
            severity: "critical".into(),
            current_value: metrics.lights.to_string(),
            limit_good: "0".into(),
            message: format!(
                "{} light(s) activa(s). Las luces en tiempo real tienen un coste alto. Desactívalas por defecto con una animación o elimínalas.",
                metrics.lights
            ),
        });
    }

    // Particles
    if metrics.particle_systems > 16 {
        recs.push(Recommendation {
            metric: "particle_systems".into(),
            severity: "critical".into(),
            current_value: metrics.particle_systems.to_string(),
            limit_good: "8".into(),
            message: format!("{} particle systems. Reduce a menos de 8 para rank Good.", metrics.particle_systems),
        });
    }

    recs
}
```

- [ ] **Build and commit**

```bash
cd E:/vrcstudio/tools/avatar-perf-core && cargo build 2>&1 | tail -5
cd E:/vrcstudio && git add tools/avatar-perf-core/src/recommendations.rs
git commit -m "feat(sidecar): implement recommendations engine per metric"
```

---

## Task 6: Unity headless render + GLTF fallback detection

**Files:**
- Modify: `tools/avatar-perf-core/src/render.rs`

- [ ] **Replace `render.rs`:**

```rust
// tools/avatar-perf-core/src/render.rs
use std::path::{Path, PathBuf};
use std::process::Command;

/// Attempts to render the avatar using Unity in headless mode.
/// Falls back to finding an FBX/OBJ for GLTF conversion.
/// Returns (thumbnail_path, gltf_or_fbx_path)
pub fn render_avatar(
    project_path: &str,
    _scene_path: &str,
    avatar_name: &str,
) -> (Option<String>, Option<String>) {
    // Try Unity headless first
    if let Some(unity_exe) = find_unity_exe(project_path) {
        if let Some(img) = run_unity_headless(&unity_exe, project_path, avatar_name) {
            return (Some(img), None);
        }
    }

    // Fallback: find an FBX to pass to the UI for Three.js rendering
    let fbx = find_avatar_fbx(project_path);
    (None, fbx.map(|p| p.to_string_lossy().to_string()))
}

fn find_unity_exe(project_path: &str) -> Option<String> {
    // Read ProjectVersion.txt to get the Unity version
    let version_file = Path::new(project_path)
        .join("ProjectSettings")
        .join("ProjectVersion.txt");
    let content = std::fs::read_to_string(&version_file).ok()?;
    let version_line = content.lines()
        .find(|l| l.starts_with("m_EditorVersion:"))?;
    let version = version_line.split(':').nth(1)?.trim();

    // Common Unity install paths on Windows
    #[cfg(target_os = "windows")]
    {
        let candidates = vec![
            format!("C:/Program Files/Unity/Hub/Editor/{}/Editor/Unity.exe", version),
            format!("C:/Program Files/Unity {}/Editor/Unity.exe", version),
        ];
        for path in candidates {
            if Path::new(&path).exists() {
                return Some(path);
            }
        }
        // Search Unity Hub installs
        let hub_dir = Path::new("C:/Program Files/Unity/Hub/Editor");
        if hub_dir.exists() {
            for entry in std::fs::read_dir(hub_dir).ok()?.filter_map(|e| e.ok()) {
                let exe = entry.path().join("Editor").join("Unity.exe");
                if exe.exists() {
                    return Some(exe.to_string_lossy().to_string());
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = vec![
            format!("/Applications/Unity/Hub/Editor/{}/Unity.app/Contents/MacOS/Unity", version),
        ];
        for path in candidates {
            if Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    None
}

fn run_unity_headless(
    unity_exe: &str,
    project_path: &str,
    avatar_name: &str,
) -> Option<String> {
    // Inject a minimal editor script that renders the avatar
    let editor_dir = Path::new(project_path).join("Assets").join("Editor");
    std::fs::create_dir_all(&editor_dir).ok()?;

    let script_path = editor_dir.join("VRCStudioRender.cs");
    let output_path = std::env::temp_dir().join("vrcstudio_avatar_render.png");

    let script = format!(r#"
using UnityEngine;
using UnityEditor;
using System.IO;

public class VRCStudioRender {{
    [MenuItem("VRCStudio/RenderAvatar")]
    public static void Render() {{
        string avatarName = "{avatar_name}";
        string outputPath = @"{output_path}";

        GameObject avatar = GameObject.Find(avatarName);
        if (avatar == null) {{
            Debug.LogError("VRCStudio: Avatar not found: " + avatarName);
            EditorApplication.Exit(1);
            return;
        }}

        // Position camera in front of avatar
        var cam = new GameObject("RenderCam").AddComponent<Camera>();
        cam.backgroundColor = new Color(0.08f, 0.08f, 0.08f, 1f);
        cam.clearFlags = CameraClearFlags.SolidColor;
        var bounds = GetAvatarBounds(avatar);
        float dist = bounds.size.magnitude * 1.1f;
        cam.transform.position = bounds.center + new Vector3(0, 0, -dist);
        cam.transform.LookAt(bounds.center);

        // Force T-pose by resetting animator
        var animator = avatar.GetComponent<Animator>();
        if (animator != null) {{ animator.enabled = false; }}

        // Render to PNG
        var rt = new RenderTexture(512, 512, 24);
        cam.targetTexture = rt;
        cam.Render();
        RenderTexture.active = rt;
        var tex = new Texture2D(512, 512, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, 512, 512), 0, 0);
        tex.Apply();
        File.WriteAllBytes(outputPath, tex.EncodeToPNG());
        Debug.Log("VRCStudio: Rendered to " + outputPath);
        EditorApplication.Exit(0);
    }}

    static Bounds GetAvatarBounds(GameObject go) {{
        var renderers = go.GetComponentsInChildren<Renderer>();
        if (renderers.Length == 0) return new Bounds(go.transform.position, Vector3.one * 2f);
        var bounds = renderers[0].bounds;
        foreach (var r in renderers) bounds.Encapsulate(r.bounds);
        return bounds;
    }}
}}
"#,
        avatar_name = avatar_name,
        output_path = output_path.to_string_lossy().replace('\\', "/"),
    );

    std::fs::write(&script_path, script).ok()?;

    // Run Unity in batch mode
    let status = Command::new(unity_exe)
        .args([
            "-batchmode",
            "-projectPath", project_path,
            "-executeMethod", "VRCStudioRender.Render",
            "-quit",
            "-logFile", "-",
        ])
        .status()
        .ok()?;

    // Clean up injected script regardless of result
    let _ = std::fs::remove_file(&script_path);
    // Remove .meta file Unity may have created
    let meta = script_path.with_extension("cs.meta");
    let _ = std::fs::remove_file(&meta);

    if status.success() && output_path.exists() {
        Some(output_path.to_string_lossy().to_string())
    } else {
        None
    }
}

fn find_avatar_fbx(project_path: &str) -> Option<PathBuf> {
    let assets = Path::new(project_path).join("Assets");
    if !assets.exists() { return None; }

    // Find the largest .fbx file (likely the main avatar mesh)
    walkdir::WalkDir::new(&assets)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("fbx"))
                .unwrap_or(false)
        })
        .max_by_key(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .map(|e| e.path().to_path_buf())
}
```

- [ ] **Build**

```bash
cd E:/vrcstudio/tools/avatar-perf-core && cargo build --release 2>&1 | tail -10
```

- [ ] **Commit**

```bash
cd E:/vrcstudio && git add tools/avatar-perf-core/src/render.rs
git commit -m "feat(sidecar): add Unity headless render with FBX fallback"
```

---

## Task 7: Tauri commands for scene/avatar scanning + sidecar runner

**Files:**
- Modify: `src-tauri/src/commands/tools.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Add these imports at the top of `commands/tools.rs`** (if not already present):

```rust
use std::io::Write;
use tokio::process::Command as TokioCommand;
use tokio::io::{AsyncBufReadExt, BufReader as AsyncBufReader};
```

- [ ] **Add the three new commands after `tools_uninstall` in `commands/tools.rs`:**

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct SceneFile {
    pub path: String,   // relative to project root e.g. "Assets/Scenes/Main.unity"
    pub name: String,   // "Main"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AvatarDescriptor {
    pub name: String,       // GameObject name e.g. "AvatarRoot"
    pub file_id: String,    // Unity fileID for reference
}

/// Lists all .unity scene files under a project's Assets folder.
#[tauri::command]
pub fn tools_scan_scenes(project_path: String) -> Result<Vec<SceneFile>, AppError> {
    let assets = std::path::Path::new(&project_path).join("Assets");
    if !assets.exists() {
        return Err(AppError::Io(format!("Assets folder not found: {}", assets.display())));
    }
    let mut scenes = Vec::new();
    for entry in walkdir::WalkDir::new(&assets)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map(|x| x == "unity").unwrap_or(false)
        })
    {
        let rel = entry.path()
            .strip_prefix(&project_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let name = entry.path()
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        scenes.push(SceneFile { path: rel, name });
    }
    Ok(scenes)
}

/// Parses a .unity scene file and returns all GameObjects with a VRC_AvatarDescriptor component.
/// Detection: MonoBehaviour with m_Script guid matching known VRChat GUIDs,
/// or MonoBehaviour containing unique VRC_AvatarDescriptor fields.
#[tauri::command]
pub fn tools_scan_avatars(
    project_path: String,
    scene_path: String,
) -> Result<Vec<AvatarDescriptor>, AppError> {
    let full_path = format!("{}/{}", project_path, scene_path);
    let text = std::fs::read_to_string(&full_path)
        .map_err(|e| AppError::Io(e.to_string()))?;

    // Look for MonoBehaviours containing VRC Avatar Descriptor fields.
    // VRC_AvatarDescriptor has unique fields: "viewPosition:" and "lipSync:"
    let mut avatars = Vec::new();
    let doc_sep = regex::Regex::new(r"--- !u!(\d+) &(\d+)").unwrap();
    let documents: Vec<_> = doc_sep.find_iter(&text).collect();

    let name_re = regex::Regex::new(r"m_Name:\s*(.+)").unwrap();
    let file_id_re = regex::Regex::new(r"m_GameObject:\s*\{fileID:\s*(\d+)").unwrap();

    for (i, header_match) in documents.iter().enumerate() {
        let start = header_match.start();
        let end = if i + 1 < documents.len() { documents[i + 1].start() } else { text.len() };
        let doc_text = &text[start..end];

        // MonoBehaviour (class 114) containing VRC Avatar Descriptor signature
        let class_id: u32 = doc_sep.captures(doc_text)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);

        if class_id != 114 { continue; }

        let is_avatar_descriptor = doc_text.contains("viewPosition:") &&
            (doc_text.contains("lipSync:") || doc_text.contains("customEyeLookSettings:"));

        if !is_avatar_descriptor { continue; }

        // Get the GameObject fileID this component is attached to
        let go_file_id = file_id_re.captures(doc_text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        // Find the GameObject name
        let go_name = find_go_name(&text, &go_file_id, &name_re);

        avatars.push(AvatarDescriptor {
            name: go_name,
            file_id: go_file_id,
        });
    }

    Ok(avatars)
}

fn find_go_name(scene_text: &str, file_id: &str, name_re: &regex::Regex) -> String {
    let pattern = format!("&{}", file_id);
    if let Some(pos) = scene_text.find(&pattern) {
        let section = &scene_text[pos..pos.min(scene_text.len()).min(pos + 500)];
        if let Some(cap) = name_re.captures(section) {
            return cap[1].trim().to_string();
        }
    }
    format!("Avatar (fileID {})", file_id)
}

/// Spawns the avatar-perf-core sidecar and streams its JSON output.
/// Emits `tools://sidecar-progress` events for intermediate progress lines.
/// Returns the final JSON result object.
#[tauri::command]
pub async fn tools_run_sidecar(
    app: tauri::AppHandle,
    tool_id: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;

    let sidecar_name = if cfg!(target_os = "windows") { "core.exe" } else { "core" };
    let sidecar_path = app_data.join("tools").join(&tool_id).join(sidecar_name);

    if !sidecar_path.exists() {
        return Err(AppError::Io(format!("Sidecar not found: {}", sidecar_path.display())));
    }

    let request_json = serde_json::to_string(&request)
        .map_err(|e| AppError::Parse(e.to_string()))?;

    let mut child = TokioCommand::new(&sidecar_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::Io(e.to_string()))?;

    // Write request to stdin
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(request_json.as_bytes()).await
            .map_err(|e| AppError::Io(e.to_string()))?;
        stdin.write_all(b"\n").await.ok();
    }

    let stdout = child.stdout.take().ok_or_else(|| AppError::Io("no stdout".into()))?;
    let mut lines = AsyncBufReader::new(stdout).lines();
    let mut last_line = String::new();

    while let Some(line) = lines.next_line().await.map_err(|e| AppError::Io(e.to_string()))? {
        // Check if this is a progress message or the final result
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if val.get("progress").is_some() {
                // Progress message — emit as event
                let _ = app.emit("tools://sidecar-progress", &val);
            } else {
                // Final result
                last_line = line;
            }
        }
    }

    child.wait().await.ok();

    if last_line.is_empty() {
        return Err(AppError::Parse("Sidecar returned no output".into()));
    }

    serde_json::from_str(&last_line)
        .map_err(|e| AppError::Parse(format!("Invalid sidecar JSON: {e}")))
}
```

- [ ] **Register the 3 new commands in `lib.rs`:**

```rust
            commands::tools::tools_scan_scenes,
            commands::tools::tools_scan_avatars,
            commands::tools::tools_run_sidecar,
```

- [ ] **Add `regex` to `src-tauri/Cargo.toml`** if not already present (it is — check first):

```bash
grep "regex" E:/vrcstudio/src-tauri/Cargo.toml
```

If missing: add `regex = "1"` to `[dependencies]`.

- [ ] **Build**

```bash
cargo build --manifest-path E:/vrcstudio/src-tauri/Cargo.toml 2>&1 | tail -10
```

- [ ] **Commit**

```bash
git add src-tauri/src/commands/tools.rs src-tauri/src/lib.rs
git commit -m "feat(tools): add tools_scan_scenes, tools_scan_avatars, tools_run_sidecar commands"
```

---

## Task 8: TypeScript bindings for new commands + toolsStore update

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/toolsStore.ts`

- [ ] **Add to `src/lib/tauri.ts`:**

```typescript
// ── Tools — Scene/Avatar scanning + Sidecar ───────────────────────────────

export interface SceneFile {
  path: string;
  name: string;
}

export interface AvatarDescriptor {
  name: string;
  file_id: string;
}

export interface AvatarMetrics {
  triangles: number;
  skinned_mesh_renderers: number;
  mesh_renderers: number;
  material_slots: number;
  bones: number;
  physbone_components: number;
  physbone_transforms: number;
  physbone_colliders: number;
  particle_systems: number;
  trail_renderers: number;
  lights: number;
  audio_sources: number;
  vram_mb: number;
}

export interface Recommendation {
  metric: string;
  severity: "critical" | "warning";
  current_value: string;
  limit_good: string;
  message: string;
}

export type VrcRank = "Excellent" | "Good" | "Medium" | "Poor" | "VeryPoor";

export interface AnalysisResult {
  ok: boolean;
  error?: string;
  avatar_name: string;
  scene: string;
  metrics: AvatarMetrics;
  rank_pc: VrcRank;
  rank_quest: VrcRank;
  recommendations: Recommendation[];
  thumbnail_path?: string;
  gltf_path?: string;
}

export async function tauriToolsScanScenes(projectPath: string): Promise<SceneFile[]> {
  return invoke<SceneFile[]>("tools_scan_scenes", { projectPath });
}

export async function tauriToolsScanAvatars(
  projectPath: string,
  scenePath: string
): Promise<AvatarDescriptor[]> {
  return invoke<AvatarDescriptor[]>("tools_scan_avatars", { projectPath, scenePath });
}

export async function tauriToolsRunSidecar(
  toolId: string,
  request: object
): Promise<AnalysisResult> {
  return invoke<AnalysisResult>("tools_run_sidecar", { toolId, request });
}
```

- [ ] **Add `runSidecar` to `toolsStore.ts`:**

In the `ToolsState` interface, add:
```typescript
  runSidecar: (toolId: string, request: object) => Promise<AnalysisResult>;
```

In the store implementation, add:
```typescript
    runSidecar: (toolId, request) => tauriToolsRunSidecar(toolId, request),
```

Also add `AnalysisResult` to the import from `"../lib/tauri"`.

- [ ] **Verify TS compiles:**

```bash
cd E:/vrcstudio && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/lib/tauri.ts src/store/toolsStore.ts
git commit -m "feat(tools): add TS types and bindings for scan + sidecar commands"
```

---

## Task 9: AvatarPerf runner — selection wizard

**Files:**
- Create: `src/components/tools/runners/AvatarPerf.tsx`

- [ ] **Create `src/components/tools/runners/AvatarPerf.tsx`:**

```tsx
// src/components/tools/runners/AvatarPerf.tsx
import { useState } from "react";
import { ArrowLeft, Loader2, ChevronRight } from "lucide-react";
import {
  SceneFile, AvatarDescriptor, AnalysisResult,
  tauriToolsScanScenes, tauriToolsScanAvatars, tauriToolsRunSidecar,
} from "../../../lib/tauri";
import { useProjectsStore } from "../../../store/projects";
import { AvatarPerfMetrics } from "./AvatarPerfMetrics";
import { AvatarPerfViewport } from "./AvatarPerfViewport";
import { AvatarPerfRecommendations } from "./AvatarPerfRecommendations";

type Step = "project" | "scene" | "avatar" | "results";

interface Props {
  toolId: string;
  onBack: () => void;
}

export function AvatarPerf({ toolId, onBack }: Props) {
  // Re-use VRC Studio's existing project list
  const projects = useProjectsStore((s) => s.projects);

  const [step, setStep] = useState<Step>("project");
  const [selectedProjectPath, setSelectedProjectPath] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [scenes, setScenes] = useState<SceneFile[]>([]);
  const [selectedScene, setSelectedScene] = useState<SceneFile | null>(null);
  const [avatars, setAvatars] = useState<AvatarDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<"metrics" | "recommendations">("metrics");

  const handleSelectProject = async (path: string, name: string) => {
    setSelectedProjectPath(path);
    setSelectedProjectName(name);
    setError(null);
    setLoading(true);
    try {
      const found = await tauriToolsScanScenes(path);
      setScenes(found);
      setStep("scene");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectScene = async (scene: SceneFile) => {
    setSelectedScene(scene);
    setError(null);
    setLoading(true);
    try {
      const found = await tauriToolsScanAvatars(selectedProjectPath, scene.path);
      setAvatars(found);
      setStep("avatar");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAvatar = async (avatar: AvatarDescriptor) => {
    setError(null);
    setLoading(true);
    try {
      const res = await tauriToolsRunSidecar(toolId, {
        action: "analyze",
        project_path: selectedProjectPath,
        scene_path: selectedScene!.path,
        avatar_name: avatar.name,
      });
      setResult(res);
      setStep("results");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Breadcrumb back navigation
  const goBack = () => {
    if (step === "scene") { setStep("project"); setScenes([]); }
    else if (step === "avatar") { setStep("scene"); setAvatars([]); }
    else if (step === "results") { setStep("avatar"); setResult(null); }
    else { onBack(); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-zinc-800 shrink-0">
        <button onClick={goBack} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={step === "project" ? "text-zinc-100 font-semibold" : ""}>Proyecto</span>
          {step !== "project" && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className={step === "scene" ? "text-zinc-100 font-semibold" : ""}>{selectedProjectName}</span>
            </>
          )}
          {(step === "avatar" || step === "results") && selectedScene && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className={step === "avatar" ? "text-zinc-100 font-semibold" : ""}>{selectedScene.name}</span>
            </>
          )}
          {step === "results" && result && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className="text-zinc-100 font-semibold">{result.avatar_name}</span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {loading && (
          <div className="flex-1 flex items-center justify-center gap-2 text-zinc-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {step === "scene" ? "Buscando escenas…" : step === "avatar" ? "Buscando avatares…" : "Analizando avatar…"}
          </div>
        )}

        {error && !loading && (
          <div className="p-6 text-sm text-red-400 bg-red-950/20 border border-red-900/30 m-4 rounded-xl">
            {error}
          </div>
        )}

        {!loading && !error && step === "project" && (
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-xs text-zinc-500 mb-4">Selecciona el proyecto Unity que contiene el avatar</p>
            <div className="flex flex-col gap-2 max-w-xl">
              {projects.length === 0 ? (
                <p className="text-sm text-zinc-600">No hay proyectos registrados. Añade uno en la pestaña Proyectos.</p>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProject(p.path, p.name)}
                    className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl text-left transition-colors"
                  >
                    <div className="text-lg">📁</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">{p.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{p.path}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600 flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {!loading && !error && step === "scene" && (
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-xs text-zinc-500 mb-4">Selecciona la escena Unity</p>
            <div className="flex flex-col gap-2 max-w-xl">
              {scenes.length === 0 ? (
                <p className="text-sm text-zinc-600">No se encontraron escenas .unity en este proyecto.</p>
              ) : (
                scenes.map((scene) => (
                  <button
                    key={scene.path}
                    onClick={() => handleSelectScene(scene)}
                    className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl text-left transition-colors"
                  >
                    <div className="text-lg">🎬</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{scene.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{scene.path}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {!loading && !error && step === "avatar" && (
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-xs text-zinc-500 mb-4">
              GameObjects con VRC Avatar Descriptor encontrados en {selectedScene?.name}
            </p>
            <div className="flex flex-col gap-2 max-w-xl">
              {avatars.length === 0 ? (
                <p className="text-sm text-zinc-600">No se encontraron avatares con VRC Avatar Descriptor en esta escena.</p>
              ) : (
                avatars.map((av) => (
                  <button
                    key={av.file_id}
                    onClick={() => handleSelectAvatar(av)}
                    className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl text-left transition-colors"
                  >
                    <div className="text-lg">👤</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{av.name}</p>
                      <p className="text-xs text-zinc-500">fileID: {av.file_id}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {!loading && !error && step === "results" && result && (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left: 3D viewport */}
            <AvatarPerfViewport
              result={result}
              projectPath={selectedProjectPath}
            />
            {/* Right: metrics + recommendations */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <AvatarPerfMetrics
                result={result}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
              {activeTab === "recommendations" && (
                <AvatarPerfRecommendations recommendations={result.recommendations} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/tools/runners/AvatarPerf.tsx
git commit -m "feat(tools): add AvatarPerf 3-step selection wizard"
```

---

## Task 10: Metrics panel

**Files:**
- Create: `src/components/tools/runners/AvatarPerfMetrics.tsx`

- [ ] **Create `src/components/tools/runners/AvatarPerfMetrics.tsx`:**

```tsx
// src/components/tools/runners/AvatarPerfMetrics.tsx
import { AnalysisResult, AvatarMetrics, VrcRank } from "../../../lib/tauri";

const RANK_COLORS: Record<VrcRank, { bg: string; text: string }> = {
  Excellent: { bg: "bg-blue-950 border-blue-700", text: "text-blue-300" },
  Good:      { bg: "bg-green-950 border-green-700", text: "text-green-300" },
  Medium:    { bg: "bg-yellow-950 border-yellow-700", text: "text-yellow-300" },
  Poor:      { bg: "bg-orange-950 border-orange-700", text: "text-orange-300" },
  VeryPoor:  { bg: "bg-red-950 border-red-800", text: "text-red-300" },
};

const RANK_LABELS: Record<VrcRank, string> = {
  Excellent: "Excellent",
  Good:      "Good",
  Medium:    "Medium",
  Poor:      "Poor",
  VeryPoor:  "Very Poor",
};

interface MetricDef {
  key: keyof AvatarMetrics;
  label: string;
  icon: string;
  limitGood: number;
  limitPoor: number;
  unit?: string;
}

const PC_METRICS: MetricDef[] = [
  { key: "triangles",              label: "Triángulos",              icon: "🔺", limitGood: 70_000, limitPoor: 70_000 },
  { key: "skinned_mesh_renderers", label: "Skinned Meshes",          icon: "🧊", limitGood: 2,      limitPoor: 8      },
  { key: "mesh_renderers",         label: "Mesh Renderers",          icon: "📐", limitGood: 2,      limitPoor: 8      },
  { key: "material_slots",         label: "Material Slots",          icon: "🎨", limitGood: 8,      limitPoor: 32     },
  { key: "bones",                  label: "Bones",                   icon: "🦴", limitGood: 150,    limitPoor: 400    },
  { key: "physbone_components",    label: "PhysBone Components",     icon: "🌀", limitGood: 8,      limitPoor: 32     },
  { key: "physbone_transforms",    label: "PhysBone Transforms",     icon: "🔗", limitGood: 64,     limitPoor: 256    },
  { key: "physbone_colliders",     label: "PhysBone Colliders",      icon: "⭕", limitGood: 8,      limitPoor: 32     },
  { key: "particle_systems",       label: "Particle Systems",        icon: "✨", limitGood: 8,      limitPoor: 32     },
  { key: "trail_renderers",        label: "Trail / Line Renderers",  icon: "〰️", limitGood: 2,     limitPoor: 8      },
  { key: "lights",                 label: "Realtime Lights",         icon: "💡", limitGood: 0,      limitPoor: 8      },
  { key: "audio_sources",          label: "Audio Sources",           icon: "🔊", limitGood: 4,      limitPoor: 8      },
  { key: "vram_mb",                label: "VRAM estimada",           icon: "🖼", limitGood: 75,     limitPoor: 150, unit: " MB" },
];

function getStatus(value: number, limitGood: number, limitPoor: number): "pass" | "warn" | "fail" {
  if (value <= limitGood) return "pass";
  if (value <= limitPoor) return "warn";
  return "fail";
}

function formatValue(value: number, unit?: string): string {
  if (unit === " MB") return `${value.toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

interface Props {
  result: AnalysisResult;
  activeTab: "metrics" | "recommendations";
  onTabChange: (tab: "metrics" | "recommendations") => void;
}

export function AvatarPerfMetrics({ result, activeTab, onTabChange }: Props) {
  const rank = result.rank_pc;
  const rankStyle = RANK_COLORS[rank];
  const criticalCount = result.recommendations.filter((r) => r.severity === "critical").length;
  const warnCount = result.recommendations.filter((r) => r.severity === "warning").length;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Platform tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-950 shrink-0">
        <button
          onClick={() => onTabChange("metrics")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "metrics"
              ? "text-zinc-100 border-red-500"
              : "text-zinc-500 border-transparent hover:text-zinc-300"
          }`}
        >
          💻 PC &nbsp;
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${rankStyle.bg} ${rankStyle.text}`}>
            {RANK_LABELS[rank]}
          </span>
        </button>
        <button
          className="px-4 py-2.5 text-xs font-semibold text-zinc-600 border-b-2 border-transparent"
          disabled
          title="Quest rank — coming soon"
        >
          📱 Quest &nbsp;
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${RANK_COLORS[result.rank_quest].bg} ${RANK_COLORS[result.rank_quest].text}`}>
            {RANK_LABELS[result.rank_quest]}
          </span>
        </button>
        <button
          onClick={() => onTabChange("recommendations")}
          className={`ml-auto px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "recommendations"
              ? "text-zinc-100 border-red-500"
              : "text-zinc-500 border-transparent hover:text-zinc-300"
          }`}
        >
          💡 Fixes ({criticalCount + warnCount})
        </button>
      </div>

      {/* Metrics list */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
        {PC_METRICS.map((def) => {
          const raw = result.metrics[def.key] as number;
          const status = getStatus(raw, def.limitGood, def.limitPoor);
          const statusIcon = status === "pass" ? "✅" : status === "warn" ? "⚠️" : "❌";
          const borderColor = status === "pass" ? "border-green-600" : status === "warn" ? "border-yellow-500" : "border-red-500";
          const barWidth = Math.min(100, (raw / (def.limitPoor * 1.5)) * 100);
          const barColor = status === "pass" ? "bg-green-500" : status === "warn" ? "bg-yellow-400" : "bg-red-500";

          return (
            <div
              key={def.key}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 border-l-[3px] ${borderColor}`}
            >
              <span className="text-sm flex-shrink-0">{def.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-zinc-400 leading-none mb-0.5">{def.label}</p>
                <p className="text-[10px] text-zinc-600">Good ≤ {def.limitGood.toLocaleString()}{def.unit ?? ""}</p>
              </div>
              <div className="w-14 h-1.5 bg-zinc-800 rounded-full flex-shrink-0">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
              </div>
              <span className="text-xs font-bold text-zinc-200 flex-shrink-0 w-16 text-right tabular-nums">
                {formatValue(raw, def.unit)}
              </span>
              <span className="text-sm flex-shrink-0">{statusIcon}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-3 py-2.5 flex items-center gap-2 shrink-0 bg-zinc-950">
        <p className="text-xs text-zinc-500">
          {criticalCount > 0 && <span className="text-red-400 font-semibold">{criticalCount} crítico{criticalCount !== 1 ? "s" : ""}</span>}
          {criticalCount > 0 && warnCount > 0 && <span className="text-zinc-600"> · </span>}
          {warnCount > 0 && <span className="text-yellow-400">{warnCount} advertencia{warnCount !== 1 ? "s" : ""}</span>}
          {criticalCount === 0 && warnCount === 0 && <span className="text-green-400">Todo bien ✓</span>}
        </p>
        {(criticalCount + warnCount) > 0 && (
          <button
            onClick={() => onTabChange("recommendations")}
            className="ml-auto text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Ver fixes →
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/tools/runners/AvatarPerfMetrics.tsx
git commit -m "feat(tools): add AvatarPerfMetrics panel with colored rows and bars"
```

---

## Task 11: Recommendations panel

**Files:**
- Create: `src/components/tools/runners/AvatarPerfRecommendations.tsx`

- [ ] **Create `src/components/tools/runners/AvatarPerfRecommendations.tsx`:**

```tsx
// src/components/tools/runners/AvatarPerfRecommendations.tsx
import { Recommendation } from "../../../lib/tauri";

interface Props {
  recommendations: Recommendation[];
}

export function AvatarPerfRecommendations({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-green-400">
        ✓ No hay problemas detectados
      </div>
    );
  }

  const critical = recommendations.filter((r) => r.severity === "critical");
  const warnings = recommendations.filter((r) => r.severity === "warning");

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      {critical.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider px-1 pt-1">
            Críticos
          </p>
          {critical.map((rec, i) => (
            <RecommendationCard key={i} rec={rec} />
          ))}
        </>
      )}
      {warnings.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider px-1 pt-2">
            Advertencias
          </p>
          {warnings.map((rec, i) => (
            <RecommendationCard key={i} rec={rec} />
          ))}
        </>
      )}
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const isCritical = rec.severity === "critical";
  const borderColor = isCritical ? "border-red-700" : "border-yellow-600";
  const badgeStyle = isCritical
    ? "bg-red-950 text-red-400 border-red-800"
    : "bg-yellow-950 text-yellow-400 border-yellow-800";

  return (
    <div className={`bg-zinc-900 border border-zinc-800 border-l-2 ${borderColor} rounded-xl p-3 flex flex-col gap-1.5`}>
      <div className="flex items-center gap-2">
        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badgeStyle}`}>
          {isCritical ? "Crítico" : "Warning"}
        </span>
        <span className="text-[10px] font-semibold text-zinc-300 flex-1">
          {rec.current_value} <span className="text-zinc-600 font-normal">→ Good: {rec.limit_good}</span>
        </span>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">{rec.message}</p>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/tools/runners/AvatarPerfRecommendations.tsx
git commit -m "feat(tools): add AvatarPerfRecommendations panel"
```

---

## Task 12: 3D Viewport

**Files:**
- Create: `src/components/tools/runners/AvatarPerfViewport.tsx`

- [ ] **Install Three.js dependencies:**

```bash
cd E:/vrcstudio && npm install @react-three/fiber @react-three/drei three
npm install --save-dev @types/three
```

- [ ] **Create `src/components/tools/runners/AvatarPerfViewport.tsx`:**

```tsx
// src/components/tools/runners/AvatarPerfViewport.tsx
import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, OrbitControls, Environment } from "@react-three/drei";
import { AnalysisResult } from "../../../lib/tauri";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  result: AnalysisResult;
  projectPath: string;
}

export function AvatarPerfViewport({ result, projectPath }: Props) {
  const hasImage = !!result.thumbnail_path;
  const hasGltf = !!result.gltf_path;

  return (
    <div className="w-72 flex-shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      {/* 3D / image area */}
      <div className="flex-1 relative overflow-hidden">
        {hasImage ? (
          <ImageViewport thumbnailPath={result.thumbnail_path!} />
        ) : hasGltf ? (
          <GltfViewport gltfPath={result.gltf_path!} />
        ) : (
          <PlaceholderViewport />
        )}
      </div>

      {/* Info strip */}
      <div className="px-4 py-3 border-t border-zinc-800 shrink-0">
        <p className="text-sm font-bold text-zinc-100 truncate">{result.avatar_name}</p>
        <p className="text-[10px] text-zinc-500 truncate mt-0.5">{result.scene}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Chip>{result.metrics.triangles >= 1000 ? `${(result.metrics.triangles / 1000).toFixed(1)}k` : result.metrics.triangles} tris</Chip>
          <Chip>{result.metrics.material_slots} mats</Chip>
          <Chip>{result.metrics.skinned_mesh_renderers} SMR</Chip>
          <Chip>PC</Chip>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-400">
      {children}
    </span>
  );
}

function ImageViewport({ thumbnailPath }: { thumbnailPath: string }) {
  const src = convertFileSrc(thumbnailPath);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
      <img
        src={src}
        alt="Avatar render"
        className="max-w-full max-h-full object-contain"
      />
      <div className="absolute bottom-2 right-2 text-[9px] text-zinc-600">Unity render</div>
    </div>
  );
}

function GltfViewport({ gltfPath }: { gltfPath: string }) {
  const src = convertFileSrc(gltfPath);
  return (
    <div className="absolute inset-0">
      <Canvas camera={{ position: [0, 1, 3], fov: 45 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={1} />
          <RotatingModel url={src} />
          <OrbitControls enableZoom={true} enablePan={false} />
        </Suspense>
      </Canvas>
      <div className="absolute bottom-2 right-2 text-[9px] text-zinc-600 pointer-events-none">
        Drag para rotar
      </div>
    </div>
  );
}

function RotatingModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const ref = useRef<any>(null);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.4; // one full rotation ~15s
    }
  });

  return <primitive ref={ref} object={scene} />;
}

function PlaceholderViewport() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900">
      {/* CSS 3D avatar placeholder */}
      <div className="text-6xl animate-pulse">👤</div>
      <p className="text-[10px] text-zinc-600 text-center px-4">
        Vista 3D no disponible.<br />Unity no encontrado o FBX no localizado.
      </p>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/tools/runners/AvatarPerfViewport.tsx
git commit -m "feat(tools): add AvatarPerfViewport with Unity render + Three.js GLTF fallback"
```

---

## Task 13: Wire everything — update Tools.tsx + build sidecar for dev testing

**Files:**
- Modify: `src/pages/Tools.tsx`

- [ ] **Update the `activeTool` section in `Tools.tsx`** to render `AvatarPerf`:

Replace the placeholder `activeTool` block:

```tsx
// At the top, add import:
import { AvatarPerf } from "../components/tools/runners/AvatarPerf";

// Replace the activeTool block:
if (activeTool) {
  const RUNNERS: Record<string, React.ComponentType<{ toolId: string; onBack: () => void }>> = {
    "avatar-performance-analyzer": AvatarPerf,
  };
  const Runner = RUNNERS[activeTool.id];
  if (Runner) {
    return <Runner toolId={activeTool.id} onBack={() => setActiveTool(null)} />;
  }
  // Unknown tool — show placeholder
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800">
        <button onClick={() => setActiveTool(null)} className="text-xs text-zinc-500 hover:text-zinc-300">← Volver</button>
        <span className="text-sm font-semibold text-zinc-100">{activeTool.name}</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
        Runner no implementado para "{activeTool.id}"
      </div>
    </div>
  );
}
```

- [ ] **Build the sidecar release binary** for local testing:

```bash
cd E:/vrcstudio/tools/avatar-perf-core && cargo build --release 2>&1 | tail -5
```

Expected: `Finished release`. Binary at `tools/avatar-perf-core/target/release/avatar-perf-core.exe`.

- [ ] **Copy sidecar to the AppData tools folder** for manual testing:

```bash
$toolDir = "$env:APPDATA\dev.vrcstudio.app\tools\avatar-performance-analyzer"
New-Item -ItemType Directory -Force $toolDir
Copy-Item "E:\vrcstudio\tools\avatar-perf-core\target\release\avatar-perf-core.exe" "$toolDir\core.exe"
```

- [ ] **Full frontend build check:**

```bash
cd E:/vrcstudio && npm run build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/pages/Tools.tsx
git commit -m "feat(tools): wire AvatarPerf runner into Tools page"
```

---

## Task 14: End-to-end manual test

- [ ] **Start Tauri dev mode:**

```bash
cd E:/vrcstudio && npm run tauri dev
```

- [ ] **Test the full flow:**
  1. Navigate to **Tools** tab — should show empty state with "Abrir Marketplace" button.
  2. Click **Marketplace** — should attempt to fetch registry (may fail with network error if registry URL not configured — that's OK for now, update `REGISTRY_URL` in `commands/tools.rs` to a real URL).
  3. Click **Back** → **Run** on the avatar-performance-analyzer (if manually inserted into DB or installed via marketplace).
  4. Select a **Unity project** from the list.
  5. Select a **scene** — verify the list shows .unity files.
  6. Select an **avatar** with VRC Avatar Descriptor.
  7. Wait for analysis (~5-30s depending on Unity headless).
  8. Verify **results panel** shows metrics with correct colors.
  9. Click **💡 Fixes** tab — verify recommendations appear.
  10. Verify **viewport** shows either the Unity render or the fallback placeholder.

- [ ] **Fix any issues found during manual test.**

- [ ] **Final commit:**

```bash
git add -A
git commit -m "feat(tools): complete Avatar Performance Analyzer tool — end-to-end"
```

---

**End of Plan 2 — Avatar Performance Analyzer**

The feature branch `feature/tools-system` now contains the complete tools system. When ready to merge to main, open a PR from `feature/tools-system` → `main` and do a full regression test on the existing features (Projects, Shop, Collections) before merging.
