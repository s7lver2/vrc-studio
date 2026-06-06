// tools/avatar-perf-core/src/analyze.rs
use crate::types::AvatarMetrics;
use crate::unity_yaml::{UnityDocument, build_index, find_gameobject_by_name};
use regex::Regex;
use std::collections::HashSet;

const PHYSBONE_GUIDS: &[&str] = &[
    "5256ffe4e7c8bc64faca93e67f9e7a4c",
    "bb5dbbcc9a9cda54d879ebcc70395f5c",
];
const PHYSBONE_COLLIDER_GUIDS: &[&str] = &[
    "f47de16e5f18e74418bf9f0e35dce71a",
];

pub fn count_metrics(
    docs: &[UnityDocument],
    avatar_name: &str,
    project_path: &str,
) -> AvatarMetrics {
    let index = build_index(docs);
    let avatar_gos = find_gameobject_by_name(docs, avatar_name);
    let root_file_id = avatar_gos.first().map(|d| d.file_id).unwrap_or(0);
    let avatar_file_ids = collect_hierarchy(docs, root_file_id, &index);

    let mut metrics = AvatarMetrics::default();

    for doc in docs {
        if !is_in_hierarchy(doc, &avatar_file_ids) {
            continue;
        }

        match doc.class_id {
            137 => {
                // SkinnedMeshRenderer
                metrics.skinned_mesh_renderers += 1;
                metrics.material_slots += count_material_slots(doc);
            }
            23 => {
                // MeshRenderer
                metrics.mesh_renderers += 1;
                metrics.material_slots += count_material_slots(doc);
            }
            108 => { metrics.lights += 1; }
            82  => { metrics.audio_sources += 1; }
            96  => { metrics.trail_renderers += 1; } // TrailRenderer
            120 => { metrics.trail_renderers += 1; } // LineRenderer
            198 => { metrics.particle_systems += 1; } // ParticleSystem
            114 => { count_monobehaviour(doc, &mut metrics); }
            _ => {}
        }
    }

    metrics.bones = count_bones(docs, root_file_id);
    metrics.triangles = estimate_triangles(docs, project_path, &avatar_file_ids, &index);
    metrics.vram_mb = estimate_vram(project_path);

    metrics
}

fn count_material_slots(doc: &UnityDocument) -> u32 {
    doc.count_list_entries("m_Materials")
}

fn count_monobehaviour(doc: &UnityDocument, metrics: &mut AvatarMetrics) {
    if let Some(guid) = doc.get_guid_field("m_Script") {
        if PHYSBONE_GUIDS.contains(&guid.as_str()) {
            metrics.physbone_components += 1;
            metrics.physbone_transforms += estimate_physbone_transforms(doc);
            return;
        }
        if PHYSBONE_COLLIDER_GUIDS.contains(&guid.as_str()) {
            metrics.physbone_colliders += 1;
            return;
        }
    }
    // Fallback: detect by unique fields
    if doc.raw.contains("m_RootTransform:") && doc.raw.contains("m_Pull:") {
        metrics.physbone_components += 1;
        metrics.physbone_transforms += estimate_physbone_transforms(doc);
    }
}

fn estimate_physbone_transforms(doc: &UnityDocument) -> u32 {
    if doc.raw.contains("m_EndpointPosition:") { 8 } else { 4 }
}

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
    if let Some(go_doc) = index.get(&go_file_id) {
        for comp_id in go_doc.get_component_file_ids() {
            visited.insert(comp_id);
            if let Some(comp_doc) = index.get(&comp_id) {
                if comp_doc.class_id == 4 {
                    for child_transform_id in comp_doc.get_list_file_ids("m_Children") {
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

fn is_in_hierarchy(doc: &UnityDocument, hierarchy: &HashSet<u64>) -> bool {
    if hierarchy.is_empty() { return true; }
    hierarchy.contains(&doc.file_id)
}

fn count_bones(docs: &[UnityDocument], root_go_id: u64) -> u32 {
    if root_go_id == 0 { return 0; }
    docs.iter().filter(|d| d.class_id == 4).count() as u32
}

fn estimate_triangles(
    docs: &[UnityDocument],
    project_path: &str,
    hierarchy: &HashSet<u64>,
    index: &std::collections::HashMap<u64, &UnityDocument>,
) -> u64 {
    let _ = index;
    let mut total = 0u64;
    for doc in docs {
        if doc.class_id != 137 { continue; }
        if !hierarchy.is_empty() && !hierarchy.contains(&doc.file_id) { continue; }
        if let Some(mesh_guid) = doc.get_guid_field("m_Mesh") {
            if let Some(count) = count_triangles_for_guid(project_path, &mesh_guid) {
                total += count;
            }
        }
    }
    total
}

fn count_triangles_for_guid(project_path: &str, guid: &str) -> Option<u64> {
    let assets_dir = std::path::Path::new(project_path).join("Assets");
    if !assets_dir.exists() { return None; }
    let meta_path = find_meta_for_guid(&assets_dir, guid)?;
    let asset_path = meta_path.trim_end_matches(".meta").to_string();
    let asset_path = std::path::Path::new(&asset_path);
    let ext = asset_path.extension()?.to_str()?.to_lowercase();
    match ext.as_str() {
        "fbx" => count_fbx_triangles(asset_path),
        "obj" => count_obj_triangles(asset_path),
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

fn count_obj_triangles(path: &std::path::Path) -> Option<u64> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    let mut triangles = 0u64;
    for line in reader.lines().filter_map(|l| l.ok()) {
        let line = line.trim();
        if line.starts_with("f ") {
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
    for line in reader.lines().filter_map(|l| l.ok()) {
        if let Some(cap) = re.captures(&line) {
            let index_count: u64 = cap[1].parse().ok()?;
            return Some(index_count / 3);
        }
    }
    None
}

fn estimate_vram(project_path: &str) -> f64 {
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
    let estimated_mb = (total_bytes as f64 * 1.5) / (1024.0 * 1024.0);
    (estimated_mb * 10.0).round() / 10.0
}
