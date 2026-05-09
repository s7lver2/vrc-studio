use std::sync::{Arc, Mutex};
use std::io::{BufRead, Seek, SeekFrom};
use std::path::PathBuf;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── Estado global del monitor ─────────────────────────────────────────────────

pub struct BuildMonitorState {
    pub running: Arc<Mutex<bool>>,
}

impl Default for BuildMonitorState {
    fn default() -> Self {
        Self { running: Arc::new(Mutex::new(false)) }
    }
}

// ── Eventos emitidos al frontend ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BuildEvent {
    PhaseStarted { phase: String, label: String },
    PhaseFinished { phase: String, duration_ms: u64 },
    LogLine { text: String },
    BuildStarted,
    BuildFinished { total_ms: u64 },
}

// ── Ruta al log de Unity ──────────────────────────────────────────────────────

fn unity_log_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").ok()?;
        Some(PathBuf::from(local_app_data).join("Unity").join("Editor").join("Editor.log"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join("Library").join("Logs").join("Unity").join("Editor.log"))
    }
}

// ── Parser de líneas ──────────────────────────────────────────────────────────

fn detect_phase_start(line: &str) -> Option<(&'static str, &'static str)> {
    let l = line.trim();
    if l.contains("Refresh: detecting if any assets need to be imported") {
        return Some(("asset_detect", "Detecting asset changes"));
    }
    if l.contains("- Starting script compilation") || l.contains("Starting script compilation") {
        return Some(("script_compile", "Compiling scripts"));
    }
    if l.contains("Compile and link shader") {
        return Some(("shader_compile", "Compiling shaders"));
    }
    if l.contains("Start importing") && !l.contains("Start importing of") {
        return Some(("asset_import", "Importing assets"));
    }
    if l.contains("Reloading assemblies") && !l.contains("done") {
        return Some(("domain_reload", "Reloading domain"));
    }
    None
}

fn detect_phase_end(line: &str) -> Option<(&'static str, Option<u64>)> {
    let l = line.trim();
    if l.contains("Refresh: total imported") || l.contains("Refresh completed") {
        return Some(("asset_detect", None));
    }
    if l.starts_with("Assembly compile time:") {
        let ms = l.split_whitespace().nth(3)
            .and_then(|s| s.trim_end_matches('s').parse::<f64>().ok())
            .map(|s| (s * 1000.0) as u64);
        return Some(("script_compile", ms));
    }
    if l.contains("Finished compiling shaders") || l.contains("Compiling shader variants") {
        return Some(("shader_compile", None));
    }
    if l.contains("Refresh completed") {
        return Some(("asset_import", None));
    }
    if l.contains("Reloading assemblies done") || l.contains("Reload complete") {
        return Some(("domain_reload", None));
    }
    None
}

// ── Comando start ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_build_monitor(
    app: AppHandle,
    state: tauri::State<'_, BuildMonitorState>,
) -> Result<(), String> {
    let running = Arc::clone(&state.running);

    {
        let mut r = running.lock().unwrap();
        if *r { return Ok(()); }
        *r = true;
    }

    let log_path = unity_log_path()
        .ok_or_else(|| "Cannot determine Unity log path".to_string())?;

    tokio::spawn(async move {
        monitor_loop(app, log_path, running).await;
    });

    Ok(())
}

async fn monitor_loop(app: AppHandle, log_path: PathBuf, running: Arc<Mutex<bool>>) {
    let mut waited = 0u32;
    loop {
        if log_path.exists() { break; }
        if waited > 300 {
            let _ = running.lock().map(|mut r| *r = false);
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        waited += 1;
    }

    let file = match std::fs::File::open(&log_path) {
        Ok(f) => f,
        Err(_) => { let _ = running.lock().map(|mut r| *r = false); return; }
    };

    let mut reader = std::io::BufReader::new(file);
    let _ = reader.seek(SeekFrom::End(0));

    let mut phase_starts: std::collections::HashMap<String, std::time::Instant> =
        std::collections::HashMap::new();
    let mut build_start: Option<std::time::Instant> = None;
    let mut build_announced = false;
    let expected_phases = ["asset_detect", "script_compile", "domain_reload"];
    let mut finished_phases: std::collections::HashSet<String> = std::collections::HashSet::new();

    loop {
        if !*running.lock().unwrap() { break; }

        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                continue;
            }
            Ok(_) => {
                let line = line.trim_end_matches('\n').trim_end_matches('\r').to_string();
                if line.is_empty() { continue; }

                if let Some((phase, label)) = detect_phase_start(&line) {
                    if !build_announced {
                        build_announced = true;
                        build_start = Some(std::time::Instant::now());
                        let _ = app.emit("build:event", &BuildEvent::BuildStarted);
                    }
                    phase_starts.insert(phase.to_string(), std::time::Instant::now());
                    let _ = app.emit("build:event", &BuildEvent::PhaseStarted {
                        phase: phase.to_string(),
                        label: label.to_string(),
                    });
                    let _ = app.emit("build:event", &BuildEvent::LogLine { text: line.clone() });
                }

                if let Some((phase, log_ms)) = detect_phase_end(&line) {
                    let duration_ms = log_ms.unwrap_or_else(|| {
                        phase_starts.get(phase)
                            .map(|s| s.elapsed().as_millis() as u64)
                            .unwrap_or(0)
                    });
                    phase_starts.remove(phase);
                    finished_phases.insert(phase.to_string());
                    let _ = app.emit("build:event", &BuildEvent::PhaseFinished {
                        phase: phase.to_string(),
                        duration_ms,
                    });

                    if expected_phases.iter().all(|p| finished_phases.contains(*p)) {
                        let total_ms = build_start
                            .map(|s| s.elapsed().as_millis() as u64)
                            .unwrap_or(0);
                        let _ = app.emit("build:event", &BuildEvent::BuildFinished { total_ms });
                        finished_phases.clear();
                        build_announced = false;
                        build_start = None;
                    }
                }
            }
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
        }
    }

    let _ = running.lock().map(|mut r| *r = false);
}

// ── Comando stop ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn stop_build_monitor(
    state: tauri::State<'_, BuildMonitorState>,
) -> Result<(), String> {
    let mut r = state.running.lock().unwrap();
    *r = false;
    Ok(())
}