// tools/avatar-perf-core/src/types.rs
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
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
    pub severity: String,
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
    pub thumbnail_path: Option<String>,
    pub gltf_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnalysisRequest {
    pub action: String,
    pub project_path: String,
    pub scene_path: String,
    pub avatar_name: String,
}

#[derive(Debug, Serialize)]
pub struct ProgressMessage {
    pub progress: f64,
    pub step: String,
}
