//! Parser para archivos .prefab y .controller de Unity.
//!
//! El formato Unity no es YAML estándar — tiene `%TAG !u!` y headers
//! `--- !u!<classID> &<fileID>`. Parseamos manualmente sin dependencias externas.

use std::collections::HashMap;
use std::path::Path;

use crate::models::{
    AnimLayerInfo, AnimStateInfo, AvatarInfo, PrefabNode, PrefabScene,
};

// ── ClassIDs relevantes ──────────────────────────────────────────────────────

const CLASS_GAME_OBJECT: u32  = 1;
const CLASS_TRANSFORM: u32    = 4;
const CLASS_ANIMATOR: u32     = 95;
const CLASS_MONO_BEHAVIOUR: u32 = 114;

// GUID conocido de VRC_AvatarDescriptor (SDK3). Si no matchea, buscamos
// ViewPosition en el MonoBehaviour genéricamente.
const VRC_DESCRIPTOR_GUID: &str = "a9a1b72893d3b5d42a0a7e25b8f4d33b";

// ── Tipos internos ───────────────────────────────────────────────────────────

#[derive(Debug, Default)]
struct RawGameObject {
    file_id: u64,
    name: String,
    is_active: bool,
    // fileIDs de Transform hijos (de m_Children)
    child_transform_ids: Vec<u64>,
}

#[derive(Debug, Default)]
struct RawTransform {
    file_id: u64,
    game_object_id: u64,
    father_id: u64, // 0 = raíz
}

#[derive(Debug, Default)]
struct RawAnimator {
    controller_guid: Option<String>,
}

#[derive(Debug, Default)]
struct RawMonoBehaviour {
    script_guid: Option<String>,
    view_position: Option<[f32; 3]>,
    lip_sync_mode: Option<u8>,
}

// ── Parser de bloques ────────────────────────────────────────────────────────

/// Extrae el valor de una línea con formato `  key: value`
fn get_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let trimmed = line.trim();
    let prefix = format!("{}:", key);
    if trimmed.starts_with(&prefix) {
        Some(trimmed[prefix.len()..].trim())
    } else {
        None
    }
}

/// Parsea `{x: 0, y: 1.62, z: 0.06}` en [f32; 3]
fn parse_vec3(s: &str) -> Option<[f32; 3]> {
    let inner = s.trim().trim_start_matches('{').trim_end_matches('}');
    let mut x = 0.0f32;
    let mut y = 0.0f32;
    let mut z = 0.0f32;
    for part in inner.split(',') {
        let kv: Vec<&str> = part.splitn(2, ':').collect();
        if kv.len() != 2 { continue; }
        let k = kv[0].trim();
        let v: f32 = kv[1].trim().parse().ok()?;
        match k {
            "x" => x = v,
            "y" => y = v,
            "z" => z = v,
            _ => {}
        }
    }
    Some([x, y, z])
}

/// Extrae fileID de `{fileID: 12345}` o `{fileID: 12345, guid: ..., type: 3}`
fn extract_file_id(s: &str) -> Option<u64> {
    let s = s.trim().trim_start_matches('{').trim_end_matches('}');
    for part in s.split(',') {
        let kv: Vec<&str> = part.splitn(2, ':').collect();
        if kv.len() == 2 && kv[0].trim() == "fileID" {
            return kv[1].trim().parse().ok();
        }
    }
    None
}

/// Extrae guid de `{fileID: ..., guid: abc123, type: 3}`
fn extract_guid(s: &str) -> Option<String> {
    let s = s.trim().trim_start_matches('{').trim_end_matches('}');
    for part in s.split(',') {
        let kv: Vec<&str> = part.splitn(2, ':').collect();
        if kv.len() == 2 && kv[0].trim() == "guid" {
            let g = kv[1].trim().to_string();
            if !g.is_empty() && g != "0" {
                return Some(g);
            }
        }
    }
    None
}

// ── Función principal: parse_prefab_text ────────────────────────────────────

pub struct ParsedPrefab {
    pub game_objects: HashMap<u64, RawGameObject>,
    pub transforms: HashMap<u64, RawTransform>,
    /// fileID de Transform → fileID de GameObject (inverso)
    pub transform_to_go: HashMap<u64, u64>,
    pub animator: Option<RawAnimator>,
    pub mono_behaviours: Vec<RawMonoBehaviour>,
}

pub fn parse_prefab_text(content: &str) -> ParsedPrefab {
    let mut game_objects: HashMap<u64, RawGameObject> = HashMap::new();
    let mut transforms: HashMap<u64, RawTransform> = HashMap::new();
    let mut animator: Option<RawAnimator> = None;
    let mut mono_behaviours: Vec<RawMonoBehaviour> = Vec::new();

    // Estado del bloque actual
    let mut current_class: Option<u32> = None;
    let mut current_file_id: u64 = 0;
    let mut in_children = false;
    let mut cur_go: Option<RawGameObject> = None;
    let mut cur_tf: Option<RawTransform> = None;
    let mut cur_an: Option<RawAnimator> = None;
    let mut cur_mb: Option<RawMonoBehaviour> = None;

    // Flush del bloque anterior al encontrar un nuevo header
    macro_rules! flush_block {
        () => {
            if let Some(go) = cur_go.take() { game_objects.insert(go.file_id, go); }
            if let Some(tf) = cur_tf.take() {
                transform_to_go_insert(&mut transforms, tf);
            }
            if let Some(an) = cur_an.take() { animator = Some(an); }
            if let Some(mb) = cur_mb.take() { mono_behaviours.push(mb); }
            in_children = false;
        };
    }

    for line in content.lines() {
        // Detectar nuevo bloque: `--- !u!<classID> &<fileID>`
        if line.starts_with("--- !u!") {
            flush_block!();
            if let Some(rest) = line.strip_prefix("--- !u!") {
                let parts: Vec<&str> = rest.splitn(2, ' ').collect();
                if let (Ok(class_id), Some(anchor)) = (
                    parts[0].parse::<u32>(),
                    parts.get(1).and_then(|s| s.strip_prefix('&')),
                ) {
                    current_class = Some(class_id);
                    current_file_id = anchor.trim().parse().unwrap_or(0);
                    match class_id {
                        CLASS_GAME_OBJECT => {
                            cur_go = Some(RawGameObject { file_id: current_file_id, is_active: true, ..Default::default() });
                        }
                        CLASS_TRANSFORM => {
                            cur_tf = Some(RawTransform { file_id: current_file_id, ..Default::default() });
                        }
                        CLASS_ANIMATOR => {
                            cur_an = Some(RawAnimator::default());
                        }
                        CLASS_MONO_BEHAVIOUR => {
                            cur_mb = Some(RawMonoBehaviour::default());
                        }
                        _ => { current_class = None; }
                    }
                }
            }
            continue;
        }

        match current_class {
            Some(CLASS_GAME_OBJECT) => {
                let go = cur_go.as_mut().unwrap();
                if let Some(v) = get_value(line, "m_Name") {
                    go.name = v.trim_matches('"').to_string();
                } else if let Some(v) = get_value(line, "m_IsActive") {
                    go.is_active = v.trim() != "0";
                } else if line.trim() == "m_Children:" {
                    in_children = true;
                } else if in_children {
                    let t = line.trim();
                    if t.starts_with("- {fileID:") {
                        if let Some(fid) = extract_file_id(t.trim_start_matches("- ")) {
                            if fid != 0 {
                                go.child_transform_ids.push(fid);
                            }
                        }
                    } else if !t.is_empty() && !t.starts_with('-') {
                        in_children = false;
                    }
                }
            }
            Some(CLASS_TRANSFORM) => {
                let tf = cur_tf.as_mut().unwrap();
                if let Some(v) = get_value(line, "m_GameObject") {
                    tf.game_object_id = extract_file_id(v).unwrap_or(0);
                } else if let Some(v) = get_value(line, "m_Father") {
                    // A cross-file reference contains a guid field (e.g. Prefab Variants or
                    // nested prefabs). In that case the Transform has no in-prefab parent
                    // and should be treated as a root node (father_id = 0).
                    if extract_guid(v).is_some() {
                        tf.father_id = 0;
                    } else {
                        tf.father_id = extract_file_id(v).unwrap_or(0);
                    }
                }
            }
            Some(CLASS_ANIMATOR) => {
                let an = cur_an.as_mut().unwrap();
                if let Some(v) = get_value(line, "m_Controller") {
                    an.controller_guid = extract_guid(v);
                }
            }
            Some(CLASS_MONO_BEHAVIOUR) => {
                let mb = cur_mb.as_mut().unwrap();
                if let Some(v) = get_value(line, "m_Script") {
                    mb.script_guid = extract_guid(v);
                } else if let Some(v) = get_value(line, "ViewPosition") {
                    mb.view_position = parse_vec3(v);
                } else if let Some(v) = get_value(line, "lipSync") {
                    mb.lip_sync_mode = v.trim().parse().ok();
                }
            }
            _ => {}
        }
    }
    flush_block!();

    // Construir mapa inverso transform→go
    let mut tmap: HashMap<u64, u64> = HashMap::new();
    for tf in transforms.values() {
        if tf.game_object_id != 0 {
            tmap.insert(tf.file_id, tf.game_object_id);
        }
    }

    ParsedPrefab { game_objects, transforms, transform_to_go: tmap, animator, mono_behaviours }
}

fn transform_to_go_insert(transforms: &mut HashMap<u64, RawTransform>, tf: RawTransform) {
    transforms.insert(tf.file_id, tf);
}

// ── Construcción del árbol ──────────────────────────────────────────────────

/// Construye PrefabNode recursivamente a partir del fileID de un Transform.
fn build_node(
    tf_id: u64,
    parsed: &ParsedPrefab,
    visited: &mut std::collections::HashSet<u64>,
) -> Option<PrefabNode> {
    if !visited.insert(tf_id) { return None; } // ciclo

    let go_id = *parsed.transform_to_go.get(&tf_id)?;
    let go = parsed.game_objects.get(&go_id)?;
    let tf = parsed.transforms.get(&tf_id)?;

    let children: Vec<PrefabNode> = go
        .child_transform_ids
        .iter()
        .filter_map(|child_tf_id| build_node(*child_tf_id, parsed, visited))
        .collect();

    Some(PrefabNode {
        file_id: go_id,
        name: go.name.clone(),
        is_active: go.is_active,
        children,
    })
}

/// Identifica los nodos raíz: Transforms cuyo m_Father == 0.
fn find_roots(parsed: &ParsedPrefab) -> Vec<u64> {
    parsed
        .transforms
        .values()
        .filter(|tf| tf.father_id == 0)
        .map(|tf| tf.file_id)
        .collect()
}

// ── Parser de .controller ────────────────────────────────────────────────────

/// Parsea un archivo .controller y extrae las capas VRC con sus estados.
/// Las 5 capas VRC son: Base, Additive, Gesture, Action, FX (por orden).
pub fn parse_controller_text(content: &str) -> Vec<AnimLayerInfo> {
    // Buscamos bloques AnimatorStateMachine (classID 1107) y AnimatorState (1102)
    // y los nombres de capa de AnimatorController (classID 91).

    // Estrategia simplificada: extraer todos los m_Name en contexto de
    // AnimatorStateMachine como nombre de capa, y los m_Name de AnimatorState
    // como estados.

    let mut layers: Vec<AnimLayerInfo> = Vec::new();
    let mut in_state_machine = false;
    let mut in_state = false;
    let mut current_layer_name: Option<String> = None;
    let mut current_states: Vec<AnimStateInfo> = Vec::new();
    let mut current_state: Option<AnimStateInfo> = None;
    let mut default_state_id: u64 = 0;
    let mut in_default_state = false;

    // VRC layer name order for positional matching when names are missing
    let vrc_layer_names = ["Base", "Additive", "Gesture", "Action", "FX"];
    let mut sm_count = 0;

    for line in content.lines() {
        if line.starts_with("--- !u!1107") {
            // Flush previous state machine
            if let Some(name) = current_layer_name.take() {
                if let Some(mut st) = current_state.take() {
                    current_states.push(st);
                }
                layers.push(AnimLayerInfo { name, states: current_states.drain(..).collect() });
            }
            in_state_machine = true;
            in_state = false;
            // Assign VRC layer name by position if possible
            let layer_name = vrc_layer_names.get(sm_count).map(|s| s.to_string());
            current_layer_name = layer_name;
            sm_count += 1;
            continue;
        }

        if line.starts_with("--- !u!1102") {
            // New AnimatorState
            if let Some(st) = current_state.take() {
                current_states.push(st);
            }
            in_state = true;
            in_state_machine = false;
            current_state = Some(AnimStateInfo {
                name: String::new(),
                clip_name: None,
                is_blend_tree: false,
                is_default: false,
            });
            continue;
        }

        if line.starts_with("--- !u!") {
            in_state_machine = false;
            in_state = false;
        }

        if in_state_machine {
            // Override layer name from m_Name if found (better than positional)
            if let Some(v) = get_value(line, "m_Name") {
                let name = v.trim_matches('"').to_string();
                if !name.is_empty() {
                    current_layer_name = Some(name);
                }
            }
        }

        if in_state {
            if let Some(st) = current_state.as_mut() {
                if let Some(v) = get_value(line, "m_Name") {
                    st.name = v.trim_matches('"').to_string();
                }
                if line.trim().contains("BlendTree") {
                    st.is_blend_tree = true;
                }
                // m_Motion references an AnimationClip — extract guid as hint
                // (no podemos resolver el clip name sin el proyecto completo)
            }
        }
    }

    // Flush last state machine
    if let Some(name) = current_layer_name.take() {
        if let Some(st) = current_state.take() {
            current_states.push(st);
        }
        layers.push(AnimLayerInfo { name, states: current_states });
    }

    layers
}

// ── Entrada pública: parse_prefab_file ──────────────────────────────────────

/// Lee un .prefab del disco, parsea jerarquía + animaciones + info avatar,
/// y devuelve un PrefabScene listo para serializar al frontend.
pub fn parse_prefab_file(prefab_path: &Path) -> anyhow::Result<PrefabScene> {
    let content = std::fs::read_to_string(prefab_path)?;
    let parsed = parse_prefab_text(&content);

    // Árbol jerárquico
    let mut visited = std::collections::HashSet::new();
    let root_tf_ids = find_roots(&parsed);
    let root_nodes: Vec<PrefabNode> = root_tf_ids
        .iter()
        .filter_map(|&tf_id| build_node(tf_id, &parsed, &mut visited))
        .collect();

    // Avatar info desde MonoBehaviours
    let avatar_info = build_avatar_info(&parsed.mono_behaviours);

    // Buscar .controller en el mismo directorio y parsearlo
    let anim_layers = try_parse_controller(prefab_path, &parsed.animator);

    // Buscar FBX/GLB junto al prefab (mismo dir, cualquier subdir directo)
    let suggested_mesh_file = find_mesh_sibling(prefab_path);

    Ok(PrefabScene { root_nodes, anim_layers, avatar_info, suggested_mesh_file })
}

fn build_avatar_info(behaviours: &[RawMonoBehaviour]) -> AvatarInfo {
    // Detectar VRC Descriptor: tiene ViewPosition O script_guid conocido
    for mb in behaviours {
        let is_vrc = mb.script_guid.as_deref() == Some(VRC_DESCRIPTOR_GUID)
            || mb.view_position.is_some();
        if is_vrc {
            return AvatarInfo {
                view_position: mb.view_position,
                lip_sync_mode: mb.lip_sync_mode,
                has_vrc_descriptor: true,
            };
        }
    }
    AvatarInfo { view_position: None, lip_sync_mode: None, has_vrc_descriptor: false }
}

fn try_parse_controller(prefab_path: &Path, animator: &Option<RawAnimator>) -> Vec<AnimLayerInfo> {
    let dir = match prefab_path.parent() { Some(d) => d, None => return vec![] };

    // Buscar .controller o .overrideController en el mismo directorio
    let candidates = std::fs::read_dir(dir).ok().map(|rd| {
        rd.filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name();
                let n = name.to_string_lossy();
                n.ends_with(".controller") || n.ends_with(".overrideController")
            })
            .map(|e| e.path())
            .collect::<Vec<_>>()
    }).unwrap_or_default();

    // Si hay guid en el animator, preferir el .meta que lo mencione
    // (simplificación: simplemente usamos el primero encontrado)
    for path in candidates {
        if let Ok(txt) = std::fs::read_to_string(&path) {
            let layers = parse_controller_text(&txt);
            if !layers.is_empty() {
                return layers;
            }
        }
    }
    vec![]
}

fn find_mesh_sibling(prefab_path: &Path) -> Option<String> {
    let dir = prefab_path.parent()?;
    let mesh_exts = ["fbx", "FBX", "glb", "GLB", "gltf", "vrm"];
    find_mesh_in_dir(dir, &mesh_exts, 0)
}

/// Búsqueda recursiva hasta max_depth niveles de subdirectorio.
fn find_mesh_in_dir(dir: &Path, mesh_exts: &[&str], depth: u32) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut dirs_to_recurse = Vec::new();

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            if depth < 2 {
                dirs_to_recurse.push(path);
            }
            continue;
        }
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if mesh_exts.contains(&ext) {
                return path.to_str().map(|s| s.to_string());
            }
        }
    }

    // Recursar en subdirectorios después de revisar archivos en este nivel
    for sub in dirs_to_recurse {
        if let Some(found) = find_mesh_in_dir(&sub, mesh_exts, depth + 1) {
            return Some(found);
        }
    }

    None
}