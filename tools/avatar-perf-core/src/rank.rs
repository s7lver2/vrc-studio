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

fn within(m: &AvatarMetrics, t: &Thresholds) -> bool {
    m.triangles              <= t.triangles
    && m.skinned_mesh_renderers <= t.skinned_mesh_renderers
    && m.mesh_renderers         <= t.mesh_renderers
    && m.material_slots         <= t.material_slots
    && m.bones                  <= t.bones
    && m.physbone_components    <= t.physbone_components
    && m.physbone_transforms    <= t.physbone_transforms
    && m.physbone_colliders     <= t.physbone_colliders
    && m.particle_systems       <= t.particle_systems
    && m.trail_renderers        <= t.trail_renderers
    && m.lights                 <= t.lights
    && m.audio_sources          <= t.audio_sources
    && m.vram_mb                <= t.vram_mb
}

pub fn calculate_pc(m: &AvatarMetrics) -> VrcRank {
    if within(m, &Thresholds { triangles: 32_000, skinned_mesh_renderers: 1, mesh_renderers: 1,  material_slots: 4,  bones: 75,  physbone_components: 4,  physbone_transforms: 16,  physbone_colliders: 0,  particle_systems: 0,  trail_renderers: 1, lights: 0, audio_sources: 1, vram_mb: 40.0  }) { return VrcRank::Excellent; }
    if within(m, &Thresholds { triangles: 70_000, skinned_mesh_renderers: 2, mesh_renderers: 2,  material_slots: 8,  bones: 150, physbone_components: 8,  physbone_transforms: 64,  physbone_colliders: 8,  particle_systems: 8,  trail_renderers: 2, lights: 0, audio_sources: 4, vram_mb: 75.0  }) { return VrcRank::Good; }
    if within(m, &Thresholds { triangles: 70_000, skinned_mesh_renderers: 2, mesh_renderers: 4,  material_slots: 16, bones: 256, physbone_components: 16, physbone_transforms: 128, physbone_colliders: 16, particle_systems: 16, trail_renderers: 4, lights: 0, audio_sources: 8, vram_mb: 110.0 }) { return VrcRank::Medium; }
    if within(m, &Thresholds { triangles: 70_000, skinned_mesh_renderers: 8, mesh_renderers: 8,  material_slots: 32, bones: 400, physbone_components: 32, physbone_transforms: 256, physbone_colliders: 32, particle_systems: 32, trail_renderers: 8, lights: 8, audio_sources: 8, vram_mb: 150.0 }) { return VrcRank::Poor; }
    VrcRank::VeryPoor
}

pub fn calculate_quest(m: &AvatarMetrics) -> VrcRank {
    if within(m, &Thresholds { triangles: 7_500,  skinned_mesh_renderers: 1, mesh_renderers: 1, material_slots: 4,  bones: 75,  physbone_components: 4,  physbone_transforms: 16,  physbone_colliders: 0,  particle_systems: 0, trail_renderers: 0, lights: 0, audio_sources: 1, vram_mb: 10.0 }) { return VrcRank::Excellent; }
    if within(m, &Thresholds { triangles: 10_000, skinned_mesh_renderers: 1, mesh_renderers: 1, material_slots: 4,  bones: 150, physbone_components: 6,  physbone_transforms: 32,  physbone_colliders: 4,  particle_systems: 0, trail_renderers: 0, lights: 0, audio_sources: 1, vram_mb: 18.0 }) { return VrcRank::Good; }
    if within(m, &Thresholds { triangles: 15_000, skinned_mesh_renderers: 2, mesh_renderers: 2, material_slots: 8,  bones: 256, physbone_components: 8,  physbone_transforms: 64,  physbone_colliders: 8,  particle_systems: 0, trail_renderers: 0, lights: 0, audio_sources: 2, vram_mb: 25.0 }) { return VrcRank::Medium; }
    if within(m, &Thresholds { triangles: 20_000, skinned_mesh_renderers: 2, mesh_renderers: 2, material_slots: 16, bones: 400, physbone_components: 16, physbone_transforms: 128, physbone_colliders: 16, particle_systems: 0, trail_renderers: 0, lights: 0, audio_sources: 4, vram_mb: 40.0 }) { return VrcRank::Poor; }
    VrcRank::VeryPoor
}
