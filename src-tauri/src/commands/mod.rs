pub mod projects;
pub mod packages;
pub mod shop;
pub mod inventory;
pub mod vcs;

#[tauri::command]
pub fn ping(msg: String) -> String {
    format!("pong: {}", msg)
}