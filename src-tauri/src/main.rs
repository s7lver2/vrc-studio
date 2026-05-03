fn main() {
    env_logger::init();
    vrc_studio_lib::app()
        .run(tauri::generate_context!())
        .expect("error while running vrc-studio");
}