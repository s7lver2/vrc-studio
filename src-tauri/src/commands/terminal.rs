use std::path::PathBuf;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Ejecuta un comando de shell en el directorio del proyecto.
/// En Windows usa cmd /C; en otros sistemas usa sh -c.
#[tauri::command]
pub async fn run_in_project(project_path: String, command: String) -> Result<CommandOutput, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err(format!("Project path does not exist: {project_path}"));
    }

    let output = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let result = std::process::Command::new("cmd")
            .args(["/C", &command])
            .current_dir(&path)
            .output();

        #[cfg(not(target_os = "windows"))]
        let result = std::process::Command::new("sh")
            .args(["-c", &command])
            .current_dir(&path)
            .output();

        result.map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}