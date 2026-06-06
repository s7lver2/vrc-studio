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
