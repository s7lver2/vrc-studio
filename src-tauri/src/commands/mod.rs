pub mod projects;
pub mod packages;
pub mod shop;
pub mod inventory;
pub mod vcs;
pub mod journal;
pub mod terminal;
pub mod build_monitor;
pub mod conflicts;
pub mod updates;
pub mod tracker;
pub mod app_settings;
pub mod cart;
pub mod collections;
pub mod booth_deps;
pub mod multi_avatar;

// TODO: pub mod vrchat_sdk; — vrchat_sdk_check_auth, vrchat_sdk_login,
//   vrchat_sdk_validate, vrchat_sdk_upload. Mientras no existan, el
//   VrchatUploadWizard usa simulación de progreso.

#[tauri::command]
pub fn ping(msg: String) -> String {
    format!("pong: {}", msg)
}