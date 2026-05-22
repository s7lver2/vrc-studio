// En release builds en Windows, no abrir ventana de consola.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    env_logger::init();
    vrc_studio_lib::app()
        .run(tauri::generate_context!())
        .expect("error while running vrc-studio");
}