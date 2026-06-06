// tools/avatar-perf-core/src/recommendations.rs
use crate::types::{AvatarMetrics, Recommendation, VrcRank};

pub fn generate(metrics: &AvatarMetrics, rank: &VrcRank) -> Vec<Recommendation> {
    let _ = rank;
    let mut recs = Vec::new();

    if metrics.triangles > 70_000 {
        recs.push(Recommendation {
            metric: "triangles".into(),
            severity: "critical".into(),
            current_value: metrics.triangles.to_string(),
            limit_good: "70,000".into(),
            message: format!(
                "El avatar tiene {} triángulos, supera el límite de Poor (70k). Usa Blender para reducir polígonos con Decimate Modifier. Objetivo: reducir ~{} triángulos.",
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
                "{} triángulos. Para Excellent necesitas ≤32k. Considera reducir mallas secundarias.",
                metrics.triangles
            ),
        });
    }

    if metrics.physbone_components > 32 {
        recs.push(Recommendation {
            metric: "physbone_components".into(),
            severity: "critical".into(),
            current_value: metrics.physbone_components.to_string(),
            limit_good: "8".into(),
            message: format!(
                "{} PhysBone components. El límite para Good es 8. Combina cadenas de huesos cortas en un solo PhysBone.",
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

    if metrics.physbone_transforms > 256 {
        recs.push(Recommendation {
            metric: "physbone_transforms".into(),
            severity: "critical".into(),
            current_value: metrics.physbone_transforms.to_string(),
            limit_good: "64".into(),
            message: "Demasiados transforms afectados por PhysBones. Reduce la longitud de las cadenas de huesos en el rig.".into(),
        });
    }

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
            message: format!("VRAM estimada en {:.0} MB. Comprime texturas a DXT5/BC7.", metrics.vram_mb),
        });
    }

    if metrics.skinned_mesh_renderers > 8 {
        recs.push(Recommendation {
            metric: "skinned_mesh_renderers".into(),
            severity: "critical".into(),
            current_value: metrics.skinned_mesh_renderers.to_string(),
            limit_good: "2".into(),
            message: format!(
                "{} Skinned Mesh Renderers. Combina meshes con 'Merge Skinned Mesh' de Modular Avatar o d4rkOptimizer.",
                metrics.skinned_mesh_renderers
            ),
        });
    }

    if metrics.lights > 0 {
        recs.push(Recommendation {
            metric: "lights".into(),
            severity: "critical".into(),
            current_value: metrics.lights.to_string(),
            limit_good: "0".into(),
            message: format!(
                "{} luz(ces) activa(s). Las luces en tiempo real tienen coste alto. Desactívalas por defecto o elimínalas.",
                metrics.lights
            ),
        });
    }

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
